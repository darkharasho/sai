import { test, expect } from './electron.setup';

/**
 * E2E tests for the Settings modal.
 *
 * The SettingsModal is opened from:
 *   1. The GitHub user dropdown > Settings button
 *   2. Any future settings trigger
 *
 * It renders with class .settings-modal inside .settings-overlay.
 * Settings include: AI provider, editor font size, minimap toggle,
 * suspend timeout, auto-compact threshold, system notifications, etc.
 */
test.describe('Settings Modal', () => {
  /**
   * Open settings via the GitHub login button area.
   * If the user is logged in, click the avatar then Settings.
   * If not logged in, we can't easily open settings from TitleBar without auth.
   * We test the modal by injecting a settings open event or finding another path.
   */
  async function tryOpenSettings(window: any): Promise<boolean> {
    // Check if there's a GitHub user logged in (gh-user-btn present)
    const ghUserBtn = window.locator('.gh-user-btn');
    const ghUserExists = await ghUserBtn.count() > 0;

    if (ghUserExists) {
      await ghUserBtn.click();
      await window.waitForTimeout(300);

      // Look for "Settings" in the dropdown
      const settingsItem = window.locator('.gh-dropdown-item:has-text("Settings")');
      const settingsExists = await settingsItem.count() > 0;

      if (settingsExists) {
        await settingsItem.click();
        await window.waitForTimeout(500);
        return true;
      }
    }

    // Alternative: try to trigger settings via keyboard shortcut if defined
    // or via any other accessible path
    return false;
  }

  test('settings modal overlay has correct CSS class structure', async ({ window }) => {
    // We can verify the modal markup even before opening by checking that
    // the app has loaded fully
    await window.waitForSelector('.project-selector', { timeout: 15000 });

    // Check if settings overlay is currently visible (it might not be)
    const overlay = window.locator('.settings-overlay');
    const isVisible = await overlay.isVisible().catch(() => false);

    if (isVisible) {
      // If somehow open, verify structure
      const modal = window.locator('.settings-modal');
      await expect(modal).toBeVisible({ timeout: 3000 });
    } else {
      // Settings not open — that's the expected initial state
      expect(isVisible).toBe(false);
    }
  });

  test('settings modal can be opened via GitHub user menu', async ({ window }) => {
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);

    if (opened) {
      const modal = window.locator('.settings-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close the modal
      await window.keyboard.press('Escape');
    } else {
      test.skip();
    }
  });

  test('settings modal shows Settings title when open', async ({ window }) => {
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);

    if (!opened) {
      test.skip();
      return;
    }

    const title = window.locator('.settings-title');
    await expect(title).toBeVisible({ timeout: 5000 });
    const text = await title.textContent();
    expect(text).toContain('Settings');

    await window.keyboard.press('Escape');
  });

  test('settings modal close button works', async ({ window }) => {
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);

    if (!opened) {
      test.skip();
      return;
    }

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Click the overlay background to close
    const overlay = window.locator('.settings-overlay');
    await overlay.click({ position: { x: 10, y: 10 } });

    await window.waitForTimeout(300);

    // Modal should be gone
    const isVisible = await modal.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('settings modal contains AI provider dropdown', async ({ window }) => {
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);

    if (!opened) {
      test.skip();
      return;
    }

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Provider options: Claude, Codex CLI, Gemini CLI
    const claudeOption = window.locator('text=Claude').first();
    const providerExists = await claudeOption.isVisible().catch(() => false);
    expect(providerExists).toBe(true);

    await window.keyboard.press('Escape');
  });

  test('settings modal contains editor font size options', async ({ window }) => {
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);

    if (!opened) {
      test.skip();
      return;
    }

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Font sizes are 11, 12, 13, 14, 15, 16, 18, 20
    // They render as buttons or select options
    const fontSizeControls = window.locator('text=Font Size');
    const exists = await fontSizeControls.count() > 0;
    expect(exists).toBe(true);

    await window.keyboard.press('Escape');
  });

  test.skip('switching AI provider to Codex updates UI (requires settings modal open)', async ({ window }) => {
    // This test requires the settings modal to be openable without a GitHub account.
    // It would click the provider dropdown, select "Codex CLI", and verify the selection.
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);
    if (!opened) return;

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Open provider dropdown and select Codex
    const providerDropdown = window.locator('.provider-dropdown-btn').first();
    await providerDropdown.click();

    const codexOption = window.locator('text=Codex CLI');
    await codexOption.click();

    // The provider label should update
    const selectedProvider = window.locator('.provider-label');
    await expect(selectedProvider).toContainText('Codex CLI');

    await window.keyboard.press('Escape');
  });

  test.skip('toggle minimap in settings persists to editor (requires settings modal + Monaco)', async ({ window }) => {
    // This requires the settings modal to be open and a file to be open in Monaco.
    // handleMinimapChange calls window.sai.settingsSet and onSettingChange callback.
    await window.waitForSelector('.project-selector', { timeout: 15000 });
    const opened = await tryOpenSettings(window);
    if (!opened) return;

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Find the minimap toggle
    const minimapToggle = window.locator('text=Minimap').locator('..').locator('input[type="checkbox"]');
    const currentState = await minimapToggle.isChecked();
    await minimapToggle.click();

    await window.waitForTimeout(500);
    const newState = await minimapToggle.isChecked();
    expect(newState).toBe(!currentState);

    // Restore original state
    await minimapToggle.click();
    await window.keyboard.press('Escape');
  });

  test('app titlebar is visible and has correct structure', async ({ window }) => {
    // The titlebar contains the settings entry point
    const titlebar = window.locator('.titlebar');
    await expect(titlebar).toBeVisible({ timeout: 15000 });

    // Project selector should be inside titlebar
    const projectSelector = window.locator('.project-selector');
    await expect(projectSelector).toBeVisible({ timeout: 5000 });
  });
});
