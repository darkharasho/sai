import { test, expect } from './electron.setup';
import { triggerSaiEvent, waitForSaiSubscription } from './helpers/mock-events';

/**
 * Background-work sidebar story: a turn ends in a background wait, per-task
 * snapshots arrive on claude:backgroundTasks, the pill opens the sidebar, a
 * Stop goes out per task, and a finished task moves to Finished.
 */
const SHOTS = process.env.SAI_SHOTS_DIR;

test.describe('Background work sidebar', () => {
  test.use({
    saiMock: {
      // App AND ChatPanel both subscribe — fan out to every listener.
      claudeOnMessage: (cb: any) => {
        const w = window as any;
        w.__saiTriggers = w.__saiTriggers || {};
        w.__claudeCbs = [...(w.__claudeCbs ?? []), cb];
        w.__saiTriggers.claude = (msg: any) => { for (const f of w.__claudeCbs) f(msg); };
        return () => { w.__claudeCbs = w.__claudeCbs.filter((f: any) => f !== cb); };
      },
      claudeOnBackgroundTasks: (cb: any) => {
        (window as any).__saiTriggers = (window as any).__saiTriggers || {};
        (window as any).__saiTriggers.bgtasks = cb;
        return () => {};
      },
      claudeSend: (projectPath: string, _m: string, _i: any, _p: any, _e: any, _mo: any, scope?: string) => {
        (window as any).__lastSend = { projectPath, scope };
      },
      claudeStopTask: (_p: string, _s: string, taskId: string) => {
        (window as any).__stopped = [...((window as any).__stopped ?? []), taskId];
        return Promise.resolve(true);
      },
    },
  });

  test('pill opens the sidebar; cards stop and finish', async ({ window }) => {
    const chatInput = window.locator('textarea').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20000 });
    await chatInput.click({ force: true });
    await chatInput.fill('launch the reviewers');
    await window.keyboard.press('Enter');
    await window.waitForFunction(() => !!(window as any).__lastSend);
    const { projectPath, scope } = await window.evaluate(() => (window as any).__lastSend);
    await waitForSaiSubscription(window, 'bgtasks');

    const now = Date.now();
    const base = { endedAt: null, totalTokens: null, toolUses: null, lastToolName: null, summary: null, error: null, status: 'running' };
    const tasks: any[] = [
      { ...base, id: 'a', description: 'Review the auth middleware', kind: 'Explore', isShell: false, isAgent: true, startedAt: now - 95_000, lastEventAt: now - 3_000, totalTokens: 18_400, toolUses: 23, summary: 'Reading src/auth/session.ts' },
      { ...base, id: 'b', description: 'Audit the IPC handlers for leaks', kind: 'general-purpose', isShell: false, isAgent: true, startedAt: now - 260_000, lastEventAt: now - 140_000, totalTokens: 41_200, toolUses: 57, lastToolName: 'Grep' },
      { ...base, id: 'c', description: 'npm run dev', kind: 'shell', isShell: true, isAgent: false, startedAt: now - 300_000, lastEventAt: now - 300_000 },
      { ...base, id: 'd', description: 'Find flaky tests', kind: 'Explore', isShell: false, isAgent: true, startedAt: now - 400_000, lastEventAt: now - 200_000, status: 'completed', endedAt: now - 200_000, totalTokens: 9_800, toolUses: 12, summary: 'Found 3 flaky tests in tests/e2e' },
    ];
    await triggerSaiEvent(window, 'bgtasks', { projectPath, scope, tasks });
    await triggerSaiEvent(window, 'claude', { type: 'done', projectPath, scope, turnSeq: null, wait: { kind: 'background', resumeInSeconds: null, taskCount: 4 } });

    const toggle = window.getByRole('button', { name: /background work/i }).first();
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(window.getByText('3 tasks running')).toBeVisible();
    if (SHOTS) await window.screenshot({ path: `${SHOTS}/1-pill.png` });

    await toggle.click();
    const sidebar = window.locator('aside.sai-bgtasks');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('3 running · 1 done')).toBeVisible();
    await expect(sidebar.locator('[data-task-id="b"]')).toHaveAttribute('data-stuck', 'true');
    // Full height, right edge, next to the main stack.
    const box = (await sidebar.boundingBox())!;
    const vp = window.viewportSize()!;
    expect(Math.round(box.x + box.width)).toBeGreaterThanOrEqual(vp.width - 2);
    expect(box.width).toBeGreaterThan(370);
    if (SHOTS) await window.screenshot({ path: `${SHOTS}/2-open.png` });

    await sidebar.locator('[data-task-id="b"]').getByRole('button', { name: 'Stop' }).click();
    await expect(sidebar.locator('[data-task-id="b"]').getByRole('button', { name: /stopping/i })).toBeDisabled();
    expect(await window.evaluate(() => (window as any).__stopped)).toEqual(['b']);

    const t2 = Date.now();
    const after = tasks.map((t) =>
      t.id === 'b' ? { ...t, status: 'stopped', endedAt: t2 }
      : t.id === 'a' ? { ...t, status: 'completed', endedAt: t2, summary: 'No issues in the auth middleware' }
      : t);
    await triggerSaiEvent(window, 'bgtasks', { projectPath, scope, tasks: after });
    await expect(sidebar.locator('[data-task-id="a"]')).toHaveAttribute('data-state', 'done');
    if (SHOTS) await window.screenshot({ path: `${SHOTS}/3-done-flash.png` });
    await expect(sidebar.locator('[data-section="finished"] [data-task-id="a"]')).toBeVisible({ timeout: 2000 });
    await expect(sidebar.locator('[data-section="finished"] [data-task-id="b"]')).toBeVisible();
    await expect(window.getByText('1 task running')).toBeVisible();
    await window.waitForTimeout(400);
    if (SHOTS) await window.screenshot({ path: `${SHOTS}/4-finished.png` });

    // Close via ×; pill re-opens it.
    await sidebar.getByRole('button', { name: /close/i }).click();
    await expect(sidebar).toHaveCount(0);
  });
});
