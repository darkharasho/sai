import { test, expect } from './electron.setup';

/**
 * E2E smoke for swarm mode: spawn → discard → row disappears.
 *
 * Reality notes:
 *  - There's no real Electron / no real backend in this harness — we run the
 *    Vite renderer in plain Chromium with `window.sai` mocked. So we can't
 *    drive a task through real `queued → streaming → done` provider events.
 *  - Tasks are now ephemeral in-memory state (no swarmDb persistence). The
 *    sidebar reflects `swarmTasksByWs` directly; there's no longer a poll
 *    against IndexedDB to reconcile from. Driving status via swarmDb would
 *    have no effect on the UI.
 *  - We also assert the broader "ephemeral cards" guarantee: when a task
 *    transitions to a terminal state (here, discarded), it disappears from
 *    the sidebar immediately — its underlying ChatSession remains in
 *    chat history (separate `chatDb`), but the sidebar row goes away.
 *
 *  - "Swarm Overview" text lives in `SwarmSidebar`, not OrchestratorView.
 *  - "+ NEW" is rendered as a Plus icon + "NEW" text (".new-task" button).
 *  - Discarding currently happens via the SwarmTaskHeader's Discard button
 *    once a task is focused; for queued tasks that button is enabled.
 */
test.describe('Swarm', () => {
  test.use({
    saiMock: {
      // Provide a current branch so spawnSwarmTask doesn't have to fall back.
      gitBranches: () => Promise.resolve({ current: 'main', all: ['main'] }),
      // Stub swarm.* — discardTask() short-circuits worktreeRemove when
      // worktreePath is null, but other code paths (e.g. eager worktree
      // materialization in the scheduler) reference window.sai.swarm.
      swarm: () => ({
        canFastForward: () => Promise.resolve(true),
        ffMerge: () => Promise.resolve(),
        worktreeAdd: () => Promise.resolve('/tmp/wt'),
        worktreeRemove: () => Promise.resolve(),
        diffStats: () => Promise.resolve({ additions: 1, deletions: 0 }),
      }),
    },
  });

  test('spawn a task → discard → row disappears', async ({ window }) => {
    // Dismiss the What's New modal if it appeared (default mock's
    // lastSeenVersion drifts out of sync with package.json on each release).
    const whatsNew = window.locator('[data-testid="whats-new-backdrop"]');
    if (await whatsNew.isVisible().catch(() => false)) {
      await window.keyboard.press('Escape');
      await whatsNew.waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Open the Swarm sidebar.
    await window.click('[aria-label="Swarm"]');
    await expect(window.locator('.overview-title', { hasText: 'Swarm Overview' })).toBeVisible({ timeout: 10000 });

    // Click the "+ NEW" button to open the popover.
    await window.locator('button.new-task').click();

    // Fill the prompt — pick a phrase that scheduler classifies as read-only
    // ("explain ...") so we don't need a real worktreeAdd to succeed for the
    // sidebar row to settle into a stable state.
    const textarea = window.locator('textarea[placeholder*="What should this task do"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('explain how the swarm scheduler works');
    await window.locator('button.ntp-btn-primary', { hasText: 'Dispatch' }).click();

    // The task row should appear in the sidebar with the prompt as its title.
    const row = window.locator('.swarm-row', {
      has: window.locator('.row-title', { hasText: 'explain how the swarm scheduler works' }),
    });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Click the row to focus the task; the SwarmTaskHeader should appear.
    await row.click();
    const discardBtn = window.locator('button[aria-label="Discard"]');
    await expect(discardBtn).toBeVisible({ timeout: 5000 });
    await expect(discardBtn).toBeEnabled();

    // Discard it — terminal state, the card should disappear from the sidebar.
    await discardBtn.click();
    await expect(row).toHaveCount(0, { timeout: 10000 });
  });
});
