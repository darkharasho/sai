import type { SwarmTask, ApprovalPolicy } from '../types';

/**
 * Dependencies the swarm task runner needs from the renderer's IPC bridge.
 * Kept narrow + injectable so this module can be unit-tested without electron.
 */
export interface SwarmRunnerDeps {
  claudeStart: (
    cwd: string,
    scope?: string,
    kind?: string,
    orchestratorContext?: unknown,
  ) => Promise<unknown>;
  claudeSend: (
    projectPath: string,
    message: string,
    imagePaths: string[] | undefined,
    permMode: string | undefined,
    effort: string | undefined,
    model: string | undefined,
    scope: string | undefined,
  ) => void;
}

/**
 * Map a SwarmTask's approvalPolicy to the Claude CLI permission mode the
 * renderer should pass through claudeSend.
 *
 *  - auto         → 'bypass'   (no approvals)
 *  - auto-read    → 'default'  (renderer's auto-approval intercepts reads)
 *  - always-ask   → 'default'  (every approval is shown to the user)
 */
export function permModeForPolicy(policy: ApprovalPolicy): 'bypass' | 'default' {
  return policy === 'auto' ? 'bypass' : 'default';
}

/**
 * Resolve the cwd a swarm task should run in. Prefers the materialized
 * worktree path when available, otherwise falls back to the project root —
 * appropriate for read-only tasks that haven't materialized a worktree yet.
 */
export function cwdForTask(task: Pick<SwarmTask, 'worktreePath' | 'workspaceId'>): string {
  return task.worktreePath || task.workspaceId;
}

/**
 * Kick off a swarm task by starting the provider's per-scope process and
 * sending the task prompt as the first message. Today this only supports
 * Claude — Codex and Gemini's IPC surface doesn't yet thread `scope`/`kind`
 * through start, so wiring them up requires backend changes (TODO).
 *
 * Returns true if the task was actually dispatched, false if the provider
 * is unsupported (caller can decide whether to mark the task failed).
 */
export async function runSwarmTask(task: SwarmTask, deps: SwarmRunnerDeps): Promise<boolean> {
  if (task.provider !== 'claude') {
    // Codex/Gemini parity is deferred; see investigation in PR description.
    return false;
  }
  const cwd = cwdForTask(task);
  const permMode = permModeForPolicy(task.approvalPolicy);
  await deps.claudeStart(cwd, task.sessionId, 'task');
  deps.claudeSend(cwd, task.prompt, undefined, permMode, undefined, task.model, task.sessionId);
  return true;
}
