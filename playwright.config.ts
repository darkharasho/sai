import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 1,
  workers: 1, // Electron tests must run serially
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'PLAYWRIGHT=1 npx vite',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
