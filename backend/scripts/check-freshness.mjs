#!/usr/bin/env node
/**
 * Reports how stale the reserves snapshot is, and exits non-zero when it needs
 * attention, so a scheduled job or CI step can fail loudly instead of the app
 * quietly serving old numbers.
 *
 * Exit codes:
 *   0  fresh
 *   1  ageing, or the snapshot could not be read
 *   2  stale, rebuild now
 *
 * Usage:
 *   node scripts/check-freshness.mjs           report and set an exit code
 *   node scripts/check-freshness.mjs --json    machine-readable output
 *   node scripts/check-freshness.mjs --quiet   exit code only
 */
import { getFreshness } from '../src/services/freshness.js';

const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet');

const EXIT = { fresh: 0, ageing: 1, unknown: 1, stale: 2 };
const LABEL = { fresh: 'FRESH', ageing: 'AGEING', stale: 'STALE', unknown: 'UNKNOWN' };

try {
  const f = await getFreshness();

  if (json) {
    console.log(JSON.stringify(f, null, 2));
  } else if (!quiet) {
    console.log(`Reserves snapshot: ${LABEL[f.overall] ?? f.overall}\n`);
    console.log(
      `  built      ${f.snapshot.generatedAt ?? 'unknown'}` +
        `  (${f.snapshot.ageDays ?? '?'} days ago, ${f.snapshot.status})`,
    );
    console.log(
      `  newest IMF figure ${f.data.latestAsOfDate ?? 'unknown'}` +
        `  (${f.data.ageDays ?? '?'} days ago, ${f.data.status})`,
    );
    if (f.action) console.log(`\n  ${f.action}`);
  }

  process.exitCode = EXIT[f.overall] ?? 1;
} catch (err) {
  if (json) console.log(JSON.stringify({ overall: 'unknown', error: err.message }));
  else if (!quiet) console.error(`Could not read the snapshot: ${err.message}\n\nRun: npm run build:data`);
  process.exitCode = 1;
}
