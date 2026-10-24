import fs from 'node:fs';
import path from 'node:path';
import type { AiUnit } from './types';

export interface SignalDeps {
  kill: (pid: number, sig: NodeJS.Signals) => void;
  /** Reads field 22 of /proc/<pid>/stat; null when the process is gone. */
  startTicksOf: (pid: number) => number | null;
  persistPath: string;
  fs?: Pick<typeof import('fs'), 'readFileSync' | 'writeFileSync' | 'renameSync'>;
}

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

/** Real deps; touches nothing until called, so tests never need these. */
export function defaultSignalDeps(persistPath: string): SignalDeps {
  return {
    kill: (pid, sig) => { process.kill(pid, sig); },
    startTicksOf: pid => readStartTicks(pid),
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

  private persist(): void {
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

  freeze(procs: Array<{ pid: number; startTicks: number }>): number {
    // Persist intent before SIGSTOP so a crash mid-freeze still gets recovered.
    const candidates = procs.filter(p => {
      try {
        return p.pid > 1 && this.deps.startTicksOf(p.pid) === p.startTicks;
      } catch {
        return false;
      }
    });
    for (const p of candidates) this.frozen.set(p.pid, p.startTicks);
    if (candidates.length) this.persist();
    let count = 0;
    let changed = false;
    for (const p of candidates) {
      if (this.send(p.pid, p.startTicks, 'SIGSTOP') === 'sent') {
        count++;
      } else {
        // Gone, or the stop was refused: it is not stopped, so don't track it.
        this.frozen.delete(p.pid);
        changed = true;
      }
    }
    if (changed) this.persist();
    return count;
  }

  thawAll(): number {
    let count = 0;
    for (const [pid, startTicks] of [...this.frozen]) {
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
    for (const p of this.readPersisted()) {
      const r = this.send(p.pid, p.startTicks, 'SIGCONT');
      if (r === 'sent') count++;
      // Keep refused entries so the next thawAll retries them.
      if (r === 'failed') this.frozen.set(p.pid, p.startTicks);
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
