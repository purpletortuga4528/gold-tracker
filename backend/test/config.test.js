import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Environment variables arrive as strings, and every subtle bug this file
 * covers comes from that. The rate limit and trust-proxy cases live in
 * rate-limit.test.js, beside the thing they configure.
 */

/** Re-imports config with `vars` applied, bypassing the module cache. */
async function withEnv(vars, key) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const { config } = await import(`../src/config.js?${key}`);
    return config;
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('HOST decides the interface, and unset means every one', async () => {
  // Undefined is not a neutral value here: app.listen(port, undefined) listens
  // on every interface, which is the default this deliberately keeps. What
  // matters is that an empty or whitespace-only value cannot become a host,
  // because listening on "" is not the same as listening on everything.
  const cases = [
    [undefined, undefined],
    ['', undefined],
    ['   ', undefined],
    ['127.0.0.1', '127.0.0.1'],
    ['  127.0.0.1  ', '127.0.0.1'],
    ['0.0.0.0', '0.0.0.0'],
    ['::1', '::1'],
  ];

  for (const [raw, expected] of cases) {
    const config = await withEnv({ HOST: raw }, `host=${encodeURIComponent(String(raw))}`);
    assert.equal(config.host, expected, `HOST=${JSON.stringify(raw)}`);
  }
});

test('a restricted HOST is actually honoured by the listener', async (t) => {
  // The config value is only half of it. This binds for real and checks that a
  // non-loopback address is refused, because a value that is read correctly and
  // then not passed to listen() would look identical in every other test.
  const { createApp } = await import('../src/app.js');
  const { networkInterfaces } = await import('node:os');

  const external = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const local = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(local.status, 200, 'loopback should answer');

    if (external) {
      await assert.rejects(
        fetch(`http://${external.address}:${port}/api/health`, { signal: AbortSignal.timeout(3000) }),
        'a bound-to-loopback server must not answer on a LAN address',
      );
    } else {
      // Said out loud rather than passed over. The LAN refusal is the half of
      // this test that matches its name, and it needs a non-loopback address
      // to attempt at all. On a machine with none, the test still passes
      // having checked only that loopback answers, which is a weaker claim
      // than the name makes, and a silent pass is how a check comes to be
      // trusted for something it never verified.
      t.diagnostic(
        'no non-internal IPv4 interface on this machine, so the LAN refusal was not attempted: ' +
          'only the loopback half of this test ran',
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
