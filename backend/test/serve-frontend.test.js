import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveFrontend, distExists } from '../src/lib/serveFrontend.js';

/** A stand-in for `frontend/dist`, so these tests never depend on a real build. */
async function fakeDist() {
  const dir = await mkdtemp(join(tmpdir(), 'gt-dist-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Gold Tracker</title><div id="root"></div>');
  await writeFile(join(dir, 'assets', 'index-abc123.js'), 'console.log("bundle")');
  await writeFile(join(dir, 'assets', 'index-abc123.css'), 'body{color:red}');
  return dir;
}

/** Mounts a minimal app shaped like the real one: API first, then the frontend. */
async function serve({ dir, withApi = true } = {}) {
  const app = express();
  if (withApi) {
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'no such api route' }));
  }
  const result = serveFrontend(app, { dir });
  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    result,
    get: (path) => fetch(base + path),
    stop: () => new Promise((r) => server.close(r)),
  };
}

describe('routing', () => {
  test('the API is never shadowed by the app', async () => {
    // The whole risk of serving both from one process: a catch-all that
    // swallows /api and answers HTML where JSON was due.
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const health = await s.get('/api/health');
      assert.equal(health.status, 200);
      assert.match(health.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await health.json(), { ok: true });

      const missing = await s.get('/api/nope');
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('content-type'), /application\/json/);
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a client-side route survives a refresh', async () => {
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      for (const path of ['/', '/countries', '/countries/USA', '/compare?codes=POL']) {
        const res = await s.get(path);
        assert.equal(res.status, 200, path);
        assert.match(res.headers.get('content-type'), /text\/html/, path);
        assert.match(await res.text(), /id="root"/, path);
      }
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a missing asset is a 404, not the app shell', async () => {
    // Answering 200 with HTML for a missing .js makes the browser report a
    // syntax error in a file that does not exist, instead of saying it is
    // missing. This regressed once already.
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      for (const path of ['/assets/nope.js', '/assets/nope.css', '/favicon.ico', '/x/y/z.png']) {
        const res = await s.get(path);
        assert.equal(res.status, 404, path);
        assert.doesNotMatch(await res.text(), /id="root"/, `${path} returned the app shell`);
      }
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('assets that do exist are served', async () => {
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const js = await s.get('/assets/index-abc123.js');
      assert.equal(js.status, 200);
      assert.match(js.headers.get('content-type'), /javascript/);
      assert.match(await js.text(), /bundle/);
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('caching', () => {
  test('fingerprinted assets cache hard, the shell does not', async () => {
    // index.html must stay uncached, or a rebuild leaves browsers pinned to a
    // bundle that no longer exists.
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const asset = await s.get('/assets/index-abc123.js');
      assert.match(asset.headers.get('cache-control'), /max-age=31536000/);
      assert.match(asset.headers.get('cache-control'), /immutable/);

      const shell = await s.get('/countries');
      assert.match(shell.headers.get('cache-control'), /no-cache/);
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('content security policy', () => {
  test("the app gets a policy that lets it run, not the API's", async () => {
    // The API sends default-src 'none', which is right for JSON and would
    // block the app's own bundle outright.
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const csp = (await s.get('/')).headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      // The theme boot script is inline by necessity: it must run before first
      // paint, so it cannot be a separate request.
      assert.match(csp, /script-src-elem 'self' 'unsafe-inline'/);
      // React and Recharts set style attributes; without this, charts render
      // unstyled.
      assert.match(csp, /style-src-attr 'unsafe-inline'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /base-uri 'none'/);
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('no external origin is reachable from the page', async () => {
    // Self-hosted means self-hosted: no font CDN, no third-party script, and
    // the API is same-origin so connect-src needs nothing else.
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const csp = (await s.get('/')).headers.get('content-security-policy');
      assert.match(csp, /font-src 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.doesNotMatch(csp, /https?:\/\//, 'no external origin should be allowed');
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the usual headers are set on the app too', async () => {
    const dir = await fakeDist();
    const s = await serve({ dir });
    try {
      const res = await s.get('/');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    } finally {
      await s.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('when the app has not been built', () => {
  test('says so, instead of serving a broken page or a bare 404', async () => {
    const dir = join(tmpdir(), 'gt-dist-does-not-exist');
    assert.equal(distExists(dir), false);

    const s = await serve({ dir });
    try {
      assert.equal(s.result.serving, false);
      const res = await s.get('/');
      assert.equal(res.status, 503);
      const body = await res.text();
      assert.match(body, /has not been built/);
      assert.match(body, /npm run build/);
      // And points at the development path, which is the likelier intent.
      assert.match(body, /npm run dev/);
    } finally {
      await s.stop();
    }
  });

  test('the API still works while the app is missing', async () => {
    const s = await serve({ dir: join(tmpdir(), 'gt-dist-does-not-exist') });
    try {
      const res = await s.get('/api/health');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    } finally {
      await s.stop();
    }
  });
});
