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
  onStart: (task: SwarmTask) => void;
}

export class SwarmScheduler {
  private tasks: SwarmTask[] = [];
  constructor(private opts: SchedulerOptions) {}

  setTasks(tasks: SwarmTask[]) {
    this.tasks = tasks;
    this.tick();
  }

  setCap(cap: number) {
    this.opts.cap = cap;
    this.tick();
  }

  tick() {
    const streaming = this.tasks.filter(t => t.status === 'streaming').length;
    let free = this.opts.cap - streaming;
    if (free <= 0) return;
    for (const t of this.tasks) {
      if (free === 0) break;
      if (t.status === 'queued') {
        // Mark in-memory so a re-tick before external state catches up doesn't double-promote.
        (t as SwarmTask).status = 'streaming';
        this.opts.onStart(t);
        free--;
      }
    }
  }
}
