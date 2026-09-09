#!/usr/bin/env node
/**
 * Rebuilds backend/data/gold-reserves.json from the IMF SDMX API.
 *
 * Source: IMF International Reserves and Foreign Currency Liquidity (IRFCL).
 * Three indicators are pulled per economy:
 *
 *   IRFCLDT1_IRFCL56V_FTO  gold volume, in fine troy ounces  -> tonnes
 *   IRFCLDT1_IRFCL56_USD   gold, at the reporter's own valuation
 *   IRFCLDT1_IRFCL54_USD   total official reserve assets
 *
 * The two USD lines are NOT used to value anything. They are used for:
 *
 *   1. Unit detection. Dividing the gold USD figure by the gold ounce figure
 *      gives an implied price per ounce. If that lands near the market price
 *      the ounce figure is sound; if it lands near a power of ten below, the
 *      reporter is submitting the volume line in the wrong unit. This is how
 *      Brazil and Angola are caught, and it is derived from the data rather
 *      than asserted from a list. See detectUnitScale.
 *
 *   2. Gold as a share of total reserves. This cannot be read off the IMF
 *      figures directly, because reporters value gold inconsistently: the US
 *      carries it at the statutory $42.2222/oz, so the naive ratio makes gold
 *      look like 4 percent of US reserves when the published figure is about
 *      84 percent. What is stored instead is NON-GOLD reserves, letting the
 *      app restate the share at the live gold price. See buildEntry.
 *
 * Every dollar amount shown in the app is still computed as tonnes x market
 * price. Neither IMF USD column is ever displayed as a valuation.
 *
 * Usage:
 *   node scripts/build-reserves.mjs [--start-year 2010] [--out data/gold-reserves.json]
 */
