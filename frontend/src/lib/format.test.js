import { describe, expect, test } from 'vitest';
import {
  TROY_OUNCES_PER_TONNE,
  reserveValueUsd,
  goldShareOfReserves,
  formatTonnes,
  formatPrice,
  formatUsdCompact,
  formatDate,
  formatPercent,
  changeOver,
  safeHttpUrl,
} from './format.js';

const LBMA_PM = 4402.55; // 2026-09-07

describe('unit conversion', () => {
  test('a tonne is 32,150.7466 troy ounces', () => {
    expect(TROY_OUNCES_PER_TONNE.toFixed(4)).toBe('32150.7466');
  });

  test('matches the backend constant exactly', async () => {
    // Two copies of this number exist, one per side. If they ever diverge the
    // table and the API disagree about what a country's gold is worth.
    const backend = await import('../../../backend/src/lib/units.js');
    expect(TROY_OUNCES_PER_TONNE).toBe(backend.TROY_OUNCES_PER_TONNE);
  });

  test('reserve value uses troy ounces, not grams', () => {
    // A tonne at $4,000/oz is about $128.6m. Treating a tonne as a million
    // grams' worth would give $4bn, which is the single easiest way to make
    // every figure in this app wrong by 31x.
    const value = reserveValueUsd(1, 4000);
    expect(value).toBeGreaterThan(128_000_000);
    expect(value).toBeLessThan(129_000_000);
  });

  test('the US holding values to about $1.15 trillion', () => {
    expect(formatUsdCompact(reserveValueUsd(8133.53, LBMA_PM))).toBe('$1.15T');
  });

  test('refuses to compute from non-numbers rather than returning NaN', () => {
    expect(reserveValueUsd(undefined, LBMA_PM)).toBeNull();
    expect(reserveValueUsd(100, undefined)).toBeNull();
    expect(reserveValueUsd(null, null)).toBeNull();
  });
});

describe("gold's share of reserves", () => {
  // The US is the case that proves the method. Its reserve total carries gold
  // at the statutory $42.2222/oz, so the IMF's own ratio says 4 percent while
  // the published figure is about 84.
  const USA = { tonnes: 8133.53, nonGoldReservesUsd: 241_667_033_000 };

  test('restates gold at market and lands near the published figure', () => {
    const share = goldShareOfReserves(USA.tonnes, LBMA_PM, USA.nonGoldReservesUsd);
    expect(share).toBeGreaterThan(0.78);
    expect(share).toBeLessThan(0.88);
  });

  test('the naive ratio it replaces would have been wildly low', () => {
    const goldAtBookValue = 11_041_058_800;
    const naive = goldAtBookValue / (USA.nonGoldReservesUsd + goldAtBookValue);
    expect(naive).toBeLessThan(0.06);
  });

  test('moves with the gold price', () => {
    const low = goldShareOfReserves(USA.tonnes, 1000, USA.nonGoldReservesUsd);
    const high = goldShareOfReserves(USA.tonnes, 8000, USA.nonGoldReservesUsd);
    expect(high).toBeGreaterThan(low);
  });

  test('is null when the economy does not report total reserves', () => {
    expect(goldShareOfReserves(100, LBMA_PM, null)).toBeNull();
    expect(goldShareOfReserves(100, LBMA_PM, undefined)).toBeNull();
  });

  test('is null rather than 1 when there is nothing to divide by', () => {
    expect(goldShareOfReserves(0, LBMA_PM, 0)).toBeNull();
  });
});

describe('safeHttpUrl', () => {
  // The source URL reaches an href from a generated data file, and React does
  // not block a javascript: href, it only warns in development.
  test('allows http and https', () => {
    expect(safeHttpUrl('https://data.imf.org/x')).toBe('https://data.imf.org/x');
    expect(safeHttpUrl('http://example.com/')).toBe('http://example.com/');
  });

  test('refuses every scheme that could execute or exfiltrate', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeHttpUrl(hostile)).toBeNull();
    }
  });

  test('refuses anything that is not a parseable absolute URL', () => {
    expect(safeHttpUrl('/relative/path')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl({ href: 'https://x.com' })).toBeNull();
  });
});

describe('formatting', () => {
  test('tonnes and prices', () => {
    expect(formatTonnes(8133.53)).toBe('8,133.5 t');
    expect(formatTonnes(undefined)).toBe('--');
    expect(formatPrice(4402.55)).toBe('$4,402.55');
    expect(formatPrice(null)).toBe('--');
  });

  test('compact money picks the right magnitude', () => {
    expect(formatUsdCompact(1_234_567_890_123)).toBe('$1.23T');
    expect(formatUsdCompact(474_080_000_000)).toBe('$474.08B');
    expect(formatUsdCompact(1_500_000)).toBe('$1.5M');
    expect(formatUsdCompact(999)).toBe('$999');
    expect(formatUsdCompact(NaN)).toBe('--');
  });

  test('dates render in UTC, so a month-end figure never slips a day', () => {
    expect(formatDate('2026-07-31')).toBe('31 Jul 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate(null)).toBe('--');
    expect(formatDate('nonsense')).toBe('nonsense');
  });

  test('percentages', () => {
    expect(formatPercent(0.827)).toBe('82.7%');
    expect(formatPercent(undefined)).toBe('--');
  });
});

describe('changeOver', () => {
  const series = [{ v: 100 }, { v: 150 }, { v: 200 }];

  test('measures first to last', () => {
    expect(changeOver(series, 'v')).toBeCloseTo(1.0);
  });

  test('declines rather than dividing by zero', () => {
    expect(changeOver([{ v: 0 }, { v: 5 }], 'v')).toBeNull();
    expect(changeOver([{ v: 1 }], 'v')).toBeNull();
    expect(changeOver([], 'v')).toBeNull();
    expect(changeOver(null, 'v')).toBeNull();
  });
});
