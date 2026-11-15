import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

async function serve() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (path, init) => fetch(base + path, init),
    stop: () => new Promise((r) => server.close(r)),
  };
}

test('a burst the size of a real page load is not throttled', async () => {
  // The constraint that shapes every limit here. A cold Compare load with six
  // countries fires exactly the 10 requests below, inside a millisecond, and
  // React StrictMode doubles them to 20 in development. That doubled burst is
  // what this replays. A limit that rejects the app's own normal behaviour is
  // worse than no limit.
  const s = await serve();
  try {
    const paths = [
      '/api/reserves/freshness',
      '/api/price/current',
      '/api/reserves/meta',
      '/api/reserves?kind=all',
      ...['POL', 'CHN', 'TUR', 'IND', 'JPN', 'DEU'].map((c) => `/api/reserves/${c}`),
    ];
    // Twice over, standing in for StrictMode's double invocation.
    const results = await Promise.all([...paths, ...paths].map((p) => s.get(p)));
    const throttled = results.filter((r) => r.status === 429);
    assert.equal(throttled.length, 0, `${throttled.length} of ${results.length} were throttled`);
  } finally {
    await s.stop();
  }
});

test('the general limit engages once it is exceeded', async () => {
  const s = await serve();
  try {
    const n = config.rateLimit.general;
    // Sequential: the point is the cutover, not concurrency.
    let firstThrottledAt = null;
    for (let i = 1; i <= n + 5; i += 1) {
      const res = await s.get('/api/reserves/freshness');
      if (res.status === 429 && firstThrottledAt === null) firstThrottledAt = i;
    }
    assert.equal(firstThrottledAt, n + 1, `expected throttling to begin at request ${n + 1}`);
  } finally {
    await s.stop();
  }
});

test('a throttled response is JSON, not an HTML error page', async () => {
  const s = await serve();
  try {
    let res;
    for (let i = 0; i <= config.rateLimit.general; i += 1) {
      res = await s.get('/api/reserves/freshness');
    }
    assert.equal(res.status, 429);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.match(body.error, /Too many requests/);
    // The shared error shape, so the frontend renders it like any other failure.
    assert.equal(Object.keys(body).join(), 'error');
  } finally {
    await s.stop();
  }
});

test('rate limit headers are advertised', async () => {
  const s = await serve();
  try {
    const res = await s.get('/api/reserves/freshness');
    const names = [...res.headers.keys()];
    assert.ok(
      names.some((h) => h.startsWith('ratelimit')),
      `expected RateLimit headers, got: ${names.join(', ')}`,
    );
    // draft-8 standard headers only; the legacy X-RateLimit-* set is off.
    assert.ok(!names.some((h) => h.startsWith('x-ratelimit')), 'legacy headers should be off');
  } finally {
    await s.stop();
  }
});

test('the price history bucket is tighter than the general one', async () => {
  // The 694 kB payload is the amplification case, so it must run out first.
  assert.ok(
    config.rateLimit.priceHistory < config.rateLimit.general,
    'history limit should be stricter than the general limit',
  );

  const s = await serve();
  try {
    let throttledAt = null;
    for (let i = 1; i <= config.rateLimit.priceHistory + 3; i += 1) {
      const res = await s.get('/api/price/history?range=1m');
      if (res.status === 429) {
        throttledAt = i;
        break;
      }
    }
    assert.equal(throttledAt, config.rateLimit.priceHistory + 1);
  } finally {
    await s.stop();
  }
});

test('health keeps answering after the general limit would have run out', async () => {
  // A monitor polls health, and throttling it would fake an outage at exactly
  // the moment health matters.
  assert.ok(config.rateLimit.health > config.rateLimit.general);

  const s = await serve();
  try {
    for (let i = 0; i < 40; i += 1) await s.get('/api/reserves/freshness');
    const res = await s.get('/api/health');
    assert.equal(res.status, 200);
  } finally {
    await s.stop();
  }
});

