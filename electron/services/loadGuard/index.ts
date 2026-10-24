import type { AiUnit, Level, ProcInfo, Provider, ScopeTag, SystemSample, TopUser, UnitKind } from './types';
import { classify, type Classified } from './classify';
import { rawLevel, stepLevel, type LevelState } from './levels';
import { FAULT, isSaiFault, pickKillTarget } from './killPlan';
import { History } from './history';
import { NoteBox, killNote, normalNote, warningNote } from './notes';
import type { Signaller } from './signals';

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
  signaller: Pick<Signaller, 'freeze' | 'thawAll' | 'killTree' | 'frozenCount'>;
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
  private lastBroadcast: string;

  constructor(private readonly deps: LoadGuardDeps) {
    this.level = { level: 'normal', since: deps.now(), calmSince: null, calmPeak: null };
    this.lastBroadcast = JSON.stringify(this.state());
  }

  start(): void {
    if (this.timer) return;
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
    const text = this.notes.take(provider, projectPath, scope, this.deps.now());
    if (text) this.deps.emitChat(projectPath, scope, provider, { kind: 'note', text });
    return text;
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
    if (!this.enabled) {
      this.retryThaw();
      return;
    }
    this.pollGpu(now);

    // --- gather (anything thrown here leaves all state untouched) ---
    const sys = await d.readSystem();
    const sample: SystemSample = { ...sys, ts: now, gpu: this.gpu };
    const swapUsedKb = sample.swapTotalKb - sample.swapFreeKb;
    const swapRef = this.history.swapUsedKbAt(now - SWAP_LOOKBACK_MS, MAX_STALE_MS);
    const raw = d.fake ?? rawLevel(sample, swapRef);
    const prev = this.level.level;
    const next = stepLevel(this.level, raw, now);
    const changed = next.level !== prev;
    const scanDue = changed || next.level !== 'normal' || now - this.lastScanAt >= SCAN_MS_NORMAL - SLACK_MS;
    let procs: ProcInfo[] | null = null;
    let c: Classified | null = null;
    if (scanDue) {
      procs = await d.readProcs();
      c = classify(procs, {
        instance: d.instance,
        appPids: d.appPids(),
        terminalPids: d.terminalPids(),
        clockTicksPerSec: d.clockTicksPerSec ?? CLK_TCK,
        bootTimeSec: d.bootTimeSec,
        nowSec: now / 1000,
      });
    }

    // --- commit ---
    this.sample = sample;
    this.level = next;
    const memUsedPct = pct(sample.memTotalKb - sample.memAvailableKb, sample.memTotalKb);
    if (c) {
      this.classified = c;
      this.lastScanAt = now;
      this.lastUnitSizes = c.units.map(u => ({ rootPid: u.rootPid, startTicks: u.startTicks, sizeKb: u.sizeKb }));
      this.saiCaused = isSaiFault(sample, c, (rootPid, startTicks) =>
        this.history.unitSizeAt(now - GROWTH_LOOKBACK_MS, rootPid, startTicks, MAX_STALE_MS));
    }
    this.history.push({
      ts: now,
      memUsedPct,
      swapUsedKb,
      psiMemFull10: sample.psiMemFull10,
      level: next.level,
      top: c ? c.top : null,
      // carried forward between scans so 60s-ago lookups land on a real size
      unitSizes: this.lastUnitSizes,
    });

    let thawed = false;
    if (changed) {
      d.devlog('state', { from: prev, to: next.level, memUsedPct, psi: { some10: sample.psiMemSome10, full10: sample.psiMemFull10 } });
      if (next.level === 'critical') {
        d.devlog('critical_snapshot', { top: c?.top ?? [], history: this.history.summary(SNAPSHOT_MS) });
      }
      if (next.level === 'warning' && c) {
        this.notes.postAll(warningNote(sample, c, swapRef !== null && swapUsedKb > swapRef), now);
      }
      if (next.level === 'normal') this.notes.postAll(normalNote(), now);
      if (prev === 'critical') {
        this.override = false;
        this.recoveredAt = now;
        this.thaw('recovered');
        thawed = true;
      }
    }

    if (next.level === 'critical' && procs && c) {
      // Only act on this tick's scan (R11).
      const ticks = new Map(procs.map(p => [p.pid, p.startTicks] as const));
      if (!this.override) this.freezeUnits(c.units, ticks);
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

  /** Freezes own-instance sai-ai pids (the units' pids) with start ticks from this tick's scan. */
  private freezeUnits(units: AiUnit[], ticks: Map<number, number>): void {
    const fresh: Array<{ pid: number; startTicks: number }> = [];
    const seen = new Set<number>();
    for (const u of units) {
      for (const pid of u.pids) {
        const st = ticks.get(pid);
        if (st === undefined || seen.has(pid)) continue;
        seen.add(pid);
        const key = `${pid}:${st}`;
        if (this.frozenKeys.has(key)) continue;
        this.frozenKeys.add(key);
        fresh.push({ pid, startTicks: st });
      }
    }
    if (fresh.length === 0) return;
    const count = this.deps.signaller.freeze(fresh);
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

  private thaw(reason: string): void {
    this.frozenKeys.clear();
    const count = this.deps.signaller.thawAll();
    if (count > 0 || this.deps.signaller.frozenCount() > 0) {
      this.deps.devlog('thaw', { reason, count, stillFrozen: this.deps.signaller.frozenCount() });
    }
  }

  /** SIGCONT can fail; the signaller keeps those pids, so keep retrying while calm. */
  private retryThaw(): void {
    if (this.deps.signaller.frozenCount() > 0) this.thaw('retry');
  }

  private maybeBroadcast(): void {
    const s = this.state();
    const json = JSON.stringify(s);
    if (json === this.lastBroadcast) return;
    this.lastBroadcast = json;
    this.deps.broadcastState(s);
  }
}
