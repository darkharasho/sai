// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoadGuard, type LoadGuardDeps } from '../../../../electron/services/loadGuard/index';
import type { Level, ProcInfo, ScopeTag, SystemSample } from '../../../../electron/services/loadGuard/types';

// SAFETY: every dep is a fake. Nothing here reads /proc or signals a real process.

const GiB = 1024 * 1024;
const HZ = 100;
const T0 = 1_000_000_000; // ms; bootTimeSec 0, so startTicks = age-from-boot * HZ
const INSTANCE = 7;
const TOTAL = 32 * GiB;

const tag = (over: Partial<ScopeTag> = {}): ScopeTag => ({ instance: INSTANCE, provider: 'claude', projectPath: '/p', scope: 's1', ...over });
/** startTicks for a process `ageSec` old at T0 */
const started = (ageSec: number) => (T0 / 1000 - ageSec) * HZ;
const proc = (pid: number, ppid: number, over: Partial<ProcInfo> = {}): ProcInfo => ({
  pid, ppid, comm: `c${pid}`, cmd: `cmd${pid}`, startTicks: started(20), rssKb: 100 * 1024, swapKb: 0, cgroup: '', tag: null, ...over,
});

type Sys = Omit<SystemSample, 'gpu'>;
const sys = (availPct: number, over: Partial<Sys> = {}): Sys => ({
  ts: 0, memTotalKb: TOTAL, memAvailableKb: Math.round(TOTAL * availPct / 100), swapTotalKb: 8 * GiB, swapFreeKb: 8 * GiB,
  psiMemSome10: 0, psiMemFull10: 0, psiCpuSome10: 0, ...over,
});
const NORMAL = () => sys(50);
const WARNING = () => sys(15);
const CRITICAL = () => sys(3);

/** agent 100 (300 MB) with a small command 101 and a big untagged pid 500 */
const smallSai = (): ProcInfo[] => [
  proc(1, 0, { comm: 'systemd' }),
  proc(100, 1, { cmd: 'claude', rssKb: 300 * 1024, tag: tag() }),
  proc(101, 100, { cmd: 'npm test', rssKb: 500 * 1024 }),
  proc(500, 1, { cmd: 'game.exe', rssKb: 20 * GiB }),
];

function fakeSignaller() {
  const frozen = new Map<number, number>();
  return {
    frozen,
    freeze: vi.fn((ps: Array<{ pid: number; startTicks: number }>) => { for (const p of ps) frozen.set(p.pid, p.startTicks); return ps.length; }),
    thawAll: vi.fn(() => { const n = frozen.size; frozen.clear(); return n; }),
    killTree: vi.fn((_u: { pids: number[] }, _t: Map<number, number>) => 1),
    frozenCount: vi.fn(() => frozen.size),
    isFrozen: vi.fn((pid: number) => frozen.has(pid)),
  };
}

function setup(over: Partial<LoadGuardDeps> = {}) {
  const env = {
    now: T0,
    sys: NORMAL() as Sys,
    procs: smallSai(),
  };
  const signaller = fakeSignaller();
  const deps = {
    now: () => env.now,
    readSystem: vi.fn(async () => ({ ...env.sys, ts: env.now })),
    readProcs: vi.fn(async () => env.procs),
    readGpu: vi.fn(async () => null as SystemSample['gpu']),
    // pid 1 stands in for SAI main: fixture agents (ppid 1) are spawned by the app (I1).
    appPids: () => new Set<number>([1]),
    terminalPids: () => new Set<number>(),
    signaller,
    broadcastState: vi.fn(),
    emitChat: vi.fn(),
    onAgentKilled: vi.fn(),
    devlog: vi.fn(),
    instance: INSTANCE,
    bootTimeSec: 0,
    clockTicksPerSec: HZ,
    ...over,
  } satisfies LoadGuardDeps;
  const g = new LoadGuard(deps);
  g.applySettings({ enabled: true, autoKill: true });
  /** run a tick at T0 + ms */
  const at = async (ms: number, s?: Sys, procs?: ProcInfo[]) => {
    env.now = T0 + ms;
    if (s) env.sys = s;
    if (procs) env.procs = procs;
    await g.tick();
  };
  const devlogEvents = () => deps.devlog.mock.calls.map(c => c[0]);
  return { g, deps, env, signaller, at, devlogEvents };
}

