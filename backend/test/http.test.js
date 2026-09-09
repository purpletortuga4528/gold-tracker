import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { stringParam, numberParam, HttpError } from '../src/lib/http.js';

/** Starts the app on an ephemeral port and returns a fetch helper plus a stop(). */
async function serve() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (path) => {
      const res = await fetch(base + path);
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: res.status, body, headers: res.headers };
    },
    stop: () => new Promise((r) => server.close(r)),
  };
}

test('repeated query parameters are rejected, not crashed on', async () => {
  // `?kind=a&kind=b` used to reach `kind.split(...)` and throw a TypeError,
  // answering 502 with the internal error text. Anyone could send it.
  const s = await serve();
  try {
    for (const q of [
      '/api/reserves?kind=country&kind=all',
      '/api/reserves?search=a&search=b',
      '/api/reserves?region=Europe&region=Asia',
      '/api/reserves?kind[]=country',
      '/api/reserves?limit=1&limit=2',
    ]) {
      const { status, body } = await s.get(q);
      assert.equal(status, 400, `${q} should be a client error, got ${status}`);
      assert.match(body.error, /at most once/);
    }
  } finally {
    await s.stop();
  }
});

test('limit is bounded', async () => {
  const s = await serve();
  try {
    assert.equal((await s.get('/api/reserves?limit=0')).status, 400);
    assert.equal((await s.get('/api/reserves?limit=-5')).status, 400);
    assert.equal((await s.get('/api/reserves?limit=100000')).status, 400);
    assert.equal((await s.get('/api/reserves?limit=abc')).status, 400);
    assert.equal((await s.get('/api/reserves?limit=5')).status, 200);
  } finally {
    await s.stop();
  }
});

test('no response leaks a filesystem path or an upstream URL', async () => {
  const s = await serve();
  try {
    const paths = [
      '/api/reserves',
      '/api/reserves/USA',
      '/api/reserves/ZZZ',
      '/api/reserves/__proto__',
      '/api/reserves?kind=a&kind=b',
      '/api/nope',
      '/api/price/history?range=nonsense',
    ];
    for (const p of paths) {
      const { body } = await s.get(p);
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      // Only error text is checked for paths; /api/reserves legitimately
      // carries the IMF query URL in its provenance metadata.
      const error = typeof body === 'object' && body?.error;
      if (error) {
        assert.doesNotMatch(error, /[A-Za-z]:\\|\/home\/|\/Users\//, `path leaked by ${p}: ${error}`);
        assert.doesNotMatch(error, /https?:\/\//, `URL leaked by ${p}: ${error}`);
      }
      assert.ok(!text.includes('node_modules'), `internals leaked by ${p}`);
    }
  } finally {
    await s.stop();
  }
});

test('a 404 does not reflect the raw request target', async () => {
  const s = await serve();
  try {
    const { status, body } = await s.get('/api/reserves/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    assert.equal(status, 404);
    assert.doesNotMatch(body.error, /<script>/i);
  } finally {
    await s.stop();
  }
});

test('security headers are set on every response', async () => {
  const s = await serve();
  try {
    for (const p of ['/api/health', '/api/reserves?limit=1', '/api/nope']) {
      const { headers } = await s.get(p);
      assert.equal(headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(headers.get('x-frame-options'), 'DENY', p);
      assert.equal(headers.get('referrer-policy'), 'no-referrer', p);
      assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, p);
    }
  } finally {
    await s.stop();
  }
});

test('the framework banner is not advertised', async () => {
  const s = await serve();
  try {
    assert.equal((await s.get('/api/health')).headers.get('x-powered-by'), null);
  } finally {
    await s.stop();
  }
});

test('a deliberate 5xx message survives, an accidental one does not', async () => {
  // The expose flag, not the status code, decides. Keying this off status
  // swallowed the 503 that tells an operator to run `npm run build:data` and
  // the 502 that says the price provider is unreachable.
  const express = (await import('express')).default;
  const app = express();
  app.get('/safe', () => {
    throw new HttpError(503, 'Run npm run build:data');
  });
  app.get('/leaky', () => {
    throw new Error(String.raw`ENOENT C:\secret\path\data.json`);
  });
  // Same handler shape as src/app.js.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const safe = err instanceof HttpError || err?.expose === true;
    res.status(status).json({
      error: safe ? err.message : status >= 500 ? 'Internal server error' : 'Bad request',
    });
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const safe = await (await fetch(`${base}/safe`)).json();
    assert.equal(safe.error, 'Run npm run build:data');
    const leaky = await (await fetch(`${base}/leaky`)).json();
    assert.equal(leaky.error, 'Internal server error');
    assert.doesNotMatch(leaky.error, /secret/);
    assert.doesNotMatch(leaky.error, /[A-Za-z]:\\/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('inherited object properties are not mistaken for query parameters', () => {
  // req.query is a plain object, so query.constructor resolves to a function.
  // Reading it without an own-property check made an unsent parameter look
  // present, and a legitimate request would have been rejected.
  assert.equal(stringParam({}, 'constructor'), undefined);
  assert.equal(stringParam({}, 'toString'), undefined);
  assert.equal(stringParam({}, 'valueOf'), undefined);
  assert.equal(stringParam({}, '__proto__'), undefined);
  assert.equal(stringParam({ constructor: 'x' }, 'constructor'), 'x');
});

test('stringParam accepts a string and rejects anything else', () => {
  assert.equal(stringParam({ a: 'x' }, 'a'), 'x');
  assert.equal(stringParam({}, 'a'), undefined);
  assert.throws(() => stringParam({ a: ['x', 'y'] }, 'a'), HttpError);
  assert.throws(() => stringParam({ a: { b: 'c' } }, 'a'), HttpError);
});

test('numberParam enforces its bounds', () => {
  assert.equal(numberParam({ n: '5' }, 'n', { min: 1, max: 10 }), 5);
  assert.equal(numberParam({}, 'n'), undefined);
  assert.throws(() => numberParam({ n: '0' }, 'n', { min: 1, max: 10 }), HttpError);
  assert.throws(() => numberParam({ n: '11' }, 'n', { min: 1, max: 10 }), HttpError);
  assert.throws(() => numberParam({ n: 'abc' }, 'n'), HttpError);
  assert.throws(() => numberParam({ n: 'Infinity' }, 'n'), HttpError);
});
