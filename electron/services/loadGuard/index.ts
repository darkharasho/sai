import type { AiUnit, Level, ProcInfo, Provider, ScopeTag, SystemSample, TopUser, UnitKind } from './types';
import { classify, type Classified } from './classify';
import { rawLevel, stepLevel, type LevelState } from './levels';
import { FAULT, isSaiFault, pickKillTarget } from './killPlan';
import { History } from './history';
import { NoteBox, killNote, normalNote, warningNote } from './notes';
import type { FreezeTarget, Signaller } from './signals';

export interface LoadGuardPublicState {
  level: Level;
  paused: boolean;
  override: boolean;
  saiCaused: boolean;
  saiAppHeavy: boolean;
  memUsedPct: number;
  swapUsedPct: number;
  game: { name: string; sizeKb: number } | null;
  recoveredAt: number | null;
  enabled: boolean;
}

export type LoadGuardChatEvent =
  | { kind: 'note'; text: string }
  | { kind: 'killed'; unitKind: UnitKind; label: string; sizeKb: number; memUsedPct: number; top: TopUser[]; toldAi: string };

export interface LoadGuardDeps {
  now(): number;
  readSystem(): Promise<Omit<SystemSample, 'gpu'>>;
  readProcs(): Promise<ProcInfo[]>;
  readGpu(): Promise<SystemSample['gpu']>;
  /** app.getAppMetrics() */
  appPids(): Set<number>;
  terminalPids(): Set<number>;
  signaller: Pick<Signaller, 'freeze' | 'thawAll' | 'killTree' | 'frozenCount' | 'isFrozen'>;
  /** webContents.send('loadGuard:state') */
  broadcastState(s: LoadGuardPublicState): void;
  /** emitChatMessage({ type: 'load_guard', ... }) */
  emitChat(projectPath: string, scope: string, provider: Provider, ev: LoadGuardChatEvent): void;
  onAgentKilled(tag: ScopeTag): void;
  devlog(event: string, data?: Record<string, unknown>): void;
  /** SAI_LOAD_GUARD_FAKE: forces the raw level; never kills (R1) */
  fake?: Level;
  /** this SAI instance's id (process.pid); only its own tags are acted on */
  instance: number;
  /** /proc/stat btime, for process ages */
  bootTimeSec: number;
  clockTicksPerSec?: number;
  /** SAI main's cgroup (/proc/self/cgroup); tagged pids in another app unit aren't SAI's */
  selfCgroup?: string;
}

const TICK_MS = 2_000;
const SCAN_MS_NORMAL = 10_000;
const GPU_MS = 10_000;
/** timer jitter allowance for the 10s cadences */
const SLACK_MS = 500;
const SWAP_LOOKBACK_MS = 30_000;
const GROWTH_LOOKBACK_MS = 60_000;
/** a History entry older than lookup ts - this is a gap (suspend, skipped ticks), not a reference */
const MAX_STALE_MS = 15_000;
const SNAPSHOT_MS = 120_000;
const CLK_TCK = 100;
const RANK: Record<Level, number> = { normal: 0, warning: 1, critical: 2 };
const EMPTY_CLASSIFIED: Classified = { units: [], saiAiKb: 0, saiAppKb: 0, top: [], game: null };

let current: LoadGuard | null = null;

/** null on non-linux / before start */
export function getLoadGuard(): LoadGuard | null {
  return current;
}