const frozenPids = (s: ReturnType<typeof fakeSignaller>) =>
  s.freeze.mock.calls.flatMap(c => c[0].map(p => p.pid)).sort((a, b) => a - b);

afterEach(() => { vi.useRealTimers(); });

describe('LoadGuard', () => {
  it('critical with SAI not at fault: freezes the tagged pids with their start ticks, no kill, paused', async () => {
    const { g, signaller, at, devlogEvents } = setup();
    await at(0, CRITICAL());
    expect(frozenPids(signaller)).toEqual([100, 101]);
    expect(signaller.freeze.mock.calls[0][0]).toContainEqual({ pid: 101, startTicks: started(20), ppid: 100 });
    expect(signaller.killTree).not.toHaveBeenCalled();
    expect(g.state()).toMatchObject({ level: 'critical', paused: true, saiCaused: false, enabled: true });
    expect(devlogEvents()).toEqual(expect.arrayContaining(['state', 'critical_snapshot', 'freeze']));
  });

  it('kills the 7 GiB command only, respects the 5s cooldown, then kills the next unit', async () => {
    const big = [
      proc(1, 0),
      proc(100, 1, { cmd: 'claude', rssKb: 300 * 1024, tag: tag() }),
      proc(101, 100, { cmd: 'vitest run', rssKb: 7 * GiB }),
      proc(102, 101, { cmd: 'vitest worker', rssKb: 100 * 1024 }),
      proc(103, 100, { cmd: 'tsc -b', rssKb: 5 * GiB }),
    ];
    const { g, deps, signaller, at } = setup();
    await at(0, CRITICAL(), big);
    expect(signaller.killTree).toHaveBeenCalledTimes(1);
    const [unit, ticks] = signaller.killTree.mock.calls[0];
    expect(unit.pids).toEqual([102, 101]);
    expect([...ticks.entries()]).toEqual(expect.arrayContaining([[101, started(20)], [102, started(20)]]));
    expect(deps.onAgentKilled).not.toHaveBeenCalled();
    expect(g.state().saiCaused).toBe(true);
    const chat = deps.emitChat.mock.calls.find(c => c[3].kind === 'killed')!;
    expect(chat.slice(0, 3)).toEqual(['/p', 's1', 'claude']);
    expect(chat[3]).toMatchObject({ kind: 'killed', unitKind: 'command', label: 'vitest run', sizeKb: 7 * GiB + 100 * 1024 });
    expect(chat[3].toldAi).toContain('SAI killed `vitest run`');

    await at(2000);
    expect(signaller.killTree).toHaveBeenCalledTimes(1);

    await at(5000, CRITICAL(), big.filter(p => p.pid !== 101 && p.pid !== 102));
    expect(signaller.killTree).toHaveBeenCalledTimes(2);
    expect(signaller.killTree.mock.calls[1][0].pids).toEqual([103]);
    // the AI is told about the kill on its next turn, but the chat already has the killed card (R12)
    deps.emitChat.mockClear();
    expect(g.takeNote('claude', '/p', 's1')).toContain('SAI killed `vitest run`');
    expect(deps.emitChat).not.toHaveBeenCalled();
  });

  it('calls onAgentKilled before killTree when the agent is the target', async () => {
    const { deps, signaller, at } = setup();
    await at(0, CRITICAL(), [proc(1, 0), proc(100, 1, { cmd: 'claude', rssKb: 5 * GiB, tag: tag({ scope: '*' }) })]);
    expect(deps.onAgentKilled).toHaveBeenCalledWith(tag({ scope: '*' }));
    expect(signaller.killTree).toHaveBeenCalledTimes(1);
    expect(deps.onAgentKilled.mock.invocationCallOrder[0]).toBeLessThan(signaller.killTree.mock.invocationCallOrder[0]);
    // R5: a '*' scope is passed through as-is
    const chat = deps.emitChat.mock.calls.find(c => c[3].kind === 'killed')!;
    expect(chat.slice(0, 3)).toEqual(['/p', '*', 'claude']);
    expect(chat[3].unitKind).toBe('agent');
  });

  it('I1: killing an orphaned tagged root never calls onAgentKilled and reports it as a service', async () => {
    const { deps, signaller, at } = setup();
    await at(0, CRITICAL(), [
      proc(1, 0),
      proc(100, 1, { cmd: 'claude', rssKb: 300 * 1024, tag: tag() }),
      proc(4242, 0, { comm: 'systemd' }),
      proc(600, 4242, { cmd: 'npm run dev', rssKb: 6 * GiB, tag: tag(), startTicks: started(900) }),
    ]);
    expect(signaller.killTree).toHaveBeenCalledTimes(1);
    expect(signaller.killTree.mock.calls[0][0].pids).toEqual([600]);
    expect(deps.onAgentKilled).not.toHaveBeenCalled();
    const chat = deps.emitChat.mock.calls.find(c => c[3].kind === 'killed')!;
    expect(chat[3]).toMatchObject({ unitKind: 'service', label: 'npm run dev' });
  });

  it('I2: a tagged app in a foreign app scope is never frozen, killed or counted as SAI fault', async () => {
    const SELF = '/user.slice/user@1000.service/app.slice/app-sai-1.scope';
    const { g, deps, signaller, at } = setup({ selfCgroup: SELF });
    await at(0, CRITICAL(), [
      proc(1, 0),
      proc(100, 1, { cmd: 'claude', rssKb: 300 * 1024, tag: tag(), cgroup: SELF }),
      proc(700, 0, { comm: 'firefox-bin', rssKb: 12 * GiB, tag: tag(), cgroup: '/user.slice/user@1000.service/app.slice/app-firefox-2.scope' }),
    ]);
    expect(frozenPids(signaller)).toEqual([100]);
    expect(signaller.killTree).not.toHaveBeenCalled();
    expect(deps.onAgentKilled).not.toHaveBeenCalled();
    expect(g.state().saiCaused).toBe(false);
  });

  it('resumeOverride thaws and the next critical tick does not freeze', async () => {
    const { g, signaller, at } = setup();
    await at(0, CRITICAL());
    expect(signaller.freeze).toHaveBeenCalledTimes(1);
    g.resumeOverride();
    expect(signaller.thawAll).toHaveBeenCalled();
    expect(g.state()).toMatchObject({ override: true, paused: false });
    await at(2000);
    expect(signaller.freeze).toHaveBeenCalledTimes(1);
  });

  it('critical then 30s of normal: thaws, clears override, sets recoveredAt, posts the normal note', async () => {
    const { g, signaller, at } = setup();
    await at(0, CRITICAL());
    g.resumeOverride();
    signaller.thawAll.mockClear();
    for (let t = 2000; t < 32_000; t += 2000) await at(t, NORMAL());
    expect(g.state().level).toBe('critical');
    expect(signaller.thawAll).not.toHaveBeenCalled();
    await at(32_000);
    expect(g.state()).toMatchObject({ level: 'normal', override: false, recoveredAt: T0 + 32_000, paused: false });
    expect(signaller.thawAll).toHaveBeenCalled();
    expect(g.takeNote('claude', '/p', 's1')).toBe('[SAI system load: back to normal] Normal workloads are fine again.');
  });

  it('entering warning posts a note that takeNote delivers once and reports to the chat', async () => {
    const { g, deps, at } = setup();
    await at(0, WARNING());
    const text = g.takeNote('claude', '/p', 's1');
    expect(text).toMatch(/^\[SAI system load: WARNING\] RAM 85% used/);
    expect(deps.emitChat).toHaveBeenCalledWith('/p', 's1', 'claude', { kind: 'note', text });
    expect(g.takeNote('claude', '/p', 's1')).toBeNull();
    expect(deps.emitChat).toHaveBeenCalledTimes(1);
    expect(deps.broadcastState).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
  });

  it('applySettings({enabled:false}) while frozen thaws, and critical ticks no longer freeze', async () => {
    const { g, signaller, at } = setup();
    await at(0, CRITICAL());
    expect(signaller.freeze).toHaveBeenCalledTimes(1);
    g.applySettings({ enabled: false, autoKill: true });
    expect(signaller.thawAll).toHaveBeenCalled();
    expect(g.state()).toMatchObject({ enabled: false, paused: false });
    await at(2000);
    await at(4000);
    expect(signaller.freeze).toHaveBeenCalledTimes(1);
    expect(signaller.killTree).not.toHaveBeenCalled();
  });

  it('autoKill off: freezes but never kills', async () => {
    const { g, signaller, at } = setup();
    g.applySettings({ enabled: true, autoKill: false });
    await at(0, CRITICAL(), [proc(1, 0), proc(100, 1, { tag: tag() }), proc(101, 100, { rssKb: 7 * GiB })]);
    expect(signaller.freeze).toHaveBeenCalled();
    expect(signaller.killTree).not.toHaveBeenCalled();
  });

  it('readProcs rejecting: the tick resolves, level unchanged, no signals, tick_error logged', async () => {
    const { g, deps, signaller, at, devlogEvents } = setup();
    deps.readProcs.mockRejectedValueOnce(new Error('EMFILE'));
    await expect(at(0, CRITICAL())).resolves.toBeUndefined();
    expect(g.state().level).toBe('normal');
    expect(signaller.freeze).not.toHaveBeenCalled();
    expect(signaller.killTree).not.toHaveBeenCalled();
    expect(devlogEvents()).toContain('tick_error');
    expect(deps.broadcastState).not.toHaveBeenCalled();
  });

  it('readSystem rejecting: the tick resolves and keeps the previous level', async () => {
    const { g, deps, signaller, at, devlogEvents } = setup();
    await at(0, CRITICAL());
    const freezes = signaller.freeze.mock.calls.length;
    deps.readSystem.mockRejectedValueOnce(new Error('ENOENT meminfo'));
    await expect(at(2000)).resolves.toBeUndefined();
    expect(g.state().level).toBe('critical');
    expect(signaller.freeze.mock.calls.length).toBe(freezes);
    expect(devlogEvents()).toContain('tick_error');
  });

  it('an untagged 20 GiB process is never frozen or killed, even with SAI at fault', async () => {
    const { signaller, at } = setup();
    const procs = [
      ...smallSai(),
      proc(600, 1, { cmd: 'other-sai', rssKb: 30 * GiB, tag: tag({ instance: 999 }) }), // another SAI instance's tag
      proc(102, 100, { cmd: 'vitest', rssKb: 5 * GiB }),
    ];
    for (let t = 0; t <= 20_000; t += 2000) await at(t, CRITICAL(), procs);
    expect(frozenPids(signaller)).not.toContain(500);
    expect(frozenPids(signaller)).not.toContain(600);
    for (const [u] of signaller.killTree.mock.calls) {
      expect(u.pids).not.toContain(500);
      expect(u.pids).not.toContain(600);
    }
    expect(signaller.killTree).toHaveBeenCalled(); // the tagged 5 GiB vitest
  });

  it('R1: with fake set, never kills (logs kill_skipped_fake) but still freezes', async () => {
    const { deps, signaller, at } = setup({ fake: 'critical' as Level });
    await at(0, NORMAL(), [proc(1, 0), proc(100, 1, { tag: tag() }), proc(101, 100, { cmd: 'vitest run', rssKb: 7 * GiB })]);
    expect(signaller.freeze).toHaveBeenCalled();
    expect(signaller.killTree).not.toHaveBeenCalled();
    expect(deps.onAgentKilled).not.toHaveBeenCalled();
    expect(deps.emitChat.mock.calls.some(c => c[3].kind === 'killed')).toBe(false);
    const skip = deps.devlog.mock.calls.find(c => c[0] === 'kill_skipped_fake');
    expect(skip?.[1]).toMatchObject({ label: 'vitest run', kind: 'command' });
  });

  it('swap growth over 30s raises warning, but a stale reference across a gap does not', async () => {
    const swap = (usedGiB: number) => sys(50, { swapFreeKb: 8 * GiB - usedGiB * GiB });
    const a = setup();
    for (let t = 0; t <= 30_000; t += 2000) await a.at(t, swap(t >= 30_000 ? 1 : 0));
    expect(a.g.state().level).toBe('warning');

    const b = setup();
    await b.at(0, swap(0));
    await b.at(120_000, swap(1)); // suspend gap: the only older entry is 120s old
    expect(b.g.state().level).toBe('normal');
  });

  it('unit growth ≥2 GiB in 60s is SAI fault, but not across a gap', async () => {
    const procs = (unitGiB: number) => [proc(1, 0), proc(100, 1, { tag: tag() }), proc(101, 100, { cmd: 'webpack', rssKb: unitGiB * GiB })];
    const a = setup();
    for (let t = 0; t <= 58_000; t += 2000) await a.at(t, NORMAL(), procs(1));
    await a.at(60_000, CRITICAL(), procs(3.5));
    expect(a.g.state().saiCaused).toBe(true);
    expect(a.signaller.killTree).toHaveBeenCalledTimes(1);

    const b = setup();
    await b.at(0, NORMAL(), procs(1));
    await b.at(120_000, CRITICAL(), procs(3.5));
    expect(b.g.state().saiCaused).toBe(false);
    expect(b.signaller.killTree).not.toHaveBeenCalled();
  });

  it('does not start a new readGpu while one is outstanding', async () => {
    const { deps, at } = setup();
    deps.readGpu.mockImplementation(() => new Promise(() => {}));
    for (let t = 0; t <= 30_000; t += 2000) await at(t);
    expect(deps.readGpu).toHaveBeenCalledTimes(1);
  });

  it('reads the GPU on a 10s cadence when reads complete', async () => {
    const { deps, at } = setup();
    for (let t = 0; t <= 20_000; t += 2000) await at(t);
    expect(deps.readGpu).toHaveBeenCalledTimes(3);
  });

  it('scans processes every 10s at normal and every tick above normal', async () => {
    const { deps, at } = setup();
    for (let t = 0; t <= 18_000; t += 2000) await at(t);
    expect(deps.readProcs).toHaveBeenCalledTimes(2);
    deps.readProcs.mockClear();
    for (let t = 20_000; t <= 26_000; t += 2000) await at(t, WARNING());
    expect(deps.readProcs).toHaveBeenCalledTimes(4);
  });

  it('freezes from a scan taken on the tick that enters critical, never a stale one', async () => {
    const { deps, signaller, at } = setup();
    await at(0, NORMAL(), smallSai());
    const fresh = [proc(1, 0), proc(200, 1, { tag: tag(), startTicks: started(1) }), proc(201, 200)];
    await at(2000, CRITICAL(), fresh);
    expect(deps.readProcs).toHaveBeenCalledTimes(2);
    expect(frozenPids(signaller)).toEqual([200, 201]);
  });

  it('retries thawAll on calm ticks while some pids are still frozen', async () => {
    const { signaller, at } = setup();
    await at(0, CRITICAL());
    signaller.thawAll.mockImplementation(() => 0); // SIGCONT refused: pids stay tracked
    for (let t = 2000; t <= 32_000; t += 2000) await at(t, NORMAL());
    expect(signaller.thawAll).toHaveBeenCalledTimes(1); // leaving critical
    await at(34_000);
    await at(36_000);
    expect(signaller.thawAll).toHaveBeenCalledTimes(3);
  });

  it('start() skips overlapping ticks and stop() thaws', async () => {
    vi.useFakeTimers();
    const { g, deps, signaller } = setup();
    deps.readSystem.mockImplementation(() => new Promise(() => {}));
    g.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.readSystem).toHaveBeenCalledTimes(1);
    g.stop();
    expect(signaller.thawAll).toHaveBeenCalled();
  });

  it('marks saiAppHeavy when a SAI app process is in the top 3 and reports the game', async () => {
    const { g, at } = setup({ appPids: () => new Set([300]) });
    await at(0, NORMAL(), [
      proc(1, 0),
      proc(300, 1, { comm: 'electron', rssKb: 6 * GiB }),
      proc(400, 1, { comm: 'wine', cmd: '/x/steamapps/common/Elden Ring/eldenring.exe', rssKb: 9 * GiB }),
    ]);
    expect(g.state()).toMatchObject({ saiAppHeavy: true, game: { name: 'Elden Ring', sizeKb: 9 * GiB }, memUsedPct: 50 });
    expect(g.topUsers()[0]).toMatchObject({ label: 'Elden Ring', owner: 'game' });
  });

  it('R12: takeNote returns kill notes plus the load note but emits only the load note', async () => {
    const { g, deps, at } = setup();
    await at(0, WARNING());
    await at(2000, CRITICAL(), [proc(1, 0), proc(100, 1, { tag: tag() }), proc(101, 100, { cmd: 'vitest run', rssKb: 7 * GiB })]);
    deps.emitChat.mockClear();
    const text = g.takeNote('claude', '/p', 's1')!;
    expect(text).toContain('SAI killed `vitest run`');
    expect(text).toContain('[SAI system load: WARNING]');
    expect(deps.emitChat).toHaveBeenCalledTimes(1);
    expect(deps.emitChat.mock.calls[0][3]).toEqual({ kind: 'note', text: expect.stringMatching(/^\[SAI system load: WARNING\]/) });
    expect(deps.emitChat.mock.calls[0][3].text).not.toContain('SAI killed');
  });

  const lastSignal = (s: ReturnType<typeof fakeSignaller>) => {
    const order = [
      ...s.freeze.mock.invocationCallOrder.map(o => ['freeze', o] as const),
      ...s.thawAll.mock.invocationCallOrder.map(o => ['thawAll', o] as const),
      ...s.killTree.mock.invocationCallOrder.map(o => ['killTree', o] as const),
    ].sort((a, b) => a[1] - b[1]);
    return order[order.length - 1]?.[0];
  };

  it('stop() during an in-flight scan: no freeze afterwards, thawAll is the last signal', async () => {
    const { g, deps, signaller, env } = setup();
    let release!: (p: ProcInfo[]) => void;
    deps.readProcs.mockImplementationOnce(() => new Promise(r => { release = r; }));
    env.sys = CRITICAL();
    const pending = g.tick();
    await vi.waitFor(() => expect(deps.readProcs).toHaveBeenCalled());
    g.stop();
    release(smallSai());
    await pending;
    expect(signaller.freeze).not.toHaveBeenCalled();
    expect(lastSignal(signaller)).toBe('thawAll');
    expect(g.state().level).toBe('normal');
  });

  it('disable during an in-flight scan: no freeze afterwards, thawAll is the last signal', async () => {
    const { g, deps, signaller, env } = setup();
    let release!: (p: ProcInfo[]) => void;
    deps.readProcs.mockImplementationOnce(() => new Promise(r => { release = r; }));
    env.sys = CRITICAL();
    const pending = g.tick();
    await vi.waitFor(() => expect(deps.readProcs).toHaveBeenCalled());
    g.applySettings({ enabled: false, autoKill: true });
    release(smallSai());
    await pending;
    expect(signaller.freeze).not.toHaveBeenCalled();
    expect(signaller.killTree).not.toHaveBeenCalled();
    expect(lastSignal(signaller)).toBe('thawAll');
  });

  it('M3: leaving critical does not need a successful scan', async () => {
    const { g, deps, signaller, at } = setup();
    await at(0, CRITICAL());
    deps.readProcs.mockRejectedValue(new Error('EMFILE'));
    for (let t = 2000; t <= 30_000; t += 2000) await at(t, NORMAL());
    expect(g.state().level).toBe('critical');
    await at(32_000);
    expect(g.state().level).toBe('normal');
    expect(signaller.thawAll).toHaveBeenCalled();
  });

  it('M2: a pid whose SIGSTOP failed is retried on the next critical tick', async () => {
    const { signaller, at } = setup();
    signaller.freeze.mockImplementationOnce((ps) => { signaller.frozen.set(ps[0].pid, ps[0].startTicks); return 1; });
    await at(0, CRITICAL());
    const stopped = [...signaller.frozen.keys()];
    expect(stopped).toHaveLength(1);
    await at(2000);
    expect(signaller.freeze).toHaveBeenCalledTimes(2);
    expect(signaller.freeze.mock.calls[0][0].map(p => p.pid).sort()).toEqual([100, 101]);
    // only the pid that was actually stopped is skipped
    expect(signaller.freeze.mock.calls[1][0].map(p => p.pid)).toEqual([100, 101].filter(pid => !stopped.includes(pid)));
  });

  it('M2: freeze throwing records nothing and the tick does not throw', async () => {
    const { signaller, at, devlogEvents } = setup();
    signaller.freeze.mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(at(0, CRITICAL())).resolves.toBeUndefined();
    expect(devlogEvents()).toContain('tick_error');
    await at(2000);
    expect(signaller.freeze).toHaveBeenCalledTimes(2);
    expect(frozenPids(signaller)).toEqual([100, 100, 101, 101]);
  });

  it('M4: a retry thaw that changes nothing is not logged', async () => {
    const { signaller, at, deps } = setup();
    await at(0, CRITICAL());
    signaller.thawAll.mockImplementation(() => 0);
    for (let t = 2000; t <= 32_000; t += 2000) await at(t, NORMAL());
    const thawLogs = () => deps.devlog.mock.calls.filter(c => c[0] === 'thaw').length;
    const before = thawLogs();
    await at(34_000);
    await at(36_000);
    expect(signaller.thawAll).toHaveBeenCalledTimes(3);
    expect(thawLogs()).toBe(before);
  });
});
