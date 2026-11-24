import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import CanvasView from '../../../src/components/Canvas/CanvasView';
import { createCanvasStore } from '../../../src/canvas/canvasStore';

vi.mock('../../../src/render/renderMermaid', () => ({ renderMermaidToSvg: vi.fn(async () => '<svg></svg>') }));

const P = '/ws/.sai/canvas/plan.md';
const DOC = '# Plan\n\n- [ ] a\n- [ ] b\n\nbody\n';

async function setup(initial = DOC) {
  const writes: string[] = [];
  let failWith: string | null = null;
  const store = createCanvasStore({
    writeFile: async (_p, c) => {
      if (failWith) throw new Error(failWith);
      writes.push(c);
    },
    now: () => Date.now(),
  });
  await store.onDiskChange(P, initial, true);
  store.markDelivered(P, 'c');
  return { store, writes, failWrite: (m: string) => (failWith = m) };
}

const base = { agentStatus: 'idle' as const, sendIn: null, pending: false };
function view(store: any, over: Record<string, unknown> = {}) {
  const fns = { onSendNow: vi.fn(), onHoldToggle: vi.fn(), onOpenSource: vi.fn(), onOpenCanvas: vi.fn() };
  const utils = render(<CanvasView path={P} store={store} {...base} {...fns} {...over} />);
  return { ...fns, ...utils };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CanvasView', () => {
  it('renders checklist and toggles', async () => {
    const { store, writes } = await setup();
    view(store);
    fireEvent.click(screen.getByLabelText('a'));
    expect(writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('- [x] a');
  });

  it('quick double toggle writes once with both ticks', async () => {
    const { store, writes } = await setup();
    view(store);
    fireEvent.click(screen.getByLabelText('a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.click(screen.getByLabelText('b'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('- [x] a');
    expect(writes[0]).toContain('- [x] b');
  });

  it('agent change between edit and flush survives', async () => {
    const { store, writes } = await setup();
    view(store);
    fireEvent.click(screen.getByLabelText('a'));
    await act(async () => { await store.onDiskChange(P, DOC.replace('body', 'agent body'), true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(writes[writes.length - 1]).toContain('- [x] a');
    expect(writes[writes.length - 1]).toContain('agent body');
  });

  it('save during agent write merges', async () => {
    const { store, writes } = await setup('first\n\nsecond\n\nthird\n');
    view(store);
    fireEvent.click(screen.getByLabelText('Edit block 3'));
    fireEvent.change(screen.getByLabelText('Edit block 3', { selector: 'textarea' }), { target: { value: 'third edited\n' } });
    await act(async () => { await store.onDiskChange(P, 'first agent\n\nsecond\n\nthird\n', true); });
    fireEvent.click(screen.getByText('Save'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const w = writes[writes.length - 1];
    expect(w).toContain('first agent');
    expect(w).toContain('third edited');
  });

  it('shows conflict actions', async () => {
    const { store } = await setup('one\n\ntwo\n');
    const spy = vi.spyOn(store, 'resolveConflict');
    await act(async () => { await store.userWrite(P, 'one\n\ntwo mine\n'); });
    await act(async () => { await store.onDiskChange(P, 'one\n\ntwo theirs\n', true); });
    view(store);
    expect(store.get(P)!.conflicts.length).toBe(1);
    fireEvent.click(screen.getByText("Use agent's"));
    expect(spy).toHaveBeenCalledWith(P, 1, 'theirs');
  });

  async function conflictInFlight(store: any) {
    view(store);
    fireEvent.click(screen.getByLabelText('Edit block 2'));
    fireEvent.change(screen.getByLabelText('Edit block 2', { selector: 'textarea' }), { target: { value: 'two mine' } });
    await act(async () => { await store.onDiskChange(P, 'one\n\ntwo A\n', true); });
    fireEvent.click(screen.getByText('Save'));
  }

  it('I3: a conflict carried through the debounce re-anchors; "Use agent\'s" replaces the right block', async () => {
    const { store } = await setup('one\n\ntwo\n');
    await conflictInFlight(store);
    // Before the flush the agent inserts a block on top: the carried conflict's index is stale.
    await act(async () => { await store.onDiskChange(P, 'top\n\none\n\ntwo A\n', true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(store.get(P)!.content).toBe('top\n\none\n\ntwo mine');
    expect(store.get(P)!.conflicts).toEqual([{ index: 2, ours: 'two mine', theirs: 'two A' }]);
    await act(async () => { fireEvent.click(screen.getByText("Use agent's")); await vi.advanceTimersByTimeAsync(0); });
    expect(store.get(P)!.content).toBe('top\n\none\n\ntwo A');
  });

  it('I3: a newer agent version wins over the carried one', async () => {
    const { store } = await setup('one\n\ntwo\n');
    await conflictInFlight(store);
    await act(async () => { await store.onDiskChange(P, 'one\n\ntwo B\n', true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(store.get(P)!.conflicts).toEqual([{ index: 1, ours: 'two mine', theirs: 'two B' }]);
  });

  describe('pill', () => {
    it('sending countdown', async () => {
      const { store } = await setup();
      const v = view(store, { sendIn: 5, pending: true, pendingCount: 2 });
      expect(screen.getByText('Sending your 2 changes in 5s')).toBeTruthy();
      fireEvent.click(screen.getByText('Send now'));
      fireEvent.click(screen.getByText('Hold'));
      expect(v.onSendNow).toHaveBeenCalled();
      expect(v.onHoldToggle).toHaveBeenCalled();
    });
    it('sending countdown copy: singular, and no count', async () => {
      const { store } = await setup();
      const { rerender } = view(store, { sendIn: 3, pending: true, pendingCount: 1 });
      expect(screen.getByText('Sending your 1 change in 3s')).toBeTruthy();
      const fns = { onSendNow() {}, onHoldToggle() {}, onOpenSource() {}, onOpenCanvas() {} };
      rerender(<CanvasView path={P} store={store} {...base} {...fns} sendIn={3} pending />);
      expect(screen.getByText('Sending your changes in 3s')).toBeTruthy();
    });
    it('held', async () => {
      const { store } = await setup();
      store.setAutoSend(P, false);
      const v = view(store, { pending: true });
      expect(screen.getByText(/Held/)).toBeTruthy();
      fireEvent.click(screen.getByText('Send'));
      expect(v.onSendNow).toHaveBeenCalled();
    });
    it('will send when free', async () => {
      const { store } = await setup();
      view(store, { pending: true, agentStatus: 'busy' });
      expect(screen.getByText('Will send when agent is free')).toBeTruthy();
    });
    it('Auto-send off toggle', async () => {
      const { store } = await setup();
      store.setAutoSend(P, false);
      const v = view(store);
      fireEvent.click(screen.getByText('Auto-send off'));
      expect(v.onHoldToggle).toHaveBeenCalled();
    });
    it('I4b: "Send to this chat" for a chat that is not the canvas\'s auto-send target', async () => {
      const { store } = await setup();
      const v = view(store, { pending: true, autoTarget: false });
      fireEvent.click(screen.getByText('Send to this chat'));
      expect(v.onSendNow).toHaveBeenCalled();
    });
    it('no pill by default', async () => {
      const { store } = await setup();
      view(store);
      expect(screen.queryByText(/Held|Sending|Will send|Auto-send/)).toBeNull();
    });
  });

  it('html emit reaches store', async () => {
    const { store } = await setup('```html picker\n<b>hi</b>\n```\n');
    const spy = vi.spyOn(store, 'userEmit');
    view(store);
    const iframe = document.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('__saiCanvasEmit');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { __saiCanvasEmit: 1, data: { x: 1 } }, source: iframe.contentWindow }));
    });
    expect(spy).toHaveBeenCalledWith(P, 'picker', { x: 1 });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { __saiCanvasEmit: 1, data: 2 }, source: window }));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows deleted state', async () => {
    const { store } = await setup();
    view(store);
    await act(async () => { await store.onDiskChange(P, null, true); });
    expect(screen.getByText('This canvas was deleted.')).toBeTruthy();
  });

  it('shows write errors inline', async () => {
    const { store, failWrite } = await setup();
    failWrite('disk full');
    view(store);
    fireEvent.click(screen.getByLabelText('a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't save canvas: disk full");
  });

  it('flushes pending write on unmount', async () => {
    const { store, writes } = await setup();
    const v = view(store);
    fireEvent.click(screen.getByLabelText('a'));
    v.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(writes[0]).toContain('- [x] a');
  });

  it('both sides rewriting a block keeps the user text and shows the conflict', async () => {
    const { store, writes } = await setup('first\n\nsecond\n');
    view(store);
    fireEvent.click(screen.getByLabelText('Edit block 2'));
    fireEvent.change(screen.getByLabelText('Edit block 2', { selector: 'textarea' }), { target: { value: 'second mine\n' } });
    await act(async () => { await store.onDiskChange(P, 'first\n\nsecond agent\n', true); });
    fireEvent.click(screen.getByText('Save'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(writes[writes.length - 1]).toContain('second mine');
    expect(screen.getByText(/Agent also changed this/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Use agent's")); await vi.advanceTimersByTimeAsync(0); });
    expect(writes[writes.length - 1]).toContain('second agent');
  });

  it('path change resets editor and flushes the old write to the old path', async () => {
    const { store, writes } = await setup('old one\n\nold two\n');
    const P2 = '/ws/.sai/canvas/other.md';
    await store.onDiskChange(P2, 'new one\n\nnew two\n', true);
    const spies = { onSendNow() {}, onHoldToggle() {}, onOpenSource() {}, onOpenCanvas() {} };
    const { rerender } = render(<CanvasView path={P} store={store} {...base} {...spies} />);
    fireEvent.click(screen.getByLabelText('Edit block 2'));
    fireEvent.change(screen.getByLabelText('Edit block 2', { selector: 'textarea' }), { target: { value: 'draft' } });
    fireEvent.click(screen.getByText('Save'));
    rerender(<CanvasView path={P2} store={store} {...base} {...spies} />);
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByText('new two')).toBeTruthy();
    expect(screen.queryByText('draft')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(writes[0]).toContain('draft');
    expect(store.get(P2)!.content).toBe('new one\n\nnew two\n');
  });

  it('renders a checklist indented by 1-3 spaces', async () => {
    const { store, writes } = await setup(' - [ ] a\n - [ ] b\n');
    view(store);
    fireEvent.click(screen.getByLabelText('b'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(writes[0]).toContain(' - [x] b');
  });

  it('emit bridge is injected before the user html', async () => {
    const { store } = await setup('```html\n<script>sai.canvas.emit(1)</script>\n```\n');
    view(store);
    const doc = document.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(doc.indexOf('__saiCanvasEmit')).toBeGreaterThan(-1);
    expect(doc.indexOf('__saiCanvasEmit')).toBeLessThan(doc.indexOf('sai.canvas.emit(1)'));
  });

  it('links open externally instead of navigating the app window', async () => {
    const openExternal = vi.fn();
    (window as any).sai = { ...(window as any).sai, openExternal };
    const { store } = await setup('See [docs](https://example.com/x).\n');
    view(store);
    const link = screen.getByText('docs');
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('raw HTML in markdown blocks is not rendered as DOM', async () => {
    const { store } = await setup('text <style>body{display:none}</style> and <iframe src="https://evil.example"></iframe>\n\n<div class="raw-x">hi</div>\n');
    view(store);
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('.raw-x')).toBeNull();
  });
  it('D4: an untitled html block emits under its nearest preceding heading', async () => {
    const { store } = await setup('# Plan\n\n## Shop flow\n\n```html\n<b>hi</b>\n```\n');
    const spy = vi.spyOn(store, 'userEmit');
    view(store);
    const iframe = document.querySelector('iframe')!;
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { __saiCanvasEmit: 1, data: 1 }, source: iframe.contentWindow }));
    });
    expect(spy).toHaveBeenCalledWith(P, 'Shop flow', 1);
  });

  it('emits from two untitled html blocks under one heading stay separate (no coalescing)', async () => {
    const { store } = await setup('# Plan\n\n## Shop flow\n\n```html\n<b>one</b>\n```\n\n```html\n<b>two</b>\n```\n');
    const spy = vi.spyOn(store, 'userEmit');
    view(store);
    const [first, second] = Array.from(document.querySelectorAll('iframe'));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { __saiCanvasEmit: 1, data: 'a' }, source: first.contentWindow }));
      window.dispatchEvent(new MessageEvent('message', { data: { __saiCanvasEmit: 1, data: 'b' }, source: second.contentWindow }));
    });
    expect(spy.mock.calls).toEqual([[P, 'Shop flow (block 3)', 'a'], [P, 'Shop flow (block 4)', 'b']]);
    // Distinct labels: the store keeps both emits instead of coalescing b over a.
    const msg = store.pendingMessage(P, 'c')!;
    expect(msg).toContain('- html "Shop flow (block 3)" sent: "a"');
    expect(msg).toContain('- html "Shop flow (block 4)" sent: "b"');
  });

  describe('D2: checklist labels are inline Markdown', () => {
    const LINKY = '- [ ] Download dependencies from [Thunderstore](https://thunderstore.io)\n- [ ] Run `npm ci` **first**\n';

    it('renders links, code and bold instead of raw Markdown, with no raw HTML', async () => {
      const { store } = await setup(LINKY + '- [ ] tag <b class="raw-y">x</b>\n');
      view(store);
      const link = screen.getByRole('link', { name: 'Thunderstore' });
      expect(link.getAttribute('href')).toBe('https://thunderstore.io');
      expect(screen.getByText('npm ci').tagName).toBe('CODE');
      expect(screen.getByText('first').tagName).toBe('STRONG');
      expect(document.body.textContent).not.toContain('[Thunderstore]');
      expect(document.body.textContent).not.toContain('`npm ci`');
      expect(document.body.textContent).not.toContain('**first**');
      expect(document.querySelector('.raw-y')).toBeNull();
      // The checkbox's accessible name is the rendered label text.
      expect(screen.getByLabelText('Download dependencies from Thunderstore')).toBeTruthy();
      // Labels stay inline: no <p> inside a <label>.
      expect(document.querySelector('label p')).toBeNull();
    });

    it('clicking a label link opens it externally and does not toggle the checkbox', async () => {
      const openExternal = vi.fn();
      (window as any).sai = { ...(window as any).sai, openExternal };
      const { store, writes } = await setup(LINKY);
      view(store);
      const box = screen.getByLabelText('Download dependencies from Thunderstore') as HTMLInputElement;
      fireEvent.click(screen.getByRole('link', { name: 'Thunderstore' }));
      expect(openExternal).toHaveBeenCalledWith('https://thunderstore.io');
      expect(box.checked).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(writes).toHaveLength(0);
    });

    it('clicking the label text (not the link) still toggles', async () => {
      const { store, writes } = await setup(LINKY);
      view(store);
      fireEvent.click(screen.getByText(/Download dependencies from/));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(writes[0]).toContain('- [x] Download dependencies from [Thunderstore](https://thunderstore.io)');
    });

    it('editing the block edits the raw label source', async () => {
      const { store } = await setup(LINKY);
      view(store);
      fireEvent.click(screen.getByRole('button', { name: 'Edit block 1' }));
      const ta = screen.getByRole('textbox', { name: 'Edit block 1' }) as HTMLTextAreaElement;
      expect(ta.value).toBe(LINKY);
    });
  });

  describe('visual redesign', () => {
    const PAGE = [
      '# ShopMod test', '',
      'A mod for the game.', '',
      '## Launch', '',
      '- [x] Install', '- [!] Buy item', '  > froze', '- [ ] Retry', '',
      '## Price check', '',
      '| Item | Status |', '|---|---|', '| Pack | Pass |', '| Crystal | Blocked by crash |', '| Gem | Not run |', '',
      '## Empty', '',
    ].join('\n');

    it('page title, muted subtitle, and one card per ## section with tags and done/total', async () => {
      const { store } = await setup(PAGE);
      view(store);
      expect(document.querySelector('.canvas-h1')!.textContent).toBe('ShopMod test');
      expect(document.querySelector('.canvas-subtitle')!.textContent).toContain('A mod for the game.');
      const cards = [...document.querySelectorAll('section.canvas-card')];
      expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Launch', 'Price check', 'Empty']);
      expect(cards[0].querySelector('.canvas-card__count')!.textContent).toBe('1 / 3');
      expect([...cards[0].querySelectorAll('.canvas-tag')].map((t) => t.textContent)).toEqual(['checklist']);
      expect([...cards[1].querySelectorAll('.canvas-tag')].map((t) => t.textContent)).toEqual(['table']);
      expect(cards[2].querySelector('.canvas-card__body')).toBeNull();
    });

    it('a failed item renders failed with a red note; "Mark failed" writes [!]; clicking a failed box resets it', async () => {
      const { store, writes } = await setup(PAGE);
      view(store);
      const failed = screen.getByLabelText('Buy item').closest('li')!;
      expect(failed.className).toContain('canvas-task--failed');
      expect(failed.querySelector('.canvas-note--bad')!.textContent).toContain('froze');
      expect(screen.getByLabelText('Install').closest('li')!.className).toContain('canvas-task--done');
      const retry = screen.getByLabelText('Retry').closest('li')!;
      fireEvent.click(retry.querySelector('.canvas-btn--danger')!);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(writes[0]).toContain('- [!] Retry');
      fireEvent.click(screen.getByLabelText('Buy item'));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(writes[1]).toContain('- [ ] Buy item');
    });

    it('table status cells get coloured dots', async () => {
      const { store } = await setup(PAGE);
      view(store);
      const cell = (t: string) => screen.getByText(t).closest('td')!;
      expect(cell('Pass').className).toContain('canvas-cell--ok');
      expect(cell('Blocked by crash').className).toContain('canvas-cell--bad');
      expect(cell('Not run').className).toContain('canvas-cell--dim');
      expect(cell('Pass').querySelector('.canvas-dot')).toBeTruthy();
    });

    it('stat tiles only with a ```stats block; auto values come from the checklists', async () => {
      const { store } = await setup(PAGE);
      view(store);
      expect(document.querySelector('.canvas-stats')).toBeNull();
      cleanup();
      const { store: s2 } = await setup(PAGE.replace('A mod for the game.\n', 'A mod for the game.\n\n```stats\nProgress: auto\nFailed: auto\nBuild: v0.3.1\n```\n'));
      view(s2);
      const tiles = [...document.querySelectorAll('.canvas-stat')].map((t) => t.textContent);
      expect(tiles).toEqual(['Progress1 of 3 steps', 'Failed1', 'Buildv0.3.1']);
      expect(document.querySelector('.canvas-stat__value--mono')!.textContent).toBe('v0.3.1');
    });

    it('header shows the sides that have edited', async () => {
      const { store } = await setup();
      view(store);
      const meta = () => document.querySelector('.canvas-meta')!.textContent;
      expect(meta()).toContain('Agent edited just now');
      expect(meta()).not.toContain('you');
      await act(async () => { await store.userWrite(P, DOC.replace('body', 'mine')); });
      expect(meta()).toMatch(/Agent edited .*·.*you just now/);
    });

    it('agent-changed items and blocks get the marker until the user edits', async () => {
      const { store } = await setup();
      view(store);
      await act(async () => { await store.onDiskChange(P, '# Plan\n\n- [ ] a\n- [ ] b\n- [ ] c\n\nbody\n\nnew para\n', true); });
      const c = screen.getByLabelText('c').closest('li')!;
      expect(c.className).toContain('canvas-agent-edge');
      expect(c.textContent).toContain('added by agent');
      expect(screen.getByLabelText('a').closest('li')!.className).not.toContain('canvas-agent-edge');
      expect(screen.getByText('new para').closest('.canvas-block')!.className).toContain('canvas-agent-edge');
      fireEvent.click(screen.getByLabelText('a'));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(document.querySelector('.canvas-agent-edge')).toBeNull();
    });

    it('agent marker expires after 10 minutes', async () => {
      const { store } = await setup();
      view(store);
      await act(async () => { await store.onDiskChange(P, DOC.replace('body', 'agent body'), true); });
      expect(document.querySelector('.canvas-agent-edge')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100); });
      expect(document.querySelector('.canvas-agent-edge')).toBeNull();
    });

    it('Canvases picker lists canvases and opens one', async () => {
      const { store } = await setup();
      const v = view(store);
      fireEvent.click(screen.getByRole('button', { name: 'Canvases' }));
      fireEvent.click(screen.getByRole('menuitem', { name: /Plan/ }));
      expect(v.onOpenCanvas).toHaveBeenCalledWith(P);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('a mermaid block renders with the injected result classes (render only)', async () => {
      const { renderMermaidToSvg } = await import('../../../src/render/renderMermaid');
      const { store } = await setup('## Flow\n\n```mermaid\ngraph LR\nA:::pass --> B\n```\n');
      view(store);
      const arg = (renderMermaidToSvg as any).mock.calls.at(-1)[0] as string;
      expect(arg).toMatch(/classDef pass /);
      expect(store.get(P)!.content).not.toContain('classDef');
      expect(document.querySelector('.canvas-card .canvas-diagram')).toBeTruthy();
    });

    it('diagrams follow an accent change (the current class uses the live accent)', async () => {
      const { renderMermaidToSvg } = await import('../../../src/render/renderMermaid');
      const root = document.documentElement;
      root.style.setProperty('--accent', '#112233');
      try {
        const { store } = await setup('```mermaid\ngraph LR\nA:::current\n```\n');
        view(store);
        expect((renderMermaidToSvg as any).mock.calls.at(-1)[0]).toContain('stroke:#112233');
        await act(async () => {
          root.style.setProperty('--accent', '#445566');
          await vi.advanceTimersByTimeAsync(0);
        });
        expect((renderMermaidToSvg as any).mock.calls.at(-1)[0]).toContain('stroke:#445566');
      } finally {
        root.style.removeProperty('--accent');
      }
    });

    it('"Add section" appends a section card', async () => {
      const { store, writes } = await setup();
      view(store);
      fireEvent.click(screen.getByText('Add section'));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(writes[0]).toBe('# Plan\n\n- [ ] a\n- [ ] b\n\nbody\n\n## New section\n\n- [ ] First step\n');
    });
  });
});
