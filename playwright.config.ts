import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a running CampusWorks instance with demo login enabled,
 * e.g. `docker compose up --build` (http://localhost:3000).
 * Override the target with BASE_URL.
 */
export default defineConfig({
  testDir: 'playwright/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    actionTimeout: 10000,
    navigationTimeout: 20000,
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /(?:auth|queue-flow|extended-flow|staffing-browser|silent-refresh-browser|showcase-flow|showcase-visual|control-alignment|insights)\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
