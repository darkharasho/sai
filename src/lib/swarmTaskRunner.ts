import type { SwarmTask, ApprovalPolicy } from '../types';

/**
 * Dependencies the swarm task runner needs from the renderer's IPC bridge.
 * Kept narrow + injectable so this module can be unit-tested without electron.
 */
export type ProviderStart = (
  projectPath: string,
  scope?: string,
  kind?: string,
  orchestratorContext?: unknown,
  scopeCwd?: string,
) => Promise<unknown>;

export type ProviderSend = (
  projectPath: string,
  message: string,
  imagePaths: string[] | undefined,
  permMode: string | undefined,
  effort: string | undefined,
  model: string | undefined,
  scope: string | undefined,
) => void;

export interface SwarmRunnerDeps {
  claudeStart: ProviderStart;
  claudeSend: ProviderSend;
  codexStart?: ProviderStart;
  codexSend?: ProviderSend;
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
 * Map a SwarmTask's approvalPolicy to Codex's SDK permission vocabulary.
 *
 *  - auto                     → 'full-access'
 *  - auto-read / always-ask   → 'auto' (workspace-write, on-request)
 */
export function codexPermissionForPolicy(policy: ApprovalPolicy): 'auto' | 'full-access' {
  return policy === 'auto' ? 'full-access' : 'auto';
}

/**
 * Resolve the cwd a swarm task should run in. Prefers the materialized
 * worktree path when available, otherwise falls back to the project root —
 * appropriate for read-only tasks that haven't materialized a worktree yet.
 */
export function cwdForTask(task: Pick<SwarmTask, 'worktreePath' | 'workspaceId' | 'projectPath'>): string {
  return task.worktreePath || task.projectPath || task.workspaceId;
}

/**
 * Kick off a swarm task by starting the provider's per-scope process and
 * sending the task prompt as the first message. Claude and Codex workers use
 * their scoped IPC bridges; other providers remain unsupported.
 *
 * Returns true if the task was actually dispatched, false if the provider
 * is unsupported (caller can decide whether to mark the task failed).
 */
export async function runSwarmTask(task: SwarmTask, deps: SwarmRunnerDeps): Promise<boolean> {
  if (task.provider === 'claude') {
    // Workspace key (projectPath in emitted events) stays the original workspace
    // root so ChatPanel + listeners can find the task. The scope's working dir
    // is pinned to the worktree (when materialized) via scopeCwd so Claude reads
    // and writes inside the isolated worktree.
    const projectPath = task.workspaceId;
    const scopeCwd = cwdForTask(task);
    const permMode = permModeForPolicy(task.approvalPolicy);
    await deps.claudeStart(projectPath, task.sessionId, 'task', undefined, scopeCwd);
    deps.claudeSend(projectPath, task.prompt, undefined, permMode, task.effort, task.model, task.sessionId);
    return true;
  }

  if (task.provider === 'codex') {
    if (!deps.codexStart || !deps.codexSend) {
      return false;
    }

    const projectPath = task.workspaceId;
    const scopeCwd = cwdForTask(task);
    await deps.codexStart(projectPath, task.sessionId, 'task', undefined, scopeCwd);
    deps.codexSend(
      projectPath,
      task.prompt,
      undefined,
      codexPermissionForPolicy(task.approvalPolicy),
      undefined,
      task.model,
      task.sessionId,
    );
    return true;
  }

  return false;
}
