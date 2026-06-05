import type { SwarmTask } from '../types';
import { isWriteTool } from './swarmToolTaxonomy';

export { isWriteTool };

const READ_ONLY_PROMPT_RE = /^(explain|what|why|how|describe|read|show)\b/i;
export function isLikelyReadOnlyPrompt(prompt: string): boolean {
  return READ_ONLY_PROMPT_RE.test(prompt.trim());
}

export interface MaterializeDeps {
  worktreeAdd: (workspaceId: string, taskId: string, branch: string, baseBranch: string) => Promise<string>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function materializeIfNeeded(
  task: SwarmTask,
  toolName: string,
  deps: MaterializeDeps
): Promise<string | null> {
  if (task.worktreePath) return task.worktreePath;
  if (!isWriteTool(toolName)) return null;
  const targetPath = task.projectPath || task.workspaceId;
  const wt = await deps.worktreeAdd(targetPath, task.id, task.branch, task.baseBranch);
  await deps.updateTask(task.id, { worktreePath: wt });
  return wt;
}

export interface SchedulerOptions {
  cap: number;
  /**
   * Start a promoted task. May be sync or async. A thrown error or a rejected
   * promise signals the start failed, freeing the reserved slot. Returning
   * normally means the task is starting; the scheduler keeps the slot reserved
   * until external state (via setTasks) reports the task as no longer 'queued'.
   */
  onStart: (task: SwarmTask) => void | Promise<unknown>;
}

export class SwarmScheduler {
  private tasks: SwarmTask[] = [];
  // Tasks we've called onStart for but whose 'streaming' status hasn't yet been
  // reflected back through setTasks. Reserved against the cap so we never exceed
  // it during the async gap, and cleared on confirmed start or failure.
  private pendingStart = new Set<string>();
  constructor(private opts: SchedulerOptions) {}

  setTasks(tasks: SwarmTask[]) {
    this.tasks = tasks;
    // Drop pending reservations for tasks external state now reports as no
    // longer queued (started → streaming, terminalized, or removed).
    const statusById = new Map(tasks.map(t => [t.id, t.status] as const));
    for (const id of [...this.pendingStart]) {
      if (statusById.get(id) !== 'queued') this.pendingStart.delete(id);
    }
    this.tick();
  }

  setCap(cap: number) {
    this.opts.cap = cap;
    this.tick();
  }

  /** Slots in use: distinct streaming tasks plus outstanding pending starts. */
  private occupiedCount(): number {
    const ids = new Set<string>();
    for (const t of this.tasks) if (t.status === 'streaming') ids.add(t.id);
    for (const id of this.pendingStart) ids.add(id);
    return ids.size;
  }

  tick() {
    let free = this.opts.cap - this.occupiedCount();
    if (free <= 0) return;
    for (const t of this.tasks) {
      if (free === 0) break;
      if (t.status === 'queued' && !this.pendingStart.has(t.id)) {
        this.pendingStart.add(t.id);
        free--;
        this.launch(t);
      }
    }
  }

  private launch(task: SwarmTask) {
    let result: void | Promise<unknown>;
    try {
      result = this.opts.onStart(task);
    } catch {
      // Synchronous failure: release the slot. Promotion of others happens on
      // the next tick (driven by the App removing/terminalizing the failed task).
      this.pendingStart.delete(task.id);
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, () => {
        // Async failure: release the slot so the next setTasks/setCap tick can
        // promote another queued task.
        this.pendingStart.delete(task.id);
      });
    }
  }
}

/**
 * Streaming tasks whose last activity is strictly older than `thresholdMs`.
 * Used by the watchdog to reclaim cap slots from providers that died silently
 * (no terminal `done`/`result`/fatal `error` ever arrived).
 */
export function findStaleTasks(
  tasks: readonly SwarmTask[],
  now: number,
  thresholdMs: number,
): SwarmTask[] {
  return tasks.filter(
    t => t.status === 'streaming' && now - t.lastActivityAt > thresholdMs,
  );
}
