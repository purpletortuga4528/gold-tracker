import { config } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { getProvider, getHistoryProvider } from './priceProviders/index.js';
import { HttpError } from '../lib/http.js';

const cache = new TtlCache();

export async function getSpotPrice() {
  const provider = getProvider();
  const key = `spot:${provider.id}`;
  try {
    const { value, cached, ageSeconds } = await cache.get(key, config.cache.spotSeconds, () =>
      provider.getSpot(),
    );
    return { ...value, cached, cacheAgeSeconds: ageSeconds };
  } catch (err) {
    // A metered provider going down should degrade the dashboard, not blank it.
    const stale = cache.peekStale(key);
    if (stale) {
      // Same reasoning as below: the upstream message is logged, not returned.
      console.warn(`[price] ${provider.id} refresh failed, serving stale value:`, err);
      return {
        ...stale.value,
        cached: true,
        stale: true,
        cacheAgeSeconds: stale.ageSeconds,
        staleReason: 'The latest refresh from the price provider failed',
      };
    }
    // The provider's own message can carry the request URL and, for a keyed
    // provider, query parameters. Log it, return something safe.
    console.error(`[price] ${provider.id} spot fetch failed:`, err);
    throw new HttpError(502, 'Could not reach the gold price provider');
  }
}

/**
 * @param {{ from?: string, to?: string, range?: string }} options
 *   `range` is a shorthand. The list lives in RANGE_MONTHS below, exported as
 *   SUPPORTED_RANGES; do not restate it here, it drifts.
 */
export async function getPriceHistory({ from, to, range } = {}) {
  const provider = getHistoryProvider();
  const resolvedFrom = from ?? rangeToStartDate(range);
  const key = `history:${provider.id}`;

  // The provider returns its whole series; we cache that once and slice per
  // request, so switching chart ranges costs nothing upstream.
  const { value } = await cache.get(key, config.cache.historySeconds, () => provider.getHistory({}));

  const points = value.points.filter(
    (p) => (!resolvedFrom || p.date >= resolvedFrom) && (!to || p.date <= to),
  );
  return { ...value, points, from: resolvedFrom ?? null, to: to ?? null, range: range ?? null };
}

const RANGE_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24, '5y': 60, '10y': 120 };

export function rangeToStartDate(range, now = new Date()) {
  if (!range || range === 'max') return null;
  const months = RANGE_MONTHS[range];
  if (!months) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export const SUPPORTED_RANGES = [...Object.keys(RANGE_MONTHS), 'max'];

export function clearPriceCache() {
  cache.clear();
}
