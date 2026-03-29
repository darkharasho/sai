# Multi-Project Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable simultaneous project contexts with independent Claude sessions, terminals, git state, and open files, switchable via a dropdown without interrupting work.

**Architecture:** Refactor backend services (claude.ts, pty.ts) from module-level globals to a workspace map keyed by project path. Each workspace owns its own Claude subprocess, terminal PTYs, and session ID. Frontend holds a `Map<string, WorkspaceContext>` and swaps which context is visible. A suspend timer kills processes after 1 hour of inactivity.

**Tech Stack:** Electron (main process), React 19, TypeScript, node-pty, xterm.js

**Spec:** `docs/superpowers/specs/2026-03-28-multi-project-workspaces-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `electron/services/workspace.ts` | Workspace map, lifecycle (create/suspend/remove), suspend timer |
| Modify | `electron/services/claude.ts` | Remove module globals, accept workspace object, add projectPath to messages |
| Modify | `electron/services/pty.ts` | Remove global terminals map, accept workspace object for terminal tracking |
| Modify | `electron/main.ts` | Wire workspace manager, register new IPC handlers, update close cleanup |
| Modify | `electron/preload.ts` | Add projectPath params to claude:send/stop, add workspace IPC bindings |
| Modify | `src/types.ts` | Add WorkspaceContext interface |
| Modify | `src/sessions.ts` | Per-project localStorage keys, migration logic |
| Modify | `src/App.tsx` | Workspace map state, context switching, message routing |
| Modify | `src/components/TitleBar.tsx` | Project switcher dropdown with status dots and grouped sections |
| Modify | `src/components/Chat/ChatPanel.tsx` | Pass projectPath to claudeSend/claudeStop, filter messages by projectPath |
| Modify | `src/components/Terminal/TerminalPanel.tsx` | No changes needed (already keys on projectPath via useEffect) |

---

### Task 1: Create Workspace Manager

**Files:**
- Create: `electron/services/workspace.ts`

- [ ] **Step 1: Create workspace.ts with Workspace type and map**

```typescript
// electron/services/workspace.ts
import { ChildProcess } from 'node:child_process';
import type * as pty from 'node-pty';
import { BrowserWindow } from 'electron';

export interface WorkspaceClaude {
  process: ChildProcess | null;
  probe: ChildProcess | null;
  sessionId: string | undefined;
  buffer: string;
  cwd: string;
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
      probe: null,
      sessionId: undefined,
      buffer: '',
      cwd: projectPath,
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

  // Kill Claude processes
  if (ws.claude.probe) {
    ws.claude.probe.kill();
    ws.claude.probe = null;
  }
  if (ws.claude.process) {
    ws.claude.process.kill();
    ws.claude.process = null;
  }

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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to workspace.ts (other pre-existing errors are fine)

- [ ] **Step 3: Commit**

```bash
git add electron/services/workspace.ts
git commit -m "feat: add workspace manager for multi-project support"
```

---

### Task 2: Refactor Claude Service to Use Workspace

**Files:**
- Modify: `electron/services/claude.ts`

- [ ] **Step 1: Rewrite claude.ts to use workspace instead of globals**

Replace the entire contents of `electron/services/claude.ts` with:

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
	try {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	} catch {
		// Window already destroyed
	}
}

