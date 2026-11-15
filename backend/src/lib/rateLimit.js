import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Rate limiting.
 *
 * Three buckets, because the endpoints do not cost the same thing. Measured
 * response sizes, uncompressed and gzipped:
 *
 *   /api/health                     0.4 kB    not compressed, under the threshold
 *   /api/price/current              0.3 kB    not compressed, under the threshold
 *
 * Health is the one figure here that moves on its own: the body carries the
 * freshness grading, so it grows as the snapshot ages. It was written as 0.3
 * and measures 379 bytes now. What the row is for holds either way, which is
 * that both of these sit under the 1 kB compression threshold.
 *   /api/reserves                    29 kB -> 4.5 kB
 *   /api/price/history?range=max    694 kB -> 83 kB   <-- the amplifier
 *
 * The sizes that matter here are the uncompressed ones, and that is not an
 * oversight. Compression is something the caller asks for: send
 * `Accept-Encoding: identity` and the 694 kB arrives in full. A browser gets
 * the small number, an adversary chooses, and a limit is sized against the
 * choice it does not control.
 *
 * So: a 67 byte request returning 694 kB is the case worth bounding. Served at
 * the general limit that is 417 MB a minute of egress to one caller, so the
 * history route gets its own tighter bucket on top of the general one, which
 * brings it to 31 MB a minute. Recompute both if you change a limit.
 *
 * Limits are sized against what the app itself does rather than a guess. A cold
 * Compare load with six countries fires 10 requests inside a millisecond, and
 * React StrictMode doubles that to 20 in development. A short window, or a
 * limit in the low tens, would reject the app's own normal behaviour, which is
 * worse than not limiting at all. Browsing five pages, one of them that
 * Compare, comes to 15 requests in all.
 */

const jsonLimitHandler = (_req, res) => {
  res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
};

/**
 * Keys by IP, collapsing IPv6 addresses to their /56 subnet.
 *
 * A single machine is routinely handed a whole IPv6 prefix, so keying on the
 * exact address would let a caller rotate through addresses and never fill a
 * bucket. `ipKeyGenerator` is the library's helper for precisely that.
 */
const keyByIp = (req) => {
  // req.ip is normally set, but is undefined if the socket has already gone.
  // ipKeyGenerator passes undefined straight through, and an undefined key
  // pools every such request into one bucket. Naming that bucket explicitly is
  // the same behaviour, minus the ambiguity of a key that is not a key.
  const key = req.ip ? ipKeyGenerator(req.ip) : undefined;
  return key ?? 'unknown-client';
};

const HEALTH_PATH = '/api/health';

/**
 * True for the health endpoint, matching on segment boundaries.
 *
 * A plain startsWith was a rate limit bypass. Express mounts middleware on
 * segment boundaries, so `app.use('/api/health', ...)` does not match
 * `/api/healthz`, but a prefix test does. The result was that any path
 * beginning `/api/health` skipped the general bucket without ever entering the
 * health one, and answered 404 with no limit applied at all, forever.
 */
const isHealth = (req) => {
  const full = `${req.baseUrl}${req.path}`;
  return full === HEALTH_PATH || full.startsWith(`${HEALTH_PATH}/`);
};

/**
 * Builds a fresh set of limiters.
 *
 * A factory rather than module-level singletons, because each limiter owns a
 * MemoryStore. Shared instances meant every app built in one process drew from
 * the same buckets: in the tests one case's 20 requests silently ate into the
 * next one's allowance, and throttling began at 281 instead of 301. Production
 * runs a single app so it never showed there, which is exactly the kind of
 * thing that only surfaces later and confusingly.
 */
export function createLimiters(limits = config.rateLimit) {
  const base = {
    windowMs: 60_000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyByIp,
    handler: jsonLimitHandler,
  };

  return {
    /**
     * Everything under /api except health. A person browsing hard stays well
     * inside this; health is skipped so it does not drain this bucket as well
     * as its own.
     */
    general: rateLimit({ ...base, limit: limits.general, skip: isHealth }),

    /**
     * The 694 kB history payload, on top of the general bucket. Still roomy for
     * a human clicking through all eight range buttons.
     */
    priceHistory: rateLimit({ ...base, limit: limits.priceHistory }),

    /**
     * Health gets its own, higher bucket. A monitor polling every second is
     * normal, and throttling it would fake an outage at exactly the moment
     * health matters most. Still bounded: an endpoint with no limit is its own
     * small problem.
     */
    health: rateLimit({ ...base, limit: limits.health }),
  };
}

/**
 * Warns, once, if a forwarded header shows up while `trust proxy` is off.
 *
 * That combination is the one case where the limits stop being per client:
 * every request arrives wearing the proxy's address, so all callers share a
 * bucket and the limit becomes a global cap. It is a misconfiguration rather
 * than a design choice, and the app can tell the moment it is true, so it says
 * so then instead of carrying a caveat in the docs that nobody reads at the
 * point it matters.
 *
 * Deliberately not automatic: trusting the header because the header is
 * present is precisely the bug it would be papering over, since anyone can
 * send one. Only the operator knows whether a proxy is genuinely in front.
 */
export function warnIfProxied(trustProxy) {
  let warned = false;
  return (req, _res, next) => {
    if (!warned && trustProxy === false && (req.headers['x-forwarded-for'] || req.headers.forwarded)) {
      warned = true;
      console.warn(
        '[rate-limit] A forwarded header arrived but trust proxy is off, so every ' +
          'client is being counted as one and the rate limits are acting as a single ' +
          'global cap. If a proxy you control is in front, set TRUST_PROXY to the hop ' +
          'count or its address. If not, something is spoofing the header and this is ' +
          'correctly being ignored.',
      );
    }
    next();
  };
}
