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
  /** Field 4 of /proc/<pid>/stat; orders crash recovery bottom-up whatever the file order. */
  ppidOf?: (pid: number) => number | null;
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

/** Stop-confirm budget per freeze() call, across all tree levels: STOP_POLLS x STOP_POLL_MS ≈ 120ms. */
const STOP_POLLS = 60;
const STOP_POLL_MS = 2;
/** States a stopped-parent check treats as settled (stopped, traced, dead). */
const SETTLED = new Set(['T', 't', 'Z', 'X', 'x']);
/** Uninterruptible sleep: SIGSTOP can't land until it leaves D, so polling only burns budget. */
const UNWAITABLE = 'D';

type SendResult = 'sent' | 'gone' | 'failed';

interface FrozenProc {
  pid: number;
  startTicks: number;
  ppid?: number;
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

/** Fields after comm in /proc/<pid>/stat (index 0 = state); null when gone or unparsable. */
function statFields(pid: number, procRoot: string): string[] | null {
  try {
    const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    return stat.slice(close + 2).trim().split(/\s+/);
  } catch {
    return null;
  }
}

/** Reads the state letter (field 3) from /proc/<pid>/stat; null when gone or unparsable. */
export function readProcState(pid: number, procRoot = '/proc'): string | null {
  return statFields(pid, procRoot)?.[0] || null;
}

/** Reads the parent pid (field 4) from /proc/<pid>/stat; null when gone or unparsable. */
export function readProcPpid(pid: number, procRoot = '/proc'): number | null {
  const v = Number(statFields(pid, procRoot)?.[1]);
  return Number.isInteger(v) ? v : null;
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
    ppidOf: pid => readProcPpid(pid),
    // Sync and race-free with stop(); bounded to ~120ms per freeze() call.
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
  deps: Pick<SignalDeps, 'kill' | 'startTicksOf' | 'ppidOf'>,
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
  /** insertion order = freeze order (ancestor-first) */
  private frozen = new Map<number, { startTicks: number; ppid?: number }>();
  /** `pid:startTicks` whose SIGSTOP was refused on the previous freeze() call */
  private refusedLast = new Set<string>();
  /** `pid:startTicks` of parents that never read as stopped on the previous freeze() call */
  private unsettledLast = new Set<string>();

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
      const list: FrozenProc[] = [...this.frozen].map(([pid, f]) => ({ pid, ...f }));
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
   * SIGSTOPs ancestors before descendants, confirming each parent is stopped before
   * signalling its children: a non-interactive `bash -c` waits with WUNTRACED, so seeing its
   * child stop first makes it exit 147 and fail the command. A parent whose SIGSTOP is
   * refused, or that never reads as stopped within the budget (and isn't in D state, where
   * it can't be in wait4), keeps its descendants running until the next call; the same
   * parent twice in a row, they are frozen anyway (saving the machine wins). Parents stopped
   * by an earlier call are checked the same way.
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
    /** tracked before this call: those are already stopped and must stay tracked */
    const prior = new Map(this.frozen);
    const levels = treeLevels(candidates);
    for (const level of levels) {
      for (const p of level) this.frozen.set(p.pid, { startTicks: p.startTicks, ppid: p.ppid });
    }
    if (candidates.length) this.persist();
    const keepsPrior = (p: FreezeTarget) => prior.get(p.pid)?.startTicks === p.startTicks;
    let count = 0;
    let changed = false;
    /** stopped by this call or an earlier one: a child of one waits for it to read T */
    const stopped = new Set(prior.keys());
    /** refused or deferred: still running, so its descendants must not be stopped yet */
    const running = new Set<number>();
    const refused = new Set<string>();
    const unsettled = new Set<string>();
    const budget = { polls: STOP_POLLS };
    const unconfirmed: number[] = [];
    const untrack = (p: FreezeTarget) => {
      if (keepsPrior(p)) return;
      this.frozen.delete(p.pid);
      stopped.delete(p.pid);
      changed = true;
    };
    for (const level of levels) {
      const parents = [...new Set(level.flatMap(p =>
        (p.ppid !== undefined && stopped.has(p.ppid) && !running.has(p.ppid) ? [p.ppid] : [])))];
      // Once the budget is spent this is a single unpolled state check.
      const { dState, pending } = this.waitStopped(parents, budget);
      unconfirmed.push(...dState, ...pending);
      for (const pid of pending) {
        const key = `${pid}:${this.frozen.get(pid)?.startTicks}`;
        unsettled.add(key);
        if (!this.unsettledLast.has(key)) running.add(pid);
      }
      for (const p of level) {
        if (p.ppid !== undefined && running.has(p.ppid)) {
          // Deferred: untracked (unless an earlier call already stopped it), so the guard
          // offers it again next tick.
          if (!keepsPrior(p)) running.add(p.pid);
          untrack(p);
          continue;
        }
        const r = this.send(p.pid, p.startTicks, 'SIGSTOP');
        if (r === 'sent') {
          count++;
          stopped.add(p.pid);
          continue;
        }
        // Gone, or the stop was refused: not stopped by this call, so don't track it
        // (a refused re-stop of a pid an earlier call stopped stays tracked).
        if (r === 'gone') {
          this.frozen.delete(p.pid);
          stopped.delete(p.pid);
          changed = true;
          continue;
        }
        const key = `${p.pid}:${p.startTicks}`;
        refused.add(key);
        if (!this.refusedLast.has(key) && !keepsPrior(p)) running.add(p.pid);
        untrack(p);
      }
    }
    this.refusedLast = refused;
    this.unsettledLast = unsettled;
    if (changed) this.persist();
    if (unconfirmed.length) this.deps.log?.('freeze_parent_unconfirmed', { pids: unconfirmed, budgetSpent: budget.polls <= 0 });
    return count;
  }

  /**
   * Polls until every pid reads as stopped (or gone), spending from the call-wide budget
   * (a spent budget still checks once). A D-state pid won't confirm, so it isn't waited on.
   */
  private waitStopped(pids: number[], budget: { polls: number }): { dState: number[]; pending: number[] } {
    const { stateOf, sleepMs } = this.deps;
    if (!stateOf || pids.length === 0) return { dState: [], pending: [] };
    const dState: number[] = [];
    let pending = pids;
    for (;;) {
      pending = pending.filter(pid => {
        let st: string | null;
        try { st = stateOf(pid); } catch { return false; }
        if (st === UNWAITABLE) { dState.push(pid); return false; }
        return st !== null && !SETTLED.has(st);
      });
      if (pending.length === 0 || budget.polls <= 0) return { dState, pending };
      budget.polls--;
      try { sleepMs?.(STOP_POLL_MS); } catch { /* keep polling */ }
    }
  }

  /**
   * SIGCONTs descendants before ancestors, so a stopped parent never sees a child stop.
   * If a descendant's SIGCONT is refused its ancestors stay stopped too (a resumed
   * `bash -c` would reap the stopped child as exit 147); all of them are kept for retry.
   */
  thawAll(): number {
    const entries = [...this.frozen].reverse().map(([pid, f]) => ({ pid, ...f }));
    let count = 0;
    for (const { pid, r } of this.continueBottomUp(entries)) {
      if (r === 'sent') count++;
      if (r !== 'failed') this.frozen.delete(pid);
    }
    this.refusedLast.clear();
    this.unsettledLast.clear();
    this.persist();
    return count;
  }

  /**
   * SIGCONTs entries leaf-first by tree depth (ppid within the set); entries is the fallback
   * order inside a depth. A pid with a held child is itself held ('failed', not signalled).
   */
  private continueBottomUp(entries: FrozenProc[]): Array<{ pid: number; r: SendResult }> {
    const ordered = treeLevels(entries).reverse().flat();
    /** parents of held pids */
    const holdFor = new Set<number>();
    const out: Array<{ pid: number; r: SendResult }> = [];
    for (const e of ordered) {
      const r: SendResult = holdFor.has(e.pid) ? 'failed' : this.send(e.pid, e.startTicks, 'SIGCONT');
      if (r === 'failed' && e.ppid !== undefined) holdFor.add(e.ppid);
      out.push({ pid: e.pid, r });
    }
    return out;
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

  /**
   * Resumes a crashed run's file bottom-up. Tree order comes from live /proc ppids when
   * available, so files written ancestor-last (pre-fix builds) still resume leaves first.
   */
  recoverFromCrash(): number {
    const file = this.readPersisted();
    const entries = file.slice().reverse().map(p => {
      let ppid: number | null | undefined;
      try { ppid = this.deps.ppidOf?.(p.pid); } catch { ppid = null; }
      return { pid: p.pid, startTicks: p.startTicks, ppid: ppid ?? p.ppid };
    });
    let count = 0;
    const kept = new Set<number>();
    for (const { pid, r } of this.continueBottomUp(entries)) {
      if (r === 'sent') count++;
      // Keep refused entries so the next thawAll retries them.
      if (r === 'failed') kept.add(pid);
    }
    for (const e of entries.slice().reverse()) {
      if (kept.has(e.pid)) this.frozen.set(e.pid, { startTicks: e.startTicks, ppid: e.ppid });
    }
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
function treeLevels<T extends { pid: number; ppid?: number }>(procs: T[]): T[][] {
  const byPid = new Map(procs.map(p => [p.pid, p] as const));
  const depth = new Map<number, number>();
  const depthOf = (p: T): number => {
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
  const levels: T[][] = [];
  for (const p of procs) (levels[depthOf(p)] ??= []).push(p);
  return levels.filter(Boolean);
}
