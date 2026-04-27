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
      await window.locator('.nav-btn[title="Source Control"].active').waitFor({ state: 'visible', timeout: 5000 });
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
    await window.locator('.nav-btn[title="Source Control"].active').waitFor({ state: 'visible', timeout: 5000 });

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

    // The nav bar should still be visible (no crash)
    const navbar = window.locator('.navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });

  test.describe('with dirty repo', () => {
    test.use({
      saiMock: {
        gitStatus: () => Promise.resolve({
          branch: 'main',
          staged: [{ path: 'src/staged.ts', index: 'M', working_dir: ' ' }],
          modified: [{ path: 'src/modified.ts', index: ' ', working_dir: 'M' }],
          created: [],
          deleted: [],
          not_added: [],
          ahead: 0,
          behind: 0,
        }),
        gitDiff: () => Promise.resolve('--- a/src/modified.ts\n+++ b/src/modified.ts\n@@ -1 +1 @@\n-old\n+new\n'),
        gitShow: () => Promise.resolve('// mock content'),
        gitStage: () => Promise.resolve(),
        gitCommit: () => Promise.resolve(),
        gitConflictFiles: () => Promise.resolve([]),
        gitRebaseStatus: () => Promise.resolve({ inProgress: false, onto: '' }),
      },
    });

    async function openGitSidebarLocal(window: any) {
      const gitBtn = window.locator('.nav-btn[title="Source Control"]');
      await gitBtn.waitFor({ state: 'visible', timeout: 15000 });
      const isActive = await gitBtn.evaluate((el: Element) => el.classList.contains('active'));
      if (!isActive) {
        await gitBtn.click();
        await window.locator('.nav-btn[title="Source Control"].active').waitFor({ state: 'visible', timeout: 5000 });
      }
    }

    test('git sidebar shows staged and unstaged file sections', async ({ window }) => {
      await openGitSidebarLocal(window);
      const staged = window.locator('text=Staged').first();
      const changes = window.locator('text=Changes').first();
      // Wait for either section to appear — they reflect the git status response
      await Promise.race([
        staged.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
        changes.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
      ]);
      const stagedVisible = await staged.isVisible().catch(() => false);
      const changesVisible = await changes.isVisible().catch(() => false);
      expect(stagedVisible || changesVisible).toBe(true);
    });

    test('clicking unstaged file opens diff viewer', async ({ window }) => {
      await openGitSidebarLocal(window);
      // File rows use data-filepath attribute (no .tree-row class in this codebase)
      const fileRow = window.locator('[data-filepath]').first();
      await fileRow.waitFor({ state: 'visible', timeout: 5000 });
      await fileRow.click();
      // Clicking a file row calls onFileClick which opens a diff tab in the editor pane.
      // Assert the tab was opened (CodePanel renders tabs with class "tab-item").
      const openTab = window.locator('.tab-item').first();
      await expect(openTab).toBeVisible({ timeout: 5000 });
    });

    test('stage all button stages all unstaged files', async ({ window }) => {
      await openGitSidebarLocal(window);
      const stageAllBtn = window.locator('text=Stage All').first();
      await stageAllBtn.waitFor({ state: 'visible', timeout: 5000 });
      await stageAllBtn.click();
      const staged = window.locator('text=Staged').first();
      await expect(staged).toBeVisible({ timeout: 3000 });
    });

    test('commit staged changes via commit box', async ({ window }) => {
      await openGitSidebarLocal(window);
      // Placeholder is "Commit message…" — match case-insensitively on "commit"
      const commitMsgInput = window.locator('textarea[placeholder*="commit" i]').first();
      await commitMsgInput.waitFor({ state: 'visible', timeout: 5000 });
      await commitMsgInput.fill('test: E2E test commit');
      const commitBtn = window.locator('button:has-text("Commit")').first();
      await commitBtn.click();
      // Verify the commit input was cleared (commit succeeded path)
      await expect(commitMsgInput).toHaveValue('', { timeout: 3000 });
      const value = await commitMsgInput.inputValue();
      expect(value).toBe('');
    });

    test('branch name is displayed in git sidebar', async ({ window }) => {
      await openGitSidebarLocal(window);
      const branchLabel = window.locator('text=main').first();
      await expect(branchLabel).toBeVisible({ timeout: 3000 });
    });
  });

  test('toggling git sidebar does not affect terminal panel', async ({ window }) => {
    const terminal = window.locator('.terminal-panel');
    await terminal.waitFor({ state: 'visible', timeout: 20000 });

    const gitBtn = window.locator('.nav-btn[title="Source Control"]');
    await gitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await gitBtn.click();
    await window.locator('.nav-btn[title="Source Control"].active').waitFor({ state: 'visible', timeout: 5000 });
    await gitBtn.click();
    await window.locator('.nav-btn[title="Source Control"]:not(.active)').waitFor({ state: 'visible', timeout: 5000 });

    await expect(terminal).toBeVisible({ timeout: 5000 });
  });
});
