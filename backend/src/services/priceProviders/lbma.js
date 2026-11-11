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
 * If you need intraday spot, add a provider: see README.md in this directory.
 *
 * CLOSED SINCE LATE 2026, and kept for whoever can still reach it.
 *
 * Between 2026-09-09 and 2026-10-10 the whole prices.lbma.org.uk subdomain
 * went behind Cloudflare: 401 at the root, 403 on every path, for browsers as
 * well as for scripts. LBMA's own site now says "A licence from IBA is
 * required in order to obtain, use or redistribute real-time or historical
 * benchmark data", and the tables moved to a portal behind that licence. FRED
 * deleted its ICE Benchmark Administration series in January 2022 and the
 * World Gold Council removed historical LBMA prices in March 2025 at ICE's
 * request, so there is no free route left to the benchmark.
 *
 * It is still the default because it needs no key and costs nothing to try,
 * and because an institution reversing a decision is not unheard of. What it
 * must not do is fail in a way that reads like a bug in this app, so the error
 * below names the closure and the alternatives rather than saying the feed
 * could not be read.
 *
 * Verified working against the live endpoint on 2026-09-08, and not since.
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
    /*
     * Two different failures wearing the same clothes.
     *
     * Saying "the feed closed" whenever both requests fail would be claiming a
     * cause rather than reporting one: somebody offline, or behind a proxy
     * that blocks the host, would be told the data had been withdrawn. The
     * closure is only asserted when the evidence for it is there, which is a
     * 403 or a 401 from the host itself. Anything else stays generic.
     */
    const reasons = [pm, am]
      .filter((r) => r.status === 'rejected')
      .map((r) => String(r.reason?.message ?? r.reason));
    const refused = reasons.some((m) => /HTTP (401|403)/.test(m));

    if (!refused) {
      throw new Error(`LBMA: neither the AM nor the PM feed could be read (${reasons.join('; ')})`);
    }

    const closed = new Error(
      'The LBMA open feed closed in late 2026: prices.lbma.org.uk now requires an ' +
        'IBA licence and answers 403. Reserve figures are unaffected. For prices, set ' +
        'PRICE_PROVIDER=metalsdev with a free metals.dev key, or PRICE_PROVIDER=demo ' +
        'to see the app with generated data. See backend/src/services/priceProviders/README.md.',
    );
    // Opt in to being shown. Provider messages are replaced by default because
    // they can carry a request URL and, for a keyed provider, the key with it.
    // This one is written here, names no URL with a secret in it, and is the
    // only thing that explains an otherwise baffling failure.
    closed.publicMessage = closed.message;
    throw closed;
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
