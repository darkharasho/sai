import { test, expect } from './electron.setup';

/**
 * E2E smoke for swarm mode: spawn → focus → land.
 *
 * Reality notes (vs the original spec text):
 *  - There's no real Electron / no real backend in this harness — we run the
 *    Vite renderer in plain Chromium with `window.sai` mocked. So we can't
 *    drive a task through real `queued → streaming → done` provider events.
 *  - Spawned tasks have `worktreePath: null` (worktrees are created lazily by
 *    code we don't exercise here). `landTask()` short-circuits in that case
 *    and just flips status → 'landed' without needing any swarm.* mocks.
 *  - To reach the Land button (which is disabled until status === 'done'), we
 *    poke the in-memory task to 'done' via `swarmUpdateTask` in a page.evaluate.
 *    The renderer reconciles tasks from IndexedDB on the next poll, so we
 *    bounce the sidebar to force a re-render of the row + header.
 *
 *  - "Swarm Overview" text lives in `SwarmSidebar`, not OrchestratorView.
 *  - "+ NEW" is rendered as a Plus icon + "NEW" text (".new-task" button).
 *  - The sidebar row's done indicator is "✓" inside `.row-icon`.
 *  - Landing flips status → 'landed'; there's no toast. We assert by checking
 *    that the row's status sub-line updates and the Land button becomes disabled.
 */
test.describe('Swarm', () => {
  test.use({
    saiMock: {
      // Suppress the What's New modal — its overlay intercepts pointer events
      // on the NavBar. The default mock returns a stale lastSeenVersion which
      // no longer matches package.json's current version, so the modal pops up.
      // useWhatsNew triggers when (lastSeen !== currentVersion), so we need to
      // dismiss it via Escape after load instead — see beforeEach below.
      // (Mocking with a fixed version is brittle: it'd drift on every release.)
      // Provide a current branch so spawnSwarmTask doesn't have to fall back.
      gitBranches: () => Promise.resolve({ current: 'main', all: ['main'] }),
      // Stub swarm.* — landTask() short-circuits when worktreePath is null,
      // but other code paths (e.g. diff stats fetch on render) reference
      // window.sai.swarm. Provide a minimal object so optional-chains find it.
      swarm: () => ({
        canFastForward: () => Promise.resolve(true),
        ffMerge: () => Promise.resolve(),
        worktreeAdd: () => Promise.resolve('/tmp/wt'),
        worktreeRemove: () => Promise.resolve(),
        diffStats: () => Promise.resolve({ additions: 1, deletions: 0 }),
      }),
    },
  });

  test('spawn a task → mark done → land', async ({ window }) => {
    // Dismiss the What's New modal if it appeared (default mock's
    // lastSeenVersion drifts out of sync with package.json on each release).
    const whatsNew = window.locator('[data-testid="whats-new-backdrop"]');
    if (await whatsNew.isVisible().catch(() => false)) {
      await window.keyboard.press('Escape');
      await whatsNew.waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Open the Swarm sidebar.
    await window.click('[aria-label="Swarm"]');
    await expect(window.getByText('Swarm Overview')).toBeVisible({ timeout: 10000 });

    // Click the "+ NEW" button to open the popover.
    await window.locator('button.new-task').click();

    // Fill the prompt and dispatch.
    const textarea = window.locator('textarea[placeholder*="What should this task do"]');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('echo hello > greet.txt');
    await window.locator('button.ntp-btn-primary', { hasText: 'Dispatch' }).click();

    // The task row should appear in the sidebar with the prompt as its title.
    const row = window.locator('.swarm-row .row-title', { hasText: 'echo hello > greet.txt' });
    await expect(row).toBeVisible({ timeout: 10000 });

    // No real provider runs, so flip the task status to 'done' directly via
    // swarmDb (the source of truth the App reconciles from on poll). Then
    // toggle the sidebar to force a state refresh of swarmTasksByWs.
    await window.evaluate(async () => {
      const mod: any = await import('/src/swarmDb.ts');
      const ws = await (window as any).sai.getCwd();
      const tasks = await mod.swarmGetTasks(ws);
      const target = tasks.find((t: any) => t.title === 'echo hello > greet.txt');
      if (!target) throw new Error('test setup: task not found in IndexedDB');
      await mod.swarmUpdateTask(target.id, { status: 'done' });
      (window as any).__testTaskId = target.id;
    });

    // Bounce the sidebar so App re-reads tasks from the DB.
    await window.click('[aria-label="Swarm"]'); // close
    await window.click('[aria-label="Swarm"]'); // reopen

    // Sidebar row should now show the done indicator (✓).
    const doneRow = window.locator('.swarm-row', {
      has: window.locator('.row-title', { hasText: 'echo hello > greet.txt' }),
    });
    await expect(doneRow.locator('.row-icon')).toHaveText('✓', { timeout: 10000 });

    // Click the row to focus the task; the SwarmTaskHeader should appear.
    await doneRow.click();
    const landBtn = window.locator('button[aria-label="Land"]');
    await expect(landBtn).toBeVisible({ timeout: 5000 });
    await expect(landBtn).toBeEnabled();

    // Land it — with worktreePath === null, this just flips status to 'landed'.
    await landBtn.click();

    // After landing, the row's sub-line includes the new status, and the Land
    // button becomes disabled (landed !== done).
    await expect(doneRow.locator('.row-sub')).toContainText('landed', { timeout: 10000 });
    await expect(landBtn).toBeDisabled();
  });
});
