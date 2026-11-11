/**
 * metals.dev, which carries the LBMA fix the app was built around.
 *
 * Why this exists: in late 2026 LBMA closed its open JSON feed. The whole
 * prices.lbma.org.uk subdomain now answers 401 at the root and 403 on every
 * path, and LBMA's own site says "A licence from IBA is required in order to
 * obtain, use or redistribute real-time or historical benchmark data". FRED
 * deleted its ICE Benchmark Administration series in January 2022 and the
 * World Gold Council removed historical LBMA prices in March 2025 at ICE's
 * request. There is no free door left to the benchmark itself.
 *
 * metals.dev republishes it under their own licence, which is why this is a
 * keyed provider in a project that used to need no keys. Each person running
 * the app supplies their own key and accepts their terms; nothing is
 * redistributed here and no price is committed to this repository.
 *
 * UNVERIFIED until somebody runs it. This file was written from metals.dev's
 * published documentation, and the last two adapters written that way were
 * deleted rather than shipped, for exactly that reason. `verified` stays false
 * until `npm run verify:provider -- metalsdev` has been run against a real key
 * and the number checked against a public quote. See README.md here.
 *
 * ON THE REQUEST BUDGET, which decides whether this is usable at all.
 * The free tier is 100 requests a month, about three a day. The app's shipped
 * cache defaults (spot every 5 minutes, history every 6 hours) would make
 * roughly 8,760 requests a month and exhaust a month's quota before lunch. So
 * this provider states what it needs, index.js prints a warning when the
 * configured lifetimes cannot be afforded, and .env.example carries the
 * arithmetic. Nothing here silently spends somebody's quota.
 */
import { config } from '../../config.js';

const BASE = 'https://api.metals.dev/v1';

/**
 * Cache lifetimes this provider needs to stay inside the free tier.
 *
 * 12 hours of spot is two requests a day, 24 hours of history is one, which is
 * 90 a month against a quota of 100. A long spot lifetime is honest here
 * anyway: the LBMA fix is set twice a day, so a shorter one would re-fetch a
 * number that cannot have changed.
 */
export const FREE_TIER_BUDGET = {
  requestsPerMonth: 100,
  spotSeconds: 43_200,
  historySeconds: 86_400,
};

/** Throws with the keys actually received, rather than reaching for a fallback. */
function readMetal(metals, names, context) {
  if (!metals || typeof metals !== 'object') {
    throw new Error(`metals.dev ${context}: no "metals" object in the response`);
  }
  for (const name of names) {
    const value = metals[name];
    if (Number.isFinite(value) && value > 0) return { name, value };
  }
  throw new Error(
    `metals.dev ${context}: none of ${names.join(', ')} present. Received: ` +
      `${Object.keys(metals).join(', ') || '(nothing)'}`,
  );
}

async function get(path, params, context) {
  if (!config.metalsDevKey) {
    throw new Error(
      'METALS_DEV_API_KEY is not set. Get a free key at metals.dev and put it in backend/.env.',
    );
  }
  const url = new URL(`${BASE}${path}`);
  // Unit first and always. A per-gram figure read as per-ounce is wrong by 31
  // and still looks like a price, which is the mistake this app's own provider
  // documentation warns about hardest.
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('unit', 'toz');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('api_key', config.metalsDevKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // Never the URL: it carries the key in a query parameter.
    throw new Error(`metals.dev ${context}: HTTP ${res.status}${body?.error_message ? ` (${body.error_message})` : ''}`);
  }
  if (body?.status && body.status !== 'success') {
    throw new Error(`metals.dev ${context}: ${body.error_message ?? body.status}`);
  }
  if (body?.unit && body.unit !== 'toz') {
    throw new Error(`metals.dev ${context}: asked for troy ounces and got "${body.unit}"`);
  }
  if (body?.currency && body.currency !== 'USD') {
    throw new Error(`metals.dev ${context}: asked for USD and got "${body.currency}"`);
  }
  return body;
}

