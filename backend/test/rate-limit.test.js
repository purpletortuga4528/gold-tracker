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
  // The constraint that shapes every limit here. One Compare page load with six
  // countries fires 20 requests in about 0.03 seconds, and React StrictMode
  // doubles that again in development. A limit that rejects the app's own
  // normal behaviour is worse than no limit.
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
