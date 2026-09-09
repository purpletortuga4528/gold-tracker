import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Appearance state: colour theme and typeface.
 *
 * `theme` is what the user chose, and may be 'system'. `resolvedTheme` is the
 * concrete 'light' or 'dark' actually applied. Only the resolved value ever
 * reaches the DOM, as `data-theme` on <html>, so the stylesheet never needs a
 * `prefers-color-scheme` query and there is one palette to keep correct rather
 * than two.
 *
 * The same keys are read by the boot script in index.html, which applies the
 * attributes before first paint. If you rename them, rename them there too.
 */
export const THEME_KEY = 'gold-tracker:theme';
export const FONT_KEY = 'gold-tracker:font';
export const CONTRAST_KEY = 'gold-tracker:contrast';

const THEMES = ['light', 'dark', 'system'];
const FONTS = ['default', 'hyperlegible'];
const CONTRASTS = ['normal', 'high'];

const AppearanceContext = createContext(null);

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

/** localStorage throws in some privacy modes, and appearance is never worth a crash. */
function readStored(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore: the choice still applies for this session */
  }
}

export function AppearanceProvider({ children }) {
  const [theme, setThemeState] = useState(() => readStored(THEME_KEY, THEMES, 'system'));
  const [font, setFontState] = useState(() => readStored(FONT_KEY, FONTS, 'default'));
  // Contrast is deliberately independent of theme rather than a fourth theme
  // value. Needing high contrast and preferring a dark ground are different
  // needs, and folding them together would force one to give way.
  const [contrast, setContrastState] = useState(() =>
    readStored(CONTRAST_KEY, CONTRASTS, 'normal'),
  );
  const [systemDark, setSystemDark] = useState(prefersDark);

  // Follow the OS while the choice is 'system'. The listener stays attached
  // regardless, so switching back to 'system' is immediately correct.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
  }, [font]);

  useEffect(() => {
    document.documentElement.dataset.contrast = contrast;
  }, [contrast]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    store(THEME_KEY, next);
  }, []);

  const setFont = useCallback((next) => {
    setFontState(next);
    store(FONT_KEY, next);
  }, []);

  const setContrast = useCallback((next) => {
    setContrastState(next);
    store(CONTRAST_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, font, setFont, contrast, setContrast }),
    [theme, resolvedTheme, setTheme, font, setFont, contrast, setContrast],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside an AppearanceProvider');
  return ctx;
}

/**
 * Chart colours read from the live stylesheet.
 *
 * Recharts takes colours as props rather than classes, so the palette has to be
 * handed to it as concrete values. Reading the computed custom properties keeps
 * the charts on the same palette as everything else instead of a second set of
 * hex codes that quietly drifts.
 */
export function useChartColors() {
  const { resolvedTheme, font, contrast } = useAppearance();

  return useMemo(() => {
    const read = (name, fallback) => {
      if (typeof window === 'undefined') return fallback;
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    };
    return {
      stroke: read('--c-chart-stroke', '#8a6412'),
      fill: read('--c-chart-fill', '#c9971f'),
      grid: read('--c-grid', '#e8e2d6'),
      axis: read('--c-axis', '#7d7568'),
      surface: read('--c-surface', '#ffffff'),
      line: read('--c-line', '#ece4d3'),
      ink: read('--c-ink', '#1a1714'),
      series: [1, 2, 3, 4, 5, 6].map((n) => read(`--c-series-${n}`, '#8a6412')),
      // Recharts renders SVG text outside the cascade, so it needs the family too.
      fontFamily: read('--font-sans', 'system-ui, sans-serif'),
      // In high contrast the line has to carry the chart on its own: a soft
      // gradient under it is exactly the low-contrast detail being turned off,
      // so the fill goes and the stroke thickens to compensate.
      highContrast: contrast === 'high',
      strokeWidth: contrast === 'high' ? 3 : 1.8,
      areaFillOpacity: contrast === 'high' ? 0 : 1,
      tickFontSize: contrast === 'high' ? 12 : 11,
    };
  }, [resolvedTheme, font, contrast]);
}
