import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileWatchRegistry } from '../../../electron/services/fileWatch';

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
});
