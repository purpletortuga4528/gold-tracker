import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUnitScale, classifyValuation, buildEntry, makePriceLookup } from '../scripts/build-reserves.mjs';
import { troyOuncesToTonnes, reserveValueUsd } from '../src/lib/units.js';

const config = {
  scaleTolerance: 0.25,
  statutoryBookUsdPerOunce: 42.2222,
  maxPlausibleTonnes: 9000,
};
const REFERENCE = 4402.55; // LBMA PM, 2026-09-07

// Real IRFCL figures. The tonnage each implies as filed is noted, because the
// plausibility of that number is what decides whether a correction may run.
const CASES = {
  USA: { rawOunces: 261_499_000, reportedUsd: 11_041_058_800 }, //   8,134 t, fine
  CHE: { rawOunces: 33_435_000, reportedUsd: 134_729_175_744 }, //   1,040 t, fine
  KOR: { rawOunces: 3_360_000, reportedUsd: 4_795_000_000 }, //        105 t, fine
  TUN: { rawOunces: 218_078.5, reportedUsd: 172_900_000 }, //          6.8 t, fine
  BRA_2010: { rawOunces: 1_080_459.8, reportedUsd: 1_165_258_724.6 }, // 33.6 t, fine
  AGO: { rawOunces: 592_900_000, reportedUsd: 2_398_965_167 }, //    18,441 t, impossible
  BRA_2026: { rawOunces: 5_544_278_723, reportedUsd: 22_417_625_703 }, // 172,446 t, impossible
};

const detect = (c, price = REFERENCE) =>
  detectUnitScale({ ...c, referencePrice: price, config });

test('a believable figure is never corrected, whatever its valuation implies', () => {
  for (const code of ['USA', 'CHE', 'KOR', 'TUN', 'BRA_2010']) {
    assert.equal(detect(CASES[code]), null, `${code} should be left alone`);
  }
});

test('Korea and Tunisia are not corrected despite valuing gold at cost', () => {
  // The false positives that forced the plausibility gate. Korea files
  // 3,360,000 oz, correctly 104.5 t, but carries the gold at historical cost:
  // its filings implied about $172/oz in 2010 and 2011, when gold was $1,383 to
  // $1,536, so a pure ratio test read that as a tenth of market and "fixed" a
  // figure that was right. Tunisia is the same error at a factor of 100.
  assert.equal(detect(CASES.KOR), null);
  assert.equal(detect(CASES.TUN), null);
  assert.equal(troyOuncesToTonnes(CASES.KOR.rawOunces).toFixed(1), '104.5');
  assert.equal(troyOuncesToTonnes(CASES.TUN.rawOunces).toFixed(1), '6.8');
});

test('an impossible figure is corrected to the power of ten that restores a market price', () => {
  for (const code of ['AGO', 'BRA_2026']) {
    const got = detect(CASES[code]);
    assert.equal(got.divisor, 1000, `${code} should be corrected by 1000`);
    assert.equal(got.basis, 'market');
  }
  assert.equal(troyOuncesToTonnes(CASES.BRA_2026.rawOunces / 1000).toFixed(1), '172.4');
  assert.ok(troyOuncesToTonnes(CASES.AGO.rawOunces / 1000) < 20);
});

test('a correction is judged against the price of the month filed', () => {
  // Brazil's 2010 filing implies $1,078/oz, a market price for January 2010.
  // Judged against 2026 prices it would look wrong; judged against its own
  // month it is plainly fine.
  const v = classifyValuation({ ...CASES.BRA_2010, referencePrice: 1078, config });
  assert.equal(v.basis, 'market');
  assert.equal(detect(CASES.BRA_2010, 1078), null);
});

test('the same reporter can need a correction in one month and not another', () => {
  // Brazil filed in fine troy ounces for years, then switched. The unit is a
  // property of a filing, not of a country: treating it otherwise reported
  // Brazil as holding 0.03 t in 2010.
  assert.equal(detect(CASES.BRA_2010, 1078), null);
  assert.equal(detect(CASES.BRA_2026).divisor, 1000);
});