test('a forwarded header cannot be used to dodge the limit', async () => {
  // trust proxy is off by default, so X-Forwarded-For is ignored and every
  // request keys to the real socket address. If this ever fails, someone has
  // turned trust proxy on and handed callers an unlimited bypass.
  assert.equal(config.trustProxy, false);

  const s = await serve();
  try {
    const n = config.rateLimit.general;
    for (let i = 0; i < n; i += 1) await s.get('/api/reserves/freshness');

    const spoofed = await s.get('/api/reserves/freshness', {
      headers: { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 250)}` },
    });
    assert.equal(spoofed.status, 429, 'a spoofed X-Forwarded-For must not reset the bucket');
  } finally {
    await s.stop();
  }
});

test('the proxy misconfiguration warns only when it is actually happening', async () => {
  // Two separate disclosures, deliberately. The startup banner always states how
  // the limits behave, so nothing is hidden. This middleware is the live signal:
  // it fires only when a forwarded header actually shows up, which is the moment
  // the standing caveat stops being hypothetical.
  const { warnIfProxied } = await import('../src/lib/rateLimit.js');
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const mw = warnIfProxied(false);
    const next = () => {};

    mw({ headers: {} }, null, next);
    assert.equal(warnings.length, 0, 'ordinary traffic should not warn');

    mw({ headers: { 'x-forwarded-for': '203.0.113.9' } }, null, next);
    assert.equal(warnings.length, 1, 'a forwarded header should warn');
    assert.match(warnings[0], /TRUST_PROXY/);

    // Once, not once per request: this is a configuration fact, not an event.
    for (let i = 0; i < 5; i += 1) {
      mw({ headers: { 'x-forwarded-for': `203.0.113.${i}` } }, null, next);
    }
    assert.equal(warnings.length, 1, 'the warning should not repeat');

    // The RFC 7239 spelling counts too.
    const mw2 = warnIfProxied(false);
    mw2({ headers: { forwarded: 'for=203.0.113.9' } }, null, next);
    assert.equal(warnings.length, 2);

    // Configured correctly, there is nothing to say.
    const mw3 = warnIfProxied(1);
    mw3({ headers: { 'x-forwarded-for': '203.0.113.9' } }, null, next);
    assert.equal(warnings.length, 2, 'no warning once trust proxy is configured');
  } finally {
    console.warn = original;
  }
});

test('TRUST_PROXY is parsed into something Express understands', async () => {
  // Environment variables are strings, and Express reads a string as an IP
  // allowlist. Every natural spelling was wrong in its own way: false/true/off
  // and empty threw "invalid IP address" and killed the process at startup,
  // and "1" was accepted while trusting nothing, because hop counts must be
  // numbers. "1" is what the documentation says to set, so the one documented
  // mitigation for the shared-bucket problem did nothing at all.
  const express = (await import('express')).default;

  const cases = [
    [undefined, false],
    ['', false],
    ['false', false],
    ['FALSE', false],
    ['off', false],
    ['no', false],
    ['0', false],
    ['true', true],
    ['on', true],
    ['1', 1],
    ['2', 2],
    ['loopback', 'loopback'],
    ['10.0.0.1', '10.0.0.1'],
  ];

  for (const [raw, expected] of cases) {
    // Re-import the config with the variable set, bypassing the module cache.
    const before = process.env.TRUST_PROXY;
    if (raw === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = raw;
    const { config: fresh } = await import(`../src/config.js?trust=${encodeURIComponent(String(raw))}`);
    if (before === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = before;

    assert.deepEqual(fresh.trustProxy, expected, `TRUST_PROXY=${JSON.stringify(raw)}`);

    // And Express must accept it rather than throwing on startup.
    assert.doesNotThrow(() => express().set('trust proxy', fresh.trustProxy), `express rejected ${JSON.stringify(raw)}`);
  }
});

test('a hop count actually trusts a hop', async () => {
  // The regression that mattered: '1' as a string trusted nothing, silently,
  // which is indistinguishable from the misconfiguration it was meant to fix.
  const express = (await import('express')).default;

  const asNumber = express();
  asNumber.set('trust proxy', 1);
  assert.deepEqual(
    [0, 1, 2].map((hop) => asNumber.get('trust proxy fn')('203.0.113.9', hop)),
    [true, false, false],
    'a numeric hop count trusts exactly one hop',
  );

  const asString = express();
  asString.set('trust proxy', '1');
  assert.deepEqual(
    [0, 1, 2].map((hop) => asString.get('trust proxy fn')('203.0.113.9', hop)),
    [false, false, false],
    'a string trusts nothing, which is why config must convert it to a number',
  );
});

test('a path merely starting with /api/health does not escape rate limiting', async () => {
  // This was a bypass. Express mounts on segment boundaries, so the health
  // limiter never matched /api/healthz, while a startsWith test in the general
  // limiter's skip rule did. Anything under that prefix was unlimited.
  const s = await serve();
  try {
    for (const p of ['/api/healthz', '/api/healthzzz', '/api/health-check']) {
      const res = await s.get(p);
      const names = [...res.headers.keys()];
      assert.ok(
        names.some((h) => h.startsWith('ratelimit')),
        `${p} answered with no rate limit applied at all`,
      );
    }
    // The real endpoint still gets the health bucket, not the general one.
    const health = await s.get('/api/health');
    assert.match(health.headers.get('ratelimit') ?? '', /1200/);
  } finally {
    await s.stop();
  }
});

test('a non-positive limit falls back to the default rather than taking the API offline', async () => {
  // express-rate-limit v7 and later answer every request with 429 when the
  // limit is 0, so a typo in an env var is a self-inflicted outage, not a
  // disabled limiter. Verified against the library below rather than assumed.
  const cases = [
    ['0', 600],
    ['-1', 600],
    // parseInt would read these as 1 and 600, quietly configuring a limit
    // nobody typed. The config uses Number so they are rejected instead.
    ['1.5', 600],
    ['600abc', 600],
    ['abc', 600],
    ['', 600],
    ['250', 250],
  ];

  for (const [raw, expected] of cases) {
    const before = process.env.RATE_LIMIT_GENERAL;
    process.env.RATE_LIMIT_GENERAL = raw;
    // Silence the warning the fallback prints; the point here is the value.
    const warn = console.warn;
    console.warn = () => {};
    const { config: fresh } = await import(`../src/config.js?limit=${encodeURIComponent(raw)}`);
    console.warn = warn;
    if (before === undefined) delete process.env.RATE_LIMIT_GENERAL;
    else process.env.RATE_LIMIT_GENERAL = before;

    assert.equal(fresh.rateLimit.general, expected, `RATE_LIMIT_GENERAL=${JSON.stringify(raw)}`);
  }
});

test('a limit of zero really does block everything, which is why the guard exists', async () => {
  // The premise of the test above. If a future version of express-rate-limit
  // changes this to mean "unlimited", the guard is still right but the reason
  // in the comment is not, and this is what would say so.
  const express = (await import('express')).default;
  const { rateLimit } = await import('express-rate-limit');

  const app = express();
  app.use(rateLimit({ windowMs: 60_000, limit: 0, standardHeaders: 'draft-8', legacyHeaders: false, validate: false }));
  app.get('/', (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(res.status, 429, 'limit: 0 should reject, not pass through');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('a doubled slash cannot dodge the rate limiter or the API', async () => {
  // `//api/reserves` is the same resource to every proxy and browser, and was
  // nothing to Express: the limiters mount on `/api` and the SPA fallback
  // excludes `/api/` with a lookahead, and a doubled slash slipped past both.
  // It answered 200 with no RateLimit header, served by the client-routing
  // fallback that /api/* is documented as never reaching. No data leaked, but
  // an unlimited path is the same shape as the /api/healthz bypass this
  // repository has already had once.
  const s = await serve();
  try {
    for (const path of ['//api/reserves', '/api//reserves', '///api//reserves']) {
      const res = await s.get(path);
      assert.equal(res.status, 200, `${path} should reach the API`);
      assert.ok(res.headers.get('ratelimit'), `${path} must be rate limited`);
      assert.match(
        res.headers.get('content-type') ?? '',
        /application\/json/,
        `${path} must be answered by the API, not the app shell`,
      );
      const body = await res.json();
      assert.ok(Array.isArray(body.countries), `${path} should return real data`);
    }
  } finally {
    await s.stop();
  }
});

test('normalising the path leaves the query string alone', async () => {
  // Slashes are meaningful inside a query value, and collapsing them would
  // quietly corrupt whatever somebody passed.
  const s = await serve();
  try {
    const res = await s.get('/api/reserves?search=' + encodeURIComponent('a//b'));
    assert.equal(res.status, 200);
    // No country matches "a//b", so an empty result proves the value arrived
    // intact rather than having been collapsed into something that matches.
    const body = await res.json();
    assert.equal(body.countries.length, 0);
  } finally {
    await s.stop();
  }
});

test('an absolute-form request target is refused, not half-routed', async () => {
  // `GET http://host/api/reserves HTTP/1.1` is legal and meant for proxies.
  // This server never proxies, so nothing legitimate sends it one. Rewriting
  // req.url to the pathname was not enough: Express matches a mount against
  // the parsed pathname and then strips the prefix by slicing the raw url, so
  // it came out as `http://host/api` and fell through to the app shell with a
  // 200. Rate limited and carrying no API data, but a request the router
  // mishandles should not be answered 200 at all.
  const { createApp } = await import('../src/app.js');
  const net = await import('node:net');

  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();

  const raw = (line) =>
    new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () =>
        socket.write(`${line}\r\nHost: h\r\nConnection: close\r\n\r\n`),
      );
      let buf = '';
      socket.on('data', (d) => (buf += d));
      socket.on('end', () => resolve(buf));
      socket.on('error', () => resolve(''));
    });

  try {
    for (const form of [
      `GET http://127.0.0.1:${port}/api/reserves HTTP/1.1`,
      `GET http://127.0.0.1:${port}//api/reserves HTTP/1.1`,
    ]) {
      const res = await raw(form);
      assert.match(res.split('\r\n')[0], /400/, `${form} should be refused`);
      assert.match(res, /Absolute-form/, 'and should say why');
      assert.doesNotMatch(res, /<!doctype html>/i, 'never the app shell');
    }

    // The ordinary forms are untouched by that refusal.
    const ok = await raw('GET /api/reserves?limit=1 HTTP/1.1');
    assert.match(ok.split('\r\n')[0], /200/);
    assert.match(ok, /application\/json/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
