import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasController, type CanvasControllerOpts } from '../../../src/canvas/CanvasContext';
import type { OpenFile } from '../../../src/types';

const WS = '/home/u/p';
const REAL = '/var/home/u/p/.sai/canvas/plan.md';
const TAB = '/home/u/p/.sai/canvas/plan.md';

type Ev = { projectPath: string; path: string; content: string | null };
let listeners: Array<(e: Ev) => void>;
const emit = (e: Ev) => { for (const l of [...listeners]) l(e); };
let listed: { path: string; content: string }[];
let sai: any;

beforeEach(() => {
  listed = [{ path: REAL, content: '- [ ] a\n' }];
  listeners = [];
  sai = {
    canvasWatch: vi.fn().mockResolvedValue(undefined),
    canvasUnwatch: vi.fn().mockResolvedValue(undefined),
    canvasList: vi.fn(async (ws: string) => (ws === WS ? listed : [])),
    onCanvasChanged: vi.fn((cb: (e: Ev) => void) => {
      listeners.push(cb);
      return () => { listeners = listeners.filter((l) => l !== cb); };
    }),
    fsWriteFile: vi.fn().mockResolvedValue(undefined),
  };
  (window as any).sai = sai;
});

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

const Q = '/home/u/q';

function setup(over: Partial<CanvasControllerOpts> = {}) {
  const files = new Map<string, OpenFile[]>();
  const live = new Set<string>();
  const opts: CanvasControllerOpts = {
    projectPath: WS, chatKey: 'c', chatBusy: false,
    openWorkspaces: [WS, Q],
    isAgentLive: (ws) => live.has(ws),
    sendRef: { current: vi.fn() },
    getOpenFiles: (ws) => files.get(ws) ?? [],
    openFile: vi.fn(), closeFile: vi.fn(), patchTabs: vi.fn(),
    ...over,
  };
  const hook = renderHook((p: CanvasControllerOpts) => useCanvasController(p), { initialProps: opts });
  return {
    hook, opts, live,
    setFiles: (f: OpenFile[], ws = WS) => { files.set(ws, f); },
  };
}