test('a correction may not push a figure past the ceiling it was meant to fix', () => {
  // Dividing must land somewhere believable, or it is not a fix.
  const absurd = { rawOunces: 1e15, reportedUsd: 1e15 * (REFERENCE / 10) };
  const got = detect(absurd);
  assert.ok(got === null || troyOuncesToTonnes(absurd.rawOunces / got.divisor) <= 9000);
});

test('detection declines rather than guesses when inputs are missing', () => {
  assert.equal(detect({ rawOunces: 0, reportedUsd: 100 }), null);
  assert.equal(detect({ rawOunces: 1e9, reportedUsd: 0 }), null);
  assert.equal(detect({ rawOunces: 1e9, reportedUsd: undefined }), null);
  assert.equal(detectUnitScale({ ...CASES.AGO, referencePrice: 0, config }), null);
});

test('detection declines an impossible figure it cannot explain', () => {
  // 300,000 t, with a dollar figure fitting no scale. Detection must return
  // null rather than invent a correction. What happens to the economy next is
  // buildEntry's decision, and it is asserted further down: this test used to
  // be named for the quarantine it does not perform.
  assert.equal(detect({ rawOunces: 9.6e9, reportedUsd: 7 }), null);
});

test('valuation basis is reported without acting on it', () => {
  assert.equal(classifyValuation({ ...CASES.USA, referencePrice: REFERENCE, config }).basis, 'book');
  assert.equal(classifyValuation({ ...CASES.CHE, referencePrice: REFERENCE, config }).basis, 'market');
  assert.equal(classifyValuation({ ...CASES.KOR, referencePrice: REFERENCE, config }).basis, 'other');
});

test("gold's share of reserves must restate gold at market, not trust the IMF total", () => {
  // The US proves it: its reserve total carries gold at the statutory rate, so
  // the naive ratio is about 4 percent against a published figure near 84.
  const totalReservesUsd = 252_708_091_800;
  const nonGold = totalReservesUsd - CASES.USA.reportedUsd;

  const naive = CASES.USA.reportedUsd / totalReservesUsd;
  assert.ok(naive < 0.06, `naive share should be misleadingly small, got ${naive}`);

  const atMarket = reserveValueUsd(troyOuncesToTonnes(CASES.USA.rawOunces), REFERENCE);
  const restated = atMarket / (atMarket + nonGold);
  assert.ok(restated > 0.78 && restated < 0.88, `restated share should be ~0.83, got ${restated}`);
});

test('the United States is not "corrected" by its own statutory book rate', () => {
  // The sharpest case for the plausibility gate, and the reason it is a gate
  // rather than a tiebreak. The US carries gold at $42.2222/oz. Multiply by 100
  // and you get $4,222, within about 5 percent of the mid-2026 market price,
  // and 8,133.5 t divided by 100 is 81.3 t, comfortably plausible. Both of the
  // inner conditions therefore pass. The only thing standing between this app
  // and reporting that the United States holds 81 tonnes of gold is the check
  // that refuses to touch a figure which is believable exactly as filed.
  const julyFix = 4026.6; // LBMA PM, 2026-07-31

  const implied = CASES.USA.reportedUsd / CASES.USA.rawOunces;
  assert.ok(Math.abs(implied - 42.2222) < 0.001, 'the statutory rate, as filed');
  assert.ok(
    Math.abs(implied * 100 - julyFix) / julyFix < 0.25,
    'x100 really does look like a market price, which is the trap',
  );
  assert.ok(
    troyOuncesToTonnes(CASES.USA.rawOunces / 100) < 9000,
    'and the divided tonnage really is plausible, so nothing downstream would object',
  );

  // Gated on implausibility, so none of that ever runs.
  assert.equal(detect(CASES.USA, julyFix), null);
  assert.equal(troyOuncesToTonnes(CASES.USA.rawOunces).toFixed(1), '8133.5');
});

