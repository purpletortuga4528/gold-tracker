import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility beyond colour.
 *
 * The contrast work was thorough and lopsided: this app ships a hyperlegible
 * typeface and a high-contrast mode, aimed squarely at readers with access
 * needs, and nothing had ever checked whether it could be operated without a
 * mouse or made sense to a screen reader.
 *
 * Two halves here. axe covers the structural rules that are worth automating,
 * and it found real defects on the first run: three of the four pages had no
 * level-one heading, and two table columns had empty header cells. What axe
 * cannot tell you is whether the thing is actually usable, so the rest of this
 * file drives the keyboard.
 *
 * What none of it proves is that the app is accessible. Automated rules catch
 * perhaps a third of what matters and nothing here substitutes for someone
 * using a screen reader in earnest.
 */

const PAGES = [
  { path: '/', name: 'dashboard' },
  { path: '/countries', name: 'countries' },
  { path: '/countries/USA', name: 'country detail' },
  { path: '/compare?codes=USA,DEU,CHN', name: 'compare' },
];

const MODES = [
  { theme: 'light', contrast: 'normal' },
  { theme: 'dark', contrast: 'normal' },
  { theme: 'light', contrast: 'high' },
  { theme: 'dark', contrast: 'high' },
];

async function setAppearance(page, { theme, contrast, font = 'default' }) {
  await page.goto('/');
  await page.evaluate(
    ([t, c, f]) => {
      localStorage.setItem('gold-tracker:theme', t);
      localStorage.setItem('gold-tracker:contrast', c);
      localStorage.setItem('gold-tracker:font', f);
    },
    [theme, contrast, font],
  );
}

/** Readable failure output: axe's own JSON is unreadable in a CI log. */
const describeViolations = (violations) =>
  violations
    .map((v) => {
      const where = v.nodes.slice(0, 4).map((n) => `      ${n.target.join(' ')}`).join('\n');
      return `  ${v.id} [${v.impact}] ${v.help}\n${where}`;
    })
    .join('\n');

for (const mode of MODES) {
  const modeName = `${mode.theme}/${mode.contrast}`;

  for (const { path, name } of PAGES) {
    test(`axe finds nothing on the ${name} in ${modeName}`, async ({ page }) => {
      await setAppearance(page, mode);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page })
        // Best practice as well as the WCAG tags. It is the best-practice set
        // that flags a missing level-one heading, which was a real defect here,
        // and the cost of the extra rules is nothing on a page this size.
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze();

      expect(violations, `\n${describeViolations(violations)}`).toEqual([]);
    });
  }
}

test('the first Tab offers a way past the navigation', async ({ page }) => {
  // Without this a keyboard user walks the whole nav and the appearance
  // controls again on every route change, which on a four page app is most of
  // the tab presses they will ever make here.
  await page.goto('/countries');
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toHaveText('Skip to content');

  // Hidden until focused, and genuinely visible once it is.
  const box = await first.boundingBox();
  expect(box, 'the skip link should be laid out once focused').not.toBeNull();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('every control reached by Tab shows where the focus is', async ({ page }) => {
  // The palette gives focus rings an explicit colour because the browser
  // default is nearly invisible on the dark surface. This is the check that
  // they are actually applied, in the mode where they are hardest to see.
  await setAppearance(page, { theme: 'dark', contrast: 'normal' });
  await page.goto('/countries');
  await page.waitForLoadState('networkidle');

  const seen = [];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
        outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });
    if (!info) break;
    seen.push(info);
  }

  expect(seen.length, 'tabbing should reach a good number of controls').toBeGreaterThan(10);

  const invisible = seen.filter(
    (s) => (s.outlineWidth === 0 || s.outlineStyle === 'none') && s.boxShadow === 'none',
  );
  expect(
    invisible,
    `no visible focus indicator on: ${invisible.map((s) => `${s.tag} "${s.label}"`).join(', ')}`,
  ).toEqual([]);
});

test('the table can be sorted from the keyboard, and says how it is sorted', async ({ page }) => {
  // aria-sort is the only thing telling a screen reader user what the arrow
  // glyph tells everyone else, and the glyph is aria-hidden precisely so it
  // does not get read out as a character.
  await page.goto('/countries');
  await page.waitForLoadState('networkidle');

  const header = page.locator('th', { hasText: 'Country' }).first();
  const countryCell = page.locator('tbody tr td:nth-child(3)').first();

  // The table opens sorted by tonnes, so the country column starts unsorted.
  await expect(header).toHaveAttribute('aria-sort', 'none');
  const byTonnes = await countryCell.textContent();

  // A fresh column sorts descending first, which is the useful direction for
  // the numeric columns this shares its handler with.
  await header.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  const descending = await countryCell.textContent();
  expect(descending, 'sorting should have reordered the rows').not.toBe(byTonnes);

  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const ascending = await countryCell.textContent();

  // aria-sort is describing something real rather than a state variable that
  // nobody applied to the rows.
  expect(ascending).not.toBe(descending);
  expect(ascending.localeCompare(descending)).toBeLessThan(0);
});

test('the appearance controls announce which one is active', async ({ page }) => {
  // Three independent toggles that look like a segmented control. Without
  // aria-pressed they are three identical buttons to a screen reader, and the
  // one that is on is indicated by colour alone.
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  for (const label of ['Light', 'Dark', 'High contrast', 'System typeface']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await expect(button, `${label} should be a button with an accessible name`).toHaveCount(1);
    await expect(button).toHaveAttribute('aria-pressed', /true|false/);
  }

  const dark = page.getByRole('button', { name: 'Dark', exact: true });
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the freshness banner is a live region when it has something to say', async ({ page }) => {
  // The banner renders nothing at all while the data is fresh, which is right,
  // and means the only way to check it is to make the data stale. The freshness
  // endpoint is stubbed rather than the dataset backdated: this is a question
  // about what the component renders, not about how staleness is computed,
  // which freshness.test.js already covers.
  await page.route('**/api/reserves/freshness', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        overall: 'stale',
        snapshot: { generatedAt: '2026-01-01T00:00:00.000Z', ageDays: 251, status: 'stale' },
        data: { latestAsOfDate: '2025-11-30', ageDays: 283, status: 'stale' },
        action: 'Rebuild the snapshot with: npm run build:data',
      }),
    }),
  );

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Scoped by its own text, not by counting live regions on the page. The
  // first version asserted there was exactly one, which held only while
  // everything else was working: when the price feed went down, the error
  // panels are live regions too and the count went up. A test that passes
  // only when nothing else is broken is not much of a test.
  const banner = page.locator('[role="status"], [role="alert"]').filter({ hasText: 'out of date' });
  await expect(banner).toHaveCount(1);

  // The message is text, not a colour. A red panel says nothing to anyone who
  // cannot see it, and nothing at all to anyone who cannot distinguish it.
  await expect(banner).toContainText('251 days ago');
});
