// electron/services/workspace.ts
import { ChildProcess } from 'node:child_process';
import type * as pty from 'node-pty';
import { BrowserWindow } from 'electron';

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
  } | null;
  busy: boolean;           // true while a turn is in progress
  turnSeq: number;         // monotonic counter — incremented each turn, tags streaming_start/done
  suppressForward: boolean; // true during commit msg generation — suppresses IPC forwarding
  // Approval flow state
  pendingToolUse: PendingToolUse | null;
  approvalBuffered: any[];
  awaitingApproval: boolean;
}

export interface WorkspaceCodex {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
  turnSeq: number;
}

export interface WorkspaceGemini {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
  turnSeq: number;
}

export interface Workspace {
  projectPath: string;
  claude: WorkspaceClaude;
  codex: WorkspaceCodex;
  gemini: WorkspaceGemini;
  terminals: Map<number, pty.IPty>;
  lastActivity: number;
  status: 'active' | 'suspended';
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
    claude: {
      process: null,
      sessionId: undefined,
      buffer: '',
      cwd: projectPath,
      processConfig: null,
      busy: false,
      turnSeq: 0,
      suppressForward: false,
      pendingToolUse: null,
      approvalBuffered: [],
      awaitingApproval: false,
    },
    codex: {
      process: null,
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

  // Kill Claude process — send done first so the frontend clears streaming state
  if (ws.claude.busy) {
    safeSend('claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
  }
  if (ws.claude.process) {
    ws.claude.process.kill();
    ws.claude.process = null;
  }
  ws.claude.processConfig = null;
  ws.claude.busy = false;
  ws.claude.suppressForward = false;
  ws.claude.pendingToolUse = null;
  ws.claude.approvalBuffered = [];
  ws.claude.awaitingApproval = false;

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
  ws.gemini.busy = false;

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
