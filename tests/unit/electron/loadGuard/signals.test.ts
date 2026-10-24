// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { Signaller, readStartTicks, recoverOrphanedFrozenFiles, frozenFileName } from '../../../../electron/services/loadGuard/signals';

// SAFETY: only a fake kill and an in-memory fs are ever used here.
function setup(live: Record<number, number>, initialFile?: string) {
  const calls: Array<[number, string]> = [];
  const files = new Map<string, string>();
  if (initialFile !== undefined) files.set('/p.json', initialFile);
  let killImpl: (pid: number, sig: string) => void = () => {};
  const s = new Signaller({
    kill: (pid, sig) => { calls.push([pid, sig]); killImpl(pid, sig); },
    startTicksOf: pid => live[pid] ?? null,
    persistPath: '/p.json',
    fs: {
      readFileSync: ((f: string) => {
        if (!files.has(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return files.get(f)!;
      }) as never,
      writeFileSync: ((f: string, d: string) => { files.set(f, d); }) as never,
      renameSync: ((a: string, b: string) => { files.set(b, files.get(a)!); files.delete(a); }) as never,
    },
  });
  return { s, calls, files, setKill: (f: typeof killImpl) => { killImpl = f; } };
}
const saved = (files: Map<string, string>) => JSON.parse(files.get('/p.json') ?? '[]');

describe('Signaller', () => {
  it('freeze skips mismatched ticks and persists the rest', () => {
    const { s, calls, files } = setup({ 101: 10, 102: 20, 103: 30 });
    const n = s.freeze([{ pid: 101, startTicks: 10 }, { pid: 102, startTicks: 99 }, { pid: 103, startTicks: 30 }]);
    expect(n).toBe(2);
    expect(calls).toEqual([[101, 'SIGSTOP'], [103, 'SIGSTOP']]);
    expect(saved(files)).toHaveLength(2);
    expect(s.frozenCount()).toBe(2);
  });

  it('thawAll sends SIGCONT and clears the file', () => {
    const { s, calls, files } = setup({ 101: 10, 103: 30 });
    s.freeze([{ pid: 101, startTicks: 10 }, { pid: 103, startTicks: 30 }]);
    calls.length = 0;
    expect(s.thawAll()).toBe(2);
    expect(calls).toEqual([[101, 'SIGCONT'], [103, 'SIGCONT']]);
    expect(saved(files)).toEqual([]);
    expect(s.frozenCount()).toBe(0);
  });

  it('killTree kills in order and drops pids from the frozen set', () => {
    const { s, calls, files } = setup({ 101: 10, 102: 20, 103: 30 });
    s.freeze([{ pid: 101, startTicks: 10 }, { pid: 102, startTicks: 20 }, { pid: 103, startTicks: 30 }]);
    calls.length = 0;
    const n = s.killTree({ pids: [102, 101] }, new Map([[101, 10], [102, 20]]));
    expect(n).toBe(2);
    expect(calls).toEqual([[102, 'SIGKILL'], [101, 'SIGKILL']]);
    expect(s.frozenCount()).toBe(1);
    expect(saved(files)).toEqual([{ pid: 103, startTicks: 30 }]);
  });

  it('killTree does not rewrite the file when nothing was frozen', () => {
    const { s, files } = setup({ 101: 10 });
    s.killTree({ pids: [101] }, new Map([[101, 10]]));
    expect(files.has('/p.json')).toBe(false);
  });

  it('swallows ESRCH and EPERM', () => {
    const { s, setKill } = setup({ 101: 10, 102: 20 });
    setKill((pid) => { throw Object.assign(new Error('x'), { code: pid === 101 ? 'ESRCH' : 'EPERM' }); });
    expect(s.freeze([{ pid: 101, startTicks: 10 }, { pid: 102, startTicks: 20 }])).toBe(0);
    expect(() => s.thawAll()).not.toThrow();
    expect(() => s.killTree({ pids: [101, 102] }, new Map([[101, 10], [102, 20]]))).not.toThrow();
  });

  it('recoverFromCrash continues only matching pids and clears the file', () => {
    const file = JSON.stringify([{ pid: 105, startTicks: 50 }, { pid: 106, startTicks: 60 }]);
    const { s, calls, files } = setup({ 105: 50, 106: 61 }, file);
    expect(s.recoverFromCrash()).toBe(1);
    expect(calls).toEqual([[105, 'SIGCONT']]);
    expect(saved(files)).toEqual([]);
  });

  it('missing or corrupt persist file reads as empty', () => {
    expect(setup({}).s.recoverFromCrash()).toBe(0);
    expect(setup({}, '{not json').s.recoverFromCrash()).toBe(0);
  });
});

describe('Signaller failure handling', () => {
  const eperm = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };

  it('keeps a pid whose SIGCONT was refused, then retries it', () => {
    const { s, files, setKill } = setup({ 101: 10 });
    s.freeze([{ pid: 101, startTicks: 10 }]);
    setKill(eperm);
    expect(s.thawAll()).toBe(0);
    expect(s.frozenCount()).toBe(1);
    expect(saved(files)).toEqual([{ pid: 101, startTicks: 10 }]);
    setKill(() => {});
    expect(s.thawAll()).toBe(1);
    expect(s.frozenCount()).toBe(0);
    expect(saved(files)).toEqual([]);
  });

  it('keeps a pid whose SIGKILL was refused', () => {
    const { s, files, setKill } = setup({ 101: 10 });
    s.freeze([{ pid: 101, startTicks: 10 }]);
    setKill(eperm);
    expect(s.killTree({ pids: [101] }, new Map([[101, 10]]))).toBe(0);
    expect(saved(files)).toEqual([{ pid: 101, startTicks: 10 }]);
  });

  it('recoverFromCrash keeps refused entries for a later thawAll', () => {
    const { s, files, setKill } = setup({ 105: 50 }, JSON.stringify([{ pid: 105, startTicks: 50 }]));
    setKill(eperm);
    expect(s.recoverFromCrash()).toBe(0);
    expect(s.frozenCount()).toBe(1);
    expect(saved(files)).toEqual([{ pid: 105, startTicks: 50 }]);
    setKill(() => {});
    expect(s.thawAll()).toBe(1);
    expect(saved(files)).toEqual([]);
  });

  it('thawAll drops and does not signal a reused pid', () => {
    const live: Record<number, number> = { 101: 10 };
    const { s, calls, files } = setup(live);
    s.freeze([{ pid: 101, startTicks: 10 }]);
    calls.length = 0;
    live[101] = 11;
    expect(s.thawAll()).toBe(0);
    expect(calls).toEqual([]);
    expect(saved(files)).toEqual([]);
  });

  it('killTree skips a reused pid and a pid missing from the ticks map', () => {
    const { s, calls } = setup({ 101: 10, 102: 20 });
    expect(s.killTree({ pids: [101, 102] }, new Map([[101, 99]]))).toBe(0);
    expect(calls).toEqual([]);
  });

  it('never signals pid <= 1', () => {
    const { s, calls } = setup({ 0: 1, 1: 1 }, JSON.stringify([{ pid: 1, startTicks: 1 }]));
    expect(s.freeze([{ pid: 1, startTicks: 1 }, { pid: 0, startTicks: 1 }])).toBe(0);
    expect(s.recoverFromCrash()).toBe(0);
    expect(s.killTree({ pids: [1] }, new Map([[1, 1]]))).toBe(0);
    expect(calls).toEqual([]);
  });

  it('persists intent before SIGSTOP and removes pids that vanish', () => {
    const { s, files, setKill } = setup({ 101: 10, 102: 20 });
    let atFirstKill: unknown;
    setKill((pid) => {
      if (atFirstKill === undefined) atFirstKill = saved(files);
      if (pid === 102) throw Object.assign(new Error('x'), { code: 'ESRCH' });
    });
    expect(s.freeze([{ pid: 101, startTicks: 10 }, { pid: 102, startTicks: 20 }])).toBe(1);
    expect(atFirstKill).toHaveLength(2);
    expect(saved(files)).toEqual([{ pid: 101, startTicks: 10 }]);
  });
});

describe('readStartTicks', () => {
  const fields = (n: number) => `S 1 1 1 0 -1 4194560 100 0 0 0 5 6 0 0 20 0 1 0 ${n} 1000 50`;
  function root(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'procroot-'));
    fs.mkdirSync(path.join(dir, '42'));
    fs.writeFileSync(path.join(dir, '42', 'stat'), content);
    return dir;
  }

  it('handles spaces in comm', () => {
    expect(readStartTicks(42, root(`42 (a b) ${fields(777)}\n`))).toBe(777);
  });
  it('handles parens in comm', () => {
    expect(readStartTicks(42, root(`42 (x) y) ${fields(888)}\n`))).toBe(888);
  });
  it('returns null for garbage', () => {
    expect(readStartTicks(42, root('garbage'))).toBeNull();
    expect(readStartTicks(42, root('42 (a) S 1'))).toBeNull();
  });
  it('returns null for a missing pid', () => {
    expect(readStartTicks(999999999)).toBeNull();
  });
});

