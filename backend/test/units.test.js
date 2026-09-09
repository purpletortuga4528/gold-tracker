import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  troyOuncesToTonnes,
  tonnesToTroyOunces,
  reserveValueUsd,
  TROY_OUNCES_PER_TONNE,
} from '../src/lib/units.js';
import { rangeToStartDate } from '../src/services/price.js';

test('a tonne is 32,150.7466 troy ounces', () => {
  assert.equal(TROY_OUNCES_PER_TONNE.toFixed(4), '32150.7466');
});

test('US reported ounces convert to the published tonnage', () => {
  // The IMF reports 261,499,000 fine troy ounces for the United States, which
  // is published elsewhere as 8,133.5 tonnes. If this drifts, the conversion
  // constant is wrong and every USD figure in the app is wrong with it.
  assert.equal(troyOuncesToTonnes(261_499_000).toFixed(1), '8133.5');
});

test('conversion round-trips', () => {
  const tonnes = 2451.85;
  assert.ok(Math.abs(troyOuncesToTonnes(tonnesToTroyOunces(tonnes)) - tonnes) < 1e-9);
});

test('reserve value uses troy ounces, not grams', () => {
  // One tonne at $4,000/oz is ~$128.6m. Using grams (1e6 per tonne) would give
  // $4bn, which is the single most likely way to get this app badly wrong.
  const value = reserveValueUsd(1, 4000);
  assert.ok(value > 128_000_000 && value < 129_000_000, `got ${value}`);
});

test('range shorthands resolve to a start date', () => {
  const now = new Date('2026-09-08T00:00:00Z');
  assert.equal(rangeToStartDate('1y', now), '2025-09-08');
  assert.equal(rangeToStartDate('3m', now), '2026-06-08');
  assert.equal(rangeToStartDate('max', now), null);
  assert.equal(rangeToStartDate(undefined, now), null);
});
