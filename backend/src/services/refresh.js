import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getFreshness } from './freshness.js';
import { clearReservesCache } from './reserves.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../..');
const BUILD_SCRIPT = resolve(BACKEND, 'scripts/build-reserves.mjs');

const HOUR = 60 * 60 * 1000;

/**
 * setInterval stores its delay in a 32-bit signed integer, so anything above
 * about 596 hours silently becomes 1ms and the interval fires continuously.
 * AUTO_REFRESH_INTERVAL_HOURS=1000 would therefore rebuild in a tight loop and
 * hammer the IMF, which is the opposite of what a long interval asks for.
 */
const MAX_TIMER_MS = 2_147_483_647;
const MIN_INTERVAL_MS = 60_000;

export function intervalToMs(hours) {
  const ms = Number(hours) * HOUR;
  if (!Number.isFinite(ms) || ms <= 0) return MIN_INTERVAL_MS;
  return Math.min(Math.max(ms, MIN_INTERVAL_MS), MAX_TIMER_MS);
}

/**
 * Keeps the reserves snapshot current while the server runs.
 *
 * Detecting staleness was never the hard part; the app already said so on
 * every page and in /api/health. The problem was that saying so did nothing.
 * Somebody self-hosting this would come back in two months to old figures
 * behind a banner they had learned to ignore, which is the failure mode that
 * actually matters for a data viewer.
 *
 * Three rules shape this:
 *
 *   It never blocks startup. The server comes up on the snapshot it already
 *   has, and a refresh happens behind it. An IMF outage must not stop the app
 *   from serving the data it already holds.
 *
 *   It never leaves the app worse off. A failed rebuild changes nothing: the
 *   script writes to a temporary file and renames, so the served dataset is
 *   either the old one or a complete new one.
 *
 *   It runs the same code path as `npm run build:data`, as a child process, so
 *   a crash in the ingest cannot take the server with it and there is only one
 *   implementation to keep correct.
 */
