// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Signaller, readStartTicks } from '../../../../electron/services/loadGuard/signals';

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
    },
  });
  return { s, calls, files, setKill: (f: typeof killImpl) => { killImpl = f; } };
}
const saved = (files: Map<string, string>) => JSON.parse(files.get('/p.json') ?? '[]');

describe('Signaller', () => {
  it('freeze skips mismatched ticks and persists the rest', () => {
    const { s, calls, files } = setup({ 1: 10, 2: 20, 3: 30 });
    const n = s.freeze([{ pid: 1, startTicks: 10 }, { pid: 2, startTicks: 99 }, { pid: 3, startTicks: 30 }]);
    expect(n).toBe(2);
    expect(calls).toEqual([[1, 'SIGSTOP'], [3, 'SIGSTOP']]);
    expect(saved(files)).toHaveLength(2);
    expect(s.frozenCount()).toBe(2);
  });

  it('thawAll sends SIGCONT and clears the file', () => {
    const { s, calls, files } = setup({ 1: 10, 3: 30 });
    s.freeze([{ pid: 1, startTicks: 10 }, { pid: 3, startTicks: 30 }]);
    calls.length = 0;
    expect(s.thawAll()).toBe(2);
    expect(calls).toEqual([[1, 'SIGCONT'], [3, 'SIGCONT']]);
    expect(saved(files)).toEqual([]);
    expect(s.frozenCount()).toBe(0);
  });

  it('killTree kills in order and drops pids from the frozen set', () => {
    const { s, calls, files } = setup({ 1: 10, 2: 20, 3: 30 });
    s.freeze([{ pid: 1, startTicks: 10 }, { pid: 2, startTicks: 20 }, { pid: 3, startTicks: 30 }]);
    calls.length = 0;
    const n = s.killTree({ pids: [2, 1] }, new Map([[1, 10], [2, 20]]));
    expect(n).toBe(2);
    expect(calls).toEqual([[2, 'SIGKILL'], [1, 'SIGKILL']]);
    expect(s.frozenCount()).toBe(1);
    expect(saved(files)).toEqual([{ pid: 3, startTicks: 30 }]);
  });

  it('killTree does not rewrite the file when nothing was frozen', () => {
    const { s, files } = setup({ 1: 10 });
    s.killTree({ pids: [1] }, new Map([[1, 10]]));
    expect(files.has('/p.json')).toBe(false);
  });

  it('swallows ESRCH and EPERM', () => {
    const { s, setKill } = setup({ 1: 10, 2: 20 });
    setKill((pid) => { throw Object.assign(new Error('x'), { code: pid === 1 ? 'ESRCH' : 'EPERM' }); });
    expect(s.freeze([{ pid: 1, startTicks: 10 }, { pid: 2, startTicks: 20 }])).toBe(0);
    expect(() => s.thawAll()).not.toThrow();
    expect(() => s.killTree({ pids: [1, 2] }, new Map([[1, 10], [2, 20]]))).not.toThrow();
  });

  it('recoverFromCrash continues only matching pids and clears the file', () => {
    const file = JSON.stringify([{ pid: 5, startTicks: 50 }, { pid: 6, startTicks: 60 }]);
    const { s, calls, files } = setup({ 5: 50, 6: 61 }, file);
    expect(s.recoverFromCrash()).toBe(1);
    expect(calls).toEqual([[5, 'SIGCONT']]);
    expect(saved(files)).toEqual([]);
  });

  it('missing or corrupt persist file reads as empty', () => {
    expect(setup({}).s.recoverFromCrash()).toBe(0);
    expect(setup({}, '{not json').s.recoverFromCrash()).toBe(0);
  });
});

describe('readStartTicks', () => {
  it('returns null for a missing pid', () => {
    expect(readStartTicks(999999999)).toBeNull();
  });
});
