import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProvider } from '../src/services/priceProviders/demo.js';
import { listProviders, getProvider } from '../src/services/priceProviders/index.js';

/**
 * The demo provider is the only thing in this repository that can put an
 * invented number in front of somebody, so what is tested here is mostly not
 * the numbers. It is that the warning travels with them, that it cannot be
 * reached by accident, and that it is identical on every run.
 */

test('it is never the default and must be asked for by name', () => {
  // A generated price becoming the default through an unset variable, a typo
  // or a bad merge is the one failure that matters here.
  const active = listProviders().filter((p) => p.active);
  assert.equal(active.length, 1);
  assert.notEqual(active[0].id, 'demo', 'demo must never be the active provider by default');
  assert.equal(active[0].id, 'lbma');
});

test('every response carries the warning, in every field that reaches the UI', async () => {
  for (const result of [await demoProvider.getSpot(), await demoProvider.getHistory({})]) {
    assert.equal(result.synthetic, true, 'the flag the UI reads must be set');
    assert.match(result.note, /NOT REAL PRICES/i);
    assert.match(result.providerLabel, /DEMONSTRATION/i);
    // "Spot" and "benchmark" are both claims about a real market.
    assert.equal(result.kind, 'demo');
    assert.doesNotMatch(result.benchmark, /LBMA/i, 'it must not borrow a real benchmark name');
  }
});

test('the provider listing marks it, so the API says so too', () => {
  const demo = listProviders().find((p) => p.id === 'demo');
  assert.ok(demo, 'it should be listed rather than hidden');
  assert.equal(demo.synthetic, true);
  assert.equal(demo.verified, false);
  assert.match(demo.label, /not real prices/i);
  assert.match(demo.description, /invented/i);

  const real = listProviders().find((p) => p.id === 'lbma');
  assert.equal(real.synthetic, false, 'the real provider must not be marked synthetic');
});

test('it is reachable through the registry when asked for', () => {
  assert.equal(getProvider('demo').id, 'demo');
});

test('the series is identical on every run', async () => {
  // Math.random here would mean a different chart on every restart, which
  // reads exactly like live data moving: the last impression this should give.
  const a = await demoProvider.getHistory({ from: '2020-01-01', to: '2020-12-31' });
  const b = await demoProvider.getHistory({ from: '2020-01-01', to: '2020-12-31' });
  assert.deepEqual(a.points, b.points);
  assert.ok(a.points.length > 200, 'a year should have a year of trading days');
});

test('the shape is plausible enough to chart, and the ranges all resolve', async () => {
  const { points } = await demoProvider.getHistory({});
  assert.ok(points.length > 10_000, 'the chart needs a real series behind it');
  assert.equal(points[0].date, '1968-04-01', 'it should cover what the real feed covers');

  for (const p of points) {
    assert.ok(Number.isFinite(p.priceUsdPerOunce) && p.priceUsdPerOunce > 0, `bad point ${p.date}`);
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
  }

  const sorted = points.every((p, i) => i === 0 || points[i - 1].date < p.date);
  assert.ok(sorted, 'points must be in order, or every range slice is wrong');

  // No weekend points: the real auction does not run then, and a chart with
  // those gaps is part of what the app is showing.
  const weekend = points.filter((p) => [0, 6].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay()));
  assert.deepEqual(weekend, [], 'the generated series should skip weekends like the real one');
});

test('a range slice returns only that range', async () => {
  const { points } = await demoProvider.getHistory({ from: '2011-01-01', to: '2011-12-31' });
  assert.ok(points.length > 200);
  assert.ok(points.every((p) => p.date >= '2011-01-01' && p.date <= '2011-12-31'));
});

test('the generated price does not shadow the real benchmark', async () => {
  /*
   * The anchor used to be the real LBMA PM fix of 2026-09-08, rounded to the
   * dollar, with the GBP and EUR multipliers taken from that day's actual
   * cross-rates. All three currencies then came out within 0.011 percent of
   * the published row at once, under labels reading "Not a real price".
   *
   * Labels do not make a number generated. A demonstration series that lands
   * on the benchmark is indistinguishable from the benchmark, which is both
   * misleading and the opposite of what this provider is for.
   *
   * Both sides are derived: the reference comes from what the last build
   * actually priced against, so this keeps working if that changes.
   */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname } = await import('node:path');

  const here = dirname(fileURLToPath(import.meta.url));
  const dataset = JSON.parse(readFileSync(resolve(here, '../data/gold-reserves.json'), 'utf8'));
  const reference = dataset.meta?.unitDetection?.latestReferencePriceUsdPerOunce;

  if (!Number.isFinite(reference)) return; // nothing recorded to compare against

  const spot = await demoProvider.getSpot();
  const apart = Math.abs(spot.priceUsdPerOunce - reference) / reference;

  assert.ok(
    apart > 0.02,
    `the demo price ${spot.priceUsdPerOunce} is within ${(apart * 100).toFixed(3)}% of the ` +
      `recorded benchmark ${reference}; it must be visibly its own number`,
  );
});