export function startAutoRefresh({
  intervalHours = config.autoRefresh.intervalHours,
  minAgeHours = config.autoRefresh.minAgeHours,
  now = () => Date.now(),
  run = runBuild,
  log = console,
  // Injected for the same reason `now` is. Reading the real snapshot made the
  // tests depend on the age of a committed file, so the one asserting that a
  // young snapshot is left alone passed in September and failed in October
  // with no code change. A test whose result depends on the calendar is a test
  // that will cry wolf exactly once and then be ignored.
  freshness = getFreshness,
  // Injected rather than mocked globally. node:test's mock.timers changed
  // shape between Node versions, and its array form also replaces setTimeout,
  // which deadlocks any helper that waits on one. Passing the scheduler its
  // own timer functions keeps the test independent of all of that.
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let running = false;
  let lastAttempt = null;
  let lastResult = null;

  /*
   * When the price reference was last found missing.
   *
   * The ingest fetches the IMF before the price, deliberately, so that a shape
   * change upstream is still caught when the price feed happens to be down.
   * The cost is that an instance with no usable price provider downloads three
   * large SDMX payloads on every tick and throws them all away. On the shipped
   * six hour interval that is four pointless round trips a day, from every
   * self-hosted copy, for as long as the feed stays shut. The IMF is not
   * charging for that, which is not a reason to spend it.
   *
   * A closed feed does not reopen within hours, so after one such failure the
   * next attempt waits a day. It still retries, because a key being added or a
   * feed reopening should be picked up without anyone restarting the process.
   */
  let noPriceSince = null;
  const NO_PRICE_BACKOFF_MS = 24 * HOUR;

  async function maybeRefresh(reason) {
    if (running) return { skipped: 'a refresh is already running' };

    if (noPriceSince !== null && now() - noPriceSince < NO_PRICE_BACKOFF_MS) {
      const hours = Math.round((now() - noPriceSince) / HOUR);
      return { skipped: `no price reference ${hours}h ago; waiting a day before trying again` };
    }

    // Claimed synchronously, in the same tick as the check above. An earlier
    // version set this only just before spawning, after awaiting the freshness
    // read, so two callers both passed the check and two rebuilds ran at once.
    // The startup refresh and a scheduled tick can genuinely overlap.
    running = true;

    try {
      let current;
      try {
        current = await freshness();
      } catch (err) {
        // No readable snapshot at all is exactly when a rebuild is most useful.
        log.warn?.('[refresh] could not read the snapshot, rebuilding:', err.message);
        current = null;
      }

      const ageHours =
        current?.snapshot?.ageDays != null ? current.snapshot.ageDays * 24 : Infinity;
      if (ageHours < minAgeHours) {
        return { skipped: `snapshot is ${Math.round(ageHours)}h old, under the ${minAgeHours}h threshold` };
      }

      lastAttempt = new Date(now()).toISOString();
      log.log?.(`[refresh] rebuilding the reserves snapshot (${reason})`);

      await run();
      // A run that got all the way through means whatever was missing is back.
      noPriceSince = null;
      // The dataset is cached in memory, so a rebuilt file is not served until
      // the cache is dropped.
      clearReservesCache();
      lastResult = { ok: true, at: new Date(now()).toISOString() };
      const after = await freshness().catch(() => null);
      log.log?.(`[refresh] done. Latest figure now ${after?.data?.latestAsOfDate ?? 'unknown'}`);
      return lastResult;
    } catch (err) {
      // Deliberately not fatal. The previous snapshot is still on disk and
      // still being served; a failed refresh is a stale-data problem, not an
      // outage, and the freshness banner already reports stale data.
      lastResult = { ok: false, at: new Date(now()).toISOString(), error: err.message };

      if (err.exitCode === 3) {
        // Not a failure of this code or of the IMF: there was no price to
        // judge filings against, so nothing was attempted. Said once, at a
        // level that matches, and then left alone for a day.
        noPriceSince = now();
        lastResult.noPriceReference = true;
        log.warn?.(
          '[refresh] no price reference, so the snapshot was not rebuilt. ' +
            'Not retrying for 24h. Set a working PRICE_PROVIDER to resume:',
          err.message,
        );
        return lastResult;
      }

      log.error?.('[refresh] rebuild failed, keeping the existing snapshot:', err.message);
      return lastResult;
    } finally {
      running = false;
    }
  }

  // Checked on start and then on an interval. The IMF publishes monthly, so
  // minAgeHours is what stops this rebuilding more often than the data can
  // possibly change; the interval only decides how soon after publication a
  // long-running server notices.
  maybeRefresh('startup').catch(() => {});
  const timer = setIntervalFn(() => {
    maybeRefresh('scheduled').catch(() => {});
  }, intervalToMs(intervalHours));

  // Unreferenced so a scheduled refresh never holds the process open, which
  // would otherwise make the server unkillable between ticks and hang tests.
  timer.unref?.();

  return {
    stop: () => clearIntervalFn(timer),
    refreshNow: () => maybeRefresh('requested'),
    status: () => ({ running, lastAttempt, lastResult, intervalHours, minAgeHours }),
  };
}

/** Runs the ingest as a child process, so its failures stay its own. */
function runBuild() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT, '--start-year', '2010'], {
      cwd: BACKEND,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.stdout.resume();

    // The ingest makes several large requests; without a ceiling a hung
    // connection would leave `running` true forever and stop every later
    // refresh from even being attempted.
    const timeout = setTimeout(() => child.kill(), 10 * 60 * 1000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolvePromise();
      const failure = new Error(
        `build-reserves exited ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`,
      );
      // 3 means it could not even try: there was no price reference, so unit
      // detection could not run. Carried through so the scheduler can back off
      // rather than repeat a download it is only going to throw away.
      failure.exitCode = code;
      reject(failure);
    });
  });
}
