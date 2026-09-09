/**
 * Contrast, checked as arithmetic rather than by eye.
 *
 * This exists because the previous check was a browser snippet whose colour
 * parser only understood `rgb()`. Tailwind v4 compiles `text-ink/50` to a
 * `color-mix`, which Chrome reports as `oklab(...)`, so every faded element was
 * skipped and the audit reported zero failures on a page where 187 of 638
 * elements were below AA. A measurement that silently skips the risky cases is
 * worse than no measurement, because it is quoted with confidence.
 *
 * Secondary text is now solid palette tokens, which is what makes this
 * checkable here at all: solid colours can be read straight out of index.css
 * and composited in Node, with no browser and no CSS engine involved.
 *
 * What this does NOT prove: that a given element actually uses these tokens, or
 * that a component has not invented a colour of its own. It pins the palette.
 * See README.md for the rendered-page audit that covers the rest.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vite rewrites import.meta.url in transformed modules, so it is not a usable
// file path here. Vitest runs with the frontend package as its root.
const CSS_PATH = resolve(process.cwd(), 'src/index.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** Reads one selector's `--c-*` declarations. Last block wins, as in CSS. */
function tokensFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out = {};
  for (const block of css.matchAll(re)) {
    for (const decl of block[1].matchAll(/(--c-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      out[decl[1]] = decl[2];
    }
  }
  return out;
}

const LIGHT = tokensFor(':root');
const DARK = { ...LIGHT, ...tokensFor(":root[data-theme='dark']") };
const LIGHT_HC = { ...LIGHT, ...tokensFor(":root[data-contrast='high']") };
const DARK_HC = {
  ...DARK,
  ...tokensFor(":root[data-contrast='high']"),
  ...tokensFor(":root[data-theme='dark'][data-contrast='high']"),
};

const hexToRgb = (hex) => {
  const h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
/** Alpha compositing in sRGB, which is what the browser paints. */
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

const ratio = (fgHex, bgHex, alpha = 1) => {
  const bg = hexToRgb(bgHex);
  const fg = alpha === 1 ? hexToRgb(fgHex) : over(hexToRgb(fgHex), bg, alpha);
  return contrast(fg, bg);
};

// `flattens` mirrors the rule at the foot of index.css: under high contrast the
// warn and danger opacity steps are restored to full opacity, so checking them
// faded there would be testing a colour the browser never paints.
const MODES = [
  { name: 'light / normal', t: LIGHT, bar: 4.5, flattens: false },
  { name: 'dark / normal', t: DARK, bar: 4.5, flattens: false },
  { name: 'light / high', t: LIGHT_HC, bar: 7, flattens: true },
  { name: 'dark / high', t: DARK_HC, bar: 7, flattens: true },
];

/** Every ground a body text token can land on, including the chip tints. */
function grounds(t) {
  const plain = ['--c-canvas', '--c-surface', '--c-raised'].map((k) => ({ label: k, hex: t[k] }));
  const tinted = [];
  for (const g of plain) {
    for (const alpha of [0.05, 0.1]) {
      const mixed = over(hexToRgb(t['--c-ink']), hexToRgb(g.hex), alpha);
      const hex = `#${mixed.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
      tinted.push({ label: `${g.label} + ink/${alpha * 100}`, hex });
    }
  }
  return [...plain, ...tinted];
}

describe('palette contrast', () => {
  test('every mode defines the tokens this file checks', () => {
    for (const { name, t } of MODES) {
      for (const key of ['--c-ink', '--c-ink-muted', '--c-ink-subtle', '--c-canvas', '--c-surface', '--c-raised']) {
        expect(t[key], `${name} is missing ${key}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    }
  });

  describe.each(MODES)('$name', ({ t, bar, flattens }) => {
    // The three text tiers, against every ground they can sit on. `subtle` is
    // the faintest tier and the one that regressed before: it is held to the
    // same bar as the rest, because WCAG does not have a discount for text the
    // designer meant to de-emphasise.
    test.each(['--c-ink', '--c-ink-muted', '--c-ink-subtle'])('%s clears the bar on every ground', (token) => {
      for (const g of grounds(t)) {
        expect(ratio(t[token], g.hex), `${token} on ${g.label}`).toBeGreaterThanOrEqual(bar);
      }
    });

    test('button labels clear the bar on the accent', () => {
      expect(ratio(t['--c-on-accent'], t['--c-accent'])).toBeGreaterThanOrEqual(bar);
      expect(ratio(t['--c-on-accent'], t['--c-accent-strong'])).toBeGreaterThanOrEqual(bar);
    });

    test('accent text clears the bar on the plain grounds', () => {
      for (const key of ['--c-canvas', '--c-surface', '--c-raised']) {
        expect(ratio(t['--c-accent'], t[key]), `accent on ${key}`).toBeGreaterThanOrEqual(bar);
      }
    });

    test('status colours clear the bar on the grounds they are used on', () => {
      for (const key of ['--c-canvas', '--c-surface', '--c-raised']) {
        expect(ratio(t['--c-positive'], t[key]), `positive on ${key}`).toBeGreaterThanOrEqual(bar);
        expect(ratio(t['--c-negative'], t[key]), `negative on ${key}`).toBeGreaterThanOrEqual(bar);
      }
    });

    // Recharts draws the axis labels as SVG text, so they are text like any
    // other and are held to the same bar. They are easy to forget because they
    // never appear in the DOM as a styled element.
    test('chart axis labels clear the bar', () => {
      for (const key of ['--c-canvas', '--c-surface', '--c-raised']) {
        expect(ratio(t['--c-axis'], t[key]), `axis on ${key}`).toBeGreaterThanOrEqual(bar);
      }
    });

    // These two are still opacity steps in the components, so they are checked
    // composited rather than flat. If a component adds a step outside this
    // list, this test will not know: keep the list in step with index.css.
    test('warn and danger text clears the bar at every opacity step used', () => {
      for (const alpha of flattens ? [1] : [0.7, 0.8, 0.9, 1]) {
        expect(
          ratio(t['--c-warn-ink'], t['--c-warn-bg'], alpha),
          `warn-ink/${alpha * 100} on warn-bg`,
        ).toBeGreaterThanOrEqual(bar);
      }
      for (const alpha of flattens ? [1] : [0.8, 0.9, 1]) {
        expect(
          ratio(t['--c-danger-ink'], t['--c-danger-bg'], alpha),
          `danger-ink/${alpha * 100} on danger-bg`,
        ).toBeGreaterThanOrEqual(bar);
      }
    });
  });
});

/**
 * Recharts takes colours as props, so useChartColors reads the custom
 * properties back out of the computed style, with a hardcoded fallback for the
 * case where there is no stylesheet. A fallback that has drifted from the
 * palette is the second set of hex codes that file exists to prevent.
 */
describe('chart colour fallbacks', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/useTheme.jsx'), 'utf8');

  test('every fallback matches the light palette it stands in for', () => {
    const pairs = [...source.matchAll(/read\('(--c-[\w-]+)',\s*'(#[0-9a-fA-F]{3,8})'\)/g)];
    expect(pairs.length, 'no read(name, fallback) pairs found in useTheme.jsx').toBeGreaterThan(4);

    for (const [, token, fallback] of pairs) {
      expect(LIGHT[token], `${token} is read but not defined in :root`).toBeDefined();
      expect(fallback.toLowerCase(), `fallback for ${token}`).toBe(LIGHT[token].toLowerCase());
    }
  });
});
