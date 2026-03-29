# Gemini CLI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini CLI as a third AI provider alongside Claude and Codex, with full streaming support, provider-specific settings, and a Gemini-branded thinking animation.

**Architecture:** Mirror the Codex integration pattern exactly — new `electron/services/gemini.ts` backend service that spawns `gemini -p <prompt> --output-format stream-json`, translates JSONL events to the unified `claude:message` IPC channel, and exposes `gemini:models/start/send/stop` handlers. Frontend extends the existing provider routing, settings, and UI controls.

**Tech Stack:** Electron IPC, Node.js child_process, React, CSS animations

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `electron/services/gemini.ts` | Create | Backend service: spawn gemini CLI, translate stream-json events, hardcoded model list |
| `electron/services/workspace.ts` | Modify | Add `WorkspaceGemini` interface and `gemini` field to `Workspace` |
| `electron/preload.ts` | Modify | Expose `geminiModels`, `geminiStart`, `geminiSend`, `geminiStop` IPC bridges |
| `electron/main.ts` | Modify | Import and register gemini handlers |
| `src/App.tsx` | Modify | Extend `AIProvider` type, add gemini state/handlers/settings persistence |
| `src/components/SettingsModal.tsx` | Modify | Add Gemini to `PROVIDER_OPTIONS` array |
| `src/components/Chat/ChatPanel.tsx` | Modify | Add gemini routing, `GeminiThinkingAnimation` component |
| `src/components/Chat/ChatInput.tsx` | Modify | Add gemini model/conversation-mode/approval-mode controls |
| `src/components/Chat/ChatMessage.tsx` | Modify | Add `.chat-msg-gemini` icon class |

---

### Task 1: Backend — Workspace State

**Files:**
- Modify: `electron/services/workspace.ts`

- [ ] **Step 1: Add WorkspaceGemini interface**

In `electron/services/workspace.ts`, add the `WorkspaceGemini` interface after the existing `WorkspaceCodex` interface (after line 26):

```typescript
export interface WorkspaceGemini {
  process: ChildProcess | null;
  buffer: string;
  cwd: string;
  busy: boolean;
}
```

- [ ] **Step 2: Add gemini field to Workspace interface**

In the `Workspace` interface (line 28), add `gemini: WorkspaceGemini;` after the `codex` field:

```typescript
export interface Workspace {
  projectPath: string;
  claude: WorkspaceClaude;
  codex: WorkspaceCodex;
  gemini: WorkspaceGemini;
  terminals: Map<number, pty.IPty>;
  lastActivity: number;
  status: 'active' | 'suspended';
}
```

- [ ] **Step 3: Initialize gemini state in getOrCreate**

In `getOrCreate()` (around line 46), add the `gemini` field to the new workspace object, after the `codex` initialization:

```typescript
    gemini: {
      process: null,
      buffer: '',
      cwd: projectPath,
      busy: false,
    },
```

- [ ] **Step 4: Add gemini cleanup to suspend function**

In the `suspend()` function (around line 80), add gemini process cleanup after the codex cleanup block (after line 98):

```typescript
  // Kill Gemini process
  if (ws.gemini.process) {
    ws.gemini.process.kill();
    ws.gemini.process = null;
  }
  ws.gemini.busy = false;
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit --project electron/tsconfig.json 2>&1 | head -20`

Expected: No errors related to workspace.ts (there may be other pre-existing errors).

- [ ] **Step 6: Commit**

```bash
git add electron/services/workspace.ts
git commit -m "feat(gemini): add WorkspaceGemini interface and state"
```

---

### Task 2: Backend — Gemini Service

**Files:**
- Create: `electron/services/gemini.ts`

- [ ] **Step 1: Create the gemini service file**

Create `electron/services/gemini.ts` with the full backend service. This mirrors `electron/services/codex.ts` but translates Gemini's `stream-json` events:

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getOrCreate, get, touchActivity } from './workspace';

/**
 * Build an enriched PATH that includes common locations for nvm/fnm/volta-installed binaries.
 * Electron apps launched from desktop entries don't inherit the user's shell PATH.
 */
