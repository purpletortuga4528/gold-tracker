#!/usr/bin/env node
/**
 * Compares a freshly built reserves snapshot against the committed one.
 *
 * The ingest is the largest single piece of logic here and CI never ran it.
 * Its pure functions have unit tests with fixtures; the part that fetches,
 * parses SDMX, picks a sector, resolves divisors per filing and writes the file
 * was only ever exercised by hand. So the failure this guards against is the
 * quiet one: the IMF changes an attribute name or a dimension, the parser
 * silently matches nothing, and the app serves a smaller or wronger dataset
 * that still looks like a dataset.
 *
 * What it will NOT do is fail because the numbers moved. Central banks buy and
 * sell gold and the IMF revises figures; that is the data working. It fails on
 * shapes that mean the pipeline broke.
 *
 * Usage:
 *   node scripts/check-ingest.mjs --before <path> --after <path>
 *
 * Exit codes: 0 the fresh build is sound, 1 something needs a human.
 */
import { readFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const beforePath = arg('before');
const afterPath = arg('after');
if (!beforePath || !afterPath) {
  console.error('Usage: node scripts/check-ingest.mjs --before <path> --after <path>');
  process.exit(2);
}

const load = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Could not read the ${label} snapshot at ${path}: ${err.message}`);
    process.exit(2);
  }
};

const before = load(beforePath, 'committed');
const after = load(afterPath, 'fresh');

const problems = [];
const notes = [];
const fail = (what, detail) => problems.push({ what, detail });
const note = (what, detail) => notes.push({ what, detail });

/** The US has reported the same holding for decades; it is the parse canary. */
const US_ANCHOR_TONNES = 8133.5;
const US_ANCHOR_TOLERANCE = 1;

// --- Structure ---------------------------------------------------------------
if (!Array.isArray(after.countries) || after.countries.length === 0) {
  fail('the fresh snapshot has no entries', 'the parser matched nothing at all');
} else {
  for (const key of ['generatedAt', 'source', 'apiQueries', 'countryCount', 'latestAsOfDate']) {
    if (after.meta?.[key] === undefined) fail('missing metadata', `meta.${key} is absent`);
  }
}

// --- Coverage ----------------------------------------------------------------
// A handful of economies appearing or dropping out is ordinary: reporters join
// the template, or file late. Losing a tenth of them at once is not.
{
  const wasCount = before.meta.countryCount;
  const nowCount = after.meta.countryCount;
  const drop = wasCount - nowCount;
  if (nowCount === 0) fail('country count is zero', 'nothing was classified as a country');
  else if (drop > Math.max(3, wasCount * 0.1)) {
    fail('country count fell sharply', `${wasCount} to ${nowCount}, a drop of ${drop}`);
  } else if (drop !== 0) {
    note('country count changed', `${wasCount} to ${nowCount}`);
  } else {
    note('country count', `${nowCount}, unchanged`);
  }
}

// --- The anchor --------------------------------------------------------------
// If the conversion or the sector selection breaks, this is what says so, and
// it says so before any dollar figure derived from it reaches a page.
{
  const usa = after.countries.find((c) => c.countryCode === 'USA');
  if (!usa) {
    fail('the United States is missing', 'the anchor entry did not survive the build');
  } else if (Math.abs(usa.reserveTonnes - US_ANCHOR_TONNES) > US_ANCHOR_TOLERANCE) {
    fail(
      'the US anchor moved',
      `${usa.reserveTonnes} t against the published ${US_ANCHOR_TONNES} t. Either the ` +
        'conversion or the sector selection has broken, or the United States genuinely ' +
        'moved its gold for the first time in decades. Both deserve a look.',
    );
  } else {
    note('US anchor', `${usa.reserveTonnes} t`);
  }
}

// --- Plausibility ------------------------------------------------------------
// buildEntry quarantines anything impossible, except aggregates, which
// legitimately exceed a single-country ceiling. Anything else past it means the
// gate did not run.
{
  const CEILING = 9000;
  const impossible = after.countries.filter((c) => c.kind !== 'aggregate' && c.reserveTonnes > CEILING);
  if (impossible.length) {
    fail(
      'an implausible holding was published',
      impossible.map((c) => `${c.countryCode} ${c.reserveTonnes} t`).join(', '),
    );
  }
  const negative = after.countries.filter((c) => !(c.reserveTonnes >= 0));
  if (negative.length) {
    fail('a holding is negative or not a number', negative.map((c) => c.countryCode).join(', '));
  }
}

// --- Corrections and quarantines ---------------------------------------------
// Both are reported rather than pinned. A new one is a real event worth seeing
// in the run log, but it is the IMF's filings changing, not this code breaking.
{
  const codes = (list) => (list ?? []).map((x) => x.countryCode).sort();
  const wasCorrected = codes(before.meta.scaleCorrections);
  const nowCorrected = codes(after.meta.scaleCorrections);
  if (wasCorrected.join() !== nowCorrected.join()) {
    note('unit corrections changed', `${wasCorrected.join('+') || 'none'} -> ${nowCorrected.join('+') || 'none'}`);
  } else {
    note('unit corrections', nowCorrected.join(', ') || 'none');
  }

  const nowQuarantined = codes(after.meta.quarantined);
  if (nowQuarantined.length) {
    note(
      'entries quarantined',
      `${nowQuarantined.join(', ')}. Impossible as filed and no power of ten explained it, so they ` +
        'were left out rather than published. Read meta.quarantined for the arithmetic.',
    );
  }
}

// --- Movement ----------------------------------------------------------------
// Reported, never failed on. A central bank buying gold is the data doing its
// job, and a threshold here would turn news into a red build.
{
  const wasByCode = new Map(before.countries.map((c) => [c.countryCode, c.reserveTonnes]));
  const moved = [];
  for (const c of after.countries) {
    const was = wasByCode.get(c.countryCode);
    if (was === undefined || was === 0) continue;
    const change = ((c.reserveTonnes - was) / was) * 100;
    if (Math.abs(change) >= 1) moved.push({ code: c.countryCode, was, now: c.reserveTonnes, change });
  }
  moved.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  if (moved.length) {
    note(
      'holdings that moved by 1 percent or more',
      moved.slice(0, 10).map((m) => `${m.code} ${m.was} -> ${m.now} t (${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%)`).join(', ') +
        (moved.length > 10 ? `, and ${moved.length - 10} more` : ''),
    );
  } else {
    note('holdings', 'nothing moved by as much as 1 percent');
  }
}

// --- Freshness of the data itself --------------------------------------------
{
  const latest = after.meta.latestAsOfDate;
  const wasLatest = before.meta.latestAsOfDate;
  if (latest < wasLatest) {
    fail('the fresh build has older data than the committed one', `${wasLatest} -> ${latest}`);
  } else if (latest === wasLatest) {
    note('newest figure', `${latest}, unchanged since the committed snapshot`);
  } else {
    note('newest figure', `${wasLatest} -> ${latest}`);
  }
}

for (const n of notes) console.log(`  note  ${n.what}: ${n.detail}`);
for (const p of problems) console.log(`  FAIL  ${p.what}: ${p.detail}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s). The ingest produced something that should not be published.`);
  process.exitCode = 1;
} else {
  console.log(`\nThe ingest still produces a sound snapshot. ${after.meta.countryCount} countries, newest figure ${after.meta.latestAsOfDate}.`);
}
