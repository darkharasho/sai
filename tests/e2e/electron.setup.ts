import { test as base, _electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

const DEV_SERVER_URL = 'http://localhost:5173';

export const test = base.extend<{
  electronApp: ElectronApplication;
  window: Page;
}>({
  electronApp: async ({}, use) => {
    const app = await _electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VITE_DEV_SERVER_URL: DEV_SERVER_URL,
      },
    });
    await use(app);
    await app.close();
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