function getEnrichedEnv(): Record<string, string> {
  const env = { ...process.env };
  const home = os.homedir();
  const extraPaths: string[] = [];

  // nvm: scan all installed versions
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions) {
        extraPaths.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* ignore */ }
  }

  // Common global bin locations
  extraPaths.push(
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
  );

  const currentPath = env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const additions = extraPaths.filter(p => !pathSet.has(p));
  if (additions.length > 0) {
    env.PATH = currentPath + ':' + additions.join(':');
  }
  return env;
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

/** Hardcoded model list — Gemini CLI has no programmatic model enumeration */
const GEMINI_MODELS: { id: string; name: string }[] = [
  { id: 'auto-gemini-3', name: 'Auto (Gemini 3)' },
  { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
];

const GEMINI_DEFAULT_MODEL = 'auto-gemini-3';

/**
 * Translate a Gemini stream-json event into one or more claude:message events.
 */
function translateEvent(msg: any, projectPath: string): any[] {
  const events: any[] = [];

  switch (msg.type) {
    case 'init':
      // Session metadata — emit streaming_start
      events.push({ type: 'streaming_start', projectPath });
      break;

    case 'message': {
      // Skip user message echoes
      if (msg.role === 'user') break;
      if (msg.role === 'assistant' && msg.content) {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text: msg.content }],
          },
        });
      }
      break;
    }

    case 'tool_use': {
      const name = msg.name || msg.tool || 'unknown';
      const input = msg.arguments || msg.input || {};
      events.push({
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            type: 'tool_use',
            name,
            input,
          }],
        },
      });
      break;
    }

    case 'tool_result':
      // Ignored — result shown via tool_use card
      break;

    case 'result': {
      const stats = msg.stats;
      if (msg.status === 'error' || msg.error) {
        events.push({
          type: 'error',
          projectPath,
          text: msg.error || msg.message || 'Gemini error',
        });
      } else if (stats) {
        events.push({
          type: 'result',
          projectPath,
          usage: {
            input_tokens: stats.input_tokens || 0,
            cache_read_input_tokens: stats.cached || 0,
            cache_creation_input_tokens: 0,
            output_tokens: stats.output_tokens || 0,
          },
        });
      }
      events.push({ type: 'done', projectPath });
      break;
    }

    case 'error':
      events.push({
        type: 'error',
        projectPath,
        text: msg.message || msg.error || 'Gemini error',
      });
      events.push({ type: 'done', projectPath });
      break;

    default:
      break;
  }

  return events;
}

