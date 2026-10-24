import fs from 'node:fs';
import path from 'node:path';
import type { AiUnit } from './types';

export interface SignalDeps {
  kill: (pid: number, sig: NodeJS.Signals) => void;
  /** Reads field 22 of /proc/<pid>/stat; null when the process is gone. */
  startTicksOf: (pid: number) => number | null;
  persistPath: string;
  /** Field 3 of /proc/<pid>/stat ('S', 'T', ...); null when gone. Absent = freeze never waits. */
  stateOf?: (pid: number) => string | null;
  /** Blocking sleep for the bounded stop-confirm poll. */
  sleepMs?: (ms: number) => void;
  log?: (event: string, data?: Record<string, unknown>) => void;
  fs?: Pick<typeof import('fs'), 'readFileSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'>;
}

export interface FreezeTarget {
  pid: number;
  startTicks: number;
  /** from the same scan; orders the freeze ancestor-first */
  ppid?: number;
}

/** Stop-confirm poll per tree level: STOP_POLLS x STOP_POLL_MS ≈ 100ms. */
const STOP_POLLS = 50;
const STOP_POLL_MS = 2;
/** States a stopped-parent check treats as settled (stopped, traced, dead). */
const SETTLED = new Set(['T', 't', 'Z', 'X', 'x']);

type SendResult = 'sent' | 'gone' | 'failed';

interface FrozenProc {
  pid: number;
  startTicks: number;
}

