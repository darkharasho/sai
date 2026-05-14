import { test, expect } from './electron.setup';

/**
 * E2E tests for Meta Workspaces.
 *
 * Meta workspaces are managed via TitleBar:
 *   - .project-selector button opens the dropdown
 *   - .project-dropdown shows Projects and Meta tabs
 *   - Meta tab allows creating and managing meta workspaces
 */
test.describe('Meta Workspaces', () => {
  test('Projects and Meta tabs render in workspace picker', async ({ window }) => {
    // Dismiss the What's New modal if it appeared.
    const whatsNew = window.locator('[data-testid="whats-new-backdrop"]');
    if (await whatsNew.isVisible().catch(() => false)) {
      await window.keyboard.press('Escape');
      await whatsNew.waitFor({ state: 'hidden', timeout: 5000 });
    }

    const selector = window.locator('.project-selector');
    await selector.waitFor({ state: 'visible', timeout: 15000 });
    await selector.click();

    await window.waitForSelector('.project-dropdown', { timeout: 5000 });

    const projectsTab = window.locator('.picker-tabs button').filter({ hasText: 'Projects' });
    const metaTab = window.locator('.picker-tabs button').filter({ hasText: 'Meta' });

    await expect(projectsTab).toBeVisible({ timeout: 5000 });
    await expect(metaTab).toBeVisible({ timeout: 5000 });

    // Switch to Meta tab and confirm it activates (rendering empty-state is fine)
    await metaTab.click();
    await expect(metaTab).toHaveClass(/active/);
  });

  test.skip('create + activate a meta workspace', async () => {
    // Requires stubbing window.sai.selectFolder + window.sai.metaWorkspaceCreate
    // through the electron preload harness. The pattern is: see tests/e2e/electron.setup.ts
    // for how other tests inject mocks via app args or ipcMain handlers.
    // Implementing this requires deeper changes to electron.setup that are out of scope here.
  });
});