export function registerGeminiHandlers(win: BrowserWindow) {
  ipcMain.handle('gemini:models', () => ({
    models: GEMINI_MODELS,
    defaultModel: GEMINI_DEFAULT_MODEL,
  }));

  ipcMain.handle('gemini:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.gemini.cwd = cwd;
    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
  });

  ipcMain.on('gemini:stop', (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    if (ws.gemini.process) {
      const proc = ws.gemini.process;
      ws.gemini.process = null;
      ws.gemini.busy = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    }
  });

  ipcMain.on('gemini:send', (_event, projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    touchActivity(projectPath);

    // Kill previous gemini process if still running
    if (ws.gemini.process) {
      ws.gemini.process.kill();
      ws.gemini.process = null;
    }

    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    const args = ['-p', prompt, '--output-format', 'stream-json'];

    // Conversation mode: 'fast' overrides model to gemini-3-flash
    const effectiveModel = conversationMode === 'fast' ? 'gemini-3-flash' : (model || GEMINI_DEFAULT_MODEL);
    args.push('-m', effectiveModel);

    // Approval mode
    if (approvalMode && approvalMode !== 'default') {
      args.push('--approval-mode', approvalMode);
    }

    const proc = spawn('gemini', args, {
      cwd: ws.gemini.cwd || projectPath,
      env: getEnrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ws.gemini.process = proc;
    ws.gemini.busy = true;
    ws.gemini.buffer = '';

    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

    proc.stdout?.on('data', (data: Buffer) => {
      if (ws.gemini.process !== proc) return;

      ws.gemini.buffer += data.toString();
      const lines = ws.gemini.buffer.split('\n');
      ws.gemini.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
          // Mark not busy on result
          if (msg.type === 'result') {
            ws.gemini.busy = false;
          }
        } catch { /* malformed JSON */ }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (ws.gemini.process !== proc) return;
      const text = data.toString().trim();
      // Gemini CLI prints "Loaded cached credentials." to stderr — skip it
      if (text && !text.startsWith('Loaded cached credentials')) {
        safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
      }
    });

    proc.on('exit', () => {
      if (ws.gemini.process !== proc) return;
      // Flush remaining buffer
      if (ws.gemini.buffer.trim()) {
        try {
          const msg = JSON.parse(ws.gemini.buffer);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
        } catch { /* ignore */ }
      }
      ws.gemini.buffer = '';
      ws.gemini.process = null;
      ws.gemini.busy = false;
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });

    proc.on('error', (err) => {
      if (ws.gemini.process !== proc) return;
      ws.gemini.process = null;
      ws.gemini.busy = false;
      safeSend(win, 'claude:message', {
        type: 'error', text: `Gemini process error: ${err.message}`, projectPath: ws.projectPath,
      });
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/gemini.ts
git commit -m "feat(gemini): add backend service with stream-json event translation"
```

---

### Task 3: Backend — IPC Bridge and Registration

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Add Gemini IPC bridges to preload.ts**

In `electron/preload.ts`, add the following after the Codex CLI block (after line 21, before the `claudeOnMessage` line):

```typescript
  // Gemini CLI
  geminiModels: () => ipcRenderer.invoke('gemini:models'),
  geminiStart: (cwd: string) => ipcRenderer.invoke('gemini:start', cwd),
  geminiSend: (projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string) => ipcRenderer.send('gemini:send', projectPath, message, imagePaths, approvalMode, conversationMode, model),
  geminiStop: (projectPath: string) => ipcRenderer.send('gemini:stop', projectPath),
```

- [ ] **Step 2: Register gemini handlers in main.ts**

In `electron/main.ts`, add the import (after line 13):

```typescript
import { registerGeminiHandlers } from './services/gemini';
```

Then add the registration call after `registerCodexHandlers(mainWindow);` (after line 51):

```typescript
  registerGeminiHandlers(mainWindow);
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts electron/main.ts
git commit -m "feat(gemini): add IPC bridge and handler registration"
```

---

### Task 4: Frontend — App State and Settings

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend AIProvider type**

In `src/App.tsx`, update the type definitions (around line 18):

Change:
```typescript
type AIProvider = 'claude' | 'codex';
```
To:
```typescript
type AIProvider = 'claude' | 'codex' | 'gemini';
type GeminiApprovalMode = 'default' | 'auto_edit' | 'yolo' | 'plan';
type GeminiConversationMode = 'planning' | 'fast';
```

- [ ] **Step 2: Add gemini state variables**

After the `codexPermission` state (line 33), add:

```typescript
  const [geminiModel, setGeminiModel] = useState('auto-gemini-3');
  const [geminiModels, setGeminiModels] = useState<{ id: string; name: string }[]>([]);
  const [geminiApprovalMode, setGeminiApprovalMode] = useState<GeminiApprovalMode>('default');
  const [geminiConversationMode, setGeminiConversationMode] = useState<GeminiConversationMode>('planning');
```

- [ ] **Step 3: Update settings loading to include gemini**

In the settings loading `useEffect` (around line 90), update the `aiProvider` validation to include `'gemini'`:

Change:
```typescript
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex') setAiProvider(v as AIProvider);
    });
```
To:
```typescript
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as AIProvider);
    });
```

After the codex settings loading block (after line 105), add:

```typescript
    window.sai.settingsGet('gemini', {}).then((g: any) => {
      if (g.model) setGeminiModel(g.model);
      if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
      if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
    });
```

- [ ] **Step 4: Update githubOnSettingsApplied handler**

In the `githubOnSettingsApplied` callback (around line 134), update the `aiProvider` check:

Change:
```typescript
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex')) setAiProvider(remote.aiProvider);
```
To:
```typescript
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex' || remote.aiProvider === 'gemini')) setAiProvider(remote.aiProvider);
```

After the codex settings applied block (after line 148), add:

```typescript
      if ('gemini' in remote && typeof remote.gemini === 'object') {
        const g = remote.gemini;
        if (g.model) setGeminiModel(g.model);
        if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
        if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
      }
