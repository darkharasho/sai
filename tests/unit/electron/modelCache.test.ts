import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotModel, readCachedModel, pruneModelCache, enforceCap } from '../../../electron/services/modelCache';

let tmp: string;
let dir: string;
let ws: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'modelcache-')));
  dir = path.join(tmp, 'cache');
  ws = path.join(tmp, 'ws');
  fs.mkdirSync(ws);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const snap = (p: string, extra: object = {}) => snapshotModel({ cwd: ws, path: p, allowedRoots: [], dir, ...extra });

describe('modelCache', () => {
  it('snapshots and dedupes by content', () => {
    fs.writeFileSync(path.join(ws, 'a.stl'), 'solid x');
    fs.writeFileSync(path.join(ws, 'b.stl'), 'solid x');
    const a = snap('a.stl');
    const b = snap('b.stl');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.versionKey).toMatch(/^[0-9a-f]{32}$/);
    expect(b.versionKey).toBe(a.versionKey);
    expect(a.ext).toBe('stl');
    expect(a.bytes).toBe(7);
    expect(fs.readdirSync(dir)).toEqual([`${a.versionKey}.stl`]);
    expect(readCachedModel(a.versionKey, dir)?.toString()).toBe('solid x');
  });

  it('rejects path outside roots', () => {
    const out = path.join(tmp, 'out.stl');
    fs.writeFileSync(out, 'x');
    const r = snap(out);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/escapes workspace/);
  });

  it('reports missing path', () => {
    const r = snap('nope.stl');
    expect(!r.ok && r.error).toMatch(/path not found/);
  });

  it('accepts path via symlinked home', () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(tmp, 'link'));
    fs.writeFileSync(path.join(real, 'm.stl'), 'solid y');
    const r = snapshotModel({ cwd: real, path: path.join(tmp, 'link', 'm.stl'), allowedRoots: [], dir });
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported ext', () => {
    fs.writeFileSync(path.join(ws, 'a.step'), 'x');
    const r = snap('a.step');
    expect(!r.ok && r.error).toMatch(/unsupported model type/);
  });

  it('readCachedModel rejects malformed key', () => {
    expect(readCachedModel('../x', dir)).toBeNull();
    expect(readCachedModel('a'.repeat(32), dir)).toBeNull();
  });

  it('prune keeps referenced, deletes rest (including png)', () => {
    fs.mkdirSync(dir, { recursive: true });
    const k1 = '1'.repeat(32), k2 = '2'.repeat(32);
    fs.writeFileSync(path.join(dir, `${k1}.stl`), 'aa');
    fs.writeFileSync(path.join(dir, `${k1}.png`), 'aa');
    fs.writeFileSync(path.join(dir, `${k2}.stl`), 'bbb');
    fs.writeFileSync(path.join(dir, `${k2}.png`), 'bbb');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
    const r = pruneModelCache([k1], dir);
    expect(r).toEqual({ deleted: 2, freedBytes: 6 });
    expect(fs.readdirSync(dir).sort()).toEqual(['notes.txt', `${k1}.png`, `${k1}.stl`].sort());
  });

  it('enforceCap evicts oldest first', () => {
    fs.mkdirSync(dir, { recursive: true });
    const keys = ['1', '2', '3'].map((c) => c.repeat(32));
    keys.forEach((k, i) => {
      const f = path.join(dir, `${k}.stl`);
      fs.writeFileSync(f, 'x'.repeat(10));
      fs.utimesSync(f, 1000 + i, 1000 + i);
    });
    fs.writeFileSync(path.join(dir, `${keys[0]}.png`), 'x'.repeat(10));
    enforceCap(dir, 20);
    expect(fs.readdirSync(dir).sort()).toEqual([`${keys[1]}.stl`, `${keys[2]}.stl`].sort());
  });

  it('cache hit touches mtime; cap never evicts the just-written key', () => {
    fs.writeFileSync(path.join(ws, 'a.stl'), 'solid x');
    const a = snap('a.stl');
    if (!a.ok) throw new Error('x');
    const f = path.join(dir, `${a.versionKey}.stl`);
    fs.utimesSync(f, 1000, 1000);
    snap('a.stl');
    expect(fs.statSync(f).mtimeMs).toBeGreaterThan(5000_000);
    fs.writeFileSync(path.join(ws, 'c.stl'), 'solid much longer');
    const c = snap('c.stl', { capBytes: 1 });
    expect(c.ok).toBe(true);
    if (c.ok) expect(fs.existsSync(path.join(dir, `${c.versionKey}.stl`))).toBe(true);
    expect(fs.existsSync(f)).toBe(false);
  });
});
