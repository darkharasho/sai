// electron/services/workspace.ts
import { ChildProcess } from 'node:child_process';
import type * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { AcpClient } from './acp';

export interface PendingToolUse {
  toolName: string;
  toolUseId: string;
  input: Record<string, any>;
}

export interface WorkspaceClaude {
  process: ChildProcess | null;
  sessionId: string | undefined;
  buffer: string;
  cwd: string;
  // Track config the process was spawned with, to detect changes
  processConfig: {
    permMode: string;
    effort: string;
    model: string;
    metaPreamble: string;
  } | null;
  busy: boolean;           // true while a turn is in progress
  turnSeq: number;         // monotonic counter — incremented each turn, tags streaming_start/done
  activeTurnSeq: number;   // turnSeq of the turn the CLI is currently responding to (lags turnSeq when interrupted)
  suppressForward: boolean; // true during commit msg generation — suppresses IPC forwarding
  // Approval flow state
  pendingToolUse: PendingToolUse | null;
  approvalBuffered: any[];
  awaitingApproval: boolean;
  // AskUserQuestion flow state — buffer CLI output between the tool_use and the user's answer
  awaitingQuestionAnswer: boolean;
  pendingQuestionId: string | null;
  // The user's answer, held until the CLI's auto-dismissed turn fully drains so the
  // hidden "dismissed" output never leaks. Flushed to stdin by flushPendingQuestionAnswer.
  pendingQuestionAnswer: { toolUseId: string; answers: Record<string, string | string[]> } | null;
  // True once the auto-dismissed turn's `result` has been seen (the turn drained).
  questionTurnDrained: boolean;
  // Grace timer: if the CLI blocked instead of auto-dismissing (no `result` to wait for),
  // inject the answer anyway so it's never stranded. Reset while the dismissed turn streams.
  questionAnswerFallbackTimer: ReturnType<typeof setTimeout> | null;
  // ExitPlanMode flow state — buffer CLI output until the user approves/rejects the plan
  awaitingPlanReview: boolean;
  pendingPlanReviewId: string | null;
  /** What kind of session this scope is. Determines CLI args (e.g. orchestrator
   *  gets --strict-mcp-config + --tools "" for swarm-only tooling). */
  kind: 'chat' | 'task' | 'orchestrator';
  /** For orchestrator-kind scopes: context used to build the --system-prompt.
   *  Set by claude:start; consumed by ensureProcess at spawn time. */
  orchestratorContext?: Record<string, unknown> | null;
  /** Meta-workspace preamble to inject via --append-system-prompt at spawn time. */
  metaPreamble?: string;
  /** Updated on every inbound stdout chunk. Used by the idle-scope sweep. */
  lastActivityAt: number;
  /** True between streaming_start and done. Idle sweep skips streaming scopes. */
  streaming: boolean;
  /** Set when a scheduling tool_use (ScheduleWakeup/CronCreate) is seen during the
   *  current turn; reset at each streaming_start. Drives scheduled-wait classification. */
  sawSchedulingTool: boolean;
  /** Set when a background launch tool_use (Bash/Agent run_in_background, Workflow)
   *  is seen during the current turn; reset at each streaming_start. Drives
   *  background-wait classification for turns the CLI ends 'completed'. */
  sawBackgroundLaunch: boolean;
  /** Set when a tool_result reporting an async launch is seen during the current
   *  turn; reset at each streaming_start. The runtime can background a launch
   *  whose input never asked for it (Agent with no run_in_background flag), so
   *  the result text is the only launch signal in that case. */
  sawAsyncLaunchResult: boolean;
  /** delaySeconds from the latest ScheduleWakeup input this turn, else null. */
  wakeupResumeInSeconds: number | null;
  /** True from a scheduled-wait result until the next resume (streaming_start).
   *  Defers the idle sweep and drives the "waiting to resume" sidebar marker. */
  pendingWakeup: boolean;
  /** Absolute ms deadline for a pending scheduled wakeup (fire time + grace).
   *  Null when no wakeup is pending or its delay is unknown. Past this, the idle
   *  sweep stops deferring the scope. */
  wakeupDeadline: number | null;
}

export interface WorkspaceCodex {
  process: ChildProcess | null;
  sessionId: string | undefined;
  buffer: string;
  cwd: string;
  busy: boolean;
  turnSeq: number;
  /** Meta-workspace preamble — stashed for future injection if codex gains a system-prompt hook. */
  metaPreamble?: string;
  additionalDirectories?: string[];
}

export interface AcpWorkspaceState {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
  turnSeq: number;
  transport: AcpClient | null;
  loadedSessionIds: Set<string>;
  bootstrappedSessionIds: Set<string>;
  suppressedScopes: Set<string>;
  chatSessionId: string | undefined;
  commitSessionId: string | undefined;
  terminalSessions: Map<string, string>;
  activeRequestId: string | undefined;
  availability: 'available' | 'disabled';
  lastError?: string;
  pendingApproval: {
    toolUseId: string;
    toolName: string;
    input: Record<string, any>;
    description?: string;
    scope: string;
  } | null;
  /** Meta-workspace preamble — stashed for future injection if the provider gains a system-prompt hook. */
  metaPreamble?: string;
}

