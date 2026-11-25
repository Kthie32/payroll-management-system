import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against their own dev server (port 3100) connected to the payroll_test
 * database, which global-setup rebuilds and seeds. The dev database is never touched.
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The dev server compiles each route on first visit, which can take well over 5s.
  timeout: 180_000,
  expect: { timeout: 45_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
