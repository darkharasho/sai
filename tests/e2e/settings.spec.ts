import { test, expect } from './electron.setup';

/**
 * E2E tests for the Settings modal.
 *
 * The SettingsModal is opened via:
 *   GitHub user dropdown (.gh-user-btn) > Settings item (.gh-dropdown-item)
 *
 * It renders with class .settings-modal inside .settings-overlay.
 * The mock provides a fake GitHub user so the user dropdown is available.
 */
test.describe('Settings Modal', () => {
  async function openSettings(window: any): Promise<void> {
    const ghUserBtn = window.locator('.gh-user-btn');
    await ghUserBtn.waitFor({ state: 'visible', timeout: 15000 });
    await ghUserBtn.click();

    const settingsItem = window.locator('.gh-dropdown-item').filter({ hasText: 'Settings' });
    await settingsItem.waitFor({ state: 'visible', timeout: 5000 });
    await settingsItem.click();

    await window.locator('.settings-modal').waitFor({ state: 'visible', timeout: 5000 });
  }

  test('settings modal is not open by default', async ({ window }) => {
    const overlay = window.locator('.settings-overlay');
    const isVisible = await overlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('settings modal can be opened via GitHub user menu', async ({ window }) => {
    await openSettings(window);
    const modal = window.locator('.settings-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await window.keyboard.press('Escape');
  });

  test('settings modal shows Settings title when open', async ({ window }) => {
    await openSettings(window);

    const title = window.locator('.settings-title');
    await expect(title).toBeVisible({ timeout: 5000 });
    const text = await title.textContent();
    expect(text).toContain('Settings');

    await window.keyboard.press('Escape');
  });

  test('settings modal closes on overlay click', async ({ window }) => {
    await openSettings(window);

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Click the overlay background to close
    const overlay = window.locator('.settings-overlay');
    await overlay.click({ position: { x: 10, y: 10 } });
    await modal.waitFor({ state: 'hidden', timeout: 5000 });

    const isVisible = await modal.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('settings modal contains AI provider options', async ({ window }) => {
    await openSettings(window);

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Navigate to the Provider page via sidebar
    const sidebar = modal.locator('.settings-sidebar');
    const providerNav = sidebar.locator('.settings-nav-item', { hasText: 'Provider' });
    await providerNav.click();

    // Provider page should show the provider select button (use first() since there are
    // multiple .provider-select-btn elements on the page: chat + commit message providers)
    const providerSelectBtn = modal.locator('.provider-select-btn').first();
    await expect(providerSelectBtn).toBeVisible({ timeout: 5000 });

    await window.keyboard.press('Escape');
  });

  test('settings modal contains font size controls', async ({ window }) => {
    await openSettings(window);

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Font size is on the Editor page — navigate there first
    const sidebar = modal.locator('.settings-sidebar');
    const editorNav = sidebar.locator('.settings-nav-item', { hasText: 'Editor' });
    await editorNav.click();

    const fontSizeControls = modal.locator('.settings-row-name', { hasText: 'Font size' });
    await expect(fontSizeControls).toBeVisible({ timeout: 5000 });

    await window.keyboard.press('Escape');
  });

  test('settings modal sidebar navigation works', async ({ window }) => {
    await openSettings(window);

    const modal = window.locator('.settings-modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Sidebar should be visible
    const sidebar = modal.locator('.settings-sidebar');
    await expect(sidebar).toBeVisible();

    // Click Provider nav
    const providerNav = sidebar.locator('.settings-nav-item', { hasText: 'Provider' });
    await providerNav.click();

    // Provider page should show chat provider section label
    const chatProvider = modal.locator('.settings-section-label', { hasText: 'AI Provider' });
    await expect(chatProvider).toBeVisible({ timeout: 3000 });

    // Click to Editor page to check Font size
    const editorNav = sidebar.locator('.settings-nav-item', { hasText: 'Editor' });
    await editorNav.click();

    // Font size should be visible on the Editor page
    const fontSize = modal.locator('.settings-row-name', { hasText: 'Font size' });
    await expect(fontSize).toBeVisible({ timeout: 3000 });

    await window.keyboard.press('Escape');
  });

  test('switching AI provider to Codex updates the provider button label', async ({ window }) => {
    await openSettings(window);
    const modal = window.locator('.settings-modal');
    const sidebar = modal.locator('.settings-sidebar');
    const providerNav = sidebar.locator('.settings-nav-item', { hasText: 'Provider' });
    await providerNav.click();

    // Open the chat provider dropdown (first .provider-select-btn on the page)
    const providerBtn = modal.locator('.provider-select-btn').first();
    await providerBtn.waitFor({ state: 'visible', timeout: 5000 });
    await providerBtn.click();

    // The dropdown renders .provider-dropdown-item buttons; pick the Codex CLI entry
    const codexOption = modal.locator('.provider-dropdown-item', { hasText: /codex/i }).first();
    await codexOption.waitFor({ state: 'visible', timeout: 5000 });
    await codexOption.click();
    // Wait for dropdown to close (codex option disappears) and label to update
    await codexOption.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    // The button label should now contain "Codex"
    await expect(providerBtn).toContainText(/codex/i, { timeout: 3000 });
    const labelText = await providerBtn.textContent();
    expect((labelText ?? '').toLowerCase()).toContain('codex');

    await window.keyboard.press('Escape');
  });

  test('toggle minimap in settings calls settingsSet with minimap key', async ({ window }) => {
    // Capture settingsSet calls from the renderer
    await window.evaluate(() => {
      (window as any).__settingsSetCalls = [];
      const orig = (window as any).sai.settingsSet;
      (window as any).sai.settingsSet = (key: string, value: any) => {
        (window as any).__settingsSetCalls.push({ key, value });
        return orig(key, value);
      };
    });

    await openSettings(window);
    const modal = window.locator('.settings-modal');

    // Minimap is on the Editor page — navigate there
    const sidebar = modal.locator('.settings-sidebar');
    const editorNav = sidebar.locator('.settings-nav-item', { hasText: 'Editor' });
    await editorNav.click();

    // The minimap row on the Editor page has a .settings-row-name "Minimap" and a
    // button[role="switch"] sibling. Playwright's :has-text() pseudo-class matches the
    // .settings-row whose subtree contains "Minimap", then we grab the switch inside it.
    const minimapToggle = window.locator(
      '.settings-modal .settings-row:has-text("Minimap") button[role="switch"]',
    );
    await minimapToggle.waitFor({ state: 'visible', timeout: 5000 });
    await minimapToggle.click();
    // Wait for settingsSet to be called (poll until the calls array is non-empty or minimap call appears)
    await window.waitForFunction(
      () => ((window as any).__settingsSetCalls ?? []).some((c: any) => /minimap/i.test(c.key)),
      { timeout: 3000 },
    );

    const calls = await window.evaluate(() => (window as any).__settingsSetCalls);
    const minimapCall = (calls as any[]).find((c) => /minimap/i.test(c.key));
    expect(minimapCall).toBeTruthy();

    await window.keyboard.press('Escape');
  });

  test('app titlebar is visible and has correct structure', async ({ window }) => {
    const titlebar = window.locator('.titlebar');
    await expect(titlebar).toBeVisible({ timeout: 15000 });

    const projectSelector = window.locator('.project-selector');
    await expect(projectSelector).toBeVisible({ timeout: 5000 });
  });
});
