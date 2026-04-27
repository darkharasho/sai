import { test, expect } from './electron.setup';

test.describe('Keybindings', () => {
  // Capture settingsSet calls for later assertion
  test.use({
    saiMock: {
      // settings store starts empty; settingsSet writes are captured by the page eval below.
      settingsGet: (key: string, def: any) => {
        const stored = (window as any).__keybindings_overrides ?? {};
        if (key === 'keybindings') return Promise.resolve(stored);
        if (key === 'lastSeenVersion') return Promise.resolve('0.8.36');
        return Promise.resolve(def ?? null);
      },
      settingsSet: (key: string, value: any) => {
        if (key === 'keybindings') (window as any).__keybindings_overrides = value;
        return Promise.resolve();
      },
    },
  });

  async function openSettingsKeybindings(window: any) {
    await window.locator('.gh-user-btn').click();
    await window.locator('.gh-dropdown-item').filter({ hasText: 'Settings' }).click();
    await window.locator('.settings-modal').waitFor({ state: 'visible' });
    const keybindingsNav = window.locator('.settings-nav-item').filter({ hasText: 'Keybindings' });
    await keybindingsNav.click();
    await window.locator('.keybindings-page').waitFor({ state: 'visible' });
  }

  test('Keybindings page lists the 4 registered shortcuts', async ({ window }) => {
    await openSettingsKeybindings(window);
    await expect(window.locator('text=Open command palette')).toBeVisible();
    await expect(window.locator('text=Toggle search sidebar')).toBeVisible();
    await expect(window.locator('text=Toggle chat history sidebar')).toBeVisible();
    await expect(window.locator('text=Toggle markdown preview')).toBeVisible();
  });

  test('rebinding Command Palette to Ctrl+J makes Ctrl+J open it', async ({ window }) => {
    await openSettingsKeybindings(window);
    // Click the Edit pencil on the palette row
    const paletteRow = window.locator('.keybinding-row').filter({ hasText: 'Open command palette' });
    await paletteRow.locator('.keybinding-edit').click();
    // Press the new combo
    await window.keyboard.press('Control+J');
    // Combo should now show Ctrl+J in the row
    await expect(paletteRow.locator('.keybinding-combo')).toContainText('Ctrl+J');
    // Close Settings via the close button
    await window.locator('.settings-close').click();
    await window.locator('.settings-modal').waitFor({ state: 'hidden' });
    // Press Ctrl+J — command palette should open (root class is cp-palette)
    await window.keyboard.press('Control+J');
    await expect(window.locator('.cp-palette')).toBeVisible({ timeout: 3000 });
  });

  test('Reset row restores default and disables when at default', async ({ window }) => {
    await openSettingsKeybindings(window);
    const paletteRow = window.locator('.keybinding-row').filter({ hasText: 'Open command palette' });
    const resetBtn = paletteRow.locator('.keybinding-reset');
    await expect(resetBtn).toBeDisabled();   // default at first
    // Change it
    await paletteRow.locator('.keybinding-edit').click();
    await window.keyboard.press('Control+J');
    await expect(resetBtn).toBeEnabled();
    // Reset it
    await resetBtn.click();
    await expect(paletteRow.locator('.keybinding-combo')).toContainText('Ctrl+K');
    await expect(resetBtn).toBeDisabled();
  });

  test('conflict modal appears when assigning a taken combo', async ({ window }) => {
    await openSettingsKeybindings(window);
    const chatRow = window.locator('.keybinding-row').filter({ hasText: 'Toggle chat history sidebar' });
    await chatRow.locator('.keybinding-edit').click();
    await window.keyboard.press('Control+K');   // taken by palette
    await expect(window.locator('.keybindings-modal')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('.keybindings-modal')).toContainText('Open command palette');
  });
});
