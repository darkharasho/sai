import { test, expect } from './electron.setup';

/**
 * Live canvas flow: the agent writes .sai/canvas/steps.md mid-turn -> a canvas
 * tab auto-opens; the user ticks a checkbox -> the file is written; once the
 * turn ends and the canvas has been idle for 5 s the edit is delivered to the
 * chat as a "[Canvas update] ..." message.
 *
 * The harness runs the renderer in a browser, so the canvas watcher and the
 * filesystem are mocked: window.__canvas.fs is an in-memory file map,
 * fsWriteFile writes into it (paths normalized like canvasKey), and window.__canvas.emit(...) plays the part of
 * electron/services/canvasWatch.ts. claudeSend records every prompt and keeps
 * the turn open until the test emits `result` + `done`.
 */
test.describe('live canvas', () => {
  test.use({
    saiMock: {
      canvasWatch: () => Promise.resolve(),
      canvasUnwatch: () => Promise.resolve(),
      canvasList: () => Promise.resolve([]),
      onCanvasChanged: (cb: any) => {
        const c = ((window as any).__canvas = (window as any).__canvas || { fs: {}, sent: [], subs: [], claude: [] });
        c.subs.push(cb);
        return () => { c.subs = c.subs.filter((s: any) => s !== cb); };
      },
      fsWriteFile: (path: string, content: string) => {
        const c = ((window as any).__canvas = (window as any).__canvas || { fs: {}, sent: [], subs: [], claude: [] });
        c.fs[path.replace(/^\/var(?=\/home\/)/, '')] = content;
        return Promise.resolve();
      },
      fsReadFile: (path: string) => {
        const c = (window as any).__canvas;
        const key = path.replace(/^\/var(?=\/home\/)/, '');
        return Promise.resolve(c && key in c.fs ? c.fs[key] : '// test content');
      },
      claudeOnMessage: (cb: any) => {
        const c = ((window as any).__canvas = (window as any).__canvas || { fs: {}, sent: [], subs: [], claude: [] });
        c.claude.push(cb);
        return () => { c.claude = c.claude.filter((s: any) => s !== cb); };
      },
      claudeSend: (projectPath: string, prompt: string, _i: any, _pm: any, _e: any, _m: any, scope: string) => {
        const c = ((window as any).__canvas = (window as any).__canvas || { fs: {}, sent: [], subs: [], claude: [] });
        c.sent.push(prompt);
        c.scope = scope;
        c.projectPath = projectPath;
        // The turn stays open until the test ends it.
        c.claude.forEach((cb: any) => cb({ projectPath, scope: c.scope, type: 'streaming_start' }));
      },
    },
  });

  test('agent canvas opens as a tab, a tick is saved, and the edit reaches the chat', async ({ window }) => {
    const chatInput = window.locator('textarea').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20000 });
    await chatInput.click({ force: true });
    await chatInput.fill('make me a checklist');
    await window.keyboard.press('Enter');
    await expect.poll(() => window.evaluate(() => (window as any).__canvas.sent.length)).toBe(1);

    // The agent writes the canvas while its turn is streaming.
    const ws = await window.evaluate(() => (window as any).sai.getCwd());
    // The app keys canvases by canvasKey(), which strips a /var prefix off /var/home paths.
    const file = `${ws}/.sai/canvas/steps.md`.replace(/^\/var(?=\/home\/)/, '');
    await window.evaluate(([w, f]) => {
      const c = (window as any).__canvas;
      const content = '# Steps\n\n- [ ] Launch game\n';
      c.fs[f] = content;
      c.subs.forEach((cb: any) => cb({ projectPath: w, path: f, content }));
    }, [ws, file]);

    // Auto-open is deferred while a text entry has focus.
    await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const checkbox = window.getByRole('checkbox', { name: 'Launch game' });
    await expect(checkbox).toBeVisible({ timeout: 10000 });

    // Tick the box mid-turn: the canvas file is rewritten.
    await checkbox.click();
    await expect.poll(() => window.evaluate((f) => (window as any).__canvas.fs[f], file)).toContain('- [x] Launch game');

    // Hold the turn open past the 5 s idle window: nothing may be delivered while the agent is busy.
    const canvasSends = () => window.evaluate(() => (window as any).__canvas.sent.filter((p: string) => p.includes('[Canvas update]')).length);
    await window.waitForTimeout(6500);
    expect(await canvasSends()).toBe(0);
    expect(await window.evaluate(() => (window as any).__canvas.sent.length)).toBe(1);

    // End the turn; the edit is delivered once the canvas has been idle for 5 s.
    await window.evaluate(() => {
      const c = (window as any).__canvas;
      c.claude.forEach((cb: any) => cb({ projectPath: c.projectPath, scope: c.scope, type: 'result' }));
      c.claude.forEach((cb: any) => cb({ projectPath: c.projectPath, scope: c.scope, type: 'done' }));
    });
    await expect.poll(() => window.evaluate(() => (window as any).__canvas.sent.length), { timeout: 15000 }).toBe(2);
    const delivered = await window.evaluate(() => (window as any).__canvas.sent[1] as string);
    // No [File: ...] prefix: canvas delivery skips file context, the update names its own path.
    expect(delivered.startsWith('[Canvas update] .sai/canvas/steps.md')).toBe(true);
    expect(delivered).toContain('- [x] Launch game');
  });
});
