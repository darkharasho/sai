// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
  Signaller, defaultSignalDeps, readProcState, readStartTicks, recoverOrphanedFrozenFiles, frozenFileName,
  type SignalDeps,
} from '../../../../electron/services/loadGuard/signals';

// SAFETY: only a fake kill and an in-memory fs are ever used here.
function setup(live: Record<number, number>, initialFile?: string, extra: Partial<SignalDeps> = {}) {
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
      unlinkSync: ((f: string) => {
        if (!files.delete(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }) as never,
    },
    ...extra,
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

  it('thawAll sends SIGCONT in reverse freeze order and removes the file', () => {
    const { s, calls, files } = setup({ 101: 10, 103: 30 });
    s.freeze([{ pid: 101, startTicks: 10 }, { pid: 103, startTicks: 30 }]);
    calls.length = 0;
    expect(s.thawAll()).toBe(2);
    expect(calls).toEqual([[103, 'SIGCONT'], [101, 'SIGCONT']]);
    expect(files.has('/p.json')).toBe(false);
    expect(s.frozenCount()).toBe(0);
  });

  it('thawAll with nothing ever frozen (clean stop) leaves no file', () => {
    const { s, files } = setup({}, '[]');
    s.thawAll();
    expect(files.has('/p.json')).toBe(false);
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
    expect(files.has('/p.json')).toBe(false);
  });

  it('recoverFromCrash resumes in reverse file order (descendants first)', () => {
    const file = JSON.stringify([{ pid: 105, startTicks: 50 }, { pid: 106, startTicks: 60 }, { pid: 107, startTicks: 70 }]);
    const { s, calls } = setup({ 105: 50, 106: 60, 107: 70 }, file);
    s.recoverFromCrash();
    expect(calls.map(c => c[0])).toEqual([107, 106, 105]);
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

  it('#16: EPERM on SIGCONT then EPERM on the re-SIGSTOP keeps the pid tracked; a later thawAll continues it', () => {
    const { s, calls, files, setKill } = setup({ 101: 10 });
    s.freeze([{ pid: 101, startTicks: 10 }]);
    setKill(eperm);
    expect(s.thawAll()).toBe(0);
    expect(s.freeze([{ pid: 101, startTicks: 10 }])).toBe(0);
    expect(s.isFrozen(101)).toBe(true);
    expect(saved(files)).toEqual([{ pid: 101, startTicks: 10 }]);
    setKill(() => {});
    calls.length = 0;
    expect(s.thawAll()).toBe(1);
    expect(calls).toEqual([[101, 'SIGCONT']]);
    expect(s.frozenCount()).toBe(0);
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

describe('Signaller freeze/thaw tree order', () => {
  // parent 200 -> child 201 -> grandchild 202, plus an unrelated 300; passed descendants-first like AiUnit.pids
  const chain = [
    { pid: 202, startTicks: 22, ppid: 201 },
    { pid: 201, startTicks: 21, ppid: 200 },
    { pid: 300, startTicks: 30, ppid: 1 },
    { pid: 200, startTicks: 20, ppid: 100 },
  ];
  const live = { 200: 20, 201: 21, 202: 22, 300: 30 };

  /** fake /proc state: a pid reads 'T' once it has been SIGSTOPped `lag` polls ago */
  function withState(lag: number, neverStops: number[] = []) {
    const log: Array<[string, unknown]> = [];
    const events: string[] = [];
    const stoppedAt = new Map<number, number>();
    let polls = 0;
    const r = setup(live, undefined, {
      stateOf: pid => {
        events.push(`state:${pid}`);
        const at = stoppedAt.get(pid);
        return at !== undefined && polls - at >= lag && !neverStops.includes(pid) ? 'T' : 'S';
      },
      sleepMs: () => { polls++; },
      log: (e, d) => { log.push([e, d]); },
    });
    r.setKill((pid, sig) => {
      events.push(`${sig}:${pid}`);
      if (sig === 'SIGSTOP') stoppedAt.set(pid, polls);
    });
    /** a replacement kill that still lets SIGSTOPped pids read T */
    const killWith = (refuse: (pid: number, sig: string) => boolean) => r.setKill((pid, sig) => {
      if (refuse(pid, sig)) throw Object.assign(new Error('x'), { code: 'EPERM' });
      if (sig === 'SIGSTOP') stoppedAt.set(pid, polls);
    });
    return { ...r, log, events, polls: () => polls, killWith };
  }

  it('freezes ancestor-first and waits for each parent to read T before signalling its children', () => {
    const { s, events, log } = withState(3);
    expect(s.freeze(chain)).toBe(4);
    const sig = events.filter(e => e.startsWith('SIG'));
    expect(sig).toEqual(['SIGSTOP:300', 'SIGSTOP:200', 'SIGSTOP:201', 'SIGSTOP:202']);
    // 201 is only signalled after 200 was observed stopped, 202 after 201
    const idx = (e: string) => events.indexOf(e);
    const lastState = (pid: number, before: string) => events.slice(0, idx(before)).lastIndexOf(`state:${pid}`);
    expect(lastState(200, 'SIGSTOP:201')).toBeGreaterThan(idx('SIGSTOP:200'));
    expect(lastState(201, 'SIGSTOP:202')).toBeGreaterThan(idx('SIGSTOP:201'));
    expect(log).toEqual([]);
  });

  it('thaws descendant-first, ancestors last', () => {
    const { s, calls } = withState(0);
    s.freeze(chain);
    calls.length = 0;
    expect(s.thawAll()).toBe(4);
    expect(calls).toEqual([[202, 'SIGCONT'], [201, 'SIGCONT'], [200, 'SIGCONT'], [300, 'SIGCONT']]);
  });

  it('persists the frozen set ancestor-first so crash recovery resumes descendants first', () => {
    const { s, files } = withState(0);
    s.freeze(chain);
    expect(saved(files).map((p: { pid: number }) => p.pid)).toEqual([300, 200, 201, 202]);
  });

  it('I3: a parent that never reads T defers its children (bounded, devlog); unconfirmed twice in a row, they freeze', () => {
    const { s, events, log, polls } = withState(0, [200]);
    expect(s.freeze(chain)).toBe(2);
    expect(events.filter(e => e.startsWith('SIG'))).toEqual(['SIGSTOP:300', 'SIGSTOP:200']);
    expect([200, 201, 202].map(p => s.isFrozen(p))).toEqual([true, false, false]);
    expect(log).toEqual([['freeze_parent_unconfirmed', { pids: [200], budgetSpent: true }]]);
    expect(polls()).toBe(60);
    events.length = 0;
    // next tick: the guard re-offers only the unfrozen pids; 200 (stopped earlier) still isn't T
    expect(s.freeze(chain.filter(p => p.pid === 201 || p.pid === 202))).toBe(2);
    expect(events.filter(e => e.startsWith('SIG'))).toEqual(['SIGSTOP:201', 'SIGSTOP:202']);
    expect(events.indexOf('state:200')).toBeLessThan(events.indexOf('SIGSTOP:201'));
  });

  it('I3: stateOf reading S for the whole budget: the child is deferred on call 1 and stopped by call 3', () => {
    let polls = 0;
    const { s, calls } = setup({ 200: 20, 201: 21 }, undefined, { stateOf: () => 'S', sleepMs: () => { polls++; } });
    const parent = { pid: 200, startTicks: 20, ppid: 100 };
    const child = { pid: 201, startTicks: 21, ppid: 200 };
    expect(s.freeze([child, parent])).toBe(1);
    expect(calls).toEqual([[200, 'SIGSTOP']]);
    expect(s.isFrozen(201)).toBe(false);
    for (let call = 2; call <= 3 && !s.isFrozen(201); call++) s.freeze([child]);
    expect(s.isFrozen(201)).toBe(true);
    expect(calls).toEqual([[200, 'SIGSTOP'], [201, 'SIGSTOP']]);
  });

  it('I3: a parent stopped on an earlier call that now reads T lets its child freeze at once', () => {
    let parentState = 'S';
    const { s, calls } = setup({ 200: 20, 201: 21 }, undefined, { stateOf: pid => (pid === 200 ? parentState : 'S'), sleepMs: () => {} });
    s.freeze([{ pid: 201, startTicks: 21, ppid: 200 }, { pid: 200, startTicks: 20, ppid: 100 }]);
    parentState = 'T';
    calls.length = 0;
    expect(s.freeze([{ pid: 201, startTicks: 21, ppid: 200 }])).toBe(1);
    expect(calls).toEqual([[201, 'SIGSTOP']]);
  });

  it('one confirm budget per call: a never-confirming chain spends it once, defers the rest, one devlog', () => {
    const deep = [500, 501, 502, 503].map((pid, i) => ({ pid, startTicks: pid, ppid: i === 0 ? 1 : pid - 1 }));
    const log: Array<[string, unknown]> = [];
    let polls = 0;
    const { s, calls } = setup({ 500: 500, 501: 501, 502: 502, 503: 503 }, undefined, {
      stateOf: () => 'S', sleepMs: () => { polls++; }, log: (e, d) => { log.push([e, d]); },
    });
    expect(s.freeze(deep)).toBe(1);
    expect(calls.map(c => c[0])).toEqual([500]);
    expect(polls).toBe(60);
    expect(log).toEqual([['freeze_parent_unconfirmed', { pids: [500], budgetSpent: true }]]);
    // each later call gets one level further; nothing waits past one budget per call
    for (let i = 0; i < 3; i++) s.freeze(deep.filter(p => !s.isFrozen(p.pid)));
    expect(calls.map(c => c[0])).toEqual([500, 501, 502, 503]);
    expect(polls).toBe(60 * 4);
  });

  it('a D-state parent is not waited on', () => {
    const log: Array<[string, unknown]> = [];
    let polls = 0;
    const { s } = setup(live, undefined, {
      stateOf: pid => (pid === 200 ? 'D' : 'T'), sleepMs: () => { polls++; }, log: (e, d) => { log.push([e, d]); },
    });
    expect(s.freeze(chain)).toBe(4);
    expect(polls).toBe(0);
    expect(log).toEqual([['freeze_parent_unconfirmed', { pids: [200], budgetSpent: false }]]);
  });

  it('a refused parent defers its descendants to the next call; refused twice in a row, they freeze anyway', () => {
    const { s, calls, killWith } = withState(0);
    killWith((pid, sig) => pid === 200 && sig === 'SIGSTOP');
    expect(s.freeze(chain)).toBe(1);
    expect(calls).toEqual([[300, 'SIGSTOP'], [200, 'SIGSTOP']]);
    expect([200, 201, 202].map(p => s.isFrozen(p))).toEqual([false, false, false]);
    calls.length = 0;
    // next tick offers the unfrozen pids again; 200 is refused a second time in a row
    expect(s.freeze(chain.filter(p => p.pid !== 300))).toBe(2);
    expect(calls).toEqual([[200, 'SIGSTOP'], [201, 'SIGSTOP'], [202, 'SIGSTOP']]);
    expect([201, 202].map(p => s.isFrozen(p))).toEqual([true, true]);
  });

  it('a refused parent on a non-consecutive call defers again', () => {
    const { s, calls, setKill } = withState(0);
    let refuse = true;
    setKill((pid, sig) => {
      if (refuse && pid === 200 && sig === 'SIGSTOP') throw Object.assign(new Error('x'), { code: 'EPERM' });
    });
    s.freeze(chain);
    refuse = false;
    s.freeze([{ pid: 300, startTicks: 30, ppid: 1 }]); // an unrelated call in between resets the streak
    refuse = true;
    calls.length = 0;
    s.freeze(chain.filter(p => p.pid !== 300));
    expect(calls).toEqual([[200, 'SIGSTOP']]);
  });

  it('a refused descendant SIGCONT holds back its ancestors, then the retry thaws them bottom-up', () => {
    const { s, calls, setKill } = withState(0);
    s.freeze(chain);
    calls.length = 0;
    setKill((pid, sig) => {
      if (pid === 202 && sig === 'SIGCONT') throw Object.assign(new Error('x'), { code: 'EPERM' });
    });
    expect(s.thawAll()).toBe(1);
    expect(calls).toEqual([[202, 'SIGCONT'], [300, 'SIGCONT']]);
    expect([200, 201, 202, 300].map(p => s.isFrozen(p))).toEqual([true, true, true, false]);
    calls.length = 0;
    setKill(() => {});
    expect(s.thawAll()).toBe(3);
    expect(calls).toEqual([[202, 'SIGCONT'], [201, 'SIGCONT'], [200, 'SIGCONT']]);
  });

  it('thaws across ticks: a child frozen on a later tick resumes before its parent', () => {
    const { s, calls } = withState(0);
    s.freeze([{ pid: 200, startTicks: 20, ppid: 100 }, { pid: 300, startTicks: 30, ppid: 1 }]);
    s.freeze([{ pid: 201, startTicks: 21, ppid: 200 }]);
    s.freeze([{ pid: 202, startTicks: 22, ppid: 201 }]);
    calls.length = 0;
    s.thawAll();
    expect(calls.map(c => c[0])).toEqual([202, 201, 300, 200]);
  });

  it('a parent that exits mid-freeze counts as settled', () => {
    const { s } = setup(live, undefined, {
      stateOf: () => null,
      sleepMs: () => { throw new Error('no sleep needed'); },
      log: () => { throw new Error('no log expected'); },
    });
    expect(s.freeze(chain)).toBe(4);
  });

  it('a ppid cycle does not hang', () => {
    const { s } = setup({ 400: 40, 401: 41 });
    expect(s.freeze([{ pid: 400, startTicks: 40, ppid: 401 }, { pid: 401, startTicks: 41, ppid: 400 }])).toBe(2);
  });
});

describe('readProcState', () => {
  it('reads the state letter after the last paren', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'procstate-'));
    try {
      fs.mkdirSync(path.join(dir, '42'));
      fs.writeFileSync(path.join(dir, '42', 'stat'), '42 (a) b) T 1 1 1\n');
      expect(readProcState(42, dir)).toBe('T');
      expect(readProcState(43, dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// SAFETY: real signals, but only to a tiny `bash -c 'sleep; echo'` this test spawns itself.
// End-to-end HEALTH SMOKE, not the regression guard: an in-process back-to-back SIGSTOP lands
// on bash before it can reap, so the pre-fix order passes here too. The deterministic guard
// for R18 is the fake-/proc ordering suite above.
describe.skipIf(process.platform !== 'linux')('Signaller on a real bash -c wrapper (health smoke)', () => {
  const childOf = (ppid: number): number | null => {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
        if (Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]) === ppid) return Number(d);
      } catch { /* exited */ }
    }
    return null;
  };

  it('freeze then thaw does not fail the wrapped command', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-real-'));
    const sh = spawn('bash', ['-c', 'sleep 1; echo ok'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    sh.stdout!.on('data', d => { out += d; });
    const exited = new Promise<number | null>(res => sh.on('exit', code => res(code)));
    let kid: number | null = null;
    try {
      for (let i = 0; i < 100 && kid === null; i++) {
        await new Promise(r => setTimeout(r, 10));
        kid = childOf(sh.pid!);
      }
      expect(kid).not.toBeNull();
      const s = new Signaller(defaultSignalDeps(path.join(dir, 'f.json')));
      const t = (pid: number) => readStartTicks(pid)!;
      // descendants-first input, like AiUnit.pids
      expect(s.freeze([{ pid: kid!, startTicks: t(kid!), ppid: sh.pid! }, { pid: sh.pid!, startTicks: t(sh.pid!), ppid: process.pid }])).toBe(2);
      await new Promise(r => setTimeout(r, 300));
      expect(s.thawAll()).toBe(2);
      expect(await exited).toBe(0);
      expect(out.trim()).toBe('ok');
      expect(fs.existsSync(path.join(dir, 'f.json'))).toBe(false);
    } finally {
      for (const pid of [kid, sh.pid]) {
        try { if (pid) { process.kill(pid, 'SIGCONT'); process.kill(pid, 'SIGKILL'); } } catch { /* exited */ }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);
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

  it('orders recovery by live /proc ppids, so an old descendants-first file still resumes leaves first', () => {
    const d = dir();
    try {
      // pre-fix builds persisted the input order: descendants first, no ppid
      write(d, frozenFileName(20, 2000), [{ pid: 62, startTicks: 2 }, { pid: 61, startTicks: 1 }, { pid: 60, startTicks: 0 }]);
      const live: Record<number, number> = { 60: 0, 61: 1, 62: 2 };
      const ppid: Record<number, number> = { 60: 1, 61: 60, 62: 61 };
      const calls: number[] = [];
      recoverOrphanedFrozenFiles(d, {
        kill: pid => { calls.push(pid); }, startTicksOf: pid => live[pid] ?? null, ppidOf: pid => ppid[pid] ?? null,
      });
      expect(calls).toEqual([62, 61, 60]);
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