import { writeFile, readFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { troyOuncesToTonnes } from '../src/lib/units.js';
import { lbmaProvider } from '../src/services/priceProviders/lbma.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDMX_BASE = 'https://api.imf.org/external/sdmx/2.1';
const FLOW = 'IMF.STA,IRFCL';
const COUNTRY_CODELIST = `${SDMX_BASE}/codelist/IMF/CL_COUNTRY`;

const INDICATORS = {
  goldOunces: 'IRFCLDT1_IRFCL56V_FTO',
  goldUsd: 'IRFCLDT1_IRFCL56_USD',
  totalReservesUsd: 'IRFCLDT1_IRFCL54_USD',
};

/** Preferred order when an economy reports under more than one SECTOR code. */
const SECTOR_PREFERENCE = ['S1XS1311', 'S1X', 'S1311'];

// A Map, not an object literal: `code` below comes from the IMF feed, and
// `NAME_OVERRIDES[code]` would return an inherited function for a REF_AREA of
// `constructor` or `toString`, which then becomes the entry's name.
const NAME_OVERRIDES = new Map([['EZB', 'European Central Bank']]);
const INSTITUTION_CODES = new Set(['EZB']);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function getText(url, label) {
  const res = await fetch(url, {
    headers: { Accept: 'application/xml' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} from ${url}`);
  return res.text();
}

const readJson = async (rel) => JSON.parse(await readFile(resolve(HERE, '..', rel), 'utf8'));

/**
 * Minimal reader for SDMX 2.1 "structure specific" XML. That flavour is flat:
 * <Series ATTR="..."> wrapping <Obs TIME_PERIOD=".." OBS_VALUE=".."/>. A regex
 * pass is enough and avoids an XML parser dependency. If the IMF ever switches
 * to a nested encoding this returns zero series and main() aborts, rather than
 * silently producing wrong numbers.
 */
function parseSdmxSeries(xml) {
  const out = [];
  const seriesRe = /<Series\s([^>]*?)>([\s\S]*?)<\/Series>/g;
  const attrRe = /([A-Za-z_][\w.]*)="([^"]*)"/g;
  const obsRe = /<Obs\s([^>]*?)\/?>/g;
  for (const m of xml.matchAll(seriesRe)) {
    const attrs = Object.fromEntries([...m[1].matchAll(attrRe)].map((a) => [a[1], a[2]]));
    const observations = [];
    for (const o of m[2].matchAll(obsRe)) {
      const oa = Object.fromEntries([...o[1].matchAll(attrRe)].map((a) => [a[1], a[2]]));
      if (oa.TIME_PERIOD && oa.OBS_VALUE !== undefined) {
        observations.push({ period: oa.TIME_PERIOD, value: Number(oa.OBS_VALUE) });
      }
    }
    out.push({ attrs, observations });
  }
  return out;
}

function parseCodelist(xml) {
  const names = new Map();
  const codeRe = /<str:Code\s[^>]*?id="([^"]+)"[^>]*>([\s\S]*?)<\/str:Code>/g;
  const nameRe = /<com:Name[^>]*xml:lang="en"[^>]*>([\s\S]*?)<\/com:Name>/;
  for (const m of xml.matchAll(codeRe)) {
    const name = nameRe.exec(m[2]);
    if (name) names.set(m[1], decodeXml(name[1].trim()));
  }
  return names;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** "2026-M07" -> "2026-07-31" (last calendar day of the reported month). */
function periodToDate(period) {
  const m = /^(\d{4})-M(\d{2})$/.exec(period);
  if (!m) return null;
  const lastDay = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`;
}

function classify(code) {
  if (INSTITUTION_CODES.has(code)) return 'institution';
  if (/^G\d+$/.test(code)) return 'aggregate';
  return 'country';
}

function round(n, dp) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Fetches one indicator for every economy and returns
 * Map<countryCode, Map<period, value>>, keeping one SECTOR per economy.
 */
async function fetchIndicator(indicator, startYear) {
  const url =
    `${SDMX_BASE}/data/${FLOW}/.${indicator}..M` +
    `?startPeriod=${startYear}-01&endPeriod=${new Date().getUTCFullYear()}-12`;
  const series = parseSdmxSeries(await getText(url, indicator));

  const best = new Map();
  for (const s of series) {
    const code = s.attrs.COUNTRY;
    if (!code || s.observations.length === 0) continue;
    const rank = SECTOR_PREFERENCE.indexOf(s.attrs.SECTOR);
    const score = rank === -1 ? SECTOR_PREFERENCE.length : rank;
    const current = best.get(code);
    if (!current || score < current.score) best.set(code, { score, observations: s.observations });
  }

  const out = new Map();
  for (const [code, { observations }] of best) {
    out.set(code, new Map(observations.map((o) => [o.period, o.value])));
  }
  return { url, byCountry: out, seriesCount: series.length };
}

/**
 * Describes how a reporter values its gold, for information only. Never acts.
 */
export function classifyValuation({ rawOunces, reportedUsd, referencePrice, config }) {
  if (!(rawOunces > 0) || !(reportedUsd > 0) || !(referencePrice > 0)) {
    return { basis: 'unknown', impliedUsdPerOunce: null };
  }
  const implied = reportedUsd / rawOunces;
  const near = (v, t) => Math.abs(v - t) / t <= config.scaleTolerance;
  if (near(implied, referencePrice)) return { basis: 'market', impliedUsdPerOunce: implied };
  if (near(implied, config.statutoryBookUsdPerOunce)) return { basis: 'book', impliedUsdPerOunce: implied };
  // Plenty of reporters carry gold at historical cost, at no fixed rate.
  return { basis: 'other', impliedUsdPerOunce: implied };
}

/**
 * Detects a unit error in a reporter's gold volume figure.
 *
 * Two conditions must BOTH hold before anything is corrected:
 *
 *   1. The figure as reported is impossible. A holding above the plausibility
 *      ceiling is not a country that quietly out-reserved the United States,
 *      it is a filing in the wrong unit.
 *   2. Dividing by a power of ten brings the reporter's own implied price per
 *      ounce back to the market price of the month it filed.
 *
 * Condition 1 is what makes this safe, and it was added after the ratio test
 * alone produced two false positives. Korea reports 3,360,000 oz, correctly,
 * being 104.5 t. It carries the gold at cost, which is $1,427/oz today but was
 * about $172/oz in late 2010 and the first half of 2011, when the fix ran
 * $1,383 to $1,536: ten times $172 lands inside the tolerance, so 7 of its 199
 * filings match, and a country-wide divisor taken from them would have divided
 * the whole series by ten. Tunisia does the same at a factor of a hundred, in
 * 42 of its 113 filings. Requiring the tonnage to be impossible first removes
 * that whole class of error: if the number is believable as filed, it is left
 * alone whatever the reporter's valuation habits.
 *
 * @returns {{divisor: number, basis: string, impliedUsdPerOunce: number} | null}
 */
export function detectUnitScale({ rawOunces, reportedUsd, referencePrice, config }) {
  if (!(rawOunces > 0) || !(reportedUsd > 0) || !(referencePrice > 0)) return null;

  if (troyOuncesToTonnes(rawOunces) <= config.maxPlausibleTonnes) return null;

  const implied = reportedUsd / rawOunces;
  const near = (v, t) => Math.abs(v - t) / t <= config.scaleTolerance;
  for (let k = 1; k <= 4; k += 1) {
    const divisor = 10 ** k;
    const corrected = implied * divisor;
    if (near(corrected, referencePrice) && troyOuncesToTonnes(rawOunces / divisor) <= config.maxPlausibleTonnes) {
      return { divisor, basis: 'market', impliedUsdPerOunce: corrected };
    }
  }
  return null;
}

/** The most recent period present in every one of the supplied maps. */
function latestCommonPeriod(...maps) {
  if (maps.some((m) => !m || m.size === 0)) return null;
  const [first, ...rest] = maps;
  const shared = [...first.keys()].filter((p) => rest.every((m) => m.has(p)));
  return shared.sort().at(-1) ?? null;
}

/**
 * Returns a function giving the last published gold price on or before a date.
 * Detection compares a reporter's implied price against the price of the month
 * it actually reported, so a country whose USD line stopped years ago is not
 * judged against today's price.
 */
function makePriceLookup(points) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return (isoDate) => {
    if (!isoDate || sorted.length === 0) return sorted.at(-1)?.priceUsdPerOunce ?? 0;
    let lo = 0;
    let hi = sorted.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date <= isoDate) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // Before the series starts, fall back to its earliest point.
    return sorted[best === -1 ? 0 : best].priceUsdPerOunce;
  };
}

/**
 * Assigns a divisor to every filing.
 *
 * A filing that detection cleared, or that is simply believable as filed, gets
 * 1. Only a filing that is BOTH impossible as filed and undetectable, because
 * the reporter published no dollar figure that month, borrows a divisor from
 * its nearest neighbour.
 *
 * The plausibility check in the middle is what keeps corrections from leaking
 * across a reporter's history. Brazil filed correctly in fine troy ounces for
 * years before switching units; without this, the 1000 detected on its recent
 * filings propagated backwards and reported Brazil as holding 0.03 t in 2010.
 */
function resolveDivisors(periods, detections, manualDivisor, goldOz, config) {
  if (manualDivisor) return () => manualDivisor;

  const resolved = new Map();
  const needsNeighbour = [];
  for (const p of periods) {
    const hit = detections.get(p);
    if (hit) resolved.set(p, hit.divisor);
    else if (troyOuncesToTonnes(goldOz.get(p)) <= config.maxPlausibleTonnes) resolved.set(p, 1);
    else needsNeighbour.push(p);
  }

  for (const p of needsNeighbour) {
    const i = periods.indexOf(p);
    let divisor = null;
    for (let step = 1; step < periods.length && divisor === null; step += 1) {
      // Look forward first: a reporter that starts publishing a dollar figure
      // partway through is best read by the first filing that can be checked.
      divisor = resolved.get(periods[i + step]) ?? resolved.get(periods[i - step]) ?? null;
      if (divisor === 1) divisor = null; // a clean neighbour explains nothing here
    }
    // Still unresolved leaves it uncorrected, and the plausibility ceiling in
    // buildEntry quarantines it rather than publishing a wrong number.
    resolved.set(p, divisor ?? 1);
  }

  return (p) => resolved.get(p) ?? 1;
}

/**
 * Describes the unit correction for a reporter, or null if none was needed.
 *
 * Also reports the period where a reporter's unit changed, which is a real
 * phenomenon rather than a hypothetical: Brazil filed in fine troy ounces for
 * years and then switched.
 */
function describeScale({ code, periods, divisorFor, detections, manual, round }) {
  const used = [...new Set(periods.map(divisorFor))];
  if (used.length === 1 && used[0] === 1) return null;

  if (manual) {
    return { divisor: manual.divisor, basis: 'manual override', evidence: manual.evidence };
  }

  const latestDivisor = divisorFor(periods.at(-1));
  const changeIndex = periods.findIndex(
    (p, i) => i > 0 && divisorFor(p) !== divisorFor(periods[i - 1]),
  );
  const changedAt = changeIndex === -1 ? null : periodToDate(periods[changeIndex]);

  // Quote the first filing that actually demonstrates the current divisor.
  const witness = [...periods].reverse().find((p) => divisorFor(p) === latestDivisor && detections.has(p));
  const d = witness ? detections.get(witness) : null;

  const evidence = d
    ? `This reporter's own dollar figure divided by its own ounce figure implies ` +
      `$${round(d.impliedUsdPerOunce / latestDivisor, 4)} per ounce, ${latestDivisor}x below the ` +
      `market price. Dividing the volume by ${latestDivisor} gives ` +
      `$${round(d.impliedUsdPerOunce, 2)} per ounce, a market price.`
    : `The reported volume is ${latestDivisor}x too large against the reported dollar value.`;

  return {
    divisor: latestDivisor,
    basis: 'detected from the reported USD value',
    evidence,
    changedAt,
    changeNote: changedAt
      ? `${code} did not use one unit throughout. Its filings switch at ${changedAt}, so the ` +
        `correction is applied per filing rather than across the whole series.`
      : null,
    divisorsUsed: used,
  };
}

/**
 * Turns one economy's raw series into a published entry, a quarantine record,
 * or nothing.
 *
 * Exported for the tests. The quarantine branch below is the last thing between
 * an impossible figure and a page presenting it as fact, and it had no coverage
 * at all: the test named for it asserted only that detectUnitScale declined to
 * invent a correction, which is a different function making a different
 * decision. `meta.quarantined` is empty on every real run, so live data has
 * never exercised it either.
 */
export function buildEntry({ code, name, kind, region, goldOz, goldUsd, totalUsd, priceOn, config, manualOverrides }) {
  const periods = [...goldOz.keys()].sort();
  const latestPeriod = periods.at(-1);
  const rawLatest = goldOz.get(latestPeriod);

  // Detection needs both series for the same month, and the USD line often lags
  // the volume line by a period. Using the latest month where both exist rather
  // than the latest month overall is the difference between resolving a
  // reporter's units and giving up on it: it moves 15 economies, France among
  // them, out of "unknown".
  const detectionPeriod = latestCommonPeriod(goldOz, goldUsd) ?? latestPeriod;

  const manual = manualOverrides.get(code);

  // Detection runs on EVERY period, not once for the series. Brazil is the
  // reason: its figures are in correct fine troy ounces from 2010 until part
  // way through the series, then switch to the thousand-fold unit. Applying
  // one divisor to the whole history divided the correct early years by a
  // thousand and reported Brazil as holding 0.03 t in 2010, a 574,733 percent
  // "increase". The unit is a property of a filing, not of a country.
  const detections = new Map();
  for (const p of periods) {
    const reportedUsd = goldUsd?.get(p);
    if (reportedUsd === undefined) continue;
    const d = detectUnitScale({
      rawOunces: goldOz.get(p),
      reportedUsd,
      // Priced at the month reported, not today, so a reporter whose USD line
      // stopped years ago is not judged against a price that has since moved.
      referencePrice: priceOn(periodToDate(p)),
      config,
    });
    if (d) detections.set(p, d);
  }
  const divisorFor = resolveDivisors(periods, detections, manual?.divisor, goldOz, config);
  const divisor = divisorFor(latestPeriod);
  const valuation = classifyValuation({
    rawOunces: goldOz.get(detectionPeriod) / divisorFor(detectionPeriod),
    reportedUsd: goldUsd?.get(detectionPeriod),
    referencePrice: priceOn(periodToDate(detectionPeriod)),
    config,
  });

  const history = periods
    .map((p) => ({
      asOfDate: periodToDate(p),
      reserveTonnes: troyOuncesToTonnes(goldOz.get(p) / divisorFor(p)),
    }))
    .filter((h) => h.asOfDate && Number.isFinite(h.reserveTonnes));
  if (history.length === 0) return { skipped: 'no usable observations' };

  const latest = history.at(-1);

  // Backstop for anything per-period detection could not resolve.
  const worst = Math.max(...history.map((h) => h.reserveTonnes));
  if (kind !== 'aggregate' && worst > config.maxPlausibleTonnes) {
    return {
      quarantined: {
        countryCode: code,
        countryName: name,
        rawTroyOunces: rawLatest,
        impliedTonnes: round(latest.reserveTonnes, 2),
        peakImpliedTonnes: round(worst, 2),
        asOfDate: latest.asOfDate,
        impliedUsdPerOunce: round(valuation.impliedUsdPerOunce, 4),
        reason:
          `Implied holding peaks at ${round(worst, 2)} t, past the ${config.maxPlausibleTonnes} t ` +
          `plausibility ceiling, and the reported USD figure did not resolve the unit. Excluded ` +
          `rather than published as fact.`,
      },
    };
  }

  // Gold's share of total reserves has to be restated at the market price,
  // because reporters carry gold at wildly different valuations. Storing
  // non-gold reserves lets the app do that against the live price.
  const sharePeriod = latestCommonPeriod(goldOz, goldUsd, totalUsd);
  let nonGoldReservesUsd = null;
  let reservesAsOfDate = null;
  if (sharePeriod) {
    const total = totalUsd.get(sharePeriod);
    const goldAtReportedValuation = goldUsd.get(sharePeriod);
    const nonGold = total - goldAtReportedValuation;
    // A negative residual would mean gold is carried above total reserves,
    // which is incoherent; drop it rather than publish a broken denominator.
    if (Number.isFinite(nonGold) && nonGold >= 0) {
      nonGoldReservesUsd = nonGold;
      reservesAsOfDate = periodToDate(sharePeriod);
    }
  }

  return {
    entry: {
      countryCode: code,
      countryName: name,
      kind,
      region,
      reserveTonnes: round(latest.reserveTonnes, 2),
      asOfDate: latest.asOfDate,
      source: 'IMF IRFCL',
      nonGoldReservesUsd: nonGoldReservesUsd === null ? null : Math.round(nonGoldReservesUsd),
      reservesAsOfDate,
      valuationBasis: manual ? 'manual' : valuation.basis,
      impliedUsdPerOunce: round(valuation.impliedUsdPerOunce, 4),
      unitScaleApplied: describeScale({
        code,
        periods,
        divisorFor,
        detections,
        manual,
        round,
      }),
      history: history.map((h) => ({
        asOfDate: h.asOfDate,
        reserveTonnes: round(h.reserveTonnes, 2),
      })),
    },
  };
}

async function main() {
  const startYear = Number(arg('start-year', '2010'));
  const outPath = resolve(HERE, '..', arg('out', 'data/gold-reserves.json'));

  const { regions: regionsRaw } = await readJson('data/regions.json');
  const config = await readJson('data/validation.json');

  // Indexed by a code that comes from an external feed, so these become Maps.
  // A plain object would answer `regions['constructor']` with an inherited
  // function rather than undefined, and quietly put it in the output.
  const regions = new Map(Object.entries(regionsRaw ?? {}));
  const manualOverrides = new Map(Object.entries(config.manualScaleOverrides ?? {}));

  console.log('Fetching the LBMA price series for unit detection');
  const [spot, priceHistory] = await Promise.all([
    lbmaProvider.getSpot(),
    lbmaProvider.getHistory({}),
  ]);
  const priceOn = makePriceLookup(priceHistory.points);
  console.log(
    `  ${priceHistory.points.length} daily fixes, latest $${spot.priceUsdPerOunce}/oz ` +
      `(${spot.benchmark}, ${spot.asOfDate})`,
  );

  console.log(`Fetching country names from ${COUNTRY_CODELIST}`);
  const countryNames = parseCodelist(await getText(COUNTRY_CODELIST, 'codelist'));
  console.log(`  ${countryNames.size} country codes`);

  const fetched = {};
  for (const [key, indicator] of Object.entries(INDICATORS)) {
    console.log(`Fetching ${indicator}`);
    fetched[key] = await fetchIndicator(indicator, startYear);
    console.log(`  ${fetched[key].seriesCount} series, ${fetched[key].byCountry.size} economies`);
  }
  if (fetched.goldOunces.byCountry.size === 0) {
    throw new Error('No gold volume series parsed; refusing to write an empty dataset.');
  }

  const entries = [];
  const quarantined = [];
  const scaleCorrections = [];
  const skipped = [];

  for (const [code, goldOz] of fetched.goldOunces.byCountry) {
    const result = buildEntry({
      code,
      name: NAME_OVERRIDES.get(code) ?? countryNames.get(code) ?? code,
      kind: classify(code),
      region: regions.get(code) ?? null,
      goldOz,
      goldUsd: fetched.goldUsd.byCountry.get(code) ?? new Map(),
      totalUsd: fetched.totalReservesUsd.byCountry.get(code) ?? new Map(),
      priceOn,
      config,
      manualOverrides,
    });
    if (result.skipped) skipped.push(code);
    else if (result.quarantined) quarantined.push(result.quarantined);
    else {
      entries.push(result.entry);
      if (result.entry.unitScaleApplied) {
        scaleCorrections.push({ countryCode: code, ...result.entry.unitScaleApplied });
      }
    }
  }
  entries.sort((a, b) => b.reserveTonnes - a.reserveTonnes);

  const asOfDates = entries.map((c) => c.asOfDate).sort();
  const withShare = entries.filter((c) => c.nonGoldReservesUsd !== null).length;
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source:
        'International Monetary Fund, International Reserves and Foreign Currency Liquidity (IRFCL)',
      sourceUrl: 'https://data.imf.org/en/datasets/IMF.STA:IRFCL',
      apiQueries: Object.fromEntries(Object.entries(fetched).map(([k, v]) => [k, v.url])),
      indicators: INDICATORS,
      unitDetection: {
        method:
          "Each reporter's own USD figure divided by its own ounce figure gives an implied price per ounce, compared against the LBMA fix for the same month. A match at market or at the US statutory rate accepts the ounces as reported; a match only after dividing by a power of ten identifies a unit error.",
        referenceSeries: `${priceHistory.benchmark}, ${priceHistory.points.length} daily fixes`,
        latestReferencePriceUsdPerOunce: spot.priceUsdPerOunce,
        latestReferenceAsOfDate: spot.asOfDate,
      },
      indicatorNote:
        'Gold (including gold deposits and, if appropriate, gold swapped), reported as volume in fine troy ounces and converted to tonnes at 31.1034768 g per troy ounce.',
      valuationNote:
        'Tonnes only. Every USD figure in this app is computed as tonnes x market price. The IMF USD columns are used to detect unit errors and to derive non-gold reserves, never to value gold: reporters carry gold at inconsistent valuations, the US at the statutory $42.2222/oz.',
      shareNote:
        "Gold's share of reserves is computed live as market-valued gold over (market-valued gold + non-gold reserves). Dividing the IMF's own gold USD by its own total would put US gold at 4 percent of reserves against a published figure of about 84 percent.",
      coverageNote:
        'Covers economies that report to the IMF reserves data template. Non-reporting holders are absent, as is gold held by the IMF and BIS themselves. Do not read the sum of these rows as a world total; cross-check against the World Gold Council.',
      entryCount: entries.length,
      countryCount: entries.filter((c) => c.kind === 'country').length,
      entriesWithReservesShare: withShare,
      earliestAsOfDate: asOfDates[0] ?? null,
      latestAsOfDate: asOfDates.at(-1) ?? null,
      scaleCorrections,
      quarantined,
    },
    countries: entries,
  };

  // Written to a temporary file and renamed, not written in place. A rebuild
  // can run while the API is serving, and a truncated JSON file would take the
  // app down with a parse error until the next successful build. Rename is
  // atomic within a filesystem, so a reader sees either the old file or the new
  // one, never a half-written one.
  await mkdir(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmpPath, outPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }

  console.log(`\nWrote ${outPath}`);
  console.log(
    `  ${entries.length} entries (${payload.meta.countryCount} countries), ` +
      `${withShare} with a reserves share, latest ${payload.meta.latestAsOfDate}`,
  );
  if (skipped.length) console.log(`  skipped: ${skipped.join(', ')}`);
  if (scaleCorrections.length) {
    console.log('\n  UNIT CORRECTIONS (detected, not hand-listed):');
    for (const c of scaleCorrections) console.log(`    ${c.countryCode}: /${c.divisor} -- ${c.evidence}`);
  }
  if (quarantined.length) {
    console.log('\n  QUARANTINED:');
    for (const q of quarantined) console.log(`    ${q.countryCode} ${q.countryName}: ${q.reason}`);
  }
  console.log('\nTop 10 by tonnes:');
  for (const c of entries.slice(0, 10)) {
    console.log(
      `  ${String(c.reserveTonnes).padStart(9)} t  ${c.countryCode.padEnd(5)} ` +
        `${c.countryName} [${c.kind}/${c.valuationBasis}] (${c.asOfDate})`,
    );
  }
}

// Only run when invoked directly, so the detection logic can be unit tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