/** What the IPC answers when there is no guard (non-linux). */
export function inactiveState(): LoadGuardPublicState {
  return {
    level: 'normal', paused: false, override: false, saiCaused: false, saiAppHeavy: false,
    memUsedPct: 0, swapUsedPct: 0, game: null, recoveredAt: null, enabled: false,
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export class LoadGuard {
  private level: LevelState;
  private enabled = true;
  private autoKill = true;
  private override = false;
  private saiCaused = false;
  private recoveredAt: number | null = null;
  private sample: SystemSample | null = null;
  private classified: Classified | null = null;
  private lastScanAt = -Infinity;
  private lastKillAt = -Infinity;
  private lastUnitSizes: Array<{ rootPid: number; startTicks: number; sizeKb: number }> = [];
  private gpu: SystemSample['gpu'] = null;
  private lastGpuAt = -Infinity;
  private gpuInFlight = false;
  /** `pid:startTicks` already sent to freeze this episode */
  private frozenKeys = new Set<string>();
  private readonly history = new History();
  private readonly notes = new NoteBox();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  /** bumped by stop/disable so an in-flight tick knows its reads predate the final thaw */
  private epoch = 0;
  private lastBroadcast: string;

  constructor(private readonly deps: LoadGuardDeps) {
    this.level = { level: 'normal', since: deps.now(), calmSince: null, calmPeak: null };
    this.lastBroadcast = JSON.stringify(this.state());
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    current = this;
    const run = () => {
      if (this.ticking) return; // previous tick still running (slow /proc, wedged read)
      this.ticking = true;
      void this.tick().finally(() => { this.ticking = false; });
    };
    this.timer = setInterval(run, TICK_MS);
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    this.epoch++;
    if (current === this) current = null;
    this.thaw('stop');
  }

  applySettings(s: { enabled: boolean; autoKill: boolean }): void {
    if (s.enabled !== this.enabled || s.autoKill !== this.autoKill) {
      this.deps.devlog('settings', { enabled: s.enabled, autoKill: s.autoKill });
    }
    this.enabled = s.enabled;
    this.autoKill = s.autoKill;
    if (!s.enabled) {
      this.epoch++;
      this.thaw('disabled');
      // A re-enable starts from a clean slate, not a stale episode.
      this.level = { level: 'normal', since: this.deps.now(), calmSince: null, calmPeak: null };
      this.override = false;
    }
    this.maybeBroadcast();
  }

  resumeOverride(): void {
    if (this.level.level === 'critical' && this.enabled) this.override = true;
    this.deps.devlog('resume_override', { level: this.level.level });
    this.thaw('override');
    this.maybeBroadcast();
  }

  state(): LoadGuardPublicState {
    const s = this.sample;
    const c = this.classified;
    const critical = this.level.level === 'critical';
    return {
      level: this.level.level,
      paused: critical && this.enabled && !this.override,
      override: this.override,
      saiCaused: this.saiCaused,
      saiAppHeavy: !!c && c.top.slice(0, 3).some(t => t.owner === 'sai-app'),
      memUsedPct: s ? pct(s.memTotalKb - s.memAvailableKb, s.memTotalKb) : 0,
      swapUsedPct: s ? pct(s.swapTotalKb - s.swapFreeKb, s.swapTotalKb) : 0,
      game: c?.game ?? null,
      recoveredAt: this.recoveredAt,
      enabled: this.enabled,
    };
  }

  topUsers(): TopUser[] {
    return this.classified?.top ?? [];
  }

  takeNote(provider: Provider, projectPath: string, scope: string): string | null {
    const { kill, load } = this.notes.takeParts(provider, projectPath, scope, this.deps.now());
    // Kill notes already show as the killed card (toldAi); only the load note gets a chat callout (R12).
    if (load) this.deps.emitChat(projectPath, scope, provider, { kind: 'note', text: load });
    const out = load ? [...kill, load] : kill;
    return out.length ? out.join('\n') : null;
  }

  /** One sample+decide pass. Never throws; on a read error the level and signals are left alone. */
  async tick(): Promise<void> {
    try {
      await this.tickInner();
    } catch (e) {
      this.deps.devlog('tick_error', { error: String((e as Error)?.message ?? e) });
    }
  }

  private async tickInner(): Promise<void> {
    const d = this.deps;
    const now = d.now();
    if (this.stopped) return;
    if (!this.enabled) {
      this.retryThaw();
      return;
    }
    this.pollGpu(now);
    const epoch = this.epoch;
    // stop()/disable during an await already thawed: nothing after it may commit or signal.
    const aborted = () => this.stopped || !this.enabled || epoch !== this.epoch;

    // --- gather: nothing below mutates state until the commit ---
    const sys = await d.readSystem();
    if (aborted()) return;
    const sample: SystemSample = { ...sys, ts: now, gpu: this.gpu };
    const swapUsedKb = sample.swapTotalKb - sample.swapFreeKb;
    const swapRef = this.history.swapUsedKbAt(now - SWAP_LOOKBACK_MS, MAX_STALE_MS);
    const raw = d.fake ?? rawLevel(sample, swapRef);
    const prev = this.level.level;
    let next = stepLevel(this.level, raw, now);
    const scanDue = next.level !== prev || next.level !== 'normal' || now - this.lastScanAt >= SCAN_MS_NORMAL - SLACK_MS;
    let procs: ProcInfo[] | null = null;
    let c: Classified | null = null;
    if (scanDue) {
      try {
        procs = await d.readProcs();
      } catch (e) {
        // Escalating, or acting at critical, needs this tick's scan; calming down never does.
        if (RANK[next.level] > RANK[prev]) throw e;
        d.devlog('scan_error', { error: String((e as Error)?.message ?? e) });
      }
      if (aborted()) return;
      if (procs) {
        c = classify(procs, {
          instance: d.instance,
          appPids: d.appPids(),
          terminalPids: d.terminalPids(),
          clockTicksPerSec: d.clockTicksPerSec ?? CLK_TCK,
          bootTimeSec: d.bootTimeSec,
          nowSec: now / 1000,
          selfCgroup: d.selfCgroup,
        });
      }
    }
    const changed = next.level !== prev;
    const memUsedPct = pct(sample.memTotalKb - sample.memAvailableKb, sample.memTotalKb);
    const saiCaused = c
      ? isSaiFault(sample, c, (rootPid, startTicks) =>
        this.history.unitSizeAt(now - GROWTH_LOOKBACK_MS, rootPid, startTicks, MAX_STALE_MS))
      : this.saiCaused;
    let note: string | null = null;
    if (changed && next.level === 'warning') {
      note = warningNote(sample, c ?? this.classified ?? EMPTY_CLASSIFIED, swapRef !== null && swapUsedKb > swapRef);
    } else if (changed && next.level === 'normal') {
      note = normalNote();
    }
    const unitSizes = c
      ? c.units.map(u => ({ rootPid: u.rootPid, startTicks: u.startTicks, sizeKb: u.sizeKb }))
      : this.lastUnitSizes;
    this.history.push({
      ts: now,
      memUsedPct,
      swapUsedKb,
      psiMemFull10: sample.psiMemFull10,
      level: next.level,
      top: c ? c.top : null,
      // carried forward between scans so 60s-ago lookups land on a real size
      unitSizes,
    });

    // --- commit ---
    this.sample = sample;
    this.level = next;
    this.saiCaused = saiCaused;
    this.lastUnitSizes = unitSizes;
    if (c) {
      this.classified = c;
      this.lastScanAt = now;
    }
    let thawed = false;
    if (changed && prev === 'critical') {
      // First, so nothing after it can skip the thaw.
      this.override = false;
      this.recoveredAt = now;
      this.thaw('recovered');
      thawed = true;
    }
    if (changed) {
      d.devlog('state', { from: prev, to: next.level, memUsedPct, psi: { some10: sample.psiMemSome10, full10: sample.psiMemFull10 } });
      if (next.level === 'critical') {
        d.devlog('critical_snapshot', { top: c?.top ?? [], history: this.history.summary(SNAPSHOT_MS) });
      }
      if (note) this.notes.postAll(note, now);
    }

    if (next.level === 'critical' && procs && c) {
      // Only act on this tick's scan (R11).
      const ticks = new Map(procs.map(p => [p.pid, p.startTicks] as const));
      if (!this.override) this.freezeUnits(c.units, ticks, new Map(procs.map(p => [p.pid, p.ppid] as const)));
      if (this.autoKill && this.saiCaused && now - this.lastKillAt >= FAULT.killCooldownMs) {
        this.killOne(c, ticks, memUsedPct, now);
      }
    }
    if (!thawed && (next.level !== 'critical' || this.override)) this.retryThaw();

    this.maybeBroadcast();
  }

  /** Fire-and-forget; a wedged nvidia-smi never stacks a second read, the last value is kept. */
  private pollGpu(now: number): void {
    if (this.gpuInFlight || now - this.lastGpuAt < GPU_MS - SLACK_MS) return;
    this.gpuInFlight = true;
    this.lastGpuAt = now;
    let p: Promise<SystemSample['gpu']>;
    try {
      p = this.deps.readGpu();
    } catch {
      this.gpuInFlight = false;
      return;
    }
    p.then(g => { this.gpu = g; }, () => { /* informational only */ })
      .finally(() => { this.gpuInFlight = false; });
  }

  /** Freezes own-instance sai-ai pids (the units' pids) with start ticks and ppids from this tick's scan. */
  private freezeUnits(units: AiUnit[], ticks: Map<number, number>, ppids: Map<number, number>): void {
    const fresh: FreezeTarget[] = [];
    const seen = new Set<number>();
    for (const u of units) {
      for (const pid of u.pids) {
        const st = ticks.get(pid);
        if (st === undefined || seen.has(pid)) continue;
        seen.add(pid);
        if (this.frozenKeys.has(`${pid}:${st}`)) continue;
        fresh.push({ pid, startTicks: st, ppid: ppids.get(pid) });
      }
    }
    if (fresh.length === 0) return;
    const count = this.deps.signaller.freeze(fresh);
    // Only pids actually stopped; a refused SIGSTOP is retried next tick.
    for (const p of fresh) if (this.deps.signaller.isFrozen(p.pid)) this.frozenKeys.add(`${p.pid}:${p.startTicks}`);
    this.deps.devlog('freeze', { requested: fresh.length, count, pids: fresh.map(p => p.pid) });
  }

  private killOne(c: Classified, scanTicks: Map<number, number>, memUsedPct: number, now: number): void {
    const d = this.deps;
    const target = pickKillTarget(c.units);
    if (!target) return;
    this.lastKillAt = now;
    const info = { label: target.label, kind: target.kind, sizeKb: target.sizeKb, tag: target.tag };
    if (d.fake) {
      d.devlog('kill_skipped_fake', info);
      return;
    }
    const ticks = new Map<number, number>();
    for (const pid of target.pids) {
      const st = scanTicks.get(pid);
      if (st !== undefined) ticks.set(pid, st);
    }
    const { instance: _instance, ...tag } = target.tag;
    const toldAi = killNote(target, memUsedPct);
    if (target.kind === 'agent') d.onAgentKilled(target.tag);
    const count = d.signaller.killTree(target, ticks);
    for (const pid of target.pids) this.frozenKeys.delete(`${pid}:${ticks.get(pid)}`);
    d.devlog('kill', { ...info, count });
    this.notes.postTo(tag, toldAi, now);
    d.emitChat(tag.projectPath, tag.scope, tag.provider, {
      kind: 'killed', unitKind: target.kind, label: target.label, sizeKb: target.sizeKb, memUsedPct, top: c.top, toldAi,
    });
  }

  private thaw(reason: string, quietIfUnchanged = false): void {
    const sig = this.deps.signaller;
    const before = sig.frozenCount();
    this.frozenKeys.clear();
    const count = sig.thawAll();
    const after = sig.frozenCount();
    if (quietIfUnchanged && after === before) return;
    if (count > 0 || after > 0 || before > 0) {
      this.deps.devlog('thaw', { reason, count, stillFrozen: after });
    }
  }

  /** SIGCONT can fail; the signaller keeps those pids, so keep retrying while calm. */
  private retryThaw(): void {
    if (this.deps.signaller.frozenCount() > 0) this.thaw('retry', true);
  }

  private maybeBroadcast(): void {
    const s = this.state();
    const json = JSON.stringify(s);
    if (json === this.lastBroadcast) return;
    this.lastBroadcast = json;
    this.deps.broadcastState(s);
  }
}
