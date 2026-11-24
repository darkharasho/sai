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
      const content = '# Steps\n\n- [ ] Launch game\n- [ ] Get mods from [Thunderstore](https://thunderstore.io)\n\nSee [the docs](https://example.com/docs).\n';
      c.fs[f] = content;
      c.subs.forEach((cb: any) => cb({ projectPath: w, path: f, content }));
    }, [ws, file]);

    // D1: focus is still in the chat composer after sending; that must not defer auto-open,
    // and auto-open must not take focus away from it.
    const checkbox = window.getByRole('checkbox', { name: 'Launch game' });
    await expect(checkbox).toBeVisible({ timeout: 10000 });
    expect(await window.evaluate(() => document.activeElement?.classList.contains('chat-textarea'))).toBe(true);
    await window.keyboard.type('still typing');
    await expect(window.locator('textarea.chat-textarea')).toHaveValue('still typing');
    await window.locator('textarea.chat-textarea').fill('');

    // D3: the auto-open put the editor beside the chat; the chat panel stayed expanded.
    await expect(window.locator('.accordion-panel.accordion-expanded textarea.chat-textarea')).toBeVisible();

    // Canvas links (labels and markdown blocks) use the app's accent color, like chat links,
    // not the browser's default dark blue.
    const accentAndLinks = await window.evaluate(() => {
      const view = document.querySelector('.canvas-view')!;
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      view.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const link = (name: string) => [...view.querySelectorAll('a')].find((a) => a.textContent === name)!;
      return { accent, label: getComputedStyle(link('Thunderstore')).color, block: getComputedStyle(link('the docs')).color };
    });
    expect(accentAndLinks.label).toBe(accentAndLinks.accent);
    expect(accentAndLinks.block).toBe(accentAndLinks.accent);

    // D2: a label renders inline Markdown; clicking its link opens it and does not tick the box.
    const linkBox = window.getByRole('checkbox', { name: 'Get mods from Thunderstore' });
    await window.evaluate(() => { (window as any).__opened = []; (window as any).sai.openExternal = (u: string) => (window as any).__opened.push(u); });
    await window.getByRole('link', { name: 'Thunderstore' }).click();
    expect(await window.evaluate(() => (window as any).__opened)).toEqual(['https://thunderstore.io']);
    await expect(linkBox).not.toBeChecked();

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
    // The chat that wrote the canvas already knows it: it gets the tick as a diff line, not the whole file.
    expect(delivered).toContain('- ☑ "Launch game"');
    expect(delivered).not.toContain('sharing this canvas');
  });

  test('redesign: section cards, a failed item, and stat tiles only with a stats block', async ({ window }) => {
    await window.setViewportSize({ width: 1900, height: 1500 });
    const chatInput = window.locator('textarea').first();
    await chatInput.waitFor({ state: 'visible', timeout: 20000 });
    await chatInput.click({ force: true });
    await chatInput.fill('make me a test plan');
    await window.keyboard.press('Enter');
    await expect.poll(() => window.evaluate(() => (window as any).__canvas.sent.length)).toBe(1);

    const ws = await window.evaluate(() => (window as any).sai.getCwd());
    const file = `${ws}/.sai/canvas/shop-test.md`.replace(/^\/var(?=\/home\/)/, '');
    const write = (content: string) => window.evaluate(([w, f, c]) => {
      const x = (window as any).__canvas;
      x.fs[f] = c;
      x.subs.forEach((cb: any) => cb({ projectPath: w, path: f, content: c }));
    }, [ws, file, content]);

    const body = [
      '## Shop flow', '',
      '```mermaid', 'flowchart LR',
      '  A[Launch game] --> B[Load save] --> C[Press F6] --> D{Shop open?}',
      '  D -- closed --> E[Check BepInEx log]', '  D -- opens --> F[Buy item] --> G{Enough $?}',
      '  G --> H[Deduct]', '  G --> I[Block buy]', '  class A,B,C pass', '  class F fail', '  class D current', '```', '',
      '## Launch & load', '',
      '- [x] Install dependencies from [Thunderstore](https://thunderstore.io) into the Dev profile',
      '- [x] Launch the game and load any save',
      '- [x] Log shows `[ShopMod] loaded successfully`', '  > Seen at 14:02:11, no warnings', '',
      '## Shop', '',
      '- [x] Press `F6` — shop window opens',
      '- [!] Buy the cheapest item', '  > Crashed here — game froze ~2s then closed. Log ends at `NullReferenceException`',
      '- [ ] Retry the purchase with `ShopMod.Debug=true` and copy the log here',
      '- [ ] Advance a level — prices go up ~15%', '',
      '## Price check', '',
      '| Item | Level 1 | Level 2 | Expected | Status |', '|---|---|---|---|---|',
      '| Health pack | $40 | $46 | $46 | Pass |', '| Stamina upgrade | $120 | — | $138 | Not run |', '| Crystal | $300 | — | $345 | Blocked by crash |', '',
    ].join('\n');
    const head = '# ShopMod — Manual test checklist\n\nBepInEx mod for R.E.P.O. · shop opens with `F6`, prices scale per level\n\n';
    await write(head + body);

    const cards = window.locator('section.canvas-card');
    await expect(cards).toHaveCount(4, { timeout: 10000 });
    await expect(cards.nth(0)).toHaveAttribute('aria-label', 'Shop flow');
    await expect(window.locator('.canvas-h1')).toHaveText('ShopMod — Manual test checklist');
    await expect(window.locator('.canvas-subtitle')).toContainText('BepInEx mod for R.E.P.O.');
    // No ```stats block: no tiles.
    await expect(window.locator('.canvas-stats')).toHaveCount(0);
    // The failed item renders as failed, with its note as a red callout.
    const failed = window.locator('li.canvas-task--failed');
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText('Buy the cheapest item');
    await expect(failed.locator('.canvas-note--bad')).toContainText('NullReferenceException');
    await expect(cards.nth(2).locator('.canvas-card__count')).toHaveText('1 / 4');
    await expect(cards.nth(0).locator('.canvas-diagram svg')).toBeVisible({ timeout: 15000 });

    // The agent adds a stats block and a step: tiles appear, the new step carries the agent marker.
    const stats = '```stats\nProgress: auto\nPassed: auto\nFailed: auto\nBuild: v0.3.1-dev\n```\n\n';
    await write(head + stats + body.replace('- [ ] Advance a level', '- [ ] Check the shop restocks after a level\n- [ ] Advance a level'));
    await expect(window.locator('.canvas-stat')).toHaveCount(4, { timeout: 10000 });
    await expect(window.locator('.canvas-stat').nth(0)).toContainText('4 of 8 steps');
    await expect(window.locator('.canvas-stat').nth(2)).toContainText('1');
    await expect(window.locator('li.canvas-agent-edge')).toContainText('Check the shop restocks');
    // Screenshot for the visual check against the approved mockup (agent marker visible).
    const dir = '/var/tmp/sai-dogfood/shots';
    await window.waitForTimeout(800);
    // The pane is short in the harness layout: shoot the page in viewport-sized slices.
    const scroller = window.locator('.canvas-scroll');
    const { total, step } = await scroller.evaluate((el) => ({ total: el.scrollHeight, step: el.clientHeight }));
    for (let i = 0, y = 0; y < total && i < 8; i++, y += step) {
      await scroller.evaluate((el, top) => { el.scrollTop = top; }, y);
      await window.waitForTimeout(150);
      await scroller.screenshot({ path: `${dir}/redesign-canvas-${i + 1}.png` }).catch(() => {});
    }
    await scroller.evaluate((el) => { el.scrollTop = 0; });

    // The user ticks something: the header shows both sides' edit times.
    await window.getByRole('checkbox', { name: 'Check the shop restocks after a level' }).click();
    await expect(window.locator('.canvas-meta')).toContainText('you');
    await expect(window.locator('li.canvas-agent-edge')).toHaveCount(0);
    // Agent still busy: the pill waits for it.
    await expect(window.locator('.canvas-pill')).toHaveText('Will send when agent is free');
    await window.locator('.canvas-header').screenshot({ path: `${dir}/redesign-header-busy.png` }).catch(() => {});
    // Turn ends: the countdown pill names the user's pending changes.
    await window.evaluate(() => {
      const c = (window as any).__canvas;
      c.claude.forEach((cb: any) => cb({ projectPath: c.projectPath, scope: c.scope, type: 'result' }));
      c.claude.forEach((cb: any) => cb({ projectPath: c.projectPath, scope: c.scope, type: 'done' }));
    });
    await expect(window.locator('.canvas-pill')).toContainText(/Sending your 1 change in \ds/, { timeout: 5000 });
    await window.locator('.canvas-header').screenshot({ path: `${dir}/redesign-header.png` }).catch(() => {});
    await window.getByRole('button', { name: 'Hold' }).click();

    await window.locator('li.canvas-task--failed').hover();
    await window.waitForTimeout(300);
    await window.locator('section.canvas-card').nth(2).screenshot({ path: `${dir}/redesign-hover.png` }).catch(() => {});
  });
});
