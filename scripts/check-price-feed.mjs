#!/usr/bin/env node
/**
 * Checks that the LBMA feed still means what the provider assumes it means.
 *
 * `lbma.js` reads the price by position:
 *
 *   const CURRENCY_INDEX = { USD: 0, GBP: 1, EUR: 2 };
 *
 * A row today is `{"is_cms_locked":0,"d":"2026-09-08","v":[4399.1,3246.1,3784.55]}`.
 * That undocumented `is_cms_locked` is a fair hint that the shape is not a
 * contract, and until now nothing verified it.
 *
 * The dangerous failure is not the feed disappearing. That throws, the route
 * answers 502, and the app says so on the page. It is the feed being reordered:
 * the app would report 3,784.55 as the dollar gold price, every country's
 * valuation would be about fourteen percent light, and every figure on every
 * page would look completely normal. That is the same class of mistake as a
 * per-gram quote read as per-ounce, which the provider README warns about at
 * length while the provider that actually ships had no check of its own.
 *
 * This is the counterpart to check-ingest.mjs. The reserves feed is verified
 * weekly; this is the other half of what the app depends on.
 *
 * Usage:
 *   node scripts/check-price-feed.mjs
 *
 * Exit codes: 0 the feed is as expected, 1 something needs a human.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FEEDS = {
  pm: 'https://prices.lbma.org.uk/json/gold_pm.json',
  am: 'https://prices.lbma.org.uk/json/gold_am.json',
};

/**
 * A band for today's fix, not for the series, which starts at $37 in 1968.
 *
 * The floor is what catches the mistake the provider README warns about
 * hardest: a per-gram figure read as per-ounce is the true price over 31.1, so
 * gold at $4,399 would arrive as $141. A floor of 100 let that straight through,
 * which a test caught and which is the reason this comment is longer than the
 * constant. At 400 it is caught for any real price below $12,400 an ounce, and
 * gold has not been under $400 since 2004, so there is room at both ends.
 *
 * The ceiling catches a per-kilo figure, which is the true price times 32.15.
 */
const PLAUSIBLE_USD = { min: 400, max: 100_000 };
/** Weekends and London holidays mean a gap; a fortnight means something is wrong. */
const MAX_AGE_DAYS = 14;
/** A move larger than this between two fixes is an event or a parsing error. */
const MAX_DAILY_MOVE = 0.15;

/**
 * The checks, as a pure function, so they can be run against a feed that was
 * broken on purpose. A verifier nobody has watched fail is a verifier nobody
 * knows works, which is exactly the situation this file exists to end.
 *
 * @param {unknown} rows Parsed PM feed.
 * @param {object|null} spot What `lbmaProvider.getSpot()` returned, or null.
 * @param {number} [now] Milliseconds, injectable so the age check is testable.
 * @returns {{ problems: Array<{what: string, detail: string}>, notes: Array }}
 */
