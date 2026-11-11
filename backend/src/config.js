import 'dotenv/config';

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Like `int`, but refuses a value that would break the thing it configures.
 *
 * A rate limit is a security control, and `RATE_LIMIT_GENERAL=0` does not mean
 * "no limit": express-rate-limit v7 and later answer every request with 429, so
 * a typo takes the whole API offline. A negative value does the same. Falling
 * back to the default and saying so out loud is the only outcome that is not a
 * surprise later.
 */
const positiveInt = (value, fallback, name) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  // Number, not parseInt. parseInt reads "1.5" as 1 and "600abc" as 600, so a
  // mistyped limit would become a different, valid-looking limit rather than an
  // error. Silently honouring half of what was written is the failure this
  // whole helper exists to avoid.
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[config] ${name}="${value}" is not a positive whole number. Using ${fallback}.`);
  return fallback;
};

/**
 * Parses TRUST_PROXY into a value Express actually understands.
 *
 * Environment variables are always strings, and Express treats a string as an
 * IP allowlist. That made every natural spelling wrong in a different way:
 * `false`, `true`, `off` and an empty value threw "invalid IP address" and
 * killed the process at startup, and `1` was accepted but silently trusted
 * nothing, because hop counts have to be numbers. `1` is exactly what the
 * documentation told people to set, so the one documented mitigation for the
 * shared-bucket problem did nothing, and suppressed its own warning while doing
 * it, since the value was no longer strictly `false`.
 */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === null) return false;
  const value = String(raw).trim();
  if (value === '') return false;
  const lower = value.toLowerCase();
  if (['false', 'off', 'no', '0'].includes(lower)) return false;
  if (['true', 'on', 'yes'].includes(lower)) return true;
  if (/^\d+$/.test(value)) return Number(value); // hop count, as a number
  return value; // 'loopback', an address, or a comma separated list
}

export const config = {
  port: positiveInt(process.env.PORT, 5174, 'PORT'),

  /**
   * Which interface to listen on. Unset means every one, which is Node's
   * default and stays the default here: a container or a home server that only
   * answered on its own loopback would be useless.
   *
   * It is worth knowing rather than discovering, though. The rate limits exist
   * partly to catch accidental exposure, and "started it" and "published it on
   * the network" are the same act unless this is set. HOST=127.0.0.1 keeps it
   * to the machine it runs on.
   */
  host: process.env.HOST?.trim() || undefined,

  /**
   * Which price provider to use. "lbma" needs no key and is the default.
   * See src/services/priceProviders/index.js for the full list.
   */
  priceProvider: process.env.PRICE_PROVIDER ?? 'lbma',

  /**
   * metals.dev API key, for the provider that republishes the LBMA fix.
   *
   * Read here and used only in priceProviders/metalsdev.js. It never reaches
   * the frontend, never appears in a response, and never goes in a log: the
   * provider reports HTTP statuses rather than URLs, because the key travels
   * as a query parameter.
   */
  metalsDevKey: process.env.METALS_DEV_API_KEY?.trim() || null,

  /** Cache lifetimes in seconds. */
  cache: {
    // The LBMA benchmark is set twice a day, so re-fetching often buys nothing.
    // A provider that quotes live spot would want a shorter one, and would also
    // be metering your calls. Zero is allowed here: it means do not cache.
    spotSeconds: int(process.env.CACHE_SPOT_SECONDS, 300),
    historySeconds: int(process.env.CACHE_HISTORY_SECONDS, 6 * 60 * 60),
  },

  /**
   * Requests per minute per client IP. Sized against what the app itself does:
   * a cold Compare load with six countries is 10 requests inside a millisecond,
   * which React StrictMode doubles to 20 in development.
   */
  rateLimit: {
    // 600/min. A Compare load is 10 requests, or 20 under StrictMode, so this
    // is 30 such loads a minute even in development. 300 was the first choice
    // and is 15, which is close enough to real development activity to risk
    // throttling the person working on the app.
    general: positiveInt(process.env.RATE_LIMIT_GENERAL, 600, 'RATE_LIMIT_GENERAL'),
    // /api/price/history?range=max returns 694 kB for a 67 byte request, or
    // 83 kB to a caller that accepts compression. This bucket is what caps
    // egress, and it is sized against the uncompressed figure because that is
    // the one the caller can insist on: 45/min is 31 MB/min at worst, 3.8 at
    // best. Generous for a human, who would have to sweep all eight range
    // buttons more than five times over in a minute to reach it.
    priceHistory: positiveInt(process.env.RATE_LIMIT_PRICE_HISTORY, 45, 'RATE_LIMIT_PRICE_HISTORY'),
    // Monitors poll this; throttling it would fake an outage.
    health: positiveInt(process.env.RATE_LIMIT_HEALTH, 1200, 'RATE_LIMIT_HEALTH'),
  },

  /**
   * Whether to believe X-Forwarded-For, as an Express `trust proxy` value.
   *
   * Off by default, and that default cuts both ways.
   *
   * Left off with no proxy in front: correct. Trusting a forwarded header that
   * nothing sets would let any caller present a fresh IP per request and walk
   * past every limit.
   *
   * Left off WITH a proxy in front: every request arrives wearing the proxy's
   * address, so all your users share one bucket and the limits become a global
   * cap rather than a per-client one. Under real traffic that throttles
   * everybody at once.
   *
   * So: deploying behind a proxy means setting this, to the specific hop count
   * or address rather than `true`, which would trust any hop.
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  /**
   * Serve the built frontend from this process, so self-hosting is one command
   * on one port. Off during development, where Vite serves the app on 5173 and
   * proxies /api here; having both serve it would mean editing files and
   * wondering which copy you are looking at.
   */
  serveFrontend: (process.env.SERVE_FRONTEND ?? 'true').toLowerCase() !== 'false',

  /**
   * Keeping the reserves snapshot current while the server runs.
   *
   * Detecting staleness was never the hard part. Without this, a self-hosted
   * copy quietly drifts: the banner appears, nobody acts on it, and the figures
   * age. IRFCL publishes monthly, so minAgeHours is what stops a rebuild
   * happening more often than the data can change, and intervalHours only
   * decides how soon after publication a long-running server notices.
   */
  autoRefresh: {
    enabled: (process.env.AUTO_REFRESH ?? 'true').toLowerCase() !== 'false',
    intervalHours: int(process.env.AUTO_REFRESH_INTERVAL_HOURS, 6),
    minAgeHours: int(process.env.AUTO_REFRESH_MIN_AGE_HOURS, 24),
  },

  /** Comma-separated list of allowed CORS origins, or "*" to allow any. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
