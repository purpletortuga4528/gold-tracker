/**
 * Measures the contrast of every rendered text element against its real
 * background, inside a real browser.
 *
 * This is the check that used to live in somebody's console, which is how it
 * came to be wrong. Its colour parser matched `rgb()` and `rgba()` only, and
 * Chrome reports Tailwind's `color-mix` opacity utilities as `oklab(...)`, so
 * every faded element was skipped in silence. It then reported the worst
 * element it could parse as the worst element on the page, and the README
 * quoted "0 failures" for two modes where 187 and 86 elements were below AA.
 *
 * Two consequences shape what is below. `oklab()` is parsed. And `unparsed` is
 * returned and asserted to be zero, so the next colour syntax nobody
 * anticipated fails the build rather than disappearing from the sample.
 *
 * `palette.test.js` covers the palette itself with no browser. This covers what
 * a component actually renders, which is where a background token colliding
 * with a text token shows up: the "unit fix" pill rendered black on black at
 * exactly 1.00 and no palette pairing would have revealed it.
 *
 * The whole function is serialised into the page by Playwright, so it can use
 * nothing from this module's scope.
 */
export function measureContrast() {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const encode = (u) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, v * 255));
  };
  /** oklab to sRGB, so `color-mix(in oklab, ...)` can be read at all. */
  const oklabToRgb = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    return [
      encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  };

  const parse = (value) => {
    if (!value) return null;
    const rgb = /^rgba?\(([^)]+)\)/.exec(value);
    if (rgb) {
      const parts = rgb[1].split(/[, /]+/).filter(Boolean).map(Number);
      return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
    }
    const oklab = /^oklab\(\s*([\d.eE+-]+%?)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)/.exec(value);
    if (oklab) {
      const num = (t) => (t == null ? 1 : String(t).endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
      return { rgb: oklabToRgb(num(oklab[1]), parseFloat(oklab[2]), parseFloat(oklab[3])), alpha: num(oklab[4]) };
    }
    if (value === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
    return null;
  };

  const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

  /**
   * The background actually behind an element: walk up through translucent
   * layers until an opaque one, then composite them back down. A tinted chip
   * on a card on the canvas is three layers, and only the composite is the
   * colour the eye sees.
   */
  const backgroundOf = (el) => {
    const stack = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.alpha > 0) {
        stack.push(c);
        if (c.alpha === 1) break;
      }
      node = node.parentElement;
    }
    let base = [255, 255, 255];
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (root && root.alpha === 1) base = root.rgb;
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i].rgb, base, stack[i].alpha);
    return base;
  };

  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)];
    const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05);
  };

  const elements = [];
  const unparsed = [];

  for (const el of document.querySelectorAll('*')) {
    // A direct text node, so a wrapper is not credited with its child's text.
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length)) continue;

    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    const fg = parse(style.color);
    if (!fg) {
      unparsed.push(style.color);
      continue;
    }

    const bg = backgroundOf(el);
    const effective = fg.alpha < 1 ? over(fg.rgb, bg, fg.alpha) : fg.rgb;

    elements.push({
      ratio: Number(contrast(effective, bg).toFixed(2)),
      tag: el.tagName,
      className: (el.className?.toString?.() ?? '').slice(0, 80),
      text: el.textContent.trim().slice(0, 40),
      color: style.color,
      fontSize: parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
    });
  }

  elements.sort((a, b) => a.ratio - b.ratio);

  return {
    theme: document.documentElement.dataset.theme,
    contrast: document.documentElement.dataset.contrast,
    font: document.documentElement.dataset.font,
    elements,
    unparsed,
  };
}
