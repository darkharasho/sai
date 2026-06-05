// electron/services/workspace.ts
import { ChildProcess } from 'node:child_process';
import type * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import type { GeminiAcpClient } from './gemini-acp';

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
}

export interface WorkspaceGemini {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
  turnSeq: number;
  transport: GeminiAcpClient | null;
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
  /** Meta-workspace preamble — stashed for future injection if gemini gains a system-prompt hook. */
  metaPreamble?: string;
}

export interface Workspace {
  projectPath: string;
  claudeScopes: Map<string, WorkspaceClaude>;
  codex: WorkspaceCodex;
  gemini: WorkspaceGemini;
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
    awaitingPlanReview: false,
    pendingPlanReviewId: null,
    kind: 'chat',
    orchestratorContext: null,
    lastActivityAt: Date.now(),
    streaming: false,
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
    gemini: {
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
    },
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

export function suspend(projectPath: string, win: BrowserWindow): void {
  const ws = workspaces.get(projectPath);
  if (!ws || ws.status === 'suspended') return;

  const safeSend = (channel: string, ...args: any[]) => {
    try { if (!win.isDestroyed() && win.webContents) win.webContents.send(channel, ...args); } catch { /* destroyed */ }
  };

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

  // Kill Gemini process
  if (ws.gemini.busy) {
    safeSend('claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.gemini.turnSeq });
  }
  if (ws.gemini.process) {
    ws.gemini.process.kill();
    ws.gemini.process = null;
  }
  ws.gemini.transport?.dispose();
  ws.gemini.transport = null;
  ws.gemini.loadedSessionIds.clear();
  ws.gemini.bootstrappedSessionIds.clear();
  ws.gemini.suppressedScopes.clear();
  ws.gemini.busy = false;
  ws.gemini.chatSessionId = undefined;
  ws.gemini.commitSessionId = undefined;
  ws.gemini.terminalSessions.clear();
  ws.gemini.activeRequestId = undefined;
  ws.gemini.availability = 'available';
  ws.gemini.lastError = undefined;
  ws.gemini.pendingApproval = null;

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

let suspendTimer: ReturnType<typeof setInterval> | null = null;

export function startSuspendTimer(win: BrowserWindow, getTimeout: () => number = () => DEFAULT_SUSPEND_TIMEOUT): void {
  if (suspendTimer) return;
  suspendTimer = setInterval(() => {
    const timeout = getTimeout();
    if (timeout === 0) return; // "Never"
    const now = Date.now();
    for (const [projectPath, ws] of workspaces) {
      if (ws.status === 'active' && now - ws.lastActivity > timeout) {
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
