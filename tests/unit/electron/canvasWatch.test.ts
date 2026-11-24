import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvasWatcher, listCanvases, type CanvasChange } from '../../../electron/services/canvasWatch';

describe('createCanvasWatcher', () => {
  let proj: string;
  let real: string;
  let events: CanvasChange[];
  let w: ReturnType<typeof createCanvasWatcher>;
  const canvasDir = () => path.join(real, '.sai', 'canvas');
  const mkCanvas = () => fs.mkdirSync(canvasDir(), { recursive: true });

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaswatch-'));
    real = fs.realpathSync(proj);
    events = [];
    w = createCanvasWatcher(e => events.push(e), { debounceMs: 30 });
  });

  afterEach(() => {
    w.disposeAll();
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('emits on create/modify/delete', async () => {
    mkCanvas();
    w.watch(proj);
    const f = path.join(canvasDir(), 'a.md');
    fs.writeFileSync(f, 'one');
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: proj, path: f, content: 'one' }));
    fs.writeFileSync(f, 'two');
    await vi.waitFor(() => expect(events.at(-1)?.content).toBe('two'));
    fs.rmSync(f);
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: proj, path: f, content: null }));
  });

  it('ignores non-md and nested files', async () => {
    mkCanvas();
    w.watch(proj);
    fs.writeFileSync(path.join(canvasDir(), 'a.txt'), 'x');
    fs.mkdirSync(path.join(canvasDir(), 'sub'));
    fs.writeFileSync(path.join(canvasDir(), 'sub', 'n.md'), 'x');
    const f = path.join(canvasDir(), 'sentinel.md');
    fs.writeFileSync(f, 's');
    await vi.waitFor(() => expect(events.some(e => e.path === f)).toBe(true));
    expect(events.map(e => path.basename(e.path))).toEqual(['sentinel.md']);
  });

  it('picks up dir created after watch', async () => {
    w.watch(proj);
    mkCanvas();
    const f = path.join(canvasDir(), 'a.md');
    fs.writeFileSync(f, 'hi');
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: proj, path: f, content: 'hi' }));
  });

  it('unwatch stops events', async () => {
    mkCanvas();
    w.watch(proj);
    const f = path.join(canvasDir(), 'a.md');
    fs.writeFileSync(f, '1');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    w.unwatch(proj);
    fs.writeFileSync(f, '2');
    fs.writeFileSync(path.join(canvasDir(), 'b.md'), '2');
    // A second watcher on the same dir proves the fs events were delivered by now.
    const seen: string[] = [];
    const w2 = createCanvasWatcher(e => seen.push(e.path), { debounceMs: 30 });
    w2.watch(proj);
    fs.writeFileSync(path.join(canvasDir(), 'c.md'), '3');
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    w2.disposeAll();
    expect(events).toHaveLength(1);
  });

  it('atomic rename saves never report a delete', async () => {
    w.disposeAll();
    w = createCanvasWatcher(e => events.push(e), { debounceMs: 150 });
    mkCanvas();
    const f = path.join(canvasDir(), 'a.md');
    fs.writeFileSync(f, 'v0');
    w.watch(proj);
    // Real window: the old file disappears, the new one lands a bit later (inside the debounce).
    fs.rmSync(f);
    await new Promise(r => setTimeout(r, 40));
    fs.writeFileSync(f, 'v1');
    await vi.waitFor(() => expect(events.at(-1)?.content).toBe('v1'));
    expect(events.every(e => e.content !== null)).toBe(true);
  });

  it('re-arms after a watcher error and after the project .sai is removed and recreated', async () => {
    const created: fs.FSWatcher[] = [];
    const orig = fs.watch;
    const spy = vi.spyOn(fs, 'watch').mockImplementation(((...args: unknown[]) => {
      const watcher = (orig as (...a: unknown[]) => fs.FSWatcher)(...args);
      created.push(watcher);
      return watcher;
    }) as typeof fs.watch);
    try {
      mkCanvas();
      const a = path.join(canvasDir(), 'a.md');
      fs.writeFileSync(a, 'a');
      w.watch(proj);
      created.at(-1)!.emit('error', Object.assign(new Error('EMFILE'), { code: 'EMFILE' }));
      await vi.waitFor(() => expect(events).toContainEqual({ projectPath: proj, path: a, content: null }));
      events.length = 0;
      // The retry re-attaches and reports what is on disk.
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: proj, path: a, content: 'a' }));
      fs.writeFileSync(a, 'b');
      await vi.waitFor(() => expect(events.at(-1)?.content).toBe('b'));
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores invalid project paths', () => {
    w.watch('');
    w.watch('relative/dir');
    w.watch(undefined as unknown as string);
    w.unwatch('relative/dir');
    expect(listCanvases('relative/dir')).toEqual([]);
    expect(listCanvases(undefined as unknown as string)).toEqual([]);
  });

  it('nulls known files when .sai is removed and resumes when re-created', async () => {
    mkCanvas();
    const a = path.join(canvasDir(), 'a.md');
    const b = path.join(canvasDir(), 'b.md');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    w.watch(proj);
    fs.rmSync(path.join(real, '.sai'), { recursive: true });
    await vi.waitFor(() => {
      const nulls = events.filter(e => e.content === null).map(e => e.path).sort();
      expect(nulls).toEqual([a, b]);
    });
    events.length = 0;
    mkCanvas();
    fs.writeFileSync(a, 'again');
    await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: proj, path: a, content: 'again' }));
  });

  it('debounces per file so two files changing together both emit', async () => {
    mkCanvas();
    w.watch(proj);
    const a = path.join(canvasDir(), 'a.md');
    const b = path.join(canvasDir(), 'b.md');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    await vi.waitFor(() => expect(new Set(events.map(e => e.path))).toEqual(new Set([a, b])));
  });

  it('emits paths from the realpath even when watched through a symlink', async () => {
    mkCanvas();
    const link = proj + '-link';
    fs.symlinkSync(proj, link);
    try {
      w.watch(link);
      const f = path.join(canvasDir(), 'a.md');
      fs.writeFileSync(f, 'x');
      await vi.waitFor(() => expect(events.at(-1)).toEqual({ projectPath: link, path: f, content: 'x' }));
    } finally {
      w.disposeAll();
      fs.rmSync(link);
    }
  });
});

describe('listCanvases', () => {
  it('returns [] without creating anything when .sai/canvas is missing', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaslist-'));
    try {
      expect(listCanvases(proj)).toEqual([]);
      expect(fs.existsSync(path.join(proj, '.sai'))).toBe(false);
      expect(listCanvases(path.join(proj, 'nope'))).toEqual([]);
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

  it('lists absolute md paths from the realpath', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'canvaslist-'));
    try {
      const dir = path.join(fs.realpathSync(proj), '.sai', 'canvas');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'a.md'), 'A');
      fs.writeFileSync(path.join(dir, 'b.txt'), 'B');
      expect(listCanvases(proj)).toEqual([{ path: path.join(dir, 'a.md'), content: 'A' }]);
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });
});
