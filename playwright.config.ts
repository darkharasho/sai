import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 1,
  // Tests use a fresh per-page window.sai mock with no shared backend, so they
  // parallelize safely. Cap CI lower to stay within runner memory.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  webServer: {
    command: 'PLAYWRIGHT=1 npx vite',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  snapshotDir: 'tests/e2e/screenshots',
});
