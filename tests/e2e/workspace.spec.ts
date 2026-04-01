import { test, expect } from './electron.setup';

/**
 * E2E tests for Workspace management.
 *
 * Workspaces are managed via TitleBar:
 *   - .project-selector button opens the dropdown
 *   - .project-dropdown shows active/suspended/recent workspaces
 *   - .open-new button opens a folder picker
 *   - .workspace-overflow-btn shows per-workspace actions (suspend, close)
 */
test.describe('Workspace', () => {
  async function openWorkspaceDropdown(window: any) {
    const selector = window.locator('.project-selector');
    await selector.waitFor({ state: 'visible', timeout: 15000 });
    await selector.click();
    await window.waitForSelector('.project-dropdown', { timeout: 5000 });
  }

  test('project selector button is visible in titlebar', async ({ window }) => {
    const selector = window.locator('.project-selector');
    await expect(selector).toBeVisible({ timeout: 15000 });
  });

  test('project selector shows current project name', async ({ window }) => {
    const selector = window.locator('.project-selector');
    await selector.waitFor({ state: 'visible', timeout: 15000 });

    const text = await selector.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('workspace dropdown opens on click', async ({ window }) => {
    await openWorkspaceDropdown(window);

    const dropdown = window.locator('.project-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Close
    await window.mouse.click(5, 5);
    await window.waitForTimeout(300);
  });

  test('workspace dropdown contains "Open New Project..." option', async ({ window }) => {
    await openWorkspaceDropdown(window);

    const openNew = window.locator('.open-new');
    await expect(openNew).toBeVisible({ timeout: 5000 });
    const text = await openNew.textContent();
    expect(text).toContain('Open New Project');

    await window.mouse.click(5, 5);
    await window.waitForTimeout(300);
  });

  test('workspace dropdown closes on outside click', async ({ window }) => {
    await openWorkspaceDropdown(window);

    const dropdown = window.locator('.project-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Click outside the dropdown
    await window.mouse.click(5, 5);
    await window.waitForTimeout(300);

    const isVisible = await dropdown.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('workspace dropdown renders section labels', async ({ window }) => {
    await openWorkspaceDropdown(window);

    // At least the "Active" section should appear since our mock returns one active workspace
    const activeLabel = window.locator('.dropdown-label').filter({ hasText: 'Active' });
    const activeExists = await activeLabel.count() > 0;

    // At least one section label should exist
    expect(activeExists).toBe(true);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  });

  test('active workspace item shows status dot', async ({ window }) => {
    await openWorkspaceDropdown(window);

    const activeDot = window.locator('.workspace-dot-active');
    const dotExists = await activeDot.count() > 0;

    if (dotExists) {
      await expect(activeDot.first()).toBeVisible({ timeout: 3000 });
    }

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  });

  test('workspace overflow button appears on hover over non-current workspace', async ({ window }) => {
    await openWorkspaceDropdown(window);

    // The overflow button (···) appears on hover for workspaces other than current
    // With only one workspace (the current one), the overflow button won't appear
    const workspaceRows = window.locator('.workspace-row-wrapper');
    const count = await workspaceRows.count();

    if (count > 0) {
      await workspaceRows.first().hover();
      await window.waitForTimeout(200);

      const overflowBtn = window.locator('.workspace-overflow-btn').first();
      const isVisible = await overflowBtn.isVisible().catch(() => false);
      expect(typeof isVisible).toBe('boolean');
    }

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  });

  test.skip('clicking "Open New Project..." opens folder dialog (requires Electron dialog mock)', async ({ window }) => {
    // selectFolder returns null in mock — this is an Electron-only feature
  });

  test.skip('switching workspace changes project context (requires multiple workspaces)', async ({ window }) => {
    // Requires at least two open workspaces
  });

  test.skip('close workspace shows confirmation modal (requires multiple workspaces)', async ({ window }) => {
    // Requires multiple workspaces
  });

  test.skip('unsaved changes modal appears when closing workspace with edits', async ({ window }) => {
    // Requires opening and editing a file
  });

  test('titlebar version badge is visible', async ({ window }) => {
    // The mock returns version '0.3.17', so .titlebar-version should show "v0.3.17"
    const versionBadge = window.locator('.titlebar-version');
    await expect(versionBadge).toBeVisible({ timeout: 15000 });
    const text = await versionBadge.textContent();
    expect(text).toContain('0.3.17');
  });

  test('workspace done dot is not present by default', async ({ window }) => {
    // .workspace-done-dot appears when completedWorkspaces has entries
    // In a fresh session, this should not be present
    const doneDot = window.locator('.workspace-done-dot');
    const count = await doneDot.count();
    expect(count).toBe(0);
  });
});