export function registerClaudeHandlers(win: BrowserWindow) {
	ipcMain.handle('claude:start', (_event, cwd: string) => {
		const ws = getOrCreate(cwd);

		// Kill any in-flight probe or active process for this workspace
		if (ws.claude.probe) {
			ws.claude.probe.kill();
			ws.claude.probe = null;
		}
		if (ws.claude.process) {
			ws.claude.process.kill();
			ws.claude.process = null;
		}

		ws.claude.cwd = cwd || process.env.HOME || '/';
		ws.claude.sessionId = undefined;

		// Probe Claude to get slash commands from init message
		return new Promise<void>((resolve) => {
			const probe = spawn('claude', [
				'-p', 'hi',
				'--output-format', 'stream-json',
				'--verbose',
				'--max-turns', '1',
			], {
				cwd: ws.claude.cwd,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			ws.claude.probe = probe;

			let probeBuffer = '';
			probe.stdout?.on('data', (data: Buffer) => {
				// Ignore output from a stale probe
				if (ws.claude.probe !== probe) return;

				probeBuffer += data.toString();
				const lines = probeBuffer.split('\n');
				probeBuffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.type === 'system' && msg.subtype === 'init') {
							safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
						}
						if (msg.session_id && !ws.claude.sessionId) {
							ws.claude.sessionId = msg.session_id;
						}
					} catch { /* ignore */ }
				}
			});

			probe.on('exit', () => {
				if (ws.claude.probe === probe) {
					ws.claude.probe = null;
					safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
				}
				resolve();
			});

			probe.on('error', () => {
				if (ws.claude.probe === probe) {
					ws.claude.probe = null;
					safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
				}
				resolve();
			});
		});
	});

	ipcMain.on('claude:stop', (_event, projectPath: string) => {
		const ws = get(projectPath);
		if (!ws) return;
		if (ws.claude.process) {
			const proc = ws.claude.process;
			ws.claude.process = null;
			proc.kill();
			safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
		}
	});

	ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string) => {
		const ws = get(cwd);
		const effectiveCwd = cwd || ws?.claude.cwd || process.env.HOME || '/';

		// Get the diff upfront so Claude doesn't need tool calls
		const diff = await new Promise<string>((resolve) => {
			const diffProc = spawn('git', ['diff', '--staged'], {
				cwd: effectiveCwd,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			let out = '';
			diffProc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
			diffProc.on('exit', () => resolve(out.trim()));
			diffProc.on('error', () => resolve(''));
		});

		if (!diff) return '';

		// Truncate very large diffs to keep the request fast
		const maxLen = 8000;
		const truncatedDiff = diff.length > maxLen
			? diff.slice(0, maxLen) + '\n... (diff truncated)'
			: diff;

		return new Promise<string>((resolve) => {
			const proc = spawn('claude', [
				'-p', `Generate a concise commit message for this diff. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.\n\n${truncatedDiff}`,
				'--output-format', 'text',
				'--max-turns', '1',
			], {
				cwd: effectiveCwd,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let output = '';
			proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
			proc.on('exit', () => resolve(output.trim()));
			proc.on('error', () => resolve(''));
		});
	});

	ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string) => {
		const ws = get(projectPath);
		if (!ws) return;

		touchActivity(projectPath);

		if (ws.claude.process) {
			ws.claude.process.kill();
			ws.claude.process = null;
		}

		// Prepend image file paths to the prompt so Claude reads them via its Read tool
		let prompt = message;
		if (imagePaths && imagePaths.length > 0) {
			const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
			prompt = `${imageRefs}\n\n${message}`;
		}

		const args = [
			'-p', prompt,
			'--output-format', 'stream-json',
			'--verbose',
			'--include-partial-messages',
		];

		if (ws.claude.sessionId) {
			args.push('--resume', ws.claude.sessionId);
		}

		// Map permission modes to Claude CLI flags
		if (permMode === 'bypass') {
			args.push('--permission-mode', 'bypassPermissions');
		} else {
			args.push('--permission-mode', 'acceptEdits');
		}

		safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

		ws.claude.process = spawn('claude', args, {
			cwd: ws.claude.cwd,
			env: { ...process.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		ws.claude.buffer = '';

		ws.claude.process.stdout?.on('data', (data: Buffer) => {
			ws.claude.buffer += data.toString();
			const lines = ws.claude.buffer.split('\n');
			ws.claude.buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.session_id && !ws.claude.sessionId) {
						ws.claude.sessionId = msg.session_id;
					}
					safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
				} catch { /* ignore */ }
			}
		});

		ws.claude.process.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text) {
				safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
			}
		});

		const proc = ws.claude.process;
		proc.on('exit', () => {
			if (ws.claude.process !== proc) return; // killed by stop or new send
			if (ws.claude.buffer.trim()) {
				try {
					safeSend(win, 'claude:message', { ...JSON.parse(ws.claude.buffer), projectPath: ws.projectPath });
				} catch { /* ignore */ }
			}
			ws.claude.buffer = '';
			safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
			ws.claude.process = null;
		});
	});
}

