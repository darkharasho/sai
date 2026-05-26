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
    // New for P5.1: shared desktop terminal stubs.
    desktopTerms: new Map<number, { cwd: string; cols: number; rows: number; alive: boolean }>(),
    desktopRings: new Map<number, string>(),
    desktopSubs: new Map<number, Set<(s: string) => void>>(),
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
  // P5.1: desktop bridge surface.
  snapshotTerminal: (termId: number) => stub.desktopRings.get(termId) ?? '',
  subscribeTerminal: (termId: number, cb: (s: string) => void) => {
    let set = stub.desktopSubs.get(termId);
    if (!set) { set = new Set(); stub.desktopSubs.set(termId, set); }
    set.add(cb);
    return () => { set?.delete(cb); };
  },
  listDesktopTerminals: () => [...stub.desktopTerms.entries()].map(([termId, t]) => ({
    termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive,
  })),
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

describe('PhoneTerminalRegistry — attach/detach + replay', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => { reg = new PhoneTerminalRegistry(); });
  afterEach(() => { reg.destroyAll(); });

  function fakeWs(): any {
    const sent: string[] = [];
    return {
      OPEN: 1,
      readyState: 1,
      send: (s: string) => sent.push(s),
      __sent: sent,
    };
  }

  it('attach() returns ring snapshot + dims; resizes PTY to client dims', () => {
    const t = reg.open('/r', 80, 24);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('first ');
    onData('second\n');

    const ws = fakeWs();
    const r = reg.attach(t.termId, ws, 100, 30);
    expect(r).not.toBeNull();
    expect(r!.replay).toBe('first second\n');
    expect(r!.cols).toBe(100);
    expect(r!.rows).toBe(30);
    expect(ptyStub().resizes).toContainEqual({ termId: t.termId, cols: 100, rows: 30 });
  });

  it('streams subsequent output to the attached client only', () => {
    const t = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(t.termId, ws, 80, 24);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('live\n');
    expect(ws.__sent.some((s: string) => s.includes('"terminal.output"') && s.includes('live'))).toBe(true);
  });

  it('attach with a new ws displaces the previous attached client', () => {
    const t = reg.open('/r', 80, 24);
    const wsA = fakeWs(); const wsB = fakeWs();
    reg.attach(t.termId, wsA, 80, 24);
    reg.attach(t.termId, wsB, 80, 24);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('after-swap');
    expect(wsA.__sent.some((s: string) => s.includes('after-swap'))).toBe(false);
    expect(wsB.__sent.some((s: string) => s.includes('after-swap'))).toBe(true);
  });

  it('detach stops live output but keeps PTY alive + ring filling', () => {
    const t = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(t.termId, ws, 80, 24);
    reg.detach(t.termId, ws);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('buffered\n');
    expect(ws.__sent.some((s: string) => s.includes('buffered'))).toBe(false);
    const ws2 = fakeWs();
    const r = reg.attach(t.termId, ws2, 80, 24);
    expect(r!.replay).toContain('buffered\n');
  });

  it('detachAll(ws) detaches every term the ws was attached to', () => {
    const a = reg.open('/r', 80, 24);
    const b = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(a.termId, ws, 80, 24);
    reg.attach(b.termId, ws, 80, 24);
    reg.detachAll(ws);
    ptyStub().dataCbs.get(a.termId)!('xa');
    ptyStub().dataCbs.get(b.termId)!('xb');
    expect(ws.__sent.some((s: string) => s.includes('xa') || s.includes('xb'))).toBe(false);
  });

  it('attach returns null for an unknown termId', () => {
    const ws = fakeWs();
    expect(reg.attach(9999, ws, 80, 24)).toBeNull();
  });
});

describe('PhoneTerminalRegistry — idle GC + destroyAll', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => {
    reg = new PhoneTerminalRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    reg.destroyAll();
    vi.useRealTimers();
  });

  it('destroyAll() kills every entry', () => {
    const a = reg.open('/r', 80, 24);
    const b = reg.open('/r', 80, 24);
    reg.destroyAll();
    expect(reg.list()).toHaveLength(0);
    expect(ptyStub().kills).toEqual(expect.arrayContaining([a.termId, b.termId]));
  });

  it('idle GC kills unattached terminals older than maxIdleMs', () => {
    vi.setSystemTime(1_000_000);
    let now = 1_000_000;
    reg.startIdleGc({ intervalMs: 1000, maxIdleMs: 5000, now: () => now });
    const a = reg.open('/r', 80, 24);
    // Detached from birth → lastAttachAt = 1_000_000
    now = 1_000_000 + 6000; // 6s later
    vi.advanceTimersByTime(1000);
    expect(reg.list().find((x) => x.termId === a.termId)).toBeUndefined();
    expect(ptyStub().kills).toContain(a.termId);
  });

  it('idle GC leaves attached terminals alone', () => {
    vi.setSystemTime(1_000_000);
    let now = 1_000_000;
    reg.startIdleGc({ intervalMs: 1000, maxIdleMs: 5000, now: () => now });
    const a = reg.open('/r', 80, 24);
    const ws: any = { OPEN: 1, readyState: 1, send: () => {} };
    reg.attach(a.termId, ws, 80, 24);
    now = 1_000_000 + 999_999;
    vi.advanceTimersByTime(1000);
    expect(reg.list().find((x) => x.termId === a.termId)).toBeDefined();
  });
});