```

- [ ] **Step 5: Prefetch Gemini models at startup**

After the Codex model prefetch `useEffect` (after line 159), add:

```typescript
  // Prefetch Gemini models (hardcoded) at startup
  useEffect(() => {
    (window.sai as any).geminiModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (result?.models?.length) setGeminiModels(result.models);
      if (result?.defaultModel) setGeminiModel(prev => prev || result.defaultModel);
    });
  }, []);
```

- [ ] **Step 6: Add saveGeminiSetting helper and change handlers**

After the `handleCodexPermissionChange` function (after line 622), add:

```typescript
  const saveGeminiSetting = (key: string, value: any) => {
    window.sai.settingsGet('gemini', {}).then((existing: any) => {
      window.sai.settingsSet('gemini', { ...existing, [key]: value });
    });
  };

  const handleGeminiModelChange = (model: string) => {
    setGeminiModel(model);
    saveGeminiSetting('model', model);
  };

  const handleGeminiApprovalModeChange = (mode: GeminiApprovalMode) => {
    setGeminiApprovalMode(mode);
    saveGeminiSetting('approvalMode', mode);
  };

  const handleGeminiConversationModeChange = (mode: GeminiConversationMode) => {
    setGeminiConversationMode(mode);
    saveGeminiSetting('conversationMode', mode);
  };
```

- [ ] **Step 7: Update accordion bar icon for gemini**

In the `renderPanel` function (around line 643), update the chat icon to include gemini:

Change:
```typescript
    const icon = panel === 'chat'
      ? <span className="accordion-provider-icon" style={{
          maskImage: `url('${aiProvider === 'codex' ? 'svg/openai.svg' : 'svg/claude.svg'}')`,
          WebkitMaskImage: `url('${aiProvider === 'codex' ? 'svg/openai.svg' : 'svg/claude.svg'}')`,
          backgroundColor: aiProvider === 'codex' ? 'var(--text)' : '#e27b4a',
          opacity: 1,
        }} />
```
To:
```typescript
    const providerSvg = aiProvider === 'codex' ? 'svg/openai.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : 'svg/claude.svg';
    const providerColor = aiProvider === 'codex' ? 'var(--text)' : aiProvider === 'gemini' ? '#4285f4' : '#e27b4a';
    const icon = panel === 'chat'
      ? <span className="accordion-provider-icon" style={{
          maskImage: `url('${providerSvg}')`,
          WebkitMaskImage: `url('${providerSvg}')`,
          backgroundColor: providerColor,
          opacity: 1,
        }} />
```

- [ ] **Step 8: Pass gemini props to ChatPanel**

In the `ChatPanel` JSX (around line 733), add the gemini props after the codex props:

```typescript
                  geminiModel={geminiModel}
                  onGeminiModelChange={handleGeminiModelChange}
                  geminiModels={geminiModels}
                  geminiApprovalMode={geminiApprovalMode}
                  onGeminiApprovalModeChange={handleGeminiApprovalModeChange}
                  geminiConversationMode={geminiConversationMode}
                  onGeminiConversationModeChange={handleGeminiConversationModeChange}
```

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(gemini): add app state, settings persistence, and provider routing"
```

---

### Task 5: Frontend — Settings Modal

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add Gemini to PROVIDER_OPTIONS**

In `src/components/SettingsModal.tsx`, update the `PROVIDER_OPTIONS` array (line 33):

Change:
```typescript
const PROVIDER_OPTIONS: { id: 'claude' | 'codex'; label: string; svg: string; color: string }[] = [
  { id: 'claude', label: 'Claude', svg: 'svg/claude.svg', color: '#e27b4a' },
  { id: 'codex', label: 'Codex CLI', svg: 'svg/openai.svg', color: '#fff' },
];
```
To:
```typescript
const PROVIDER_OPTIONS: { id: 'claude' | 'codex' | 'gemini'; label: string; svg: string; color: string }[] = [
  { id: 'claude', label: 'Claude', svg: 'svg/claude.svg', color: '#e27b4a' },
  { id: 'codex', label: 'Codex CLI', svg: 'svg/openai.svg', color: '#fff' },
  { id: 'gemini', label: 'Gemini CLI', svg: 'svg/Google-gemini-icon.svg', color: '#4285f4' },
];
```