export function destroyClaude() {
	// Now handled by workspace.destroyAll — this is kept for backwards compat during migration
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add electron/services/claude.ts
git commit -m "refactor: claude service uses workspace instead of globals"
```

---

### Task 3: Refactor Terminal Service to Use Workspace

**Files:**
- Modify: `electron/services/pty.ts`

- [ ] **Step 1: Rewrite pty.ts to register terminals with workspaces**

Replace the entire contents of `electron/services/pty.ts` with:

```typescript
import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';
import { get, touchActivity } from './workspace';

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
	try {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	} catch {
		// Window already destroyed
	}
}

// Global map for ID→terminal lookup (IDs are globally unique)
const allTerminals = new Map<number, pty.IPty>();
// Reverse lookup: terminal ID → project path
const terminalOwner = new Map<number, string>();
let nextId = 1;

export function registerTerminalHandlers(win: BrowserWindow) {
  ipcMain.handle('terminal:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env: process.env as Record<string, string>,
    });

    allTerminals.set(id, term);

    // Register with workspace if one exists for this cwd
    const ws = get(cwd);
    if (ws) {
      ws.terminals.set(id, term);
      terminalOwner.set(id, cwd);
    }

    term.onData((data) => { safeSend(win, 'terminal:data', id, data); });
    term.onExit(() => {
      allTerminals.delete(id);
      const owner = terminalOwner.get(id);
      if (owner) {
        const ownerWs = get(owner);
        ownerWs?.terminals.delete(id);
        terminalOwner.delete(id);
      }
    });
    return id;
  });

  ipcMain.on('terminal:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
    // Update activity for owning workspace
    const owner = terminalOwner.get(id);
    if (owner) touchActivity(owner);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resize(cols, rows);
  });
}

export function destroyAllTerminals() {
  for (const term of allTerminals.values()) { term.kill(); }
  allTerminals.clear();
  terminalOwner.clear();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add electron/services/pty.ts
git commit -m "refactor: terminal service registers PTYs with workspaces"
```

---

### Task 4: Wire Workspace Manager into Main Process

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Update main.ts imports and close handler**

At the top of `electron/main.ts`, add the workspace import:

```typescript
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove } from './services/workspace';
```

- [ ] **Step 2: Update the close handler**

Replace the `mainWindow.on('close', ...)` block:

```typescript
  mainWindow.on('close', () => {
    stopSuspendTimer();
    destroyAllTerminals();
    destroyAll(mainWindow!);
  });
```

- [ ] **Step 3: Start suspend timer after registering handlers**

After the `registerUpdater(mainWindow!)` line, add:

```typescript
  startSuspendTimer(mainWindow);
```

- [ ] **Step 4: Register new workspace IPC handlers**

After the `startSuspendTimer` call, add:

```typescript
  ipcMain.handle('workspace:getAll', () => {
    const active = getAll();
    const recent = getRecentProjects();
    // Merge: active/suspended workspaces + recent projects not already in workspaces
    const activeSet = new Set(active.map(w => w.projectPath));
    const recentOnly = recent
      .filter(p => !activeSet.has(p))
      .map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 }));
    return [...active, ...recentOnly];
  });

  ipcMain.handle('workspace:close', (_event, projectPath: string) => {
    remove(projectPath, mainWindow!);
  });
```

- [ ] **Step 5: Update window-all-closed handler**

Replace the `app.on('window-all-closed', ...)` block:

```typescript
app.on('window-all-closed', () => {
  stopSuspendTimer();
  destroyAllTerminals();
  if (mainWindow) destroyAll(mainWindow);
  app.quit();
});
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts
git commit -m "feat: wire workspace manager into main process with suspend timer"
```

---

### Task 5: Update Preload API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Update claudeSend to include projectPath**

Change the `claudeSend` line from:
```typescript
claudeSend: (message: string, imagePaths?: string[], permMode?: string) => ipcRenderer.send('claude:send', message, imagePaths, permMode),
```
to:
```typescript
claudeSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string) => ipcRenderer.send('claude:send', projectPath, message, imagePaths, permMode),
```

- [ ] **Step 2: Update claudeStop to include projectPath**

Change the `claudeStop` line from:
```typescript
claudeStop: () => ipcRenderer.send('claude:stop'),
```
to:
```typescript
claudeStop: (projectPath: string) => ipcRenderer.send('claude:stop', projectPath),
```

- [ ] **Step 3: Add workspace IPC bindings**

After the `onUpdateError` binding, add:

```typescript
  workspaceGetAll: () => ipcRenderer.invoke('workspace:getAll'),
  workspaceClose: (projectPath: string) => ipcRenderer.invoke('workspace:close', projectPath),
  onWorkspaceSuspended: (callback: (projectPath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, projectPath: string) => callback(projectPath);
    ipcRenderer.on('workspace:suspended', listener);
    return () => ipcRenderer.removeListener('workspace:suspended', listener);
  },
