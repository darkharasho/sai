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

  describe('pill', () => {
    it('sending countdown', async () => {
      const { store } = await setup();
      const v = view(store, { sendIn: 5, pending: true });
      expect(screen.getByText(/Sending to agent in 5s/)).toBeTruthy();
      fireEvent.click(screen.getByText('Send now'));
      fireEvent.click(screen.getByText('Hold'));
      expect(v.onSendNow).toHaveBeenCalled();
      expect(v.onHoldToggle).toHaveBeenCalled();
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
});