- [ ] **Step 2: Update aiProvider state type**

Update the `aiProvider` state and validation to include `'gemini'` (line 42 and line 53-54):

Change:
```typescript
  const [aiProvider, setAiProvider] = useState<'claude' | 'codex'>('claude');
```
To:
```typescript
  const [aiProvider, setAiProvider] = useState<'claude' | 'codex' | 'gemini'>('claude');
```

Change the settings load validation:
```typescript
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex') setAiProvider(v);
    });
```
To:
```typescript
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as 'claude' | 'codex' | 'gemini');
    });
```

Also update the `githubOnSettingsApplied` handler in the same file:
```typescript
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex' || remote.aiProvider === 'gemini')) setAiProvider(remote.aiProvider);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(gemini): add Gemini to settings modal provider dropdown"
```

---

### Task 6: Frontend — ChatPanel Routing and Thinking Animation

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Add GeminiThinkingAnimation component**

In `src/components/Chat/ChatPanel.tsx`, add the `GeminiThinkingAnimation` component after the `CodexThinkingAnimation` component (after line 103):

```typescript
function GeminiThinkingAnimation() {
  return (
    <div className="gemini-thinking">
      <div className="gemini-dots">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className="gemini-dot" style={{ animationDelay: `${i * 0.33}s` }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add gemini props to ChatPanelProps interface**

Update the `ChatPanelProps` interface (around line 111) to add gemini-specific props:

After the `onCodexPermissionChange` prop, add:

```typescript
  geminiModel: string;
  onGeminiModelChange: (model: string) => void;
  geminiModels: { id: string; name: string }[];
  geminiApprovalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onGeminiApprovalModeChange: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  geminiConversationMode: 'planning' | 'fast';
  onGeminiConversationModeChange: (mode: 'planning' | 'fast') => void;
```

- [ ] **Step 3: Update the component destructuring**

Update the function signature (around line 285) to destructure the new gemini props. Add after `onCodexPermissionChange`:

```typescript
, geminiModel, onGeminiModelChange, geminiModels, geminiApprovalMode, onGeminiApprovalModeChange, geminiConversationMode, onGeminiConversationModeChange
```

- [ ] **Step 4: Update provider routing — start**

Update the start function (around line 339):

Change:
```typescript
    const startFn = aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
```
To:
```typescript
    const startFn = aiProvider === 'gemini' ? (window.sai as any).geminiStart : aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
```

- [ ] **Step 5: Update provider routing — send**

Update the send logic (around line 691):

Change:
```typescript
    if (aiProvider === 'codex') {
      window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
    } else {
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
    }
```
To:
```typescript
    if (aiProvider === 'gemini') {
      (window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel);
    } else if (aiProvider === 'codex') {
      window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
    } else {
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
    }
```

- [ ] **Step 6: Update provider routing — stop**

Update the stop handler (around line 745):

Change:
```typescript
        onStop={() => aiProvider === 'codex' ? window.sai.codexStop(projectPath) : window.sai.claudeStop?.(projectPath)}
```
To:
```typescript
        onStop={() => aiProvider === 'gemini' ? (window.sai as any).geminiStop(projectPath) : aiProvider === 'codex' ? window.sai.codexStop(projectPath) : window.sai.claudeStop?.(projectPath)}
```

- [ ] **Step 7: Update thinking animation rendering**

Update the thinking animation (around line 726):

Change:
```typescript
        {isStreaming && (aiProvider === 'codex'
          ? <CodexThinkingAnimation />
          : <ThinkingAnimation hasContent={messages[messages.length - 1]?.role === 'assistant'} />
        )}
```
To:
```typescript
        {isStreaming && (aiProvider === 'gemini'
          ? <GeminiThinkingAnimation />
          : aiProvider === 'codex'
          ? <CodexThinkingAnimation />
          : <ThinkingAnimation hasContent={messages[messages.length - 1]?.role === 'assistant'} />
        )}
