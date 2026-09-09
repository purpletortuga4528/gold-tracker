import { getReservesMeta } from './reserves.js';

/**
 * How stale the reserves snapshot is.
 *
 * Two different clocks matter here and conflating them hides problems:
 *
 *   snapshotAgeDays  - when `npm run build:data` last ran. If this grows, the
 *                      file is drifting away from what the IMF now publishes.
 *   dataAgeDays      - how old the newest IMF figure in it is. This is large
 *                      even for a fresh snapshot, because IRFCL reports
 *                      month-end with a lag, so it is judged separately.
 *
 * A snapshot rebuilt today whose newest figure is six weeks old is healthy.
 * A snapshot built three months ago is not, however recent its figures looked
 * at the time.
 */
const DAY = 24 * 60 * 60 * 1000;

// IRFCL publishes monthly. A snapshot older than this has certainly missed a
// release; the warn threshold sits inside one publication cycle.
export const SNAPSHOT_WARN_DAYS = 35;
export const SNAPSHOT_STALE_DAYS = 70;

// The data itself is expected to lag. Past a quarter, something has gone wrong
// upstream rather than merely being late.
export const DATA_WARN_DAYS = 75;
export const DATA_STALE_DAYS = 120;

const daysBetween = (a, b) => Math.floor((a - b) / DAY);

function grade(age, warn, stale) {
  if (!Number.isFinite(age)) return 'unknown';
  if (age >= stale) return 'stale';
  if (age >= warn) return 'ageing';
  return 'fresh';
}

const WORST_FIRST = ['unknown', 'stale', 'ageing', 'fresh'];

export async function getFreshness(now = new Date()) {
  const meta = await getReservesMeta();

  const generatedAt = meta.generatedAt ? new Date(meta.generatedAt) : null;
  const latestData = meta.latestAsOfDate ? new Date(`${meta.latestAsOfDate}T00:00:00Z`) : null;

  const snapshotAgeDays = generatedAt ? daysBetween(now, generatedAt) : null;
  const dataAgeDays = latestData ? daysBetween(now, latestData) : null;

  const snapshot = {
    generatedAt: meta.generatedAt ?? null,
    ageDays: snapshotAgeDays,
    status: grade(snapshotAgeDays, SNAPSHOT_WARN_DAYS, SNAPSHOT_STALE_DAYS),
    warnAfterDays: SNAPSHOT_WARN_DAYS,
    staleAfterDays: SNAPSHOT_STALE_DAYS,
  };
  const data = {
    latestAsOfDate: meta.latestAsOfDate ?? null,
    ageDays: dataAgeDays,
    status: grade(dataAgeDays, DATA_WARN_DAYS, DATA_STALE_DAYS),
    warnAfterDays: DATA_WARN_DAYS,
    staleAfterDays: DATA_STALE_DAYS,
  };

  const overall = WORST_FIRST.find((s) => s === snapshot.status || s === data.status) ?? 'fresh';

  return {
    overall,
    snapshot,
    data,
    action:
      overall === 'fresh'
        ? null
        : snapshot.status === 'fresh'
          ? 'The snapshot is current but the IMF has not published a recent figure. Check the source before relying on these numbers.'
          : 'Rebuild the snapshot with: npm run build:data',
  };
}
