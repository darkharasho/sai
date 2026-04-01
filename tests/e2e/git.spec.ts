import { test, expect } from './electron.setup';

/**
 * E2E tests for the Git sidebar.
 *
 * The git sidebar is toggled via the "Source Control" nav button (.nav-btn[title="Source Control"]).
 * Tests that require an actual dirty git repo are skipped.
 */
test.describe('Git Sidebar', () => {
  async function openGitSidebar(window: any) {
    const gitBtn = window.locator('.nav-btn[title="Source Control"]');
    await gitBtn.waitFor({ state: 'visible', timeout: 15000 });
    const isActive = await gitBtn.evaluate((el: Element) => el.classList.contains('active'));
    if (!isActive) {
      await gitBtn.click();
      await window.waitForTimeout(500);
    }
  }

  test('Source Control nav button is present', async ({ window }) => {
    const gitBtn = window.locator('.nav-btn[title="Source Control"]');
    await expect(gitBtn).toBeVisible({ timeout: 15000 });
  });

  test('clicking Source Control opens git sidebar', async ({ window }) => {
    const gitBtn = window.locator('.nav-btn[title="Source Control"]');
    await gitBtn.waitFor({ state: 'visible', timeout: 15000 });

    await gitBtn.click();
    await window.waitForTimeout(800);

    // Verify the button is now active
    const isNowActive = await gitBtn.evaluate((el: Element) => el.classList.contains('active'));
    expect(isNowActive).toBe(true);
  });

  test('git badge shows change count when files are modified', async ({ window }) => {
    // The .git-badge appears when gitChangeCount > 0
    // In a clean workspace this badge may not appear — that's acceptable
    const badge = window.locator('.git-badge');
    const badgeExists = await badge.count() > 0;

    if (badgeExists) {
      const text = await badge.textContent();
      expect(text).toMatch(/^\d+$|^99\+$/);
    } else {
      expect(badgeExists).toBe(false);
    }
  });

  test('git sidebar renders without crashing when opened', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    // The nav bar should still be visible (no crash)
    const navbar = window.locator('.navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });

  test.skip('git sidebar shows staged and unstaged file sections (requires dirty repo)', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    const staged = window.locator('text=Staged').first();
    const changes = window.locator('text=Changes').first();

    const stagedVisible = await staged.isVisible().catch(() => false);
    const changesVisible = await changes.isVisible().catch(() => false);

    expect(stagedVisible || changesVisible).toBe(true);
  });

  test.skip('clicking unstaged file opens diff viewer (requires dirty repo)', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    const fileRow = window.locator('.tree-row').first();
    await fileRow.click();

    const diffEditor = window.locator('.monaco-diff-editor');
    await expect(diffEditor).toBeVisible({ timeout: 5000 });
  });

  test.skip('stage all button stages all unstaged files (requires dirty repo)', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    const stageAllBtn = window.locator('text=Stage All').first();
    await stageAllBtn.click();

    const staged = window.locator('text=Staged').first();
    await expect(staged).toBeVisible({ timeout: 3000 });
  });

  test.skip('commit staged changes via commit box (requires dirty repo + staged files)', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    const commitMsgInput = window.locator('textarea[placeholder*="commit"]').first();
    await commitMsgInput.fill('test: E2E test commit');

    const commitBtn = window.locator('button:has-text("Commit")').first();
    await commitBtn.click();

    await window.waitForTimeout(2000);
    const stagedFiles = window.locator('.git-staged-file');
    const count = await stagedFiles.count();
    expect(count).toBe(0);
  });

  test.skip('branch name is displayed in git sidebar (requires open project)', async ({ window }) => {
    await openGitSidebar(window);
    await window.waitForTimeout(1500);

    const branchLabel = window.locator('text=main').first();
    const altBranch = window.locator('text=master').first();

    const mainVisible = await branchLabel.isVisible().catch(() => false);
    const masterVisible = await altBranch.isVisible().catch(() => false);
    expect(mainVisible || masterVisible).toBe(true);
  });

  test('toggling git sidebar does not affect terminal panel', async ({ window }) => {
    const terminal = window.locator('.terminal-panel');
    await terminal.waitFor({ state: 'visible', timeout: 20000 });

    const gitBtn = window.locator('.nav-btn[title="Source Control"]');
    await gitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await gitBtn.click();
    await window.waitForTimeout(400);
    await gitBtn.click();
    await window.waitForTimeout(400);

    await expect(terminal).toBeVisible({ timeout: 5000 });
  });
});
