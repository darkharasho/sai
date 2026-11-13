import { test, expect } from './electron.setup';
test.use({
  saiMock: {
    claudeOnMessage: (cb: any) => {
      const t = ((window as any).__saiTriggers = (window as any).__saiTriggers || {});
      (t.claudeSubs = t.claudeSubs || []).push(cb);
      return () => {};
    },
    claudeSend: (projectPath: string, p: any, _i: any, _pm: any, _e: any, _m: any, scope: string) => {
      const t = (window as any).__saiTriggers;
      (window as any).__sent = ((window as any).__sent || []).concat([p]);
      const emit = (m: any) => t?.claudeSubs?.forEach((cb: any) => cb({ projectPath, scope: scope || 'chat', ...m }));
      const tu = (id: string, name: string, input: any) => emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
      const tx = (text: string) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
      if ((window as any).__sent.length > 1) { tx('ack'); emit({ type: 'done' }); return; }
      emit({ type: 'streaming_start' });
      let d = 0; const at = (f: () => void) => setTimeout(f, (d += 150));
      at(() => tu('t1', 'mcp__sai__sai_task', { action: 'create', tasks: [{ id: 'a', title: 'Fix the login bug' }, { id: 'b', title: 'Write release notes' }] }));
      at(() => tu('t2', 'mcp__sai__sai_task', { action: 'update', id: 'a', status: 'running' }));
      at(() => tx('Looking at the login handler.'));
      at(() => tu('t3', 'Read', { file_path: '/proj/login.ts' }));
      at(() => tu('t4', 'mcp__sai__sai_task', { action: 'update', id: 'a', status: 'done', note: 'fixed' }));
      at(() => tu('t5', 'mcp__sai__sai_task', { action: 'update', id: 'b', status: 'running' }));
      at(() => tx('Drafting the notes now.'));
      at(() => tu('t6', 'Read', { file_path: '/proj/CHANGELOG.md' }));
      // stay streaming so tabs stay live
    },
  },
});
test('tabs, chips, and directed sends', async ({ window }) => {
  const input = window.locator('textarea').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click({ force: true });
  await input.fill('do two things');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(2500);

  const tabs = window.locator('.task-tabs').first();
  await expect(tabs).toContainText('Fix the login bug');
  await expect(tabs).toContainText('Write release notes');

  // Regression: chips lived in a flex column and collapsed to 6px with the
  // global ToolCallCard `.task-chip` rule overriding their color.
  const chip = window.locator('.task-feed-chip').first();
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  expect(box!.height).toBeGreaterThan(14);
  expect(await chip.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(74, 159, 212)');

  await window.locator('.task-tabs button', { hasText: 'Fix the login bug' }).first().click();
  await input.click({ force: true });
  await input.fill('use tabs please');
  await window.keyboard.press('Enter');
  await expect.poll(() => window.evaluate(() => (window as any).__sent)).toEqual([
    'do two things',
    'About task "Fix the login bug": use tabs please',
  ]);
});