export const metalsDevProvider = {
  id: 'metalsdev',
  label: 'LBMA Gold Price via metals.dev',
  requiresKey: true,
  supportsHistory: true,
  // Flipped only after a real call has been made and the number checked.
  verified: false,
  description:
    'The LBMA AM and PM fixes, republished by metals.dev. Needs a free API key. ' +
    'The free tier is 100 requests a month, so cache lifetimes must be long.',

  async getSpot() {
    const body = await get('/latest', {}, 'latest');

    // The PM fix is the traditional valuation benchmark. AM is the fallback
    // before the afternoon auction publishes. Generic spot is the last resort
    // and is labelled as spot rather than borrowing the benchmark's name.
    const metals = body?.metals;
    let picked;
    let benchmark;
    let kind;
    try {
      picked = readMetal(metals, ['lbma_gold_pm'], 'latest');
      benchmark = 'LBMA Gold Price PM';
      kind = 'benchmark';
    } catch {
      try {
        picked = readMetal(metals, ['lbma_gold_am'], 'latest');
        benchmark = 'LBMA Gold Price AM';
        kind = 'benchmark';
      } catch {
        picked = readMetal(metals, ['gold'], 'latest');
        benchmark = 'Spot gold via metals.dev';
        kind = 'spot';
      }
    }

    return {
      priceUsdPerOunce: picked.value,
      currency: 'USD',
      // Their timestamp if they give one, otherwise today. Never invented
      // precision: this is a date, not a wall-clock time.
      asOfDate: (body.timestamps?.metal ?? body.timestamp ?? new Date().toISOString()).slice(0, 10),
      kind,
      benchmark,
      provider: 'metalsdev',
      providerLabel: 'LBMA Gold Price via metals.dev',
      note:
        kind === 'benchmark'
          ? `Once-daily auction benchmark (${benchmark.endsWith('AM') ? 'AM' : 'PM'} fix), republished by metals.dev. Not a live spot quote.`
          : 'The LBMA fix was not in this response, so this is metals.dev spot gold rather than the benchmark.',
    };
  },

  /**
   * @param {{ from?: string, to?: string }} range ISO dates, inclusive.
   *
   * Their timeseries window is 30 days per request and returns generic spot
   * gold rather than the LBMA fix, so a chart drawn from it is neither the
   * benchmark nor the full history the LBMA feed gave. Both facts travel with
   * the response rather than being left for somebody to infer from the shape.
   */
  async getHistory({ from, to } = {}) {
    const end = to ? new Date(`${to}T00:00:00Z`) : new Date();
    const start = new Date(end.getTime() - 29 * 86_400_000);
    const requestedFrom = from ? new Date(`${from}T00:00:00Z`) : null;
    const truncated = requestedFrom !== null && requestedFrom < start;

    const iso = (d) => d.toISOString().slice(0, 10);
    const body = await get(
      '/timeseries',
      { start_date: iso(start), end_date: iso(end) },
      'timeseries',
    );

    const rates = body?.rates;
    if (!rates || typeof rates !== 'object') {
      throw new Error(
        `metals.dev timeseries: no "rates" object. Received: ${Object.keys(body ?? {}).join(', ')}`,
      );
    }

    const points = Object.entries(rates)
      .map(([date, row]) => ({ date, priceUsdPerOunce: row?.metals?.gold }))
      .filter((p) => Number.isFinite(p.priceUsdPerOunce) && p.priceUsdPerOunce > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (points.length === 0) {
      throw new Error('metals.dev timeseries: no usable gold points in the response');
    }

    return {
      points,
      kind: 'spot',
      benchmark: 'Spot gold via metals.dev',
      provider: 'metalsdev',
      providerLabel: 'LBMA Gold Price via metals.dev',
      granularity: 'daily',
      truncated,
      note:
        'Daily spot gold, not the LBMA fix, which metals.dev publishes only as a live value. ' +
        'Limited to the last 30 days: their timeseries window is 30 days per request and the ' +
        'free tier is 100 requests a month, so a longer chart would cost more than it is worth.',
    };
  },
};
