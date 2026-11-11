import test from 'node:test';
import assert from 'node:assert/strict';
import { lbmaProvider } from '../src/services/priceProviders/lbma.js';

/**
 * Which provider failures are allowed to reach a client.
 *
 * The default is that none are. A provider's own message routinely carries the
 * request URL, and for a keyed provider the key travels inside it, so price.js
 * logs the original and returns a fixed string instead.
 *
 * `publicMessage` is the opt out of that, and it is an opt out with a point:
 * when the LBMA feed closed, "Could not reach the gold price provider" sent
 * people to check their network for a feed that had been withdrawn. The
 * message that replaces it is written here rather than upstream, names no URL
 * carrying a secret, and is the only thing that explains the failure.
 *
 * fetch is stubbed, so this needs no network and cannot pass by accident when
 * the feed happens to be up.
 */

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};

const forbidden = () =>
  Promise.resolve(new Response('<!doctype html>Attention Required! | Cloudflare', { status: 403 }));

test('a closed LBMA feed explains itself rather than blaming the network', async () => {
  await withFetch(forbidden, async () => {
    const err = await lbmaProvider.getSpot().then(
      () => null,
      (e) => e,
    );
    assert.ok(err, 'it should reject when both feeds are forbidden');
    assert.match(err.message, /closed in late 2026/);
    assert.match(err.message, /IBA licence/);
    // And it points at the two things that do work.
    assert.match(err.message, /PRICE_PROVIDER=metalsdev/);
    assert.match(err.message, /PRICE_PROVIDER=demo/);
    // Reserves are the half that still works, and saying so stops somebody
    // concluding the whole app is broken.
    assert.match(err.message, /Reserve figures are unaffected/);
  });
});

test('that message is marked safe to show, and carries no URL that could hold a key', async () => {
  await withFetch(forbidden, async () => {
    const err = await lbmaProvider.getSpot().catch((e) => e);
    assert.equal(err.publicMessage, err.message, 'it must opt in explicitly');
    assert.doesNotMatch(err.publicMessage, /https?:\/\/\S*[?&]/, 'no URL with a query string');
    assert.doesNotMatch(err.publicMessage, /api_key|apikey|token/i);
  });
});

test('an ordinary provider failure stays unexposed', async () => {
  // The default, and the reason the opt in exists at all. A transport error
  // carries whatever the runtime put in it, which is not ours to forward.
  await withFetch(
    () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:443 while fetching https://host/path?api_key=SECRET')),
    async () => {
      const err = await lbmaProvider.getSpot().catch((e) => e);
      assert.equal(err.publicMessage, undefined, 'an upstream message must not opt itself in');
    },
  );
});
