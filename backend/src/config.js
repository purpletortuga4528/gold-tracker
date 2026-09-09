import 'dotenv/config';

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
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
  port: int(process.env.PORT, 5174),

  /**
   * Which price provider to use. "lbma" needs no key and is the default.
   * See src/services/priceProviders/index.js for the full list.
   */
  priceProvider: process.env.PRICE_PROVIDER ?? 'lbma',

  /**
   * Provider keys. These stay on the server: the frontend never sees them and
   * never talks to a price provider directly.
   */
  goldApiKey: process.env.GOLDAPI_KEY ?? '',
  metalPriceApiKey: process.env.METALPRICEAPI_KEY ?? '',

  /** Cache lifetimes in seconds. */
  cache: {
    // The LBMA benchmark is set twice a day, so re-fetching often buys nothing.
    // Keyed spot providers move constantly but also meter your free tier.
    spotSeconds: int(process.env.CACHE_SPOT_SECONDS, 300),
    historySeconds: int(process.env.CACHE_HISTORY_SECONDS, 6 * 60 * 60),
  },

  /**
   * Requests per minute per client IP. Sized against what the app itself does:
   * one Compare page load with six countries is 20 requests in a fraction of a
   * second, doubled again by React StrictMode in development.
   */
  rateLimit: {
    // 600/min. One Compare page load is 20 requests, so this is about 30 such
    // loads a minute. 300 was the first choice and is roughly 15 loads, which
    // is close enough to real development activity to risk throttling the
    // person working on the app.
    general: int(process.env.RATE_LIMIT_GENERAL, 600),
    // /api/price/history?range=max returns 694 kB from a 60 byte request, so
    // this bucket is what actually caps egress: 45/min is about 31 MB/min.
    // Generous for a human, who would have to sweep all eight range buttons
    // three times over in a minute to reach it.
    priceHistory: int(process.env.RATE_LIMIT_PRICE_HISTORY, 45),
    // Monitors poll this; throttling it would fake an outage.
    health: int(process.env.RATE_LIMIT_HEALTH, 1200),
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

  /** Comma-separated list of allowed CORS origins, or "*" to allow any. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
