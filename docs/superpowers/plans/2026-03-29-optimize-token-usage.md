# Optimize Token Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce API token consumption by switching to a persistent Claude CLI process, removing the startup probe, and routing commit messages through the existing session.

**Architecture:** Replace the spawn-per-message pattern in `electron/services/claude.ts` with a single long-lived `claude -p --input-format stream-json --output-format stream-json` process per workspace. Messages are written to stdin as NDJSON. The probe is removed entirely — slash commands come from the persistent process's init message. Commit messages route through the persistent process when available.

**Tech Stack:** Node.js child_process (spawn), Electron IPC, Claude CLI stream-json protocol

---

### Task 1: Add process config tracking to WorkspaceClaude

**Files:**
- Modify: `electron/services/workspace.ts:6-12`

This adds fields to detect when the user changes permission mode, effort, or model between turns — which requires killing and respawning the persistent process.

- [ ] **Step 1: Add config fields to WorkspaceClaude interface**

In `electron/services/workspace.ts`, update the `WorkspaceClaude` interface:

```typescript
export interface WorkspaceClaude {
  process: ChildProcess | null;
  probe: ChildProcess | null;       // kept temporarily — removed in Task 3
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
```

- [ ] **Step 2: Update getOrCreate to initialize new fields**

In `getOrCreate`, update the workspace creation:

```typescript
const ws: Workspace = {
  projectPath,
  claude: {
    process: null,
    probe: null,
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
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit`
Expected: Type errors in `claude.ts` (existing code doesn't set new fields yet) — that's fine, we'll fix in Task 2.

- [ ] **Step 4: Commit**

```bash
git add electron/services/workspace.ts
git commit -m "refactor: add processConfig and busy fields to WorkspaceClaude"
```

---

### Task 2: Rewrite claude.ts — persistent process with stream-json input

**Files:**
- Modify: `electron/services/claude.ts` (full rewrite)

This is the core change. Replace spawn-per-message with a persistent process.

- [ ] **Step 1: Write the new claude.ts**

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

/**
 * Build CLI args for the persistent process based on current config.
 */
function buildArgs(permMode?: string, effort?: string, model?: string): string[] {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (permMode === 'bypass') {
    args.push('--permission-mode', 'bypassPermissions');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (effort && ['low', 'medium', 'high', 'max'].includes(effort)) {
    args.push('--effort', effort);
  }

  if (model) {
    args.push('--model', model);
  }

  return args;
}

/**
 * Spawn (or respawn) the persistent Claude process for a workspace.
 * Attaches stdout/stderr handlers that route messages to the renderer.
 */
function ensureProcess(
  win: BrowserWindow,
  projectPath: string,
  permMode?: string,
  effort?: string,
  model?: string,
): ChildProcess {
  const ws = getOrCreate(projectPath);
  const currentConfig = { permMode: permMode || 'default', effort: effort || '', model: model || '' };

  // If process exists and config hasn't changed, reuse it
  if (ws.claude.process && ws.claude.processConfig &&
      ws.claude.processConfig.permMode === currentConfig.permMode &&
      ws.claude.processConfig.effort === currentConfig.effort &&
      ws.claude.processConfig.model === currentConfig.model) {
    return ws.claude.process;
  }

  // Config changed or no process — kill old one and spawn fresh
  if (ws.claude.process) {
    ws.claude.process.kill();
    ws.claude.process = null;
  }

  const args = buildArgs(permMode, effort, model);

  // Resume existing session if we have one
  if (ws.claude.sessionId) {
    args.push('--resume', ws.claude.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd: ws.claude.cwd || projectPath,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ws.claude.process = proc;
  ws.claude.processConfig = currentConfig;
  ws.claude.buffer = '';

  proc.stdout?.on('data', (data: Buffer) => {
    // Ignore if this process has been replaced
    if (ws.claude.process !== proc) return;

    ws.claude.buffer += data.toString();
    const lines = ws.claude.buffer.split('\n');
    ws.claude.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Capture session ID
        if (msg.session_id && !ws.claude.sessionId) {
          ws.claude.sessionId = msg.session_id;
        }

        // Capture slash commands from init (replaces the probe)
        if (msg.type === 'system' && msg.subtype === 'init') {
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
        }

        // When suppressForward is true (commit msg generation), skip IPC
        if (ws.claude.suppressForward) continue;

        // Result signals end of a turn
        if (msg.type === 'result') {
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
          continue;
        }

        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch { /* ignore malformed JSON */ }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (ws.claude.process !== proc) return;
    const text = data.toString().trim();
    if (text) {
      safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
    }
  });

  proc.on('exit', () => {
    if (ws.claude.process !== proc) return;

    // Flush remaining buffer
    if (ws.claude.buffer.trim()) {
      try {
        const msg = JSON.parse(ws.claude.buffer);
        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch { /* ignore */ }
    }
    ws.claude.buffer = '';
    ws.claude.process = null;
    ws.claude.processConfig = null;
    ws.claude.busy = false;
    ws.claude.suppressForward = false;
    // Signal unexpected exit so the UI can recover
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
  });

  return proc;
}

export function registerClaudeHandlers(win: BrowserWindow) {
  // claude:start — no longer spawns a probe. Just signals ready.
  ipcMain.handle('claude:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.claude.cwd = cwd;
    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
  });

  // claude:stop — kill the persistent process
  ipcMain.on('claude:stop', (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    if (ws.claude.process) {
      const proc = ws.claude.process;
      ws.claude.process = null;
      ws.claude.processConfig = null;
      ws.claude.busy = false;
      ws.claude.suppressForward = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    }
  });

  // claude:send — write message to persistent process stdin
  ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;

    touchActivity(projectPath);

    // Build the prompt (same image handling as before)
    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    // Ensure persistent process is running with current config
    const proc = ensureProcess(win, projectPath, permMode, effort, model);

    ws.claude.busy = true;
    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

    // Write the user message as NDJSON to stdin
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
    proc.stdin?.write(msg + '\n');
  });

  // claude:generateCommitMessage — route through persistent process or one-shot fallback
  ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string) => {
    const ws = get(cwd);
    const effectiveCwd = cwd || ws?.claude.cwd || process.env.HOME || '/';

    // Get the diff
    const getDiff = (args: string[]) => new Promise<string>((resolve) => {
      const diffProc = spawn('git', ['diff', ...args], {
        cwd: effectiveCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      diffProc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      diffProc.on('exit', () => resolve(out.trim()));
      diffProc.on('error', () => resolve(''));
    });

    let diff = await getDiff(['--staged']);
    if (!diff) diff = await getDiff([]);
    if (!diff) return '';

    const maxLen = 8000;
    const truncatedDiff = diff.length > maxLen
      ? diff.slice(0, maxLen) + '\n... (diff truncated)'
      : diff;

    const commitPrompt = `Generate a concise commit message for this diff. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.\n\n${truncatedDiff}`;

    // If persistent process exists and is idle, use it for caching benefits.
    // suppressForward prevents the main stdout handler from sending commit
    // message results to the renderer (which would pollute the chat UI).
    // Instead, the result is captured here via a temporary listener.
    if (ws?.claude.process && !ws.claude.busy) {
      return new Promise<string>((resolve) => {
        const proc = ws.claude.process!;
        let resolved = false;

        ws.claude.busy = true;
        ws.claude.suppressForward = true;

        const commitHandler = (data: Buffer) => {
          if (resolved) return;
          const text = data.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'result') {
                const commitResult = typeof msg.result === 'string' ? msg.result : '';
                ws.claude.busy = false;
                ws.claude.suppressForward = false;
                resolved = true;
                proc.stdout?.removeListener('data', commitHandler);
                resolve(commitResult.trim());
                return;
              }
            } catch { /* ignore */ }
          }
        };

        proc.stdout?.on('data', commitHandler);

        const msg = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: commitPrompt },
        });
        proc.stdin?.write(msg + '\n');

        // Timeout fallback — if no result in 30s, resolve empty
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            proc.stdout?.removeListener('data', commitHandler);
            ws.claude.busy = false;
            ws.claude.suppressForward = false;
            resolve('');
          }
        }, 30000);
      });
    }

    // Fallback: one-shot process (no persistent process available or it's busy)
    return new Promise<string>((resolve) => {
      const proc = spawn('claude', [
        '-p', commitPrompt,
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
}

export function destroyClaude() {
  // Handled by workspace.destroyAll
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit`
Expected: Clean compile (no errors).

- [ ] **Step 3: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat: persistent Claude process with stream-json bidirectional IO"
```

---

### Task 3: Clean up workspace.ts — remove probe field

**Files:**
- Modify: `electron/services/workspace.ts:6-12`
- Modify: `electron/services/workspace.ts:57-65`

Now that the probe is gone from claude.ts, remove the `probe` field.

- [ ] **Step 1: Remove probe from WorkspaceClaude interface**

In `electron/services/workspace.ts`, update the interface:

```typescript
export interface WorkspaceClaude {
  process: ChildProcess | null;
  sessionId: string | undefined;
  buffer: string;
  cwd: string;
  processConfig: {
    permMode: string;
    effort: string;
    model: string;
  } | null;
  busy: boolean;
  suppressForward: boolean;
}
```

- [ ] **Step 2: Remove probe from getOrCreate**

Update the workspace creation in `getOrCreate`:

```typescript
claude: {
  process: null,
  sessionId: undefined,
  buffer: '',
  cwd: projectPath,
  processConfig: null,
  busy: false,
  suppressForward: false,
},
```

- [ ] **Step 3: Remove probe kill from suspend**

In the `suspend` function, remove:

```typescript
if (ws.claude.probe) {
  ws.claude.probe.kill();
  ws.claude.probe = null;
}
```

And add reset of new fields after the process kill:

```typescript
// Kill Claude process
if (ws.claude.process) {
  ws.claude.process.kill();
  ws.claude.process = null;
}
ws.claude.processConfig = null;
ws.claude.busy = false;
ws.claude.suppressForward = false;
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 5: Commit**

```bash
git add electron/services/workspace.ts
git commit -m "refactor: remove probe field from WorkspaceClaude"
```

---

### Task 4: Update ChatPanel to handle persistent process message flow

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:123-126`

The persistent process emits `done` from the stdout handler (on `result` message) instead of on process exit. The ChatPanel already listens for `done` messages, so the main change is that `claude:start` no longer needs to wait for a probe.

- [ ] **Step 1: Simplify the claude:start effect**

In `ChatPanel.tsx`, the `useEffect` at line 123 currently does:

```typescript
useEffect(() => {
  setReady(false);
  window.sai.claudeStart(projectPath || '').then(() => setReady(true));
```

This is fine — `claudeStart` now resolves immediately (no probe). But we should also handle the case where the init message arrives later (when the persistent process spawns on first send). Update to:

```typescript
useEffect(() => {
  setReady(false);
  window.sai.claudeStart(projectPath || '').then(() => setReady(true));

  const cleanup = window.sai.claudeOnMessage((msg: any) => {
    if (msg.projectPath && msg.projectPath !== projectPath) return;

    if (msg.type === 'ready') {
      setReady(true);
      return;
    }

    if (msg.type === 'streaming_start') {
      setIsStreaming(true);
      return;
    }

    if (msg.type === 'done') {
      setIsStreaming(false);
      onTurnComplete?.();
      return;
    }

    if (msg.type === 'process_exit') {
      setReady(false);
      setIsStreaming(false);
      return;
    }

    if (msg.type === 'error') {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: msg.text || 'Unknown error',
        timestamp: Date.now(),
      }]);
      return;
    }

    if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands) {
      setSlashCommands(msg.slash_commands);
      return;
    }

    if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
      const info = msg.rate_limit_info;
      const key = info.rateLimitType || 'unknown';
      setRateLimits(prev => {
        const next = new Map(prev);
        next.set(key, {
          rateLimitType: key,
          resetsAt: info.resetsAt || 0,
          status: info.status || 'unknown',
          isUsingOverage: !!info.isUsingOverage,
          overageResetsAt: info.overageResetsAt || 0,
        });
        return next;
      });
      return;
    }

    if (msg.type === 'system' || msg.type === 'rate_limit_event' || msg.type === 'user') {
      return;
    }

    if (msg.type === 'assistant' && msg.message?.content) {
      const textParts: string[] = [];
      const tools: ToolCall[] = [];

      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
        if (block.type === 'tool_use') {
          tools.push({
            type: block.name?.includes('Edit') || block.name?.includes('Write') ? 'file_edit' :
                  block.name?.includes('Bash') ? 'terminal_command' :
                  block.name?.includes('Read') || block.name?.includes('Glob') || block.name?.includes('Grep') ? 'file_read' : 'other',
            name: block.name || 'tool',
            input: typeof block.input === 'string' ? block.input :
                   typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : '',
          });
        }
      }

      const text = textParts.join('');

      if (text || tools.length > 0) {
        setMessages(prev => {
          return [...prev, {
            id: `${Date.now()}-${Math.random()}`,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
            toolCalls: tools.length > 0 ? tools : undefined,
          }];
        });
      }
    }

    if (msg.type === 'result') {
      if (msg.usage) {
        const used = (msg.usage.input_tokens || 0) +
          (msg.usage.cache_read_input_tokens || 0) +
          (msg.usage.cache_creation_input_tokens || 0) +
          (msg.usage.output_tokens || 0);
        const modelUsage = msg.modelUsage || {};
        const modelKey = Object.keys(modelUsage)[0];
        const total = modelKey ? modelUsage[modelKey].contextWindow || 1000000 : 1000000;
        setContextUsage({ used, total });
      }
      if (msg.usage) {
        setSessionUsage(prev => ({
          inputTokens: prev.inputTokens + (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0),
          outputTokens: prev.outputTokens + (msg.usage.output_tokens || 0),
        }));
      }
    }
    if (msg.type === 'result' && msg.result) {
      const text = typeof msg.result === 'string' ? msg.result : '';
      if (text) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: text }];
          }
          return [...prev, {
            id: `result-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          }];
        });
      }
    }
  });

  return cleanup;
}, [projectPath]);
```

This is actually the same logic as the current code — the key difference is that `claudeStart` resolves instantly now, and the `system.init` message (with slash commands) arrives when the persistent process starts on first send rather than from a probe.

- [ ] **Step 2: Verify the build compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "refactor: adapt ChatPanel for persistent process message flow"
```

---

### Task 5: Build, run, and verify

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npm run build`
Expected: Clean build with no errors.

- [ ] **Step 2: Manual smoke test**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npm run dev`

Test the following:
1. App opens, chat panel shows "ready" state
2. Send a message — response streams back
3. Send a second message — response streams back (same process, no respawn)
4. Change model/effort/permission in settings, send a message — process respawns with new config
5. Generate a commit message from the Git sidebar — message is generated
6. Stop button works during streaming
7. Slash command autocomplete works (commands arrive from init message)

- [ ] **Step 3: Verify token savings**

After testing, check the session usage display in the chat input area. On the second and subsequent messages, `cache_read_input_tokens` should be significantly higher than `cache_creation_input_tokens`, confirming the persistent process enables prompt caching.

- [ ] **Step 4: Final commit if any fixes were needed**

Only if smoke testing revealed issues that required fixes.