```

- [ ] **Step 8: Pass gemini props to ChatInput**

In the `ChatInput` JSX (around line 740), add after the codex props:

```typescript
        geminiModel={geminiModel}
        geminiModels={geminiModels}
        onGeminiModelChange={onGeminiModelChange}
        geminiApprovalMode={geminiApprovalMode}
        onGeminiApprovalModeChange={onGeminiApprovalModeChange}
        geminiConversationMode={geminiConversationMode}
        onGeminiConversationModeChange={onGeminiConversationModeChange}
```

- [ ] **Step 9: Add GeminiThinkingAnimation CSS**

In the `<style>` block, add after the codex shimmer CSS (after the `@keyframes codex-working-shimmer` block):

```css
        .gemini-thinking {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-left: 24px;
          padding: 8px 0;
        }
        .gemini-dots {
          display: grid;
          grid-template-columns: repeat(3, 6px);
          grid-template-rows: repeat(2, 6px);
          gap: 3px;
        }
        .gemini-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(66, 133, 244, 0.25);
          animation: gemini-dot-pulse 2s ease-in-out infinite;
        }
        @keyframes gemini-dot-pulse {
          0%, 100% {
            background: rgba(66, 133, 244, 0.25);
            transform: scale(1);
          }
          16.6% {
            background: #4285f4;
            transform: scale(1.3);
          }
          33.3% {
            background: rgba(168, 85, 247, 0.25);
            transform: scale(1);
          }
          50% {
            background: #a855f7;
            transform: scale(1.3);
          }
          66.6% {
            background: rgba(234, 67, 53, 0.25);
            transform: scale(1);
          }
          83.3% {
            background: #ea4335;
            transform: scale(1.3);
          }
        }
```

- [ ] **Step 10: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat(gemini): add chat routing, thinking animation, and provider controls"
```

---

### Task 7: Frontend — ChatInput Controls

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

- [ ] **Step 1: Add gemini props to ChatInputProps**

In `src/components/Chat/ChatInput.tsx`, update the `ChatInputProps` interface (around line 11). Update the `aiProvider` type and add gemini props after `onCodexPermissionChange`:

Change:
```typescript
  aiProvider?: 'claude' | 'codex';
```
To:
```typescript
  aiProvider?: 'claude' | 'codex' | 'gemini';
```

Add after the `onCodexPermissionChange` prop (after line 32):

```typescript
  geminiModel?: string;
  geminiModels?: { id: string; name: string }[];
  onGeminiModelChange?: (model: string) => void;
  geminiApprovalMode?: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onGeminiApprovalModeChange?: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  geminiConversationMode?: 'planning' | 'fast';
  onGeminiConversationModeChange?: (mode: 'planning' | 'fast') => void;
```

- [ ] **Step 2: Update component destructuring**

Update the function signature (around line 189) to add the gemini props. Add after `onCodexPermissionChange`:

```typescript
, geminiModel = 'auto-gemini-3', geminiModels = [], onGeminiModelChange, geminiApprovalMode = 'default', onGeminiApprovalModeChange, geminiConversationMode = 'planning', onGeminiConversationModeChange
```

- [ ] **Step 3: Hide Claude-only controls for gemini**

The existing guards `aiProvider === 'claude'` already hide Claude controls. Verify these lines:
- Line 458: `{aiProvider === 'claude' && contextUsage && ...}` — context ring ✓
- Line 478: `{aiProvider === 'claude' && (sessionUsage || ...}` — rate limits ✓
- Line 593: `{aiProvider === 'claude' && ...}` — effort level ✓
- Line 610: `{aiProvider === 'claude' && ...}` — claude model selector ✓

These already correctly hide for both codex AND gemini. No changes needed.

- [ ] **Step 4: Add Gemini model selector**

After the Codex model selector block (after line 682), add:

