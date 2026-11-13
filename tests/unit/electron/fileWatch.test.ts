import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createFileWatchRegistry, createSenderWatches } from '../../../electron/services/fileWatch';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// debounce 50 ms; wait well past it so fs.watch latency doesn't flake.
const SETTLE = 400;

describe('createFileWatchRegistry', () => {
  let dir: string;
  let calls: string[];
  let reg: ReturnType<typeof createFileWatchRegistry>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatch-'));
    fs.writeFileSync(path.join(dir, 'x.stl'), 'a');
    calls = [];
    reg = createFileWatchRegistry(p => calls.push(p), { debounceMs: 50 });
  });

  afterEach(() => {
    reg.disposeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fires once for a burst of writes', async () => {
    const f = path.join(dir, 'x.stl');
    reg.watch(f);
    await sleep(50);
    fs.writeFileSync(f, '1');
    await sleep(5);
    fs.writeFileSync(f, '2');
    await sleep(5);
    fs.writeFileSync(f, '3');
    await sleep(SETTLE);
    expect(calls).toEqual([f]);
  });

  it('fires after atomic rename and keeps watching', async () => {
    const f = path.join(dir, 'x.stl');
    reg.watch(f);
    await sleep(50);
    fs.writeFileSync(path.join(dir, 'x.tmp'), '1');
    fs.renameSync(path.join(dir, 'x.tmp'), f);
    await sleep(SETTLE);
    expect(calls.length).toBe(1);
    fs.writeFileSync(path.join(dir, 'x.tmp'), '2');
    fs.renameSync(path.join(dir, 'x.tmp'), f);
    await sleep(SETTLE);
    expect(calls.length).toBe(2);
  });

  it('ignores sibling files', async () => {
    reg.watch(path.join(dir, 'x.stl'));
    await sleep(50);
    fs.writeFileSync(path.join(dir, 'y.stl'), 'z');
    await sleep(SETTLE);
    expect(calls).toEqual([]);
  });

  it('ref-counted unwatch', async () => {
    const f = path.join(dir, 'x.stl');
    reg.watch(f);
    reg.watch(f);
    reg.unwatch(f);
    await sleep(50);
    fs.writeFileSync(f, '1');
    await sleep(SETTLE);
    expect(calls.length).toBe(1);
    reg.unwatch(f);
    fs.writeFileSync(f, '2');
    await sleep(SETTLE);
    expect(calls.length).toBe(1);
  });

  it('does not throw when the parent dir is missing', () => {
    expect(() => reg.watch(path.join(dir, 'nope', 'x.stl'))).not.toThrow();
    expect(() => reg.unwatch(path.join(dir, 'nope', 'x.stl'))).not.toThrow();
  });

  it('unwatch via a symlinked spelling of the same file stops events', async () => {
    const link = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatch-link-')) + '/alias';
    fs.symlinkSync(dir, link);
    try {
      reg.watch(path.join(dir, 'x.stl'));
      reg.unwatch(path.join(link, 'x.stl'));
      fs.writeFileSync(path.join(dir, 'x.stl'), '1');
      await sleep(SETTLE);
      expect(calls).toEqual([]);
    } finally {
      fs.rmSync(path.dirname(link), { recursive: true, force: true });
    }
  });

  it('unwatch after the parent dir is removed does not throw and closes the watcher', async () => {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    const f = path.join(sub, 'x.stl');
    fs.writeFileSync(f, 'a');
    const spy = vi.spyOn(fs, 'watch');
    reg.watch(f);
    const watcher = spy.mock.results[0].value as fs.FSWatcher;
    const closeSpy = vi.spyOn(watcher, 'close');
    spy.mockRestore();
    fs.rmSync(sub, { recursive: true, force: true });
    expect(() => reg.unwatch(f)).not.toThrow();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe('createSenderWatches', () => {
  class FakeSender extends EventEmitter {
    id = 7;
    destroyed = false;
    sent: string[] = [];
    isDestroyed() { return this.destroyed; }
    send(_c: string, p: string) { this.sent.push(p); }
  }

  it('disposes on main-frame navigation, ignores same-document and subframes, recreates lazily', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatch-s-'));
    const f = path.join(dir, 'x.stl');
    fs.writeFileSync(f, 'a');
    const sw = createSenderWatches({ debounceMs: 50 });
    const s = new FakeSender();
    try {
      sw.watch(s as any, f);
      s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
      s.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
      await sleep(50);
      fs.writeFileSync(f, '1');
      await sleep(SETTLE);
      expect(s.sent).toEqual([f]);

      s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
      fs.writeFileSync(f, '2');
      await sleep(SETTLE);
      expect(s.sent).toEqual([f]);

      sw.watch(s as any, f);
      expect(s.listenerCount('did-start-navigation')).toBe(1);
      await sleep(50);
      fs.writeFileSync(f, '3');
      await sleep(SETTLE);
      expect(s.sent).toEqual([f, f]);

      s.emit('render-process-gone');
      fs.writeFileSync(f, '4');
      await sleep(SETTLE);
      expect(s.sent.length).toBe(2);
    } finally {
      s.emit('destroyed');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