```

- [ ] **Step 4: Update claudeOnMessage to pass projectPath through**

The existing `claudeOnMessage` already passes the full `msg` object through. Since we now add `projectPath` to every message in claude.ts, no change is needed here. The frontend will read `msg.projectPath` from the callback.

- [ ] **Step 5: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: add projectPath to claude IPC and workspace preload API"
```

---

### Task 6: Add WorkspaceContext Type and Update Sessions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/sessions.ts`

- [ ] **Step 1: Add WorkspaceContext to types.ts**

At the end of `src/types.ts`, before the `declare global` block, add:

```typescript
export type WorkspaceStatus = 'active' | 'suspended' | 'recent';

export interface WorkspaceContext {
  projectPath: string;
  sessions: ChatSession[];
  activeSession: ChatSession;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalIds: number[];
  status: WorkspaceStatus;
  lastActivity: number;
}
```

- [ ] **Step 2: Update sessions.ts for per-project storage**

Replace the entire contents of `src/sessions.ts` with:

```typescript
import type { ChatSession } from './types';

const LEGACY_KEY = 'sai-chat-sessions';
const MAX_SESSIONS = 10;

function storageKey(projectPath: string): string {
  return `sai-chat-sessions-${projectPath}`;
}

export function loadSessions(projectPath: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(storageKey(projectPath));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessions(projectPath: string, sessions: ChatSession[]): void {
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(sessions));
  } catch {
    // localStorage quota exceeded - silently fail
  }
}

export function migrateLegacySessions(projectPath: string): void {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const existing = loadSessions(projectPath);
    if (existing.length === 0) {
      // Move legacy sessions to this project
      localStorage.setItem(storageKey(projectPath), legacy);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Migration failed - not critical
  }
}

export function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  // Don't save empty sessions
  if (session.messages.length === 0) {
    return sessions.filter(s => s.id !== session.id);
  }

  // Set title from first user message if not set
  if (!session.title) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      session.title = firstUserMsg.content.slice(0, 40);
    }
  }

  session.updatedAt = Date.now();

  const existing = sessions.findIndex(s => s.id === session.id);
  let updated: ChatSession[];
  if (existing >= 0) {
    updated = [...sessions];
    updated[existing] = session;
  } else {
    updated = [session, ...sessions];
  }

  // Sort by updatedAt descending, keep max
  updated.sort((a, b) => b.updatedAt - a.updatedAt);
  return updated.slice(0, MAX_SESSIONS);
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDate.getTime() === today.getTime()) return 'Today';
  if (sessionDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: Errors in App.tsx due to changed loadSessions/saveSessions signatures (fixed in next task)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/sessions.ts
git commit -m "feat: add WorkspaceContext type and per-project session storage"
```

---

### Task 7: Update ChatPanel for Workspace Routing

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Update claudeSend call to include projectPath**

In `ChatPanel.tsx`, find the `handleSend` function. Change line 285:

```typescript
    window.sai.claudeSend(text, imagePaths, permissionMode);
```

to:

```typescript
    window.sai.claudeSend(projectPath, text, imagePaths, permissionMode);
```

- [ ] **Step 2: Update claudeStop call to include projectPath**

In `ChatPanel.tsx`, find the `ChatInput` component's `onStop` prop (line 309). Change:

```typescript
        onStop={() => window.sai.claudeStop?.()}
```

to:

```typescript
        onStop={() => window.sai.claudeStop?.(projectPath)}
```

- [ ] **Step 3: Filter incoming messages by projectPath**

In the `claudeOnMessage` callback (inside the `useEffect` at line 122), add a filter at the top of the callback. Change:

```typescript
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (msg.type === 'ready') {
```

to:

