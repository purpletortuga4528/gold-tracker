import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFeed } from '../../scripts/check-price-feed.mjs';

/**
 * Tests for the checker, not for the feed.
 *
 * The point of check-price-feed.mjs is that lbma.js reads currencies by
 * position and nothing had ever confirmed the positions. A checker for that
 * which has only ever been run against a correct feed has the same problem one
 * level up: it has never been seen to fail, so nobody knows it can.
 *
 * No network here. checkFeed is pure, and every case below is a real row with
 * one thing broken.
 */

const NOW = Date.parse('2026-09-09T12:00:00Z');

/** Two real consecutive PM fixes. */
const GOOD = [
  { is_cms_locked: 0, d: '2026-09-07', v: [4402.55, 3249.6, 3787.4] },
  { is_cms_locked: 0, d: '2026-09-08', v: [4399.1, 3246.1, 3784.55] },
];

const SPOT = { priceUsdPerOunce: 4399.1, benchmark: 'LBMA Gold Price PM', asOfDate: '2026-09-08' };

/** The latest row, with `v` or `d` replaced. */
const withLatest = (changes) => [GOOD[0], { ...GOOD[1], ...changes }];

const failuresOf = (rows, spot = SPOT, now = NOW) =>
  checkFeed(rows, spot, now).problems.map((p) => p.what);

test('a healthy feed produces no problems at all', () => {
  const { problems, notes } = checkFeed(GOOD, SPOT, NOW);
  assert.deepEqual(problems, [], JSON.stringify(problems));
  assert.ok(notes.length >= 4, 'it should still report what it saw');
});

test('a reordered v array is caught, which is the whole reason this exists', () => {
  // GBP first. The provider would report 3,246 as the dollar price: a number
  // that is wrong by a quarter and looks entirely ordinary on a page.
  const reordered = withLatest({ v: [3246.1, 3784.55, 4399.1] });
  assert.ok(
    failuresOf(reordered, { ...SPOT, priceUsdPerOunce: 3246.1 }).some((w) => /order/.test(w)),
    'a reordered feed must not pass',
  );
});

test('a fourth currency is caught, because it moves every index after it', () => {
  const extra = withLatest({ v: [4399.1, 3246.1, 3784.55, 660_000] });
  assert.ok(failuresOf(extra).some((w) => /number of currencies/.test(w)));
});

test('a value array turned into an object is caught', () => {
  const asObject = withLatest({ v: { USD: 4399.1, GBP: 3246.1, EUR: 3784.55 } });
  assert.ok(failuresOf(asObject).some((w) => /no longer an array/.test(w)));
});

test('a renamed or reformatted date field is caught', () => {
  assert.ok(failuresOf(withLatest({ d: '08/09/2026' })).some((w) => /date field/.test(w)));
  assert.ok(failuresOf(withLatest({ d: undefined })).some((w) => /date field/.test(w)));
});

test('an implausible price is caught even when the shape is perfect', () => {
  // A per-gram quote, which is the mistake that looks most like a price.
  const perGram = withLatest({ v: [141.4, 104.4, 121.7] });
  assert.ok(
    failuresOf(perGram, { ...SPOT, priceUsdPerOunce: 141.4 }).some((w) => /plausible gold price/.test(w)),
  );
});

test('a stalled feed is caught', () => {
  const stale = [
    { d: '2026-07-01', v: [4402.55, 3249.6, 3787.4] },
    { d: '2026-07-02', v: [4399.1, 3246.1, 3784.55] },
  ];
  assert.ok(failuresOf(stale).some((w) => /stopped updating/.test(w)));
});

test('a weekend gap is not mistaken for a stalled feed', () => {
  // Friday's fix read on Monday. Three days is normal and must stay quiet.
  const friday = [
    { d: '2026-09-03', v: [4402.55, 3249.6, 3787.4] },
    { d: '2026-09-04', v: [4399.1, 3246.1, 3784.55] },
  ];
  assert.deepEqual(failuresOf(friday, SPOT, Date.parse('2026-09-07T12:00:00Z')), []);
});

test('a jump no market made is caught', () => {
  // A decimal shift, or a column swapped in one row only.
  const jump = withLatest({ v: [3000, 2200, 2600] });
  assert.ok(
    failuresOf(jump, { ...SPOT, priceUsdPerOunce: 3000 }).some((w) => /jumped further/.test(w)),
  );
});

test('a real market move is not mistaken for a parsing error', () => {
  // Ten percent in a day is rare and has happened. It must not fail the build.
  const bigButReal = withLatest({ v: [4842.8, 3570.7, 4163.0] });
  assert.deepEqual(
    failuresOf(bigButReal, { ...SPOT, priceUsdPerOunce: 4842.8 }),
    [],
    'a large but plausible move should pass',
  );
});

test('the provider disagreeing with the feed is caught', () => {
  // The feed is fine and the code reading it is not, which is the failure the
  // shape checks above cannot see.
  const wrongReading = failuresOf(GOOD, { ...SPOT, priceUsdPerOunce: 3784.55 });
  assert.ok(wrongReading.some((w) => /disagrees with the feed/.test(w)));
});

test('an AM fallback is not treated as disagreement', () => {
  // The provider prefers PM and falls back to AM when AM is newer. That is a
  // different auction with a different number, and comparing them would fail
  // every morning before the PM fix publishes.
  const am = { priceUsdPerOunce: 4380.25, benchmark: 'LBMA Gold Price AM', asOfDate: '2026-09-09' };
  assert.deepEqual(failuresOf(GOOD, am), []);
});

test('an empty or non-array feed is caught rather than crashing', () => {
  assert.ok(failuresOf([]).some((w) => /non-empty array/.test(w)));
  assert.ok(failuresOf(null).some((w) => /non-empty array/.test(w)));
  assert.ok(failuresOf({ rows: [] }).some((w) => /non-empty array/.test(w)));
});
