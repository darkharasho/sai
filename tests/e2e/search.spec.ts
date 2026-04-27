import { test, expect } from './electron.setup';

test.describe('Search Sidebar', () => {
  test('opens via Ctrl+Shift+F and focuses the search input', async ({ window }) => {
    // Click the page first to ensure the browser frame has focus before pressing keyboard shortcut.
    await window.locator('body').click();
    await window.keyboard.press('Control+Shift+F');
    const input = window.locator('.search-panel .search-input').first();
    await expect(input).toBeVisible({ timeout: 5000 });
    // The panel auto-focuses the input in a useEffect; poll with a timeout to allow the effect to fire.
    await expect(input).toBeFocused({ timeout: 3000 });
  });

  test('renders results from a mocked search', async ({ window }) => {
    await window.keyboard.press('Control+Shift+F');
    await window.locator('.search-panel').waitFor({ state: 'visible' });

    // Override searchRun for this run via window.sai
    await window.evaluate(() => {
      (window as any).sai.searchRun = () => Promise.resolve({
        files: [
          { path: 'src/foo.ts', matches: [
            { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
          ]},
        ],
        truncated: false,
        durationMs: 5,
      });
    });

    await window.locator('.search-panel .search-input').first().fill('foo');
    // wait past the 250ms debounce
    await window.waitForTimeout(500);

    await expect(window.locator('text=src/foo.ts')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('text=function')).toBeVisible();
  });

  test.describe('with scripted results', () => {
    test.use({
      saiMock: {
        searchRun: () => Promise.resolve({
          files: [{ path: 'src/foo.ts', matches: [
            { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
          ]}],
          truncated: false,
          durationMs: 5,
        }),
        searchReplaceFile: () => Promise.resolve(),
      },
    });

    test('Replace All shows confirmation dialog', async ({ window }) => {
      await window.keyboard.press('Control+Shift+F');
      await window.locator('.search-panel').waitFor({ state: 'visible' });
      await window.locator('.search-panel .search-input').first().fill('foo');
      await window.locator('input[placeholder="Replace"]').fill('bar');
      await window.waitForTimeout(500);
      await window.locator('.search-replace-all').click();
      await expect(window.locator('.search-confirm-dialog')).toBeVisible({ timeout: 3000 });
    });
  });
});
