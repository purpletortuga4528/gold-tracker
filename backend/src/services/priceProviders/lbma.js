/**
 * LBMA Gold Price benchmark -- the default provider. No API key.
 *
 * The London Bullion Market Association publishes the daily gold auction
 * results as open JSON, with USD, GBP and EUR columns and history back to
 * April 1968. Each row is `{ d: "YYYY-MM-DD", v: [usd, gbp, eur] }`.
 *
 * What this is NOT: a live spot feed. The auction runs twice a day (the "AM"
 * and "PM" fixes), so `getSpot()` returns the most recent published benchmark,
 * which can be several hours to a day old. Everything this provider returns is
 * tagged `kind: "benchmark"` so the UI can say so rather than implying a tick.
 * If you need intraday spot, set PRICE_PROVIDER to a keyed provider.
 *
 * Verified working against the live endpoint on 2026-09-08.
 */
const FEEDS = {
  pm: 'https://prices.lbma.org.uk/json/gold_pm.json',
  am: 'https://prices.lbma.org.uk/json/gold_am.json',
};

const CURRENCY_INDEX = { USD: 0, GBP: 1, EUR: 2 };

async function fetchFeed(which) {
  const url = FEEDS[which];
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`LBMA ${which} feed: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`LBMA ${which} feed did not return an array`);

  return rows
    .map((row) => ({
      date: row?.d,
      usd: Number(row?.v?.[CURRENCY_INDEX.USD]),
      gbp: Number(row?.v?.[CURRENCY_INDEX.GBP]),
      eur: Number(row?.v?.[CURRENCY_INDEX.EUR]),
    }))
    .filter((r) => typeof r.date === 'string' && Number.isFinite(r.usd) && r.usd > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The AM and PM auctions are separate series. We prefer PM (the traditional
 * valuation benchmark) but fall back to AM when PM has not published yet, so a
 * morning page load does not show yesterday's number when today's AM exists.
 */
async function latestRow() {
  const [pm, am] = await Promise.allSettled([fetchFeed('pm'), fetchFeed('am')]);
  const pmRows = pm.status === 'fulfilled' ? pm.value : [];
  const amRows = am.status === 'fulfilled' ? am.value : [];
  if (pmRows.length === 0 && amRows.length === 0) {
    throw new Error('LBMA: neither the AM nor the PM feed could be read');
  }
  const pmLatest = pmRows.at(-1);
  const amLatest = amRows.at(-1);
  if (!pmLatest) return { row: amLatest, auction: 'AM' };
  if (!amLatest) return { row: pmLatest, auction: 'PM' };
  return amLatest.date > pmLatest.date
    ? { row: amLatest, auction: 'AM' }
    : { row: pmLatest, auction: 'PM' };
}

export const lbmaProvider = {
  id: 'lbma',
  label: 'LBMA Gold Price',
  requiresKey: false,
  supportsHistory: true,
  description:
    'London Bullion Market Association daily auction benchmark. Free, no key, history to 1968. Once-daily granularity, not live spot.',

  async getSpot() {
    const { row, auction } = await latestRow();
    return {
      priceUsdPerOunce: row.usd,
      currency: 'USD',
      // The auction has no published intraday timestamp in this feed, so the
      // date is the honest resolution: do not dress it up as a wall-clock time.
      asOfDate: row.date,
      kind: 'benchmark',
      benchmark: `LBMA Gold Price ${auction}`,
      alternates: { GBP: row.gbp || null, EUR: row.eur || null },
      provider: 'lbma',
      providerLabel: 'LBMA Gold Price',
      note: `Once-daily auction benchmark (${auction} fix), not a live spot quote.`,
    };
  },

  /**
   * @param {{ from?: string, to?: string }} range ISO dates, inclusive.
   */
  async getHistory({ from, to } = {}) {
    const rows = await fetchFeed('pm');
    const points = rows
      .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
      .map((r) => ({ date: r.date, priceUsdPerOunce: r.usd }));
    return {
      points,
      kind: 'benchmark',
      benchmark: 'LBMA Gold Price PM',
      provider: 'lbma',
      providerLabel: 'LBMA Gold Price',
      granularity: 'daily',
      note: 'Daily PM auction results. Weekends and London holidays are absent by design.',
    };
  },
};
