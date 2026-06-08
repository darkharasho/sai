import type { Locator, Page } from '@playwright/test';

export interface HarnessFixture {
  render(story: string, props?: Record<string, string>): Promise<Locator>;
}

export function createHarness(page: Page): HarnessFixture {
  return {
    render: async (story, props = {}) => {
      const params = new URLSearchParams({ story, ...props });
      await page.goto(`http://localhost:5173/test-harness?${params}`);
      await page.waitForSelector('[data-testid="harness-root"]', { timeout: 10000 });
      return page.locator('[data-testid="harness-root"]');
    },
  };
}