/** Reads start ticks from /proc/<pid>/stat; comm may hold spaces/parens, so parse after the LAST ')'. */
export function readStartTicks(pid: number, procRoot = '/proc'): number | null {
  try {
    const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const ticks = Number(stat.slice(close + 2).trim().split(/\s+/)[19]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/** Reads the state letter (field 3) from /proc/<pid>/stat; null when gone or unparsable. */
export function readProcState(pid: number, procRoot = '/proc'): string | null {
  try {
    const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    return stat.slice(close + 2).trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/** Real deps; touches nothing until called, so tests never need these. */
export function defaultSignalDeps(
  persistPath: string,
  log?: (event: string, data?: Record<string, unknown>) => void,
): SignalDeps {
  return {
    kill: (pid, sig) => { process.kill(pid, sig); },
    startTicksOf: pid => readStartTicks(pid),
    stateOf: pid => readProcState(pid),
    // Sync and race-free with stop(); bounded to ~100ms per tree level.
    sleepMs: ms => { Atomics.wait(sleepCell, 0, 0, ms); },
    log,
    persistPath,
  };
}

const LEGACY_FROZEN_FILE = 'loadguard-frozen.json';
const FROZEN_FILE_RE = /^loadguard-frozen-(\d+)-(\d+)\.json$/;

/** Per-instance persist file, keyed by the owner's pid and start ticks so a second SAI never shares it. */
export function frozenFileName(ownerPid: number, ownerStartTicks: number): string {
  return `loadguard-frozen-${ownerPid}-${ownerStartTicks}.json`;
}

/**
 * Boot-time recovery for every frozen-pid file whose owning SAI is gone (crashed, or the
 * legacy shared name): SIGCONT what it lists, then delete it. A live instance's file is never
 * touched. A file with a refused SIGCONT is kept so the next boot retries. Never throws.
 */
export function recoverOrphanedFrozenFiles(
  dir: string,
  deps: Pick<SignalDeps, 'kill' | 'startTicksOf'>,
): { resumed: number; files: number } {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { resumed: 0, files: 0 };
  }
  let resumed = 0;
  let files = 0;
  for (const name of names) {
    const m = FROZEN_FILE_RE.exec(name);
    if (!m && name !== LEGACY_FROZEN_FILE) continue;
    if (m) {
      let ownerTicks: number | null;
      try { ownerTicks = deps.startTicksOf(Number(m[1])); } catch { ownerTicks = null; }
      if (ownerTicks === Number(m[2])) continue; // owner still running
    }
    const file = path.join(dir, name);
    const s = new Signaller({ ...deps, persistPath: file });
    resumed += s.recoverFromCrash();
    files++;
    if (s.frozenCount() === 0) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
  }
  return { resumed, files };
}

/** Freezes, thaws and kills SAI-owned processes. Never throws; every signal is pid-reuse checked. */
export class Signaller {
  private frozen = new Map<number, number>();

  constructor(private deps: SignalDeps) {}

  private get io() {
    return this.deps.fs ?? fs;
  }

  /**
   * Signals pid only while it still has the expected start ticks.
   * 'gone' = exited or pid reused (nothing left to resume); 'failed' = signal refused (EPERM...), process may still be stopped.
   */
  private send(pid: number, startTicks: number, sig: NodeJS.Signals): SendResult {
    if (!Number.isInteger(pid) || pid <= 1) return 'gone';
    try {
      if (this.deps.startTicksOf(pid) !== startTicks) return 'gone';
      this.deps.kill(pid, sig);
      return 'sent';
    } catch (e) {
      return (e as NodeJS.ErrnoException)?.code === 'ESRCH' ? 'gone' : 'failed';
    }
  }

  /** Writes the frozen set in freeze (ancestor-first) order; an empty set leaves no file behind. */
  private persist(): void {
    if (this.frozen.size === 0) {
      try { this.io.unlinkSync(this.deps.persistPath); } catch { /* already gone */ }
      return;
    }
    try {
      const list: FrozenProc[] = [...this.frozen].map(([pid, startTicks]) => ({ pid, startTicks }));
      const tmp = `${this.deps.persistPath}.tmp`;
      this.io.writeFileSync(tmp, JSON.stringify(list));
      this.io.renameSync(tmp, this.deps.persistPath);
    } catch {
      // A guard must never throw.
    }
  }

  private readPersisted(): FrozenProc[] {
    try {
      const parsed = JSON.parse(this.io.readFileSync(this.deps.persistPath, 'utf8') as string);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        p => p && Number.isInteger(p.pid) && p.pid > 1 && typeof p.startTicks === 'number',
      );
    } catch {
      return [];
    }
  }

  /**
   * SIGSTOPs ancestors before descendants, confirming each tree level is stopped before
   * signalling the next: a non-interactive `bash -c` waits with WUNTRACED, so seeing its
   * child stop first makes it exit 147 and fail the command.
   */
  freeze(procs: FreezeTarget[]): number {
    // Persist intent before SIGSTOP so a crash mid-freeze still gets recovered.
    const candidates = procs.filter(p => {
      try {
        return p.pid > 1 && this.deps.startTicksOf(p.pid) === p.startTicks;
      } catch {
        return false;
      }
    });
    const levels = treeLevels(candidates);
    for (const level of levels) for (const p of level) this.frozen.set(p.pid, p.startTicks);
    if (candidates.length) this.persist();
    let count = 0;
    let changed = false;
    const sent = new Set<number>();
    for (const level of levels) {
      const parents = [...new Set(level.flatMap(p => (p.ppid !== undefined && sent.has(p.ppid) ? [p.ppid] : [])))];
      const unconfirmed = this.waitStopped(parents);
      if (unconfirmed.length) this.deps.log?.('freeze_parent_unconfirmed', { pids: unconfirmed });
      for (const p of level) {
        if (this.send(p.pid, p.startTicks, 'SIGSTOP') === 'sent') {
          count++;
          sent.add(p.pid);
        } else {
          // Gone, or the stop was refused: it is not stopped, so don't track it.
          this.frozen.delete(p.pid);
          changed = true;
        }
      }
    }
    if (changed) this.persist();
    return count;
  }

  /** Bounded poll until every pid reads as stopped (or gone); returns the ones that never did. */
  private waitStopped(pids: number[]): number[] {
    const { stateOf, sleepMs } = this.deps;
    if (!stateOf || pids.length === 0) return [];
    let pending = pids;
    for (let i = 0; ; i++) {
      pending = pending.filter(pid => {
        try {
          const st = stateOf(pid);
          return st !== null && !SETTLED.has(st);
        } catch {
          return false;
        }
      });
      if (pending.length === 0 || i >= STOP_POLLS) return pending;
      try { sleepMs?.(STOP_POLL_MS); } catch { /* keep polling */ }
    }
  }

  /** SIGCONTs in reverse freeze order, descendants before ancestors, so a stopped parent never sees a child stop. */
  thawAll(): number {
    let count = 0;
    for (const [pid, startTicks] of [...this.frozen].reverse()) {
      const r = this.send(pid, startTicks, 'SIGCONT');
      if (r === 'sent') count++;
      if (r !== 'failed') this.frozen.delete(pid);
    }
    this.persist();
    return count;
  }

  killTree(unit: Pick<AiUnit, 'pids'>, ticks: Map<number, number>): number {
    let count = 0;
    let changed = false;
    for (const pid of unit.pids) {
      const t = ticks.get(pid);
      if (t === undefined) continue;
      const r = this.send(pid, t, 'SIGKILL');
      if (r === 'sent') count++;
      if (r !== 'failed' && this.frozen.delete(pid)) changed = true;
    }
    if (changed) this.persist();
    return count;
  }

  recoverFromCrash(): number {
    let count = 0;
    const kept: FrozenProc[] = [];
    // The file is in freeze order: resume descendants first.
    for (const p of this.readPersisted().reverse()) {
      const r = this.send(p.pid, p.startTicks, 'SIGCONT');
      if (r === 'sent') count++;
      // Keep refused entries so the next thawAll retries them.
      if (r === 'failed') kept.push(p);
    }
    for (const p of kept.reverse()) this.frozen.set(p.pid, p.startTicks);
    this.persist();
    return count;
  }

  isFrozen(pid: number): boolean {
    return this.frozen.has(pid);
  }

  frozenCount(): number {
    return this.frozen.size;
  }
}

/**
 * Groups targets by depth within the batch: level 0 has no parent in the batch, level n's
 * parent is in level n-1. Order within a level is the input order.
 */
function treeLevels(procs: FreezeTarget[]): FreezeTarget[][] {
  const byPid = new Map(procs.map(p => [p.pid, p] as const));
  const depth = new Map<number, number>();
  const depthOf = (p: FreezeTarget): number => {
    const known = depth.get(p.pid);
    if (known !== undefined) return known;
    let d = 0;
    // Bounded walk: a ppid cycle (pid reuse mid-scan) can't loop forever.
    for (let cur = p; d < procs.length; d++) {
      const parent = cur.ppid === undefined ? undefined : byPid.get(cur.ppid);
      if (!parent || parent === p) break;
      cur = parent;
    }
    depth.set(p.pid, d);
    return d;
  };
  const levels: FreezeTarget[][] = [];
  for (const p of procs) (levels[depthOf(p)] ??= []).push(p);
  return levels.filter(Boolean);
}
