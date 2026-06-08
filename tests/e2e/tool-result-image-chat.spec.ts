import { test, expect } from './test';
import { triggerSaiEvent, waitForSaiSubscription } from './helpers/mock-events';

/**
 * Full-stack: drive the real chat pipeline with a Read tool call whose result
 * carries an image, and assert the inline preview renders in the ToolCallCard.
 *
 * Covers both image sources:
 *  - 'sai-file'  — the real Claude path (renderer re-reads via fsReadFileBase64)
 *  - 'base64'    — stream-supplied bytes (e.g. Gemini / MCP)
 */
test.describe('Read tool image in chat', () => {
  test.use({
    saiMock: {
      // Capture the renderer's claude callback so we can fire fake messages.
      claudeOnMessage: (cb: any) => {
        (window as any).__saiTriggers = (window as any).__saiTriggers || {};
        (window as any).__saiTriggers.claude = cb;
        return () => {};
      },
    },
  });

  async function fireImageRead(window: any, source: Record<string, unknown>) {
    await waitForSaiSubscription(window, 'claude');
    // 1) Assistant calls Read → ChatPanel creates a file_read ToolCall (id matches).
    await triggerSaiEvent(window, 'claude', {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool_img_1', name: 'Read', input: { file_path: '/proj/shot.png' } },
        ],
      },
    });
    // 2) Tool result carries the image → ChatPanel attaches resultImages.
    await triggerSaiEvent(window, 'claude', {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_img_1',
            content: [
              { type: 'text', text: '[image: shot.png]' },
              { type: 'image', source },
            ],
            is_error: false,
          },
        ],
      },
    });
  }

  test('sai-file source renders the inline preview (Claude path)', async ({ window }) => {
    await fireImageRead(window, { type: 'sai-file', path: '/proj/shot.png', media_type: 'image/png' });
    await expect(window.locator('[data-testid="tool-result-image-thumb"]')).toBeVisible({ timeout: 5000 });
  });

  test('base64 source renders the inline preview (stream path)', async ({ window }) => {
    await fireImageRead(window, {
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    await expect(window.locator('[data-testid="tool-result-image-thumb"]')).toBeVisible({ timeout: 5000 });
  });

  test('clicking the chat thumbnail opens the lightbox', async ({ window }) => {
    await fireImageRead(window, { type: 'sai-file', path: '/proj/shot.png', media_type: 'image/png' });
    const thumb = window.locator('[data-testid="tool-result-image-thumb"]');
    await thumb.waitFor({ state: 'visible', timeout: 5000 });
    await thumb.click();
    await expect(window.locator('[data-testid="tool-result-image-lightbox"]')).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(window.locator('[data-testid="tool-result-image-lightbox"]')).toHaveCount(0);
  });
});