/** Back-compat alias — the Gemini state shape is now the shared ACP provider state. */
export type WorkspaceGemini = AcpWorkspaceState;

export interface Workspace {
  projectPath: string;
  claudeScopes: Map<string, WorkspaceClaude>;
  codex: WorkspaceCodex;
  gemini: AcpWorkspaceState;
  kimi: AcpWorkspaceState;
  terminals: Map<number, pty.IPty>;
  lastActivity: number;
  status: 'active' | 'suspended';
}

/** Default Claude state for a new scope */
function newClaudeScope(cwd: string): WorkspaceClaude {
  return {
    process: null,
    sessionId: undefined,
    buffer: '',
    cwd,
    processConfig: null,
    busy: false,
    turnSeq: 0,
    activeTurnSeq: 0,
    suppressForward: false,
    pendingToolUse: null,
    approvalBuffered: [],
    awaitingApproval: false,
    awaitingQuestionAnswer: false,
    pendingQuestionId: null,
    pendingQuestionAnswer: null,
    questionTurnDrained: false,
    questionAnswerFallbackTimer: null,
    awaitingPlanReview: false,
    pendingPlanReviewId: null,
    kind: 'chat',
    orchestratorContext: null,
    lastActivityAt: Date.now(),
    streaming: false,
    sawSchedulingTool: false,
    sawBackgroundLaunch: false,
    sawAsyncLaunchResult: false,
    wakeupResumeInSeconds: null,
    pendingWakeup: false,
    wakeupDeadline: null,
  };
}

/** Get (or create) the Claude instance for a given scope within a workspace.
 *  If `kind` is provided and differs from a previously stored kind, the new
 *  kind takes effect on the NEXT process spawn (the in-flight process is left
 *  alone — call sites should respawn explicitly if needed). */
export function getClaude(
  ws: Workspace,
  scope: string = 'chat',
  kind?: 'chat' | 'task' | 'orchestrator',
): WorkspaceClaude {
  let c = ws.claudeScopes.get(scope);
  if (!c) {
    c = newClaudeScope(ws.projectPath);
    ws.claudeScopes.set(scope, c);
  }
  if (kind && c.kind !== kind) {
    if (c.process) {
      console.warn(`[sai] claude scope "${scope}" kind changed ${c.kind} -> ${kind} while process running; new kind applies on next spawn`);
    }
    c.kind = kind;
  }
  return c;
}

const workspaces = new Map<string, Workspace>();

/**
 * Seam for backends whose sessions live outside this registry, so
 * suspend() can't kill them and isWorkspaceQuiescent() can't see them.
 * Registered by each external backend when it is constructed. Provider keys
 * keep one backend from replacing another backend's lifecycle visibility.
 */
export interface WorkspaceBackendHooks {
  suspend?: (projectPath: string) => void;
  isBusy?: (projectPath: string) => boolean;
}
const backendHooks = new Map<string, WorkspaceBackendHooks>();
export function registerWorkspaceBackendHooks(provider: string, hooks: WorkspaceBackendHooks): void {
  backendHooks.set(provider, hooks);
}

function newAcpState(projectPath: string): AcpWorkspaceState {
  return {
    process: null,
    buffer: '',
    cwd: projectPath,
    busy: false,
    turnSeq: 0,
    transport: null,
    loadedSessionIds: new Set(),
    bootstrappedSessionIds: new Set(),
    suppressedScopes: new Set(),
    chatSessionId: undefined,
    commitSessionId: undefined,
    terminalSessions: new Map(),
    activeRequestId: undefined,
    availability: 'available',
    lastError: undefined,
    pendingApproval: null,
  };
}

export function getOrCreate(projectPath: string): Workspace {
  const existing = workspaces.get(projectPath);
  if (existing) {
    existing.status = 'active';
    existing.lastActivity = Date.now();
    return existing;
  }
  const ws: Workspace = {
    projectPath,
    claudeScopes: new Map([['chat', newClaudeScope(projectPath)]]),
    codex: {
      process: null,
      sessionId: undefined,
      buffer: '',
      cwd: projectPath,
      busy: false,
      turnSeq: 0,
    },
    gemini: newAcpState(projectPath),
    kimi: newAcpState(projectPath),
    terminals: new Map(),
    lastActivity: Date.now(),
    status: 'active',
  };
  workspaces.set(projectPath, ws);
  return ws;
}

export function get(projectPath: string): Workspace | undefined {
  return workspaces.get(projectPath);
}

export function listAllWorkspaces(): Workspace[] {
  return Array.from(workspaces.values());
}

export function touchActivity(projectPath: string): void {
  const ws = workspaces.get(projectPath);
  if (ws) ws.lastActivity = Date.now();
}

