import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stub = vi.hoisted(() => {
  let nextId = 100;
  const state = {
    writes: [] as Array<{ termId: number; data: string }>,
    resizes: [] as Array<{ termId: number; cols: number; rows: number }>,
    signals: [] as Array<{ termId: number; sig: NodeJS.Signals }>,
    kills: [] as number[],
    dataCbs: new Map<number, (s: string) => void>(),
    exitCbs: new Map<number, (n: number) => void>(),
    getNextId: () => nextId++,
  };
  return state;
});

vi.mock('@electron/services/pty', () => ({
  createTerminalImpl: (opts: any) => {
    const termId = stub.getNextId();
    stub.dataCbs.set(termId, opts.onData);
    stub.exitCbs.set(termId, opts.onExit);
    return { termId, pty: { pid: 9000 + termId } };
  },
  writeTerminalImpl: (termId: number, data: string) => stub.writes.push({ termId, data }),
  resizeTerminalImpl: (termId: number, cols: number, rows: number) =>
    stub.resizes.push({ termId, cols, rows }),
  signalTerminalImpl: (termId: number, sig: NodeJS.Signals) =>
    stub.signals.push({ termId, sig }),
  killTerminalImpl: (termId: number) => stub.kills.push(termId),
}));

import { PhoneTerminalRegistry } from '@electron/services/remote/terminal-store';

const ptyStub = () => stub;

describe('PhoneTerminalRegistry — basic lifecycle', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => { reg = new PhoneTerminalRegistry(); });
  afterEach(() => { reg.destroyAll(); });

  it('open() returns a PhoneTerminal with cwd/cols/rows + alive', () => {
    const t = reg.open('/repo', 80, 24);
    expect(t.cwd).toBe('/repo');
    expect(t.cols).toBe(80);
    expect(t.rows).toBe(24);
    expect(t.termId).toBeGreaterThan(0);
    expect(reg.list().map((x) => x.termId)).toContain(t.termId);
  });

  it('list() filters by cwd', () => {
    reg.open('/a', 80, 24);
    reg.open('/b', 80, 24);
    expect(reg.list('/a')).toHaveLength(1);
    expect(reg.list('/b')).toHaveLength(1);
    expect(reg.list()).toHaveLength(2);
  });

  it('input/resize/signal/kill delegate to impls', () => {
    const t = reg.open('/r', 80, 24);
    reg.input(t.termId, 'ls\n');
    reg.resize(t.termId, 120, 40);
    reg.signal(t.termId, 'SIGINT');
    reg.kill(t.termId);
    const s = ptyStub();
    expect(s.writes).toContainEqual({ termId: t.termId, data: 'ls\n' });
    expect(s.resizes).toContainEqual({ termId: t.termId, cols: 120, rows: 40 });
    expect(s.signals).toContainEqual({ termId: t.termId, sig: 'SIGINT' });
    expect(s.kills).toContain(t.termId);
    expect(reg.list()).toHaveLength(0);
  });

  it('clamps cols/rows to a minimum on open', () => {
    const t = reg.open('/r', 5, 1);
    expect(t.cols).toBeGreaterThanOrEqual(20);
    expect(t.rows).toBeGreaterThanOrEqual(5);
  });
});