describe('recoverOrphanedFrozenFiles', () => {
  // SAFETY: fake kill and fake start ticks; only a tmpdir is touched.
  function dir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lg-orphans-'));
  }
  const write = (d: string, name: string, list: unknown) => fs.writeFileSync(path.join(d, name), JSON.stringify(list));

  it('names files per instance', () => {
    expect(frozenFileName(4242, 777)).toBe('loadguard-frozen-4242-777.json');
  });

  it('leaves a live owner\'s file alone, recovers and deletes a dead owner\'s file and the legacy file', () => {
    const d = dir();
    try {
      write(d, frozenFileName(10, 1000), [{ pid: 50, startTicks: 5 }]); // live owner
      write(d, frozenFileName(20, 2000), [{ pid: 60, startTicks: 6 }, { pid: 61, startTicks: 99 }]); // dead owner
      write(d, 'loadguard-frozen.json', [{ pid: 70, startTicks: 7 }]); // legacy: always orphaned
      write(d, 'unrelated.json', [{ pid: 80, startTicks: 8 }]);
      const live: Record<number, number> = { 10: 1000, 20: 2001 /* pid reused */, 50: 5, 60: 6, 61: 1, 70: 7, 80: 8 };
      const calls: Array<[number, string]> = [];
      const r = recoverOrphanedFrozenFiles(d, { kill: (pid, sig) => { calls.push([pid, sig]); }, startTicksOf: pid => live[pid] ?? null });
      expect(calls.sort()).toEqual([[60, 'SIGCONT'], [70, 'SIGCONT']]);
      expect(r).toEqual({ resumed: 2, files: 2 });
      expect(fs.readdirSync(d).sort()).toEqual([frozenFileName(10, 1000), 'unrelated.json'].sort());
      expect(JSON.parse(fs.readFileSync(path.join(d, frozenFileName(10, 1000)), 'utf8'))).toEqual([{ pid: 50, startTicks: 5 }]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('keeps an orphan file whose SIGCONT was refused, for the next boot', () => {
    const d = dir();
    try {
      write(d, frozenFileName(20, 2000), [{ pid: 60, startTicks: 6 }]);
      const r = recoverOrphanedFrozenFiles(d, {
        kill: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); },
        startTicksOf: pid => (pid === 60 ? 6 : null),
      });
      expect(r.resumed).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(d, frozenFileName(20, 2000)), 'utf8'))).toEqual([{ pid: 60, startTicks: 6 }]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('never throws on a missing dir', () => {
    expect(recoverOrphanedFrozenFiles('/nonexistent-lg-dir', { kill: () => {}, startTicksOf: () => null })).toEqual({ resumed: 0, files: 0 });
  });
});

describe('Signaller.isFrozen', () => {
  it('reports only pids actually stopped', () => {
    const { s, setKill } = setup({ 101: 10, 102: 20 });
    setKill((pid) => { if (pid === 102) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
    s.freeze([{ pid: 101, startTicks: 10 }, { pid: 102, startTicks: 20 }]);
    expect(s.isFrozen(101)).toBe(true);
    expect(s.isFrozen(102)).toBe(false);
  });
});