/*
 * buildEntry: the decision to publish, quarantine, or skip.
 *
 * detectUnitScale decides whether a divisor is justified. buildEntry decides
 * what happens to the economy afterwards, and that is the branch that keeps an
 * impossible figure off the page. The test above named for quarantine only
 * asserted that detection declined to invent a correction, which is a different
 * function answering a different question; nothing exercised the exclusion
 * itself, and `meta.quarantined` is empty on every real run, so live data never
 * has either.
 */

const asMap = (pairs) => new Map(pairs);
/** A flat price, so a case is about the tonnage rather than about the month. */
const flatPrice = () => REFERENCE;

const entryFor = (overrides = {}) =>
  buildEntry({
    code: 'ZZZ',
    name: 'Testland',
    kind: 'country',
    region: 'Europe',
    goldOz: asMap([['2026-M06', 3_360_000], ['2026-M07', 3_360_000]]),
    goldUsd: asMap([['2026-M06', 14_792_000_000], ['2026-M07', 14_792_000_000]]),
    totalUsd: asMap([['2026-M06', 60_000_000_000], ['2026-M07', 60_000_000_000]]),
    priceOn: flatPrice,
    config,
    manualOverrides: new Map(),
    ...overrides,
  });

test('a believable economy is published, with its share denominator', () => {
  const { entry, quarantined, skipped } = entryFor();
  assert.equal(quarantined, undefined);
  assert.equal(skipped, undefined);
  assert.equal(entry.countryCode, 'ZZZ');
  assert.equal(entry.reserveTonnes, 104.51);
  assert.equal(entry.history.length, 2);
  // Non-gold reserves, not the IMF's total: the app restates gold at market.
  assert.equal(entry.nonGoldReservesUsd, 60_000_000_000 - 14_792_000_000);
});

test('an impossible figure no power of ten explains is quarantined, not published', () => {
  // 300,000 t as filed, with a dollar figure matching no scale, so detection
  // returns null for every period and the divisor stays 1.
  const impossible = entryFor({
    goldOz: asMap([['2026-M07', 9.6e9]]),
    goldUsd: asMap([['2026-M07', 7]]),
    totalUsd: asMap([['2026-M07', 1000]]),
  });

  assert.equal(impossible.entry, undefined, 'it must not reach the published file');
  assert.ok(impossible.quarantined, 'it must be recorded rather than silently dropped');
  assert.equal(impossible.quarantined.countryCode, 'ZZZ');
  assert.ok(
    impossible.quarantined.peakImpliedTonnes > config.maxPlausibleTonnes,
    'the record should carry the figure that failed',
  );
  assert.match(impossible.quarantined.reason, /plausibility ceiling/);
});

test('the ceiling is judged on the whole history, not just the latest filing', () => {
  // Plausible today, impossible in an earlier month. Publishing the entry would
  // put 300,000 t on the country's own history chart.
  const spike = entryFor({
    goldOz: asMap([['2026-M06', 9.6e9], ['2026-M07', 3_360_000]]),
    goldUsd: asMap([['2026-M06', 7], ['2026-M07', 14_792_000_000]]),
    totalUsd: asMap([['2026-M07', 60_000_000_000]]),
  });

  assert.ok(spike.quarantined, 'a spike anywhere in the series disqualifies the entry');
  assert.equal(spike.quarantined.peakImpliedTonnes > 100_000, true);
});

test('an aggregate is exempt from the ceiling, because it is not one country', () => {
  // The Euro Area is 21 central banks plus the ECB and stands at 10,807 t. The
  // ceiling is a statement about a single country, so applying it here would
  // quarantine a real and correct figure.
  const euroAreaOunces = 347_500_000; // about 10,807 t
  const aggregate = entryFor({
    kind: 'aggregate',
    goldOz: asMap([['2026-M07', euroAreaOunces]]),
    goldUsd: asMap([['2026-M07', euroAreaOunces * REFERENCE]]),
    totalUsd: asMap([['2026-M07', euroAreaOunces * REFERENCE * 2]]),
  });

  assert.equal(aggregate.quarantined, undefined, 'an aggregate may exceed a country ceiling');
  assert.ok(aggregate.entry.reserveTonnes > config.maxPlausibleTonnes);

  // And the same figure filed as a country is quarantined, so the exemption is
  // doing the work rather than the ceiling having been raised.
  const asCountry = entryFor({
    kind: 'country',
    goldOz: asMap([['2026-M07', euroAreaOunces]]),
    goldUsd: asMap([['2026-M07', euroAreaOunces * REFERENCE]]),
    totalUsd: asMap([['2026-M07', euroAreaOunces * REFERENCE * 2]]),
  });
  assert.ok(asCountry.quarantined, 'the same tonnage as a country must not be published');
});

