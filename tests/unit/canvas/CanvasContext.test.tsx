import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasController, type CanvasControllerOpts } from '../../../src/canvas/CanvasContext';
import type { OpenFile } from '../../../src/types';

const WS = '/home/u/p';
const REAL = '/var/home/u/p/.sai/canvas/plan.md';
const TAB = '/home/u/p/.sai/canvas/plan.md';

type Ev = { projectPath: string; path: string; content: string | null };
let emit: (e: Ev) => void;
let listed: { path: string; content: string }[];
let sai: any;

beforeEach(() => {
  listed = [{ path: REAL, content: '- [ ] a\n' }];
  sai = {
    canvasWatch: vi.fn().mockResolvedValue(undefined),
    canvasUnwatch: vi.fn().mockResolvedValue(undefined),
    canvasList: vi.fn(async () => listed),
    onCanvasChanged: vi.fn((cb: (e: Ev) => void) => { emit = cb; return () => {}; }),
    fsWriteFile: vi.fn().mockResolvedValue(undefined),
  };
  (window as any).sai = sai;
});

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

function setup(over: Partial<CanvasControllerOpts> = {}) {
  let files: OpenFile[] = [];
  const opts: CanvasControllerOpts = {
    projectPath: WS, chatKey: 'c', chatBusy: false, agentLive: false,
    sendRef: { current: vi.fn() },
    getOpenFiles: () => files,
    openFile: vi.fn(), closeFile: vi.fn(),
    ...over,
  };
  const hook = renderHook((p: CanvasControllerOpts) => useCanvasController(p), { initialProps: opts });
  return { hook, opts, setFiles: (f: OpenFile[]) => { files = f; } };
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
    const { hook, opts } = setup();
    await flush();
    hook.rerender({ ...opts, agentLive: true });
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
  });

  it('defers auto-open while typing outside a canvas, then opens on focus change', async () => {
    const { hook, opts } = setup();
    await flush();
    hook.rerender({ ...opts, agentLive: true });
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    act(() => emit({ projectPath: WS, path: REAL, content: '- [ ] a\n\nnew\n' }));
    await flush();
    expect(opts.openFile).not.toHaveBeenCalled();
    vi.useFakeTimers();
    act(() => { ta.blur(); vi.runAllTimers(); });
    vi.useRealTimers();
    expect(opts.openFile).toHaveBeenCalledWith(TAB);
    ta.remove();
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

  it('ignores events for other projects', async () => {
    const { hook } = setup();
    await flush();
    act(() => emit({ projectPath: '/home/u/other', path: '/home/u/other/.sai/canvas/z.md', content: 'z' }));
    await flush();
    expect(hook.result.current.store.list()).toHaveLength(1);
  });

  it('keeps one store per workspace; unwatches on switch and re-seeds on return', async () => {
    const { hook, opts } = setup();
    await flush();
    const first = hook.result.current.store;
    hook.rerender({ ...opts, projectPath: '/home/u/q' });
    await flush();
    expect(sai.canvasUnwatch).toHaveBeenCalledWith(WS);
    expect(sai.canvasWatch).toHaveBeenCalledWith('/home/u/q');
    expect(hook.result.current.store).not.toBe(first);
    hook.rerender({ ...opts });
    await flush();
    expect(hook.result.current.store).toBe(first);
    expect(sai.canvasList).toHaveBeenCalledTimes(3);
    // Unchanged re-seed is a no-op: still nothing pending.
    expect(first.hasPending(TAB, 'c')).toBe(false);
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
