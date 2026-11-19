import { defineConfig, devices } from '@playwright/test';

/**
 * Phone app e2e: the built phone web app (dist/mobile, `npm run build:mobile`)
 * served by `vite preview`, against a fake desktop that wraps the real bridge
 * and chat log (tests/e2e-mobile/fakeDesktop.ts).
 *
 * The device is the iPhone 15 profile. Its default engine is WebKit; set
 * SAI_E2E_BROWSER=webkit where Playwright's WebKit runs (it needs host
 * libraries installed with sudo), otherwise Chromium emulates the device.
 */
const browserName = (process.env.SAI_E2E_BROWSER ?? 'chromium') as 'chromium' | 'webkit';

export default defineConfig({
  testDir: 'tests/e2e-mobile',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/mobile',
  timeout: 60_000,
  retries: 0,
  // One fake desktop is shared by every test; the machine is memory-constrained.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ...devices['iPhone 15'],
    browserName,
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npx vite preview --config mobile/vite.config.ts --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx jiti tests/e2e-mobile/fakeDesktop.ts',
      url: 'http://127.0.0.1:17898/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