test('a filing in the wrong unit is corrected and published, not quarantined', () => {
  // The Brazil case: ounces reported a thousandfold, with the reporter's own
  // dollar figure identifying the scale.
  const corrected = entryFor({
    goldOz: asMap([['2026-M07', 3_360_000 * 1000]]),
    goldUsd: asMap([['2026-M07', 14_792_000_000]]),
    totalUsd: asMap([['2026-M07', 60_000_000_000]]),
  });

  assert.equal(corrected.quarantined, undefined);
  assert.equal(corrected.entry.reserveTonnes, 104.51, 'the divisor should restore the real tonnage');
  assert.equal(corrected.entry.unitScaleApplied.divisor, 1000);
});

test('an economy with no usable observation is skipped rather than published empty', () => {
  const empty = entryFor({
    goldOz: asMap([['not-a-period', 3_360_000]]),
    goldUsd: asMap([]),
    totalUsd: asMap([]),
  });
  assert.equal(empty.skipped, 'no usable observations');
  assert.equal(empty.entry, undefined);
});

/*
 * makePriceLookup, and what it does at the edges of the series it was given.
 *
 * This used to fall back to the earliest point for any date before the series
 * began, which was harmless while the only provider ran from 1968 and nothing
 * could fall outside it. The provider that replaced it offers a 30 day window,
 * which would have had every filing since 2010 judged against this month's
 * price. That is not a missed correction, which would be safe: detectUnitScale
 * can match a different power of ten against the wrong reference and publish a
 * figure wrong by a factor of ten.
 */

const SERIES = [
  { date: '2026-10-13', priceUsdPerOunce: 4000 },
  { date: '2026-10-14', priceUsdPerOunce: 4100 },
  { date: '2026-11-11', priceUsdPerOunce: 4200 },
];

test('a date inside the series gets the last price on or before it', () => {
  const priceOn = makePriceLookup(SERIES);
  assert.equal(priceOn('2026-10-14'), 4100);
  assert.equal(priceOn('2026-10-20'), 4100, 'carry the last fix forward, as the auction does');
  assert.equal(priceOn('2026-11-11'), 4200);
  assert.equal(priceOn('2027-01-01'), 4200, 'after the series, the latest price still applies');
});

test('a date before the series has no reference price at all', () => {
  // 0, not the earliest point. detectUnitScale declines on a non-positive
  // reference, so the filing is left alone and quarantined if impossible.
  const priceOn = makePriceLookup(SERIES);
  assert.equal(priceOn('2010-01-31'), 0);
  assert.equal(priceOn('2026-10-12'), 0, 'one day before the series is still outside it');
});

test('declining is safe: no reference means no correction, not a guessed one', () => {
  const priceOn = makePriceLookup(SERIES);
  // Brazil's real filing, which a correct reference resolves with a divisor of
  // 1000. With no reference it must not be corrected by some other factor.
  const result = detectUnitScale({
    rawOunces: 5_544_278_723,
    reportedUsd: 22_417_000_000,
    referencePrice: priceOn('2010-01-31'),
    config,
  });
  assert.equal(result, null, 'an absent reference must produce no correction');
});

test('an empty series gives no reference for any date', () => {
  const priceOn = makePriceLookup([]);
  assert.equal(priceOn('2026-11-11'), 0);
  assert.equal(priceOn(undefined), 0);
});