describe('useCanvasController', () => {
  it('seeds from canvasList as a baseline under one path key', async () => {
    const { hook, opts } = setup();
    await flush();
    expect(sai.canvasWatch).toHaveBeenCalledWith(WS);
    expect(hook.result.current.store.get(TAB)?.content).toBe('- [ ] a\n');
    expect(hook.result.current.store.hasPending(TAB, 'c')).toBe(false);
    expect(opts.openFile).not.toHaveBeenCalled();
  });

  it('auto-opens an agent-written canvas in the project spelling', async () => {
    const { live, opts } = setup();
    await flush();
    live.add(WS);
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
  });

  it('defers auto-open while focus is in any text entry, even inside a canvas view, then opens on focus change', async () => {
    const { live, opts } = setup();
    await flush();
    live.add(WS);
    const view = document.createElement('div');
    view.className = 'canvas-view';
    const ta = document.createElement('textarea');
    view.appendChild(ta);
    document.body.appendChild(view);
    ta.focus();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    expect(opts.openFile).not.toHaveBeenCalled();
    vi.useFakeTimers();
    act(() => { ta.blur(); vi.runAllTimers(); });
    vi.useRealTimers();
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
    view.remove();
  });

  it('auto-opens a canvas once per session, not on every agent write', async () => {
    const { live, opts } = setup();
    await flush();
    live.add(WS);
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\none\n' }));
    await flush();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\ntwo\n' }));
    await flush();
    expect(opts.openFile).toHaveBeenCalledTimes(1);
  });

  it('a deferred canvas opens once when focus allows, despite more agent writes meanwhile', async () => {
    const { live, opts } = setup();
    await flush();
    live.add(WS);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\none\n' }));
    await flush();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\ntwo\n' }));
    await flush();
    expect(opts.openFile).not.toHaveBeenCalled();
    vi.useFakeTimers();
    act(() => { ta.blur(); vi.runAllTimers(); });
    vi.useRealTimers();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nthree\n' }));
    await flush();
    expect(opts.openFile).toHaveBeenCalledTimes(1);
    ta.remove();
  });

  it('keeps the controller value stable across unrelated re-renders', async () => {
    const { hook, opts } = setup();
    await flush();
    const before = hook.result.current;
    hook.rerender({ ...opts, getOpenFiles: () => [], openFile: vi.fn() });
    expect(hook.result.current).toBe(before);
    hook.rerender({ ...opts, chatBusy: true });
    expect(hook.result.current).not.toBe(before);
  });

  it('clears a pending focusout check on unmount', async () => {
    const { hook, live, opts } = setup();
    await flush();
    live.add(WS);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    vi.useFakeTimers();
    ta.blur(); // schedules the deferred check
    hook.unmount();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(opts.openFile).not.toHaveBeenCalled();
    ta.remove();
  });

  it('a focused checkbox does not defer auto-open', async () => {
    const { live, opts } = setup();
    await flush();
    live.add(WS);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);
    cb.focus();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
    cb.remove();
  });

  it('closes the tab when the canvas is deleted (either spelling)', async () => {
    const { opts, setFiles } = setup();
    await flush();
    setFiles([{ path: TAB, viewMode: 'editor' }, { path: '/home/u/p/x.ts', viewMode: 'editor' }]);
    act(() => emit({ projectPath: WS, path: REAL, content: null }));
    await flush();
    expect(opts.closeFile).toHaveBeenCalledTimes(1);
    expect(opts.closeFile).toHaveBeenCalledWith(TAB);
  });

  it('I2: deleting a canvas leaves a dirty source tab open', async () => {
    const { opts, setFiles } = setup();
    await flush();
    setFiles([{ path: TAB, viewMode: 'editor', canvasSource: true, isDirty: true, content: 'x' }]);
    act(() => emit({ projectPath: WS, path: REAL, content: null }));
    await flush();
    expect(opts.closeFile).not.toHaveBeenCalled();
  });

  it('I4a: an agent write is attributed to the workspace\'s streaming chats (they get diffs)', async () => {
    const { hook, live } = setup({ liveChats: (ws) => (ws === WS ? ['c'] : []) });
    await flush();
    live.add(WS);
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    const s = hook.result.current.store;
    await act(async () => { await s.userWrite(TAB, '- [x] a\n\nnew\n'); });
    expect(s.pendingMessage(TAB, 'c')).toContain('☑ "a"');
  });

  it('ignores events for other projects', async () => {
    const { hook } = setup();
    await flush();
    act(() => emit({ projectPath: '/home/u/other', path: '/home/u/other/.sai/canvas/z.md', content: 'z' }));
    await flush();
    expect(hook.result.current.store.list()).toHaveLength(1);
  });

  it('keeps watching a background workspace and absorbs its agent writes as agent edits', async () => {
    const { hook, opts, live } = setup();
    await flush();
    const first = hook.result.current.store;
    // Switch to Q: WS stays watched (no unwatch, no re-seed).
    hook.rerender({ ...opts, projectPath: Q });
    await flush();
    expect(sai.canvasUnwatch).not.toHaveBeenCalled();
    expect(sai.canvasWatch).toHaveBeenCalledWith(Q);
    expect(hook.result.current.store).not.toBe(first);
    // WS's agent writes while WS is in the background.
    live.add(WS);
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nagent\n' }));
    await flush();
    expect(first.get(TAB)?.lastEditor).toBe('agent');
    expect(first.hasPending(TAB, 'c')).toBe(false);
    // Not auto-opened into Q.
    expect(opts.openFile).not.toHaveBeenCalled();
    // Back to WS: same store, seeded once only, and the touched canvas opens now.
    live.delete(WS);
    hook.rerender({ ...opts });
    await flush();
    expect(hook.result.current.store).toBe(first);
    expect(sai.canvasList.mock.calls.filter((c: string[]) => c[0] === WS)).toHaveLength(1);
    expect(first.hasPending(TAB, 'c')).toBe(false);
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
  });

  it('closes a background workspace tab on delete via patchTabs', async () => {
    const { hook, opts, setFiles } = setup();
    await flush();
    hook.rerender({ ...opts, projectPath: Q });
    await flush();
    setFiles([{ path: TAB, viewMode: 'editor' }], WS);
    act(() => emit({ projectPath: WS, path: REAL, content: null }));
    await flush();
    expect(opts.closeFile).not.toHaveBeenCalled();
    expect(opts.patchTabs).toHaveBeenCalledWith(WS, expect.any(Function));
  });

  it('unwatches a workspace once it is closed, and everything on unmount', async () => {
    const { hook, opts } = setup();
    await flush();
    hook.rerender({ ...opts, projectPath: Q });
    await flush();
    hook.rerender({ ...opts, projectPath: Q, openWorkspaces: [Q] });
    await flush();
    expect(sai.canvasUnwatch).toHaveBeenCalledWith(WS);
    expect(sai.canvasUnwatch).not.toHaveBeenCalledWith(Q);
    hook.unmount();
    expect(sai.canvasUnwatch).toHaveBeenCalledWith(Q);
  });

  it('routes source saves of project canvases through the store', async () => {
    const { hook } = setup();
    await flush();
    let ok = false;
    await act(async () => { ok = await hook.result.current.writeSource(TAB, '- [x] a\n'); });
    expect(ok).toBe(true);
    expect(hook.result.current.store.get(TAB)?.lastEditor).toBe('user');
    expect(sai.fsWriteFile).toHaveBeenCalledWith(TAB, '- [x] a\n');
    let other = true;
    await act(async () => { other = await hook.result.current.writeSource('/home/u/x/.sai/canvas/a.md', 'x'); });
    expect(other).toBe(false);
  });
});