```typescript
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      // Only process messages for this workspace
      if (msg.projectPath && msg.projectPath !== projectPath) return;

      if (msg.type === 'ready') {
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat: route chat messages by projectPath for workspace isolation"
```

---

### Task 8: Update App.tsx for Workspace State Management

**Files:**
- Modify: `src/App.tsx`

This is the largest change. The flat project state becomes a workspace map.

- [ ] **Step 1: Update imports**

Change the sessions import from:
```typescript
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
```
to:
```typescript
import { loadSessions, saveSessions, createSession, upsertSession, migrateLegacySessions } from './sessions';
```

Add WorkspaceContext to the types import:
```typescript
import type { ChatSession, ChatMessage, GitFile, OpenFile, WorkspaceContext } from './types';
```

- [ ] **Step 2: Replace flat state with workspace map**

Replace these state declarations (lines 27-32):

```typescript
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);

  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSession, setActiveSession] = useState<ChatSession>(createSession);
```

with:

```typescript
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [activeProjectPath, setActiveProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);
  const [workspaces, setWorkspaces] = useState<Map<string, WorkspaceContext>>(new Map());
```

- [ ] **Step 3: Add helper to get/create workspace context**

After the `workspaces` state, add:

```typescript
  const getWorkspace = useCallback((path: string): WorkspaceContext => {
    const existing = workspaces.get(path);
    if (existing) return existing;
    return {
      projectPath: path,
      sessions: [],
      activeSession: createSession(),
      openFiles: [],
      activeFilePath: null,
      terminalIds: [],
      status: 'recent',
      lastActivity: Date.now(),
    };
  }, [workspaces]);

  const activeWorkspace = activeProjectPath ? getWorkspace(activeProjectPath) : null;

  const updateWorkspace = useCallback((path: string, updater: (ws: WorkspaceContext) => WorkspaceContext) => {
    setWorkspaces(prev => {
      const next = new Map(prev);
      const current = next.get(path) || {
        projectPath: path,
        sessions: [],
        activeSession: createSession(),
        openFiles: [],
        activeFilePath: null,
        terminalIds: [],
        status: 'active' as const,
        lastActivity: Date.now(),
      };
      next.set(path, updater(current));
      return next;
    });
  }, []);

  // Derived state for the active workspace
  const projectPath = activeProjectPath;
  const sessions = activeWorkspace?.sessions ?? [];
  const activeSession = activeWorkspace?.activeSession ?? createSession();
  const openFiles = activeWorkspace?.openFiles ?? [];
  const activeFilePath = activeWorkspace?.activeFilePath ?? null;
```

- [ ] **Step 4: Update the initial CWD load to create first workspace**

Replace the existing getCwd useEffect:

```typescript
  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) setProjectPath(cwd);
    });
  }, []);
```

with:

```typescript
  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) {
        migrateLegacySessions(cwd);
        const sessions = loadSessions(cwd);
        setActiveProjectPath(cwd);
        setWorkspaces(new Map([[cwd, {
          projectPath: cwd,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        }]]));
      }
    });
  }, []);
```

- [ ] **Step 5: Update persistSession to use workspace-scoped storage**

Replace:

```typescript
  const persistSession = useCallback((session: ChatSession) => {
    setSessions(prev => {
      const updated = upsertSession(prev, session);
      saveSessions(updated);
      return updated;
    });
  }, []);
```

with:

```typescript
  const persistSession = useCallback((session: ChatSession) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const updated = upsertSession(ws.sessions, session);
      saveSessions(activeProjectPath, updated);
      return { ...ws, sessions: updated };
    });
  }, [activeProjectPath, updateWorkspace]);
```

- [ ] **Step 6: Update session handlers to use workspace**

Replace `handleNewChat`:

```typescript
  const handleNewChat = () => {
    if (!activeProjectPath) return;
    persistSession(activeSession);
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      activeSession: createSession(),
    }));
  };
```

Replace `handleSelectSession`:

```typescript
  const handleSelectSession = (id: string) => {
    if (!activeProjectPath) return;
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        activeSession: { ...selected },
      }));
    }
  };
```

Replace `handleMessagesChange`:

