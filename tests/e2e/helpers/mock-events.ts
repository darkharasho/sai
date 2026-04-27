import { Page } from '@playwright/test';

/**
 * Inject a registry that captures callbacks passed to `*OnMessage`-style mocks.
 * Tests use `triggerSaiEvent(page, 'claude', { type: 'assistant', text: 'hi' })`
 * to fire the captured callback with a payload.
 *
 * The matching mock override (set via test.use({ saiMock })) must look like:
 *   claudeOnMessage: (cb) => { (window).__saiTriggers.claude = cb; return () => {}; }
 */
export async function triggerSaiEvent(page: Page, channel: string, payload: unknown): Promise<void> {
  await page.evaluate(
    ({ channel, payload }) => {
      const cb = (window as any).__saiTriggers?.[channel];
      if (typeof cb === 'function') cb(payload);
    },
    { channel, payload }
  );
}

/**
 * Wait until a captured callback is registered for a channel. Useful when
 * the renderer subscribes asynchronously after mount.
 */
export async function waitForSaiSubscription(page: Page, channel: string, timeoutMs = 5000): Promise<void> {
  await page.waitForFunction(
    (ch) => typeof (window as any).__saiTriggers?.[ch] === 'function',
    channel,
    { timeout: timeoutMs }
  );
}
