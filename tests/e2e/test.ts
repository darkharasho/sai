import { test as electronTest, expect, type SaiMockOverrides } from './electron.setup';
import { createAppState, type AppStateFixture } from './fixtures/app-state';
import { createHarness, type HarnessFixture } from './fixtures/harness';

export { expect };
export type { SaiMockOverrides };

export const test = electronTest.extend<{
  appState: AppStateFixture;
  harness: HarnessFixture;
}>({
  // appState depends on `window` (full app with sai mock already loaded)
  appState: async ({ window }, use) => {
    await use(createAppState(window));
  },
  // harness uses `page` directly — navigates to /test-harness, no sai mock needed
  harness: async ({ page }, use) => {
    await use(createHarness(page));
  },
});
