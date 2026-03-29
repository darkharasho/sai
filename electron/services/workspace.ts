// electron/services/workspace.ts
import { ChildProcess } from 'node:child_process';
import type * as pty from 'node-pty';
import { BrowserWindow } from 'electron';

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
  suppressForward: boolean; // true during commit msg generation — suppresses IPC forwarding
}

export interface Workspace {
  projectPath: string;
  claude: WorkspaceClaude;
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
      suppressForward: false,
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

  // Kill Claude process
  if (ws.claude.process) {
    ws.claude.process.kill();
    ws.claude.process = null;
  }
  ws.claude.processConfig = null;
  ws.claude.busy = false;
  ws.claude.suppressForward = false;

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
const SUSPEND_TIMEOUT = 60 * 60 * 1000; // 1 hour

let suspendTimer: ReturnType<typeof setInterval> | null = null;

export function startSuspendTimer(win: BrowserWindow): void {
  if (suspendTimer) return;
  suspendTimer = setInterval(() => {
    const now = Date.now();
    for (const [projectPath, ws] of workspaces) {
      if (ws.status === 'active' && now - ws.lastActivity > SUSPEND_TIMEOUT) {
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
