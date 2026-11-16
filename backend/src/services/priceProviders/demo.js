/**
 * Generated prices, for demonstrating the app without a working price feed.
 *
 * Why this exists. The LBMA feed went behind Cloudflare and now answers 401 at
 * the root and 403 on every path, to browsers exactly as to scripts, which
 * leaves the only keyless provider that ships unable to return a number. There
 * is no "open it by hand" around it. Everything downstream of a
 * price goes dark with it: the headline, the chart, every dollar valuation and
 * the share of reserves. That is correct behaviour and it is useless for
 * showing somebody what the app does.
 *
 * NOTHING HERE IS A REAL PRICE. Not one value. The series is generated from a
 * fixed seed, so it is identical on every run and on every machine, and it is
 * shaped to look like gold's history only so that a chart of it reads as a
 * chart rather than as noise. The anchors below are roughly where gold
 * actually traded at those dates, and every value between them is invented.
 *
 * That makes this the one provider in here that could mislead somebody, so it
 * says what it is in every place a price surfaces: the provider label, the
 * note under the headline, the pill beside it, /api/price/providers, and the
 * startup banner. It is never the default and must never become one. It is
 * reached only by setting PRICE_PROVIDER=demo deliberately.
 *
 * When the LBMA feed is reachable again, or another provider is added, this
 * has no further use.
 */

/** The warning that travels with every response this provider produces. */
/*
 * Worded to be true of the anchors as well as the series.
 *
 * It used to end "must not be read as a quote, a benchmark, or a record of
 * what gold cost on any date". Every served value is generated, so that was
 * right about the series, and wrong about the fourteen anchors it is drawn
 * through: those are real historical levels on real dates, which is the whole
 * reason the chart has a recognisable shape. A disclaimer that overstates
 * itself is worth less than one that says exactly what is and is not invented.
 */
const DISCLAIMER =
  'GENERATED DATA, NOT REAL PRICES. Every figure served here is invented for ' +
  'demonstration and must not be read as a quote or a benchmark. The curve is ' +
  'drawn through a handful of real historical levels so that a chart of it ' +
  'reads as a chart, but no value on it is a published price.';

/**
 * Roughly where gold traded, in USD per troy ounce, at a handful of dates
 * most people would recognise. Only the shape of the curve comes from these:
 * the daily values between them are generated.
 */
const ANCHORS = [
  ['1968-04-01', 38],
  ['1974-12-31', 183],
  ['1980-01-21', 850], // the Hunt brothers peak
  ['1985-02-25', 284],
  ['1987-12-14', 486],
  ['1999-08-25', 253], // the Brown Bottom
  ['2005-12-30', 513],
  ['2008-03-17', 1011],
  ['2011-09-06', 1895], // the post-crisis high
  ['2015-12-17', 1050],
  ['2020-08-06', 2067],
  ['2022-11-03', 1618],
  ['2024-10-30', 2787],
  /*
   * A round number, and deliberately not the last published fix.
   *
   * This anchor used to be ['2026-09-08', 4399]: the date and value of the
   * real LBMA PM fix, rounded to the dollar. With the cross-rate multipliers
   * below also taken from that day, the demo provider reproduced the actual
   * benchmark to within 0.011 percent in all three currencies, while every
   * label around it said "Not a real price". A generated series that lands on
   * the real number is the one thing this provider must not do, whatever the
   * labels say, and it made the honest labelling look like a formality.
   */
  ['2026-09-08', 4000],
];

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * A small deterministic generator, so the same chart appears every time.
 *
 * Math.random would give a different series on every restart, which looks like
 * live data moving and is the last impression this provider should leave.
 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * Daily points from the first anchor to the last, interpolated between the
 * anchors and jittered so the line is not made of straight segments.
 *
 * Built once and held, because it is a little over twenty thousand points and
 * nothing about it changes.
 */
let series = null;
function buildSeries() {
  if (series) return series;

  const random = seeded(20_260_908);
  const points = [];
  let drift = 0;

  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const [fromDate, fromPrice] = ANCHORS[i];
    const [toDate, toPrice] = ANCHORS[i + 1];
    const start = Date.parse(`${fromDate}T00:00:00Z`);
    const end = Date.parse(`${toDate}T00:00:00Z`);
    const days = Math.round((end - start) / DAY);

    for (let d = 0; d < days; d += 1) {
      const t = d / days;
      // Geometric rather than linear, so a move from 253 to 1895 does not look
      // like a ramp. Prices compound; a straight line between them does not.
      const base = fromPrice * (toPrice / fromPrice) ** t;
      // A slow wander that mean-reverts, so the line wobbles without escaping.
      drift = drift * 0.985 + (random() - 0.5) * 0.02;
      const price = base * (1 + drift);

      const date = iso(start + d * DAY);
      // The real auction does not run at weekends, and a chart with gaps where
      // the market is shut is part of what the app is trying to show.
      const weekday = new Date(start + d * DAY).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;

      points.push({ date, priceUsdPerOunce: Math.round(price * 100) / 100 });
    }
  }

  const [lastDate, lastPrice] = ANCHORS.at(-1);
  points.push({ date: lastDate, priceUsdPerOunce: lastPrice });

  series = points;
  return series;
}

export const demoProvider = {
  id: 'demo',
  label: 'DEMONSTRATION DATA (not real prices)',
  requiresKey: false,
  supportsHistory: true,
  // Not in the sense verify-provider means, and deliberately so: there is no
  // upstream to verify against, and a run of `npm run verify:provider -- demo`
  // should never be able to end with this marked as trustworthy.
  verified: false,
  /** Read by index.js and by the startup banner, which says so out loud. */
  synthetic: true,
  description:
    'Generated prices for demonstrating the app when no real feed is reachable. ' +
    'Every value is invented. Never use this for anything but a demonstration.',

  async getSpot() {
    const points = buildSeries();
    const latest = points.at(-1);
    return {
      priceUsdPerOunce: latest.priceUsdPerOunce,
      currency: 'USD',
      asOfDate: latest.date,
      kind: 'demo',
      benchmark: 'Demonstration data',
      synthetic: true,
      alternates: {
        /*
         * Round rates, and that matters more than it looks.
         *
         * These were 0.738 and 0.8603, which are the real GBP/USD and EUR/USD
         * cross-rates of 2026-09-08 to four decimal places. Combined with an
         * anchor set to that day's fix, the three currencies came out within
         * 0.011 percent of the published row all at once. The comment here
         * said "invented like everything else"; they were not.
         */
        GBP: Math.round(latest.priceUsdPerOunce * 0.75 * 100) / 100,
        EUR: Math.round(latest.priceUsdPerOunce * 0.85 * 100) / 100,
      },
      provider: 'demo',
      providerLabel: 'DEMONSTRATION DATA (not real prices)',
      note: DISCLAIMER,
    };
  },

  /**
   * @param {{ from?: string, to?: string }} range ISO dates, inclusive.
   */
  async getHistory({ from, to } = {}) {
    const points = buildSeries().filter(
      (p) => (!from || p.date >= from) && (!to || p.date <= to),
    );
    return {
      points,
      kind: 'demo',
      benchmark: 'Demonstration data',
      synthetic: true,
      provider: 'demo',
      providerLabel: 'DEMONSTRATION DATA (not real prices)',
      granularity: 'daily',
      note: DISCLAIMER,
    };
  },
};
