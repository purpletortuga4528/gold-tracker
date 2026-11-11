import test from 'node:test';
import assert from 'node:assert/strict';
import { metalsDevProvider, FREE_TIER_BUDGET } from '../src/services/priceProviders/metalsdev.js';
import { listProviders, getProvider } from '../src/services/priceProviders/index.js';

/**
 * What can be tested without a key, which is not the thing that matters most.
 *
 * This provider is written from metals.dev's published documentation and has
 * never been run. The last two adapters written that way were deleted rather
 * than shipped, so nothing here claims it works: `verified` stays false until
 * `npm run verify:provider -- metalsdev` has been run against a real key and
 * the number checked against a public quote. These cover the parts that need
 * no network: that it is registered, that it refuses to invent a price, and
 * that the quota arithmetic behind the startup warning is right.
 */

test('it is registered, keyed, and honestly marked unverified', () => {
  const p = listProviders().find((x) => x.id === 'metalsdev');
  assert.ok(p, 'it should be listed');
  assert.equal(p.requiresKey, true);
  assert.equal(p.verified, false, 'nothing written from documentation may claim to be verified');
  assert.equal(p.synthetic, false, 'it is a real source, unlike the demo provider');
  assert.equal(getProvider('metalsdev').id, 'metalsdev');
});

test('it is not the default, so an unset key cannot break a working install', () => {
  const active = listProviders().filter((x) => x.active);
  assert.equal(active.length, 1);
  assert.notEqual(active[0].id, 'metalsdev');
});

test('without a key it names the variable to set rather than failing obscurely', async () => {
  // config is read at import and no key is set in the test environment.
  await assert.rejects(() => metalsDevProvider.getSpot(), /METALS_DEV_API_KEY/);
  await assert.rejects(() => metalsDevProvider.getHistory({}), /METALS_DEV_API_KEY/);
});

test('the free tier budget is arithmetic, not a guess', () => {
  const { requestsPerMonth, spotSeconds, historySeconds } = FREE_TIER_BUDGET;
  const perMonth = 30 * (86_400 / spotSeconds + 86_400 / historySeconds);
  assert.ok(
    perMonth <= requestsPerMonth,
    `the recommended lifetimes cost ${perMonth}/month against a ${requestsPerMonth} quota`,
  );
  // And not needlessly conservative either: an unspent quota is a staler
  // price than the plan actually pays for.
  assert.ok(perMonth > requestsPerMonth * 0.5, 'the recommendation should use most of the quota');
});

test('the shipped cache defaults do not fit the free tier, which is why there is a warning', () => {
  // The premise of the startup warning. If a future change made the defaults
  // affordable the warning would be noise, and this is what would say so.
  const shipped = 30 * (86_400 / 300 + 86_400 / 21_600);
  assert.ok(
    shipped > FREE_TIER_BUDGET.requestsPerMonth,
    'the defaults now fit the free tier, so the startup warning is obsolete',
  );
});
