// The troy ounce is exactly 31.1034768 g, so this factor is exact.
// Kept in step with backend/src/lib/units.js -- if you change one, change both.
export const TROY_OUNCES_PER_TONNE = 1_000_000 / 31.1034768;

/** Market value in USD of `tonnes` of gold at `pricePerOunce` USD per troy ounce. */
export function reserveValueUsd(tonnes, pricePerOunce) {
  if (!Number.isFinite(tonnes) || !Number.isFinite(pricePerOunce)) return null;
  return tonnes * TROY_OUNCES_PER_TONNE * pricePerOunce;
}

/**
 * Gold as a share of an economy's total reserves, restated at the market price.
 *
 * The denominator is deliberately rebuilt rather than taken from the IMF's own
 * total reserve assets, because reporters carry gold at inconsistent
 * valuations. The United States books its gold at the statutory $42.2222 an
 * ounce, so the IMF's own ratio makes gold look like 4 percent of US reserves
 * when the published figure is about 84 percent. Non-gold reserves are stable
 * across valuations, so gold at market over (gold at market + non-gold) gives a
 * figure that tracks the published ones and moves with the gold price.
 */
export function goldShareOfReserves(tonnes, pricePerOunce, nonGoldReservesUsd) {
  if (!Number.isFinite(nonGoldReservesUsd)) return null;
  const atMarket = reserveValueUsd(tonnes, pricePerOunce);
  if (atMarket === null) return null;
  const total = atMarket + nonGoldReservesUsd;
  return total > 0 ? atMarket / total : null;
}

const nf = (opts) => new Intl.NumberFormat('en-US', opts);

export const formatTonnes = (t) =>
  Number.isFinite(t) ? `${nf({ maximumFractionDigits: 1 }).format(t)} t` : '--';

export const formatPrice = (p) =>
  Number.isFinite(p)
    ? nf({ style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(p)
    : '--';

/** Big money is unreadable in full. $1,234,567,890,123 becomes $1.23T. */
export function formatUsdCompact(value) {
  if (!Number.isFinite(value)) return '--';
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) {
      return `$${nf({ maximumFractionDigits: 2 }).format(value / size)}${suffix}`;
    }
  }
  return nf({ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export const formatDate = (iso) => {
  if (!iso) return '--';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const formatPercent = (fraction, digits = 1) =>
  Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '--';

/** Percentage change between the first and last point of a series. */
export function changeOver(points, key) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0][key];
  const last = points.at(-1)[key];
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return (last - first) / first;
}

/**
 * Returns the URL only if it is safe to put in an href.
 *
 * The source URL reaches the page from a generated data file rather than from a
 * literal, and React does not block a `javascript:` href -- it warns in
 * development and renders it anyway. Anything that is not http(s) is refused so
 * a tampered dataset cannot turn a citation into a script trigger.
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
