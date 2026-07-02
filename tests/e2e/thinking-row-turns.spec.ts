import { test, expect } from './electron.setup';

/**
 * Regression: the tail thinking row must be VISIBLE on every turn, not just
 * the first. jsdom cannot catch this class of bug (framer animations run for
 * real here), so this drives two full scripted turns in a real browser.
 *
 * NOTE: playwright's toBeVisible() treats opacity:0 as visible (only
 * display:none/zero-box hide an element from it), so assertions read computed
 * style directly — the failure mode is a MOUNTED but invisible row.
 */

async function rowVisibility(window: any): Promise<any> {
  return window.evaluate(() => {
    const row = document.querySelector('.thinking-animation') as HTMLElement | null;
    if (!row) return { present: false, opacity: 0, height: 0 };
    // The animated wrapper is the motion.div around the row (stable class —
    // parentElement would now hit the .thinking-wrap layout div instead).
    const wrap = row.closest('.thinking-row-wrap') as HTMLElement;
    if (!wrap) return { present: false, opacity: 0, height: 0 };
    const cs = getComputedStyle(wrap);
    const rect = wrap.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowCs = getComputedStyle(row);
    return {
      present: true,
      opacity: parseFloat(cs.opacity),
      height: rect.height,
      wrapStyle: wrap.getAttribute('style'),
      rowH: rowRect.height,
      rowW: rowRect.width,
      rowTop: rowRect.top,
      rowDisplay: rowCs.display,
      rowFont: rowCs.fontSize,
      text: (row.textContent || '').slice(0, 40),
    };
  });
}

test.describe('thinking row across turns', () => {
  test.use({
    saiMock: {
      // Multiple components subscribe (App drives isStreaming, ChatPanel the
      // transcript) — broadcast to ALL of them, with the projectPath/scope the
      // real backend stamps on every event.
      claudeOnMessage: (cb: any) => {
        const t = ((window as any).__saiTriggers = (window as any).__saiTriggers || {});
        (t.claudeSubs = t.claudeSubs || []).push(cb);
        return () => {};
      },
      // Real signature: claudeSend(projectPath, prompt, images, permissionMode,
      // effort, model, scope). The scope is the SESSION ID (App keys streaming
      // state by `${projectPath}:${scope}` and ChatPanel drops mismatches), so
      // events must echo it back.
      claudeSend: (projectPath: string, _p: any, _i: any, _pm: any, _e: any, _m: any, scope: string) => {
        const t = (window as any).__saiTriggers;
        const emit = (m: any) =>
          t?.claudeSubs?.forEach((cb: any) => cb({ projectPath, scope: scope || 'chat', ...m }));
        // Leave a thinking window before the reply, then finish the turn.
        emit({ type: 'streaming_start' });
        setTimeout(() => {
          emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'scripted reply' }] } });
          emit({ type: 'done' });
        }, 1600);
      },
    },
  });

  test('row is visible while thinking on turn 1 AND turn 2', async ({ window }) => {
    const chatInput = window.locator('textarea').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20000 });

    // ---- Turn 1
    await chatInput.click({ force: true });
    await chatInput.fill('first question');
    await window.keyboard.press('Enter');

    await window.waitForSelector('.thinking-animation', { timeout: 3000 });
    // Give the enter animation time to finish, then measure real visibility.
    await window.waitForTimeout(500);
    const t1 = await rowVisibility(window);
    expect(t1.present).toBe(true);
    expect(t1.opacity).toBeGreaterThan(0.5);
    expect(t1.height).toBeGreaterThan(10);

    // Reply lands, turn ends, row leaves.
    await expect(window.locator('text=scripted reply').first()).toBeVisible({ timeout: 5000 });
    await window.waitForTimeout(800);

    // ---- Turn 2
    await chatInput.click({ force: true });
    await chatInput.fill('second question');
    await window.keyboard.press('Enter');

    await window.waitForSelector('.thinking-animation', { timeout: 3000 });
    await window.waitForTimeout(500);
    const t2 = await rowVisibility(window);
    expect(t2.present).toBe(true);
    expect(t2.opacity).toBeGreaterThan(0.5);
    expect(t2.height).toBeGreaterThan(10);
  });
});
