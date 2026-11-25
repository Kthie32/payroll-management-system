import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the dev server and the `payroll` database.
 * They expect a freshly seeded database: run `pnpm db:reset` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