```typescript
          {/* Model selector — Gemini */}
          {aiProvider === 'gemini' && (
          <div className="model-selector" ref={modelMenuRef}>
            <button
              className="toolbar-btn model-btn"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              style={{ color: '#4285f4' }}
            >
              <span className="model-label">{geminiModels.find(m => m.id === geminiModel)?.name || geminiModel}</span>
              <ChevronDown size={11} style={{ opacity: 0.5 }} />
            </button>
            {modelMenuOpen && (
              <div className="model-dropdown">
                <div className="model-dropdown-header">Select a model</div>
                {geminiModels.map(m => (
                  <button
                    key={m.id}
                    className={`model-dropdown-item ${m.id === geminiModel ? 'active' : ''}`}
                    onClick={() => { onGeminiModelChange?.(m.id); setModelMenuOpen(false); }}
                  >
                    <div className="model-dropdown-item-info">
                      <span className="model-dropdown-item-name" style={{ color: m.id === geminiModel ? '#4285f4' : undefined }}>
                        {m.name}
                      </span>
                    </div>
                    {m.id === geminiModel && <Check size={14} style={{ color: '#4285f4', flexShrink: 0 }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
```

- [ ] **Step 5: Add Gemini conversation mode button**

After the Gemini model selector (added in step 4), add the conversation mode cycling button:

```typescript
          {/* Conversation mode — Gemini */}
          {aiProvider === 'gemini' && (
          <button
            className="toolbar-btn"
            onClick={() => {
              const next = geminiConversationMode === 'planning' ? 'fast' : 'planning';
              onGeminiConversationModeChange?.(next);
            }}
            title={`Conversation mode: ${geminiConversationMode}`}
            style={{ color: '#4285f4' }}
          >
            {geminiConversationMode === 'planning'
              ? <><Settings size={14} /> <span className="permission-label">Planning</span></>
              : <><Zap size={14} /> <span className="permission-label">Fast</span></>
            }
          </button>
          )}
```

Note: `Settings` is already imported from lucide-react. If not, add it to the import.

- [ ] **Step 6: Update permission/approval button for gemini**

Update the permission button logic (around line 684). Currently it's a ternary between claude and codex. Change it to handle three providers:

Change:
```typescript
          {aiProvider === 'claude' ? (
          <button
            className={`toolbar-btn permission-btn ${permissionMode === 'bypass' ? 'bypass-active' : ''}`}
            onClick={() => onPermissionChange(permissionMode === 'default' ? 'bypass' : 'default')}
            title={permissionMode === 'default' ? 'Default permissions' : 'Bypass permissions'}
          >
            {permissionMode === 'default'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Default Approvals</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Bypass</span></>
            }
          </button>
          ) : (
          <button
            className={`toolbar-btn permission-btn ${codexPermission === 'full-access' ? 'bypass-active' : ''}`}
            onClick={() => {
              const next = codexPermission === 'auto' ? 'read-only' : codexPermission === 'read-only' ? 'full-access' : 'auto';
              onCodexPermissionChange?.(next);
            }}
            title={`Permissions: ${codexPermission}`}
          >
            {codexPermission === 'auto'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Auto</span></>
              : codexPermission === 'read-only'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Read-only</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Full Access</span></>
            }
          </button>
          )}
```
To:
```typescript
          {aiProvider === 'claude' ? (
          <button
            className={`toolbar-btn permission-btn ${permissionMode === 'bypass' ? 'bypass-active' : ''}`}
            onClick={() => onPermissionChange(permissionMode === 'default' ? 'bypass' : 'default')}
            title={permissionMode === 'default' ? 'Default permissions' : 'Bypass permissions'}
          >
            {permissionMode === 'default'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Default Approvals</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Bypass</span></>
            }
          </button>
          ) : aiProvider === 'gemini' ? (
          <button
            className={`toolbar-btn permission-btn ${geminiApprovalMode === 'yolo' ? 'bypass-active' : ''}`}
            onClick={() => {
              const modes: Array<'default' | 'auto_edit' | 'yolo' | 'plan'> = ['default', 'auto_edit', 'yolo', 'plan'];
              const idx = modes.indexOf(geminiApprovalMode);
              onGeminiApprovalModeChange?.(modes[(idx + 1) % modes.length]);
            }}
            title={`Approval: ${geminiApprovalMode}`}
          >
            {geminiApprovalMode === 'default'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Default</span></>
              : geminiApprovalMode === 'auto_edit'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Auto Edit</span></>
              : geminiApprovalMode === 'yolo'
              ? <><ShieldOff size={14} /> <span className="permission-label">Yolo</span></>
              : <><ShieldCheck size={14} /> <span className="permission-label">Plan</span></>
            }
          </button>
          ) : (
          <button
            className={`toolbar-btn permission-btn ${codexPermission === 'full-access' ? 'bypass-active' : ''}`}
            onClick={() => {
              const next = codexPermission === 'auto' ? 'read-only' : codexPermission === 'read-only' ? 'full-access' : 'auto';
              onCodexPermissionChange?.(next);
            }}
            title={`Permissions: ${codexPermission}`}
          >
            {codexPermission === 'auto'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Auto</span></>
              : codexPermission === 'read-only'
              ? <><ShieldCheck size={14} /> <span className="permission-label">Read-only</span></>
              : <><ShieldOff size={14} /> <span className="permission-label">Full Access</span></>
            }
          </button>
          )}
```