```typescript
  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const updated = { ...ws.activeSession, messages, updatedAt: Date.now() };
      if (!updated.title) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          updated.title = firstUserMsg.content.slice(0, 40);
        }
      }
      return { ...ws, activeSession: updated };
    });
  }, [activeProjectPath, updateWorkspace]);
```

Replace `handleSessionSave`:

```typescript
  const handleSessionSave = useCallback(() => {
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    if (ws && ws.activeSession.messages.length > 0) {
      persistSession(ws.activeSession);
    }
  }, [activeProjectPath, workspaces, persistSession]);
```

- [ ] **Step 7: Update file handlers to use workspace**

Replace all `setOpenFiles` / `setActiveFilePath` calls in the file handlers to use `updateWorkspace`. Replace `handleFileClick`:

```typescript
  const handleFileClick = useCallback((file: GitFile) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const exists = ws.openFiles.some(f => f.path === file.path);
      return {
        ...ws,
        openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }],
        activeFilePath: file.path,
      };
    });
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      const next = [...prev, 'editor' as PanelId];
      setSplitRatio(0.66);
      return next.length > 2 ? next.slice(1) : next;
    });
  }, [activeProjectPath, updateWorkspace]);
```

Replace `handleFileOpen`:

```typescript
  const handleFileOpen = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const content = await window.sai.fsReadFile(filePath) as string;
      updateWorkspace(activeProjectPath, ws => {
        const exists = ws.openFiles.some(f => f.path === filePath);
        return {
          ...ws,
          openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: filePath, viewMode: 'editor', content }],
          activeFilePath: filePath,
        };
      });
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace]);
```

Replace `handleFileClose`:

```typescript
  const handleFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const next = ws.openFiles.filter(f => f.path !== path);
      let newActive = ws.activeFilePath;
      if (next.length === 0) {
        newActive = null;
        setExpanded(['chat', 'terminal']);
        setSplitRatio(0.66);
      } else if (path === ws.activeFilePath) {
        const idx = ws.openFiles.findIndex(f => f.path === path);
        newActive = next[Math.min(idx, next.length - 1)].path;
      }
      return { ...ws, openFiles: next, activeFilePath: newActive };
    });
  }, [activeProjectPath, updateWorkspace]);
```

Replace `handleCloseAllFiles`:

```typescript
  const handleCloseAllFiles = useCallback(() => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: [],
      activeFilePath: null,
    }));
    setExpanded(['chat', 'terminal']);
    setSplitRatio(0.66);
  }, [activeProjectPath, updateWorkspace]);
```

Replace `handleDiffModeChange`:

```typescript
  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === path ? { ...f, diffMode: mode } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);
```

- [ ] **Step 8: Add project switching handler**

After `handleDiffModeChange`, add:

```typescript
  const handleProjectSwitch = useCallback((newPath: string) => {
    if (newPath === activeProjectPath) return;
    // Load sessions for new project
    const sessions = loadSessions(newPath);
    setWorkspaces(prev => {
      const next = new Map(prev);
      if (!next.has(newPath)) {
        next.set(newPath, {
          projectPath: newPath,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        });
      } else {
        const ws = next.get(newPath)!;
        next.set(newPath, { ...ws, status: 'active', lastActivity: Date.now() });
      }
      return next;
    });
    setActiveProjectPath(newPath);
  }, [activeProjectPath]);
```

- [ ] **Step 9: Listen for workspace:suspended events**

Add a useEffect after the workspace:suspended listener:

```typescript
  useEffect(() => {
    const cleanup = window.sai.onWorkspaceSuspended?.((suspendedPath: string) => {
      updateWorkspace(suspendedPath, ws => ({ ...ws, status: 'suspended' }));
    });
    return cleanup;
  }, [updateWorkspace]);
```

- [ ] **Step 10: Update TitleBar prop**

Change the `onProjectChange` prop in the return JSX:

```typescript
        <TitleBar
          projectPath={projectPath}
          onProjectChange={handleProjectSwitch}
        />
```

(This is already `setProjectPath` which we removed — now it uses `handleProjectSwitch`.)

- [ ] **Step 11: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 12: Commit**

```bash
git add src/App.tsx
git commit -m "feat: workspace map state management with project switching"
```

---

### Task 9: Update TitleBar with Workspace Switcher

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Add workspace list props and state**

Update the TitleBarProps interface and component:

