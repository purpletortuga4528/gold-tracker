import { getReservesMeta } from './reserves.js';
import { getProvider } from './priceProviders/index.js';

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

/**
 * @param now  the moment to judge against, injected so no test depends on the
 *   calendar. See the note at the top of freshness.test.js.
 * @param provider  how to find the active price provider, injected for the
 *   same reason `now` is: PRICE_PROVIDER is read into `config` once at import,
 *   so setting the variable inside a test changes nothing and the advice
 *   branches below would be untestable.
 */
export async function getFreshness(now = new Date(), { provider = activeProvider } = {}) {
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
          : rebuildAdvice(provider()),
  };
}

/*
 * What to actually do, which is not always "rebuild".
 *
 * This said "Rebuild the snapshot with: npm run build:data" whatever the state
 * of the price feed. That command needs a price series to run unit detection
 * against, so with the default provider closed it exits 3 and writes nothing,
 * and the advice sent whoever read it, in the CLI and in the app's own banner,
 * to run a command that cannot work and does not explain itself in those
 * terms. An instruction that fails is worse than no instruction: it costs
 * someone a round of debugging before they learn what this already knows.
 */
function rebuildAdvice(provider) {
  const rebuild = 'Rebuild the snapshot with: npm run build:data';

  if (provider === null) return rebuild;

  if (provider.synthetic) {
    return (
      `${rebuild} -- but PRICE_PROVIDER is "${provider.id}", which generates prices, and the ` +
      'ingest refuses to decide unit corrections against invented numbers. Set a real provider first.'
    );
  }

  // Not phrased as a prediction of failure. Whether a given provider can serve
  // a decade of daily prices is something only the attempt establishes, and
  // claiming it cannot would be the same guessing this file is here to stop.
  return (
    `${rebuild} -- which needs a price series covering the whole history, not just today, ` +
    'because each filing is priced against the gold price of its own month. If it exits 3, ' +
    'the provider could not supply that: see backend/.env.example.'
  );
}

/**
 * The active provider, or null if it cannot be determined.
 *
 * Imported lazily and guarded: freshness is read by /api/health, and a
 * provider registry that threw at import would turn "the data is ageing" into
 * a failed health check, which is a worse answer than a less specific
 * sentence.
 */
function activeProvider() {
  try {
    return getProvider();
  } catch {
    return null;
  }
}
