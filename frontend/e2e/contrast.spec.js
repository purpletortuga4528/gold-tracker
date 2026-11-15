import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  /*
   * The table renders from an API response, so wait for every row the API has
   * rather than measuring a half-drawn page and calling it a pass.
   *
   * The expected count comes from the API, not from a literal. It was
   * `toHaveCount(85)`, which is the number of reporters in the committed
   * snapshot: an economy joining or leaving IRFCL would have failed all six
   * tests in this file, with a message about row counts and nothing to do with
   * contrast. Derived, it also asserts something better, which is that the
   * table rendered everything it was given.
   */
  const { total } = await (await page.request.get('/api/reserves')).json();
  expect(total, 'the API returned no rows, so there is nothing to measure').toBeGreaterThan(50);
  await expect(page.locator('tbody tr')).toHaveCount(total);
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

test('the README table matches what is actually measured', async ({ page }) => {
  /*
   * This used to print the four rows and assert nothing about them, on the
   * reasoning that the ratios drift with the design and pinning them would
   * make every visual change a test edit.
   *
   * Half of that was right and the conclusion was wrong. The README publishes
   * these figures, and a published figure nobody checks is the thing this
   * repository keeps finding: adding two screen-reader spans moved the element
   * count from 643 to 730, the table still said 643, and only reading the
   * output by eye caught it. A visual change that moves the worst ratio SHOULD
   * require updating a table that states the worst ratio. That is not a chore,
   * it is the table being true.
   */
  const readme = readFileSync(resolve(fileURLToPath(import.meta.url), '../../../README.md'), 'utf8');

  const printed = [];
  const mismatches = [];

  for (const mode of MODES) {
    await loadIn(page, mode);
    const { elements, unparsed } = await page.evaluate(measureContrast);
    expect(unparsed).toEqual([]);

    const bar = BARS[mode.contrast];
    const worst = elements[0].ratio;
    const count = elements.length;
    printed.push(
      `  ${`${mode.theme}/${mode.contrast}`.padEnd(14)} bar ${String(bar).padEnd(4)} worst ${String(worst).padEnd(6)} of ${count} elements`,
    );

    // The row as the README writes it, e.g.
    //   | light / normal | AA 4.5 | 5.37 | 0 of 730 |
    const label = `${mode.theme} / ${mode.contrast}`;
    const row = new RegExp(
      `\\|\\s*${label}\\s*\\|[^|]*\\|\\s*([\\d.]+)\\s*\\|\\s*0 of (\\d+)\\s*\\|`,
    ).exec(readme);

    if (!row) {
      mismatches.push(`${label}: no row for it in the README table`);
      continue;
    }
    if (Number(row[1]) !== worst) mismatches.push(`${label}: README says worst ${row[1]}, measured ${worst}`);
    if (Number(row[2]) !== count) mismatches.push(`${label}: README says ${row[2]} elements, measured ${count}`);
  }

  console.log(`\nContrast, measured on /countries:\n${printed.join('\n')}\n`);

  expect(
    mismatches,
    `The contrast table in README.md no longer matches measurement:\n  ${mismatches.join('\n  ')}\n`,
  ).toEqual([]);
});