```typescript
interface WorkspaceInfo {
  projectPath: string;
  status: string;
  lastActivity: number;
}

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
}
```

(The interface stays the same, but we'll fetch workspace data inside the component.)

- [ ] **Step 2: Fetch workspace list when dropdown opens**

Replace the `recentProjects` state and its useEffect with:

```typescript
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);

  useEffect(() => {
    if (open) {
      window.sai.workspaceGetAll?.().then((list: WorkspaceInfo[]) => {
        setWorkspaceList(list || []);
      }).catch(() => {
        // Fallback to recent projects if workspace API not available
        window.sai.getRecentProjects().then((recent: string[]) => {
          setWorkspaceList(recent.map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 })));
        });
      });
    }
  }, [open]);
```

- [ ] **Step 3: Replace dropdown rendering with grouped workspace list**

Replace the entire dropdown `{open && ( ... )}` block with:

```tsx
        {open && (
          <div className="project-dropdown">
            {(() => {
              const active = workspaceList.filter(w => w.status === 'active');
              const suspended = workspaceList.filter(w => w.status === 'suspended');
              const recent = workspaceList.filter(w => w.status === 'recent');

              return (
                <>
                  {active.length > 0 && (
                    <>
                      <div className="dropdown-label">Active</div>
                      {active.map(w => (
                        <button
                          key={w.projectPath}
                          className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                          onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                        >
                          <span className="workspace-status-dot workspace-dot-active" />
                          <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                          <span className="dropdown-item-path">{w.projectPath}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {suspended.length > 0 && (
                    <>
                      {active.length > 0 && <div className="dropdown-divider" />}
                      <div className="dropdown-label">Suspended</div>
                      {suspended.map(w => (
                        <button
                          key={w.projectPath}
                          className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                          onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                        >
                          <span className="workspace-status-dot workspace-dot-suspended" />
                          <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                          <span className="dropdown-item-path">{w.projectPath}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {recent.length > 0 && (
                    <>
                      {(active.length > 0 || suspended.length > 0) && <div className="dropdown-divider" />}
                      <div className="dropdown-label">Recent</div>
                      {recent.map(w => (
                        <button
                          key={w.projectPath}
                          className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                          onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                        >
                          <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                          <span className="dropdown-item-path">{w.projectPath}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <div className="dropdown-divider" />
                  <button className="dropdown-item open-new" onClick={handleOpenNew}>
                    + Open New Project...
                  </button>
                </>
              );
            })()}
          </div>
        )}
```

- [ ] **Step 4: Add workspace status dot CSS**

Add these styles inside the existing `<style>` tag:

```css
        .workspace-item {
          flex-direction: row !important;
          align-items: center;
          gap: 8px;
        }
        .workspace-item .dropdown-item-path {
          margin-left: auto;
          flex-shrink: 1;
        }
        .workspace-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .workspace-dot-active {
          background: #4ade80;
        }
        .workspace-dot-suspended {
          background: #d4a72c;
        }
```

- [ ] **Step 5: Update handleSelectRecent for workspace flow**

Replace `handleSelectRecent`:

```typescript
  const handleSelectRecent = async (path: string) => {
    await window.sai.openRecentProject(path);
    onProjectChange(path);
    setOpen(false);
  };
```

This is now only used for the fallback. The main dropdown calls `onProjectChange` directly (which calls `handleProjectSwitch` in App.tsx, which handles workspace creation).

- [ ] **Step 6: Verify it compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat: workspace switcher dropdown with status dots"
```

---

### Task 10: End-to-End Smoke Test

- [ ] **Step 1: Build and run**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors

- [ ] **Step 2: Manual smoke test checklist**

Start the app with `npm run dev` and verify:

1. App opens and loads the most recent project as an active workspace
2. Chat works normally (send a message, get a response)
3. Open the project dropdown — current project shows with green dot under "Active"
4. Click "Open New Project..." and select a different folder
5. New project appears in dropdown with green dot
6. Switch back to first project — chat history and open files are preserved
7. Wait or verify the suspend timer concept works (can reduce timeout to 10s for testing)

- [ ] **Step 3: Fix any issues found during smoke test**

Address any compilation or runtime errors discovered.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: multi-project workspaces - simultaneous project contexts"
```