export function checkFeed(rows, spot, now = Date.now()) {
  const problems = [];
  const notes = [];
  const fail = (what, detail) => problems.push({ what, detail });
  const note = (what, detail) => notes.push({ what, detail });

  if (!Array.isArray(rows) || rows.length === 0) {
    fail('the feed is not a non-empty array', `got ${Array.isArray(rows) ? 'an empty array' : typeof rows}`);
    return { problems, notes };
  }

  const latest = rows.at(-1);
  note('row keys', Object.keys(latest).sort().join(', '));

  if (typeof latest.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(latest.d)) {
    fail('the date field changed', `expected d as YYYY-MM-DD, got ${JSON.stringify(latest.d)}`);
  }

  if (!Array.isArray(latest.v)) {
    fail('the value field is no longer an array', `v is ${typeof latest.v}`);
    return { problems, notes };
  }
  if (latest.v.length !== 3) {
    // The provider indexes USD, GBP and EUR by position. A currency added or
    // removed moves every index after it.
    fail('the number of currencies changed', `expected 3 values, got ${latest.v.length}: ${JSON.stringify(latest.v)}`);
    return { problems, notes };
  }
  if (!latest.v.every((n) => Number.isFinite(n) && n > 0)) {
    fail('a value is not a positive number', JSON.stringify(latest.v));
    return { problems, notes };
  }

  const [usd, gbp, eur] = latest.v;
  note('latest row', `${latest.d}: USD ${usd}, GBP ${gbp}, EUR ${eur}`);

  // The only thing distinguishing the three columns is their size. Gold costs
  // more dollars than euros and more euros than pounds, because that is the
  // order of the three currencies' value, and has been for the life of the euro.
  if (!(usd > eur && eur > gbp)) {
    fail(
      'the columns are no longer in the order the provider assumes',
      `USD ${usd}, GBP ${gbp}, EUR ${eur}. Either the feed reordered its values, in which case ` +
        'CURRENCY_INDEX in lbma.js is now reading the wrong currency into every price on every ' +
        'page, or the exchange rates have moved far enough to reorder them honestly. Both need ' +
        'a person to look.',
    );
  }

  if (usd < PLAUSIBLE_USD.min || usd > PLAUSIBLE_USD.max) {
    fail('the dollar price is not a plausible gold price', `${usd} per ounce`);
  }

  const ageDays = Math.floor((now - Date.parse(`${latest.d}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(ageDays)) fail('the latest date is unreadable', String(latest.d));
  else if (ageDays > MAX_AGE_DAYS) {
    fail('the feed has stopped updating', `newest fix is ${latest.d}, ${ageDays} days old`);
  } else note('freshness', `newest fix ${latest.d}, ${ageDays} days old`);

  // A reordered column or a shifted decimal shows up as a jump the market did
  // not make. Gold moves, but not by a sixth between two fixes.
  const previous = rows.at(-2);
  const previousUsd = Array.isArray(previous?.v) ? previous.v[0] : null;
  if (Number.isFinite(previousUsd) && previousUsd > 0) {
    const move = Math.abs(usd - previousUsd) / previousUsd;
    if (move > MAX_DAILY_MOVE) {
      fail(
        'the price jumped further than a market move',
        `${previous.d} ${previousUsd} to ${latest.d} ${usd}, ${(move * 100).toFixed(1)} percent. ` +
          'Check the feed before believing it.',
      );
    } else note('day on day', `${(move * 100).toFixed(2)} percent from ${previous.d}`);
  }

  // Everything above tests the feed. This tests the code that reads it, which
  // is the part that can be wrong while the feed is perfect.
  if (spot === null) {
    note('provider reading', 'not checked');
  } else if (!Number.isFinite(spot?.priceUsdPerOunce)) {
    fail('the provider returned no usable price', JSON.stringify(spot).slice(0, 200));
  } else if (spot.benchmark?.endsWith('PM') && spot.priceUsdPerOunce !== usd) {
    // Comparable only when the provider chose PM. It falls back to AM when AM
    // is newer, and that is a different auction with a different number.
    fail(
      'the provider disagrees with the feed it just read',
      `provider says ${spot.priceUsdPerOunce}, the PM feed's newest row says ${usd}`,
    );
  } else {
    note('provider reading', `${spot.benchmark} ${spot.priceUsdPerOunce} as of ${spot.asOfDate}`);
  }

  return { problems, notes };
}

/** Only when run directly, so importing this for the tests costs no network. */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-price-feed.mjs')) {
  /*
   * These branches set exitCode and fall through; none of them calls
   * process.exit().
   *
   * Calling it here aborted the process on Windows. The SKIP path below runs
   * immediately after an HTTPS request, so the TLS connection is still being
   * torn down, and exiting into that teardown trips a libuv assertion:
   *
   *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
   *   file src\win\async.c, line 94
   *
   * The process then exited 127. So the one path this script is most careful
   * about, the SKIP that deliberately refuses to fail a build over somebody
   * else's outage, was the path that aborted and reported neither the feed nor
   * the build.
   *
   * Observed on Windows only, and that scoping is the honest limit of it: the
   * assertion lives in libuv's Windows code, CI runs on Linux, and whether the
   * weekly job there was ever affected was never established. The step runs
   * with `if: always()` and no continue-on-error, so a non-zero exit would
   * fail it; that it ever did on Linux is not something this found out.
   *
   * It is the exit that does it, not the request's abort timer: it reproduces
   * identically with the signal removed, and AbortSignal.timeout is unref'd so
   * it holds nothing open. Letting the process end on its own is the whole fix.
   */
  let rows;
  try {
    const res = await fetch(FEEDS.pm, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    // Unreachable is not the same as changed. Say which, and do not report a
    // shape as wrong when it was never seen. Same reasoning as check-docs' SKIP.
    console.log(`  SKIP  the LBMA PM feed could not be read: ${err.message}`);
    console.log('\nThat is an upstream outage. Nothing here is evidence about the feed\'s shape.');
    process.exitCode = 0;
    rows = null;
  }

  // Nothing below can say anything without the feed. Guarded rather than
  // exited, so the SKIP above leaves the process to end on its own.
  if (rows !== null) {
    let spot = null;
    try {
      const { lbmaProvider } = await import(
        `file://${resolve(ROOT, 'backend/src/services/priceProviders/lbma.js')}`
      );
      spot = await lbmaProvider.getSpot();
    } catch (err) {
      console.log(`  FAIL  the provider could not produce a price: ${err.message}`);
      process.exitCode = 1;
    }

    if (spot !== null) {
      const { problems, notes } = checkFeed(rows, spot);
      for (const n of notes) console.log(`  note  ${n.what}: ${n.detail}`);
      for (const p of problems) console.log(`  FAIL  ${p.what}: ${p.detail}`);

      if (problems.length) {
        console.log(`\n${problems.length} problem(s). The price feed is not what lbma.js assumes it is.`);
        process.exitCode = 1;
      } else {
        console.log('\nThe LBMA feed still has the shape the provider reads, and the provider agrees with it.');
      }
    }
  }
}
