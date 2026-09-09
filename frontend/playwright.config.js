import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright is here for one thing: measuring contrast on a page a browser has
 * actually laid out and painted. jsdom cannot do it, because the numbers come
 * from resolved custom properties, `color-mix`, and the background of whatever
 * happens to be behind an element.
 *
 * It runs against the production path on purpose. `npm start` builds the app
 * and serves it from the API on one port, which is what a self-hosted copy
 * does, so the CSS under test is the CSS that ships rather than a dev build.
 */
export default defineConfig({
  testDir: './e2e',
  // No retries. A contrast measurement is deterministic; retrying one would
  // only hide a real failure behind a flake that is not a flake.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:5174',
    // Chromium only. This measures colour arithmetic that is defined by the
    // CSS spec, not engine-specific rendering, so a second engine would cost
    // minutes of CI to re-confirm the same numbers.
    ...devices['Desktop Chrome'],
  },

  webServer: {
    // From the repository root: it builds the frontend, then starts the API
    // serving it. AUTO_REFRESH is off so a test run never reaches the IMF.
    command: 'npm start',
    cwd: '..',
    url: 'http://127.0.0.1:5174/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { AUTO_REFRESH: 'false' },
  },
});