describe('PhoneTerminalRegistry — shared desktop terminals', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => {
    reg = new PhoneTerminalRegistry();
    stub.desktopTerms.clear();
    stub.desktopRings.clear();
    stub.desktopSubs.clear();
    stub.writes.length = 0;
    stub.resizes.length = 0;
    stub.signals.length = 0;
    stub.kills.length = 0;
  });
  afterEach(() => { reg.destroyAll(); });

  function fakeWs(): any {
    const sent: string[] = [];
    return { OPEN: 1, readyState: 1, send: (s: string) => sent.push(s), __sent: sent };
  }

  it('list() merges phone + desktop summaries with origin tags', () => {
    const phone = reg.open('/repo', 80, 24);
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 100, rows: 30, alive: true });
    const all = reg.list();
    const phoneEntry = all.find((x) => x.termId === phone.termId)!;
    const desktopEntry = all.find((x) => x.termId === 7)!;
    expect(phoneEntry.origin).toBe('phone');
    expect(desktopEntry.origin).toBe('desktop');
    expect(desktopEntry.cwd).toBe('/repo');
    expect(desktopEntry.cols).toBe(100);
  });

  it('list(cwd) filters desktop terms by cwd', () => {
    stub.desktopTerms.set(7, { cwd: '/a', cols: 80, rows: 24, alive: true });
    stub.desktopTerms.set(8, { cwd: '/b', cols: 80, rows: 24, alive: true });
    expect(reg.list('/a').map((x) => x.termId)).toEqual([7]);
    expect(reg.list('/b').map((x) => x.termId)).toEqual([8]);
  });

  it('attach() for a desktop term returns the ring snapshot + desktop dims', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 132, rows: 50, alive: true });
    stub.desktopRings.set(7, 'previous output\n$ ');
    const ws = fakeWs();
    const r = reg.attach(7, ws, 80, 24);
    expect(r).not.toBeNull();
    expect(r!.replay).toBe('previous output\n$ ');
    expect(r!.cols).toBe(132);
    expect(r!.rows).toBe(50);
  });

  it('desktop attach subscribes to live output and forwards terminal.output frames', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    const ws = fakeWs();
    reg.attach(7, ws, 80, 24);
    const subs = stub.desktopSubs.get(7)!;
    expect(subs.size).toBe(1);
    // Fire the data callback as the pty would.
    for (const cb of subs) cb('live-byte');
    expect(ws.__sent.some((s: string) =>
      s.includes('"terminal.output"') && s.includes('"termId":7') && s.includes('live-byte'),
    )).toBe(true);
  });

  it('attach() returns null for an unknown termId (neither phone nor desktop)', () => {
    const ws = fakeWs();
    expect(reg.attach(9999, ws, 80, 24)).toBeNull();
  });

  it('does NOT resize the desktop PTY on attach (phone cols/rows ignored)', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 132, rows: 50, alive: true });
    const before = stub.resizes.length;
    reg.attach(7, fakeWs(), 80, 24);
    expect(stub.resizes.length).toBe(before); // no resize emitted
  });

  it('input() on a desktop term passes through allow-listed bytes', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    reg.input(7, '\x03');         // Ctrl+C
    reg.input(7, '\x1b');         // Esc
    reg.input(7, '\t');           // Tab
    reg.input(7, '\r');           // CR
    reg.input(7, '\n');           // LF
    reg.input(7, '\x1b[A');       // Up
    reg.input(7, '\x1b[B');       // Down
    reg.input(7, '\x1b[C');       // Right
    reg.input(7, '\x1b[D');       // Left
    expect(stub.writes.filter((w) => w.termId === 7).map((w) => w.data))
      .toEqual(['\x03', '\x1b', '\t', '\r', '\n', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);
  });

  it('input() on a desktop term drops printable characters silently', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    reg.input(7, 'a');
    reg.input(7, 'hello world');
    reg.input(7, '1');
    expect(stub.writes.filter((w) => w.termId === 7)).toHaveLength(0);
  });

  it('input() on a phone term is unfiltered (regression guard)', () => {
    const phone = reg.open('/repo', 80, 24);
    reg.input(phone.termId, 'hello\n');
    expect(stub.writes).toContainEqual({ termId: phone.termId, data: 'hello\n' });
  });

  it('resize() on a desktop term silently no-ops', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    const before = stub.resizes.length;
    reg.resize(7, 120, 40);
    expect(stub.resizes.length).toBe(before);
  });

  it('kill() on a desktop term throws (refused at the bridge layer)', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    expect(() => reg.kill(7)).toThrowError(/desktop/i);
    expect(stub.kills).not.toContain(7);
  });

  it('signal(SIGINT) on a desktop term forwards via signalTerminalImpl', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    reg.signal(7, 'SIGINT');
    expect(stub.signals).toContainEqual({ termId: 7, sig: 'SIGINT' });
  });

  it('signal() with non-SIGINT on a desktop term is ignored', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    const before = stub.signals.length;
    reg.signal(7, 'SIGTERM');
    expect(stub.signals.length).toBe(before);
  });

  it('detach(desktopTermId, ws) clears the per-ws subscriber', () => {
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    const ws = fakeWs();
    reg.attach(7, ws, 80, 24);
    expect(stub.desktopSubs.get(7)!.size).toBe(1);
    reg.detach(7, ws);
    expect(stub.desktopSubs.get(7)!.size).toBe(0);
  });

  it('detachAll(ws) clears both phone and desktop subscribers', () => {
    const phone = reg.open('/repo', 80, 24);
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
    const ws = fakeWs();
    reg.attach(phone.termId, ws, 80, 24);
    reg.attach(7, ws, 80, 24);
    reg.detachAll(ws);
    // Phone path: data callback should no longer send to ws.
    stub.dataCbs.get(phone.termId)!('x');
    // Desktop path: subscriber set empty.
    expect(stub.desktopSubs.get(7)!.size).toBe(0);
    expect(ws.__sent.some((s: string) => s.includes('"termId":' + phone.termId) && s.includes('"x"'))).toBe(false);
  });
});
