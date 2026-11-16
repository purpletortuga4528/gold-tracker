import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/lib/cache.js';

/**
 * The TTL cache, which had no tests.
 *
 * The README makes a specific promise about it: "The TTL cache also
 * de-duplicates in-flight requests, so ten browser tabs opening at once make
 * one upstream call, not ten." That is the non-obvious half of this class and
 * the half that matters, because the price providers are metered: a provider
 * on a hundred requests a month cannot afford a dashboard that fans out one
 * call per tab.
 *
 * Nothing verified it. These tests exist because a documented claim about
 * somebody's quota should not rest on reading the code and agreeing with it.
 */

const later = (ms) => new Promise((r) => setTimeout(r, ms));

describe('in-flight de-duplication', () => {
  test('ten callers at once make one upstream call', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      await later(20);
      // An arbitrary payload. It used to be the recorded benchmark truncated
      // to the dollar, which made check:docs count this file as holding a
      // price. Nothing here cares what the number is.
      return { price: 1234 };
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => cache.get('spot', 300, produce)),
    );

    assert.equal(calls, 1, 'ten concurrent callers must share one upstream call');
    for (const r of results) assert.deepEqual(r.value, { price: 1234 }, 'every caller gets the value');
  });

  test('a failure is not cached, and the next caller may try again', async () => {
    // The opposite mistake: holding a rejected promise would turn one upstream
    // blip into a permanently broken endpoint.
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      if (calls === 1) throw new Error('upstream down');
      return 'recovered';
    };

    await assert.rejects(() => cache.get('k', 300, produce), /upstream down/);
    const second = await cache.get('k', 300, produce);

    assert.equal(second.value, 'recovered');
    assert.equal(calls, 2, 'the second caller must be allowed its own attempt');
  });

  test('concurrent callers all see the same failure rather than one hanging', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      await later(10);
      throw new Error('upstream down');
    };

    const settled = await Promise.allSettled([
      cache.get('k', 300, produce),
      cache.get('k', 300, produce),
      cache.get('k', 300, produce),
    ]);

    assert.equal(calls, 1, 'they should still share the one attempt');
    for (const s of settled) {
      assert.equal(s.status, 'rejected', 'a shared failure must reject every caller');
      assert.match(s.reason.message, /upstream down/);
    }
  });

  test('different keys do not share a call', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      await later(10);
      return calls;
    };

    await Promise.all([cache.get('spot', 300, produce), cache.get('history', 300, produce)]);
    assert.equal(calls, 2, 'two keys are two upstream calls');
  });
});

describe('expiry', () => {
  test('a value inside its TTL is served from the cache', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      return 'v';
    };

    const first = await cache.get('k', 300, produce);
    const second = await cache.get('k', 300, produce);

    assert.equal(calls, 1);
    assert.equal(first.cached, false, 'the first caller produced it');
    assert.equal(second.cached, true, 'the second was served from the cache');
    assert.equal(typeof second.ageSeconds, 'number');
  });

  test('a value past its TTL is produced again', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      return calls;
    };

    await cache.get('k', 0.01, produce);
    await later(25);
    const again = await cache.get('k', 0.01, produce);

    assert.equal(calls, 2, 'an expired entry must be refetched');
    assert.equal(again.value, 2);
  });
});

describe('the stale fallback', () => {
  test('peekStale returns an expired value, which is what keeps the page up', async () => {
    // price.js serves this when a refresh fails, flagged as stale, rather than
    // blanking the dashboard over somebody else's outage.
    const cache = new TtlCache();
    await cache.get('k', 0.01, async () => 'old');
    await later(25);

    const stale = cache.peekStale('k');
    assert.equal(stale.value, 'old', 'the expired value is still there to fall back on');
    assert.equal(typeof stale.ageSeconds, 'number');
  });

  test('peekStale is null when nothing was ever cached', () => {
    // null, not an object with an undefined value: price.js tests the result
    // for truthiness before using it, so this is the distinction that decides
    // whether it falls back or reports the outage.
    assert.equal(new TtlCache().peekStale('never'), null);
  });

  test('clear() drops the values and the in-flight map', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const produce = async () => {
      calls += 1;
      return 'v';
    };

    await cache.get('k', 300, produce);
    cache.clear();
    await cache.get('k', 300, produce);

    assert.equal(calls, 2, 'a cleared cache must produce again');
    assert.equal(cache.peekStale('k').value, 'v');
  });
});