function resetAcpState(state: AcpWorkspaceState, safeSend: (channel: string, ...args: any[]) => void, projectPath: string) {
  if (state.busy) {
    safeSend('claude:message', { type: 'done', projectPath, turnSeq: state.turnSeq });
  }
  if (state.process) {
    state.process.kill();
    state.process = null;
  }
  state.transport?.dispose();
  state.transport = null;
  state.loadedSessionIds.clear();
  state.bootstrappedSessionIds.clear();
  state.suppressedScopes.clear();
  state.busy = false;
  state.chatSessionId = undefined;
  state.commitSessionId = undefined;
  state.terminalSessions.clear();
  state.activeRequestId = undefined;
  state.availability = 'available';
  state.lastError = undefined;
  state.pendingApproval = null;
}

export function suspend(projectPath: string, win: BrowserWindow): void {
  const ws = workspaces.get(projectPath);
  if (!ws || ws.status === 'suspended') return;

  const safeSend = (channel: string, ...args: any[]) => {
    try { if (!win.isDestroyed() && win.webContents) win.webContents.send(channel, ...args); } catch { /* destroyed */ }
  };

  // Give each selected backend first ownership of its runtime settlement. The
  // built-in workspace cleanup below remains a fallback if a hook fails/no-ops.
  for (const hooks of backendHooks.values()) {
    try { hooks.suspend?.(projectPath); } catch { /* backend already down */ }
  }

  // Kill all Claude scoped processes
  for (const [scope, claude] of ws.claudeScopes) {
    if (claude.busy) {
      safeSend('claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
    }
    if (claude.process) {
      claude.process.kill();
      claude.process = null;
    }
    claude.processConfig = null;
    claude.busy = false;
    claude.suppressForward = false;
    claude.pendingToolUse = null;
    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.awaitingQuestionAnswer = false;
    claude.pendingQuestionId = null;
    claude.awaitingPlanReview = false;
    claude.pendingPlanReviewId = null;
  }

  // Kill Codex process
  if (ws.codex.busy) {
    safeSend('claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.codex.turnSeq });
  }
  if (ws.codex.process) {
    ws.codex.process.kill();
    ws.codex.process = null;
  }
  ws.codex.busy = false;

  // Reset ACP providers (Gemini, Kimi)
  resetAcpState(ws.gemini, safeSend, ws.projectPath);
  resetAcpState(ws.kimi, safeSend, ws.projectPath);

  // Kill all terminals
  for (const term of ws.terminals.values()) {
    term.kill();
  }
  ws.terminals.clear();

  ws.status = 'suspended';

  try {
    if (!win.isDestroyed()) {
      win.webContents.send('workspace:suspended', projectPath);
    }
  } catch { /* window destroyed */ }
}

export function remove(projectPath: string, win: BrowserWindow): void {
  const ws = workspaces.get(projectPath);
  if (!ws) return;
  // Kill everything first
  suspend(projectPath, win);
  workspaces.delete(projectPath);
}

export function getAll(): Array<{ projectPath: string; status: string; lastActivity: number }> {
  return Array.from(workspaces.values()).map(ws => ({
    projectPath: ws.projectPath,
    status: ws.status,
    lastActivity: ws.lastActivity,
  }));
}

export function destroyAll(win: BrowserWindow): void {
  for (const projectPath of workspaces.keys()) {
    suspend(projectPath, win);
  }
  workspaces.clear();
}

const SUSPEND_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_SUSPEND_TIMEOUT = 60 * 60 * 1000; // 1 hour

/**
 * True when no agent in the workspace is doing or waiting on anything:
 * no Claude scope busy/streaming or blocked on user input (question,
 * approval, plan review), and Codex/Gemini/Kimi idle. lastActivity only tracks
 * *user* actions, so the auto-suspend timer must check this too — a long
 * agentic run (or a pending question while the user is away) looks "inactive"
 * by timestamp while a process is very much alive. Mirrors the guards in
 * sweepIdleScopes.
 */
export function isWorkspaceQuiescent(ws: Workspace): boolean {
  for (const claude of ws.claudeScopes.values()) {
    if (claude.busy || claude.streaming) return false;
    if (claude.awaitingQuestionAnswer || claude.awaitingApproval || claude.awaitingPlanReview) return false;
  }
  if (ws.codex.busy) return false;
  if (ws.gemini.busy || ws.kimi.busy) return false;
  for (const hooks of backendHooks.values()) {
    try {
      if (hooks.isBusy?.(ws.projectPath)) return false;
    } catch {
      // Unknown backend state must not allow the idle timer to reap live work.
      return false;
    }
  }
  return true;
}

let suspendTimer: ReturnType<typeof setInterval> | null = null;

export function startSuspendTimer(win: BrowserWindow, getTimeout: () => number = () => DEFAULT_SUSPEND_TIMEOUT): void {
  if (suspendTimer) return;
  suspendTimer = setInterval(() => {
    const timeout = getTimeout();
    if (timeout === 0) return; // "Never"
    const now = Date.now();
    for (const [projectPath, ws] of workspaces) {
      if (ws.status === 'active' && now - ws.lastActivity > timeout && isWorkspaceQuiescent(ws)) {
        suspend(projectPath, win);
      }
    }
  }, SUSPEND_CHECK_INTERVAL);
}

export function stopSuspendTimer(): void {
  if (suspendTimer) {
    clearInterval(suspendTimer);
    suspendTimer = null;
  }
}