- [ ] **Step 7: Verify Settings import exists**

Check that `Settings` is imported from lucide-react at the top of the file. If not, add it. The current import line is:

```typescript
import {
  SquarePlus, Slash, SquareSlash, AtSign, FileText, GitBranch, Terminal, Settings,
  MessageSquare, Zap, Send, Square, ShieldCheck, ShieldOff,
  Paperclip, Image, ChevronDown, Minus, ChevronUp, ChevronsUp, Clock, Check,
} from 'lucide-react';
```

`Settings` and `Zap` are already imported — no changes needed.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat(gemini): add model, conversation mode, and approval mode controls"
```

---

### Task 8: Frontend — ChatMessage Icon

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx`

- [ ] **Step 1: Update aiProvider prop type**

In `src/components/Chat/ChatMessage.tsx`, update the `aiProvider` prop type (line 121):

Change:
```typescript
export default function ChatMessage({ message, projectPath, onFileOpen, aiProvider = 'claude' }: { message: ChatMessageType; projectPath?: string; onFileOpen?: (path: string) => void; aiProvider?: 'claude' | 'codex' }) {
```
To:
```typescript
export default function ChatMessage({ message, projectPath, onFileOpen, aiProvider = 'claude' }: { message: ChatMessageType; projectPath?: string; onFileOpen?: (path: string) => void; aiProvider?: 'claude' | 'codex' | 'gemini' }) {
```

- [ ] **Step 2: Update assistant icon rendering**

Update the icon selection (around line 131-132):

Change:
```typescript
            ? <span className={`chat-msg-dot ${aiProvider === 'codex' ? 'chat-msg-openai' : 'chat-msg-claude'}`} />
```
To:
```typescript
            ? <span className={`chat-msg-dot ${aiProvider === 'gemini' ? 'chat-msg-gemini' : aiProvider === 'codex' ? 'chat-msg-openai' : 'chat-msg-claude'}`} />
```

- [ ] **Step 3: Add .chat-msg-gemini CSS**

In the `<style>` block, after the `.chat-msg-openai` CSS (after line 210), add:

```css
        .chat-msg-gemini {
          width: 14px;
          height: 14px;
          margin-top: 2px;
          background-color: #4285f4;
          -webkit-mask-image: url('svg/Google-gemini-icon.svg');
          mask-image: url('svg/Google-gemini-icon.svg');
          -webkit-mask-size: contain;
          mask-size: contain;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
        }
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "feat(gemini): add Gemini icon to chat messages"
```

---

### Task 9: Build Verification and Final Commit

- [ ] **Step 1: Run the build**

Run: `cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -30`

Expected: Build succeeds without errors.

- [ ] **Step 2: Fix any build errors**

If there are TypeScript errors, fix them. Common issues:
- Missing props in component calls
- Type mismatches in the `window.sai` type declarations
- Unused imports

- [ ] **Step 3: Manual smoke test**

Start the app with `npm run dev` and verify:
1. Settings modal shows Claude, Codex CLI, and Gemini CLI in the provider dropdown
2. Selecting Gemini updates the accordion bar icon to the Gemini SVG in blue
3. Gemini-specific controls appear in the input toolbar (model, conversation mode, approval mode)
4. Claude-specific controls (effort, model, context ring) are hidden when Gemini is selected
5. Sending a message to Gemini CLI spawns the process and streams responses
6. The 6-dot thinking animation appears while Gemini is streaming
7. Gemini message icons use the blue Gemini SVG
8. Switching providers preserves each provider's settings

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(gemini): resolve build errors from integration"
```
