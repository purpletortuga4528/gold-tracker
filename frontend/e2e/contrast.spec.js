import { expect, test } from '@playwright/test';
import { measureContrast } from './measure-contrast.js';

/**
 * The rendered-page half of the contrast checks.
 *
 * `src/lib/palette.test.js` proves the palette is sound with no browser. It
 * cannot prove a component uses it, and it cannot see a background token
 * colliding with a text token on one element, which is how the "unit fix" pill
 * came to render black on black at exactly 1.00.
 *
 * Sampled on /countries because it is the densest page: every row, every
 * secondary label, the chips and the sort headers. Other pages render a subset
 * of the same components.
 */

const BARS = { normal: 4.5, high: 7 };

const MODES = [
  { theme: 'light', contrast: 'normal' },
  { theme: 'light', contrast: 'high' },
  { theme: 'dark', contrast: 'normal' },
  { theme: 'dark', contrast: 'high' },
];

/**
 * Appearance is set through localStorage and then loaded, never by flipping
 * `data-theme` on a live page. Setting the attribute and reading
 * `getComputedStyle` immediately returns styles the browser has not
 * recalculated, which reports confident nonsense.
 */
async function loadIn(page, { theme, contrast, font = 'default' }) {
  await page.goto('/');
  await page.evaluate(
    ([t, c, f]) => {
      localStorage.setItem('gold-tracker:theme', t);
      localStorage.setItem('gold-tracker:contrast', c);
      localStorage.setItem('gold-tracker:font', f);
    },
    [theme, contrast, font],
  );
  await page.goto('/countries');
  // The table renders from an API response, so wait for real rows rather than
  // measuring an empty page and calling it a pass.
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(85);
}

for (const mode of MODES) {
  const name = `${mode.theme} / ${mode.contrast}`;

  test(`every rendered element clears its bar in ${name}`, async ({ page }) => {
    await loadIn(page, mode);

    const result = await page.evaluate(measureContrast);
    const bar = BARS[mode.contrast];

    expect(result.theme, 'the theme did not apply before measuring').toBe(mode.theme);
    expect(result.contrast).toBe(mode.contrast);

    // A colour the parser did not understand is a failure, not a skip. This is
    // the assertion the old console version did not have, and its absence is
    // the entire reason the published table was wrong.
    expect(result.unparsed, `unreadable colours: ${[...new Set(result.unparsed)].join(', ')}`).toEqual([]);

    expect(result.elements.length, 'measured almost nothing, so the page probably did not render').toBeGreaterThan(300);

    const failing = result.elements.filter((e) => e.ratio < bar);
    const detail = failing
      .slice(0, 10)
      .map((e) => `  ${e.ratio}:1  <${e.tag}> "${e.text}"  ${e.color}  ${e.className}`)
      .join('\n');

    expect(failing, `${failing.length} of ${result.elements.length} below ${bar}:1\n${detail}`).toHaveLength(0);
  });
}

test('the hyperlegible face does not change any colour', async ({ page }) => {
  // Switching the typeface should be orthogonal to the palette. It is cheap to
  // assert, and a font that quietly brought its own colour would otherwise only
  // be found by someone using it.
  await loadIn(page, { theme: 'light', contrast: 'normal', font: 'hyperlegible' });

  const result = await page.evaluate(measureContrast);
  expect(result.font).toBe('hyperlegible');
  expect(result.unparsed).toEqual([]);
  expect(result.elements.filter((e) => e.ratio < BARS.normal)).toHaveLength(0);
});

test('the worst ratio in each mode is reported, so the README can be checked against it', async ({ page }) => {
  // Not an assertion about a specific number: those drift with the design and
  // pinning them would make every visual change a test edit. This prints the
  // table the README quotes, so re-measuring it is running one command.
  const rows = [];
  for (const mode of MODES) {
    await loadIn(page, mode);
    const { elements, unparsed } = await page.evaluate(measureContrast);
    expect(unparsed).toEqual([]);
    rows.push(
      `  ${`${mode.theme}/${mode.contrast}`.padEnd(14)} bar ${String(BARS[mode.contrast]).padEnd(4)} worst ${String(elements[0].ratio).padEnd(6)} of ${elements.length} elements`,
    );
  }
  console.log(`\nContrast, measured on /countries:\n${rows.join('\n')}\n`);
});
