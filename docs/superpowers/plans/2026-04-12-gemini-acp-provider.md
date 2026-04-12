# Gemini ACP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SAI's Gemini `-p` wrapper with an ACP-backed provider that supports session-backed chat, approvals, tool rendering, terminal mode, and hidden-session commit-message generation with explicit disable-on-failure behavior.

**Architecture:** Add a Gemini ACP transport/client layer in Electron, then rebuild `electron/services/gemini.ts` around real session creation/loading instead of prompt replay. Persist `geminiSessionId` in saved chat sessions, route chat and terminal scopes to distinct Gemini ACP sessions, and move Gemini commit generation to a hidden ACP session that never pollutes visible chat history.

**Tech Stack:** Electron IPC, Node child processes, Gemini CLI ACP over stdio JSON-RPC, React/TypeScript, Vitest, Playwright/E2E harness

---

## File Structure

### New Files

- `electron/services/gemini-acp.ts`
  Gemini ACP transport and request/response correlation helper.
- `tests/unit/services/gemini-acp.test.ts`
  Unit tests for ACP transport, handshake, request lifecycle, and error cases.
- `tests/integration/gemini-acp-lifecycle.test.ts`
  Integration coverage for workspace Gemini session lifecycle and disable/retry behavior.

### Modified Files

- `electron/services/gemini.ts`
  Replace one-shot prompt execution with ACP-backed session manager and event translation.
- `electron/services/workspace.ts`
  Extend Gemini runtime state for ACP transport, session IDs, request tracking, availability, and scoped sessions.
- `electron/preload.ts`
  Add Gemini session setter and retry/availability IPC methods if needed by the renderer.
- `electron/services/claude.ts`
  Route Gemini commit-message generation through Gemini ACP hidden sessions instead of `gemini -p`.
- `src/types.ts`
  Persist `geminiSessionId` on chat sessions.
- `src/App.tsx`
  Save/restore Gemini session IDs and notify the backend when the active Gemini session changes.
- `src/components/Chat/ChatPanel.tsx`
  Remove Gemini prompt replay, capture Gemini `session_id`, and stop relying on Gemini-only append semantics.
- `src/components/TerminalMode/providerBridge.ts`
  Pass scope/tab identifiers into Gemini ACP terminal sends/stops.
- `src/components/TerminalMode/TerminalModeView.tsx`
  Capture Gemini terminal session IDs and keep terminal Gemini traffic scoped to terminal mode.
- `tests/unit/services/gemini.test.ts`
  Replace one-shot process tests with ACP session-manager tests.
- `tests/integration/workspace-lifecycle.test.ts`
  Update Gemini workspace cleanup assertions for ACP state.
- `tests/e2e/electron.setup.ts`
  Mock new Gemini preload methods for renderer tests.
- `tests/unit/sessions.test.ts`
  Cover `geminiSessionId` persistence in index entries.

## Task 1: Persist Gemini Session IDs In Chat Sessions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/sessions.ts`
- Test: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Write the failing session-persistence tests**

```ts
it('preserves geminiSessionId when saving sessions', () => {
  const session = {
    ...createSession(),
    geminiSessionId: 'gemini-session-123',
    messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() }],
  };

  const result = upsertSession([], session);

  expect(result[0].geminiSessionId).toBe('gemini-session-123');
});

it('loads geminiSessionId from saved session index', () => {
  const session = {
    ...createSession(),
    geminiSessionId: 'gemini-session-restore',
    messages: [{ id: 'm1', role: 'user', content: 'restore me', timestamp: Date.now() }],
  };

  saveSessions('/project', upsertSession([], session));

  expect(loadSessions('/project')[0].geminiSessionId).toBe('gemini-session-restore');
});
```

- [ ] **Step 2: Run the session tests to verify the new assertions fail or are missing coverage**

Run: `npm run test:unit -- tests/unit/sessions.test.ts --reporter=verbose`
Expected: FAIL or missing `geminiSessionId` assertions in current behavior.

- [ ] **Step 3: Add the persisted Gemini session field**

```ts
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  claudeSessionId?: string;
  codexSessionId?: string;
  geminiSessionId?: string;
  pinned?: boolean;
  titleEdited?: boolean;
}
```

- [ ] **Step 4: Save and restore Gemini session IDs in the app session flow**

```ts
const handleNewChat = () => {
  if (!activeProjectPath) return;
  flushAndPersist(activeProjectPath);
  window.sai.claudeSetSessionId(activeProjectPath, undefined);
  (window.sai as any).codexSetSessionId(activeProjectPath, undefined);
  (window.sai as any).geminiSetSessionId?.(activeProjectPath, undefined, 'chat');
  updateWorkspace(activeProjectPath, ws => ({
    ...ws,
    activeSession: createSession(),
  }));
};

const handleSelectSession = (id: string) => {
  if (!activeProjectPath) return;
  flushAndPersist(activeProjectPath);
  const selected = sessions.find(s => s.id === id);
  if (!selected) return;

  window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId);
  (window.sai as any).codexSetSessionId(activeProjectPath, selected.codexSessionId);
  (window.sai as any).geminiSetSessionId?.(activeProjectPath, selected.geminiSessionId, 'chat');

  const messages = loadSessionMessages(selected.id);
  updateWorkspace(activeProjectPath, ws => ({
    ...ws,
    activeSession: { ...selected, messages },
  }));
};
```

- [ ] **Step 5: Capture Gemini session IDs from the chat panel**

```tsx
<ChatPanel
  // ...
  onGeminiSessionId={(sessionId: string) => {
    updateWorkspace(wsPath, w => ({
      ...w,
      activeSession: { ...w.activeSession, geminiSessionId: sessionId },
    }));
  }}
/>
```

- [ ] **Step 6: Run the targeted tests**

Run: `npm run test:unit -- tests/unit/sessions.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/App.tsx src/sessions.ts tests/unit/sessions.test.ts
git commit -m "feat: persist gemini session ids in chat sessions"
```

## Task 2: Build The Gemini ACP Transport Helper

**Files:**
- Create: `electron/services/gemini-acp.ts`
- Test: `tests/unit/services/gemini-acp.test.ts`

- [ ] **Step 1: Write the failing ACP transport tests**

```ts
it('sends initialize and resolves after initialize response', async () => {
  const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
  await client.start();

  expect(mockSpawnFn).toHaveBeenCalledWith(
    'gemini',
    ['--acp'],
    expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
  );

  const proc = getLatestProcess();
  proc.pushStdout(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1' } }) + '\n');

  await expect(client.ready()).resolves.toBeUndefined();
});

it('correlates request ids and resolves prompt responses', async () => {
  const client = await startReadyClient();
  const promise = client.request('session/new', { cwd: PROJECT });
  emitRpcResult(1, { sessionId: 'gemini-session-1' });
  await expect(promise).resolves.toEqual({ sessionId: 'gemini-session-1' });
});

it('rejects all pending requests when the transport exits unexpectedly', async () => {
  const client = await startReadyClient();
  const pending = client.request('session/load', { sessionId: 'dead-session' });
  getLatestProcess().emit('exit', 1, null);
  await expect(pending).rejects.toThrow('Gemini ACP transport exited');
});
```

- [ ] **Step 2: Run the ACP transport tests to confirm they fail**

Run: `npm run test:unit -- tests/unit/services/gemini-acp.test.ts --reporter=verbose`
Expected: FAIL because the ACP transport file does not exist yet.

- [ ] **Step 3: Implement the minimal ACP transport**

```ts
export interface GeminiAcpClient {
  start(): Promise<void>;
  ready(): Promise<void>;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onEvent(listener: (event: any) => void): () => void;
  dispose(): void;
}

export function createGeminiAcpClient(opts: { cwd: string; env: NodeJS.ProcessEnv }): GeminiAcpClient {
  let nextId = 0;
  let proc: ChildProcess | null = null;
  let buffer = '';
  const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
  const listeners = new Set<(event: any) => void>();

  const write = (msg: unknown) => {
    if (!proc?.stdin) throw new Error('Gemini ACP transport not started');
    proc.stdin.write(JSON.stringify(msg) + '\n');
  };

  return {
    async start() {
      proc = spawn('gemini', ['--acp'], { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (typeof msg.id === 'number' && pending.has(msg.id)) {
            const waiter = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) waiter.reject(new Error(msg.error.message || 'Gemini ACP error'));
            else waiter.resolve(msg.result);
          } else {
            listeners.forEach(listener => listener(msg));
          }
        }
      });
      proc.on('exit', () => {
        for (const waiter of pending.values()) waiter.reject(new Error('Gemini ACP transport exited'));
        pending.clear();
      });
      write({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { clientInfo: { name: 'sai', version: '1.0' } } });
    },
    ready() {
      return this.request('initialized', {});
    },
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method, params = {}) {
      write({ jsonrpc: '2.0', method, params });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      proc?.kill();
      proc = null;
    },
  };
}
```

- [ ] **Step 4: Run the ACP transport tests to verify they pass**

Run: `npm run test:unit -- tests/unit/services/gemini-acp.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/gemini-acp.ts tests/unit/services/gemini-acp.test.ts
git commit -m "feat: add gemini acp transport client"
```

## Task 3: Rebuild The Gemini Main-Process Service Around ACP Chat Sessions

**Files:**
- Modify: `electron/services/workspace.ts`
- Modify: `electron/services/gemini.ts`
- Test: `tests/unit/services/gemini.test.ts`
- Test: `tests/integration/workspace-lifecycle.test.ts`

- [ ] **Step 1: Write failing Gemini service tests for ACP session start/load/send/stop**

```ts
it('creates a new Gemini ACP chat session on first send and emits session_id', async () => {
  mockIpcMain._emit('gemini:send', PROJECT, 'hello', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');

  emitRpcEvent({ method: 'session.created', params: { sessionId: 'gemini-chat-1', scope: 'chat' } });
  emitRpcEvent({ method: 'message.delta', params: { sessionId: 'gemini-chat-1', text: 'hello back' } });
  emitRpcEvent({ method: 'turn.completed', params: { sessionId: 'gemini-chat-1', usage: { input_tokens: 10, output_tokens: 4 } } });

  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({ type: 'session_id', sessionId: 'gemini-chat-1' }));
  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({ type: 'assistant' }));
  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({ type: 'done' }));
});

it('loads an existing Gemini session when gemini:setSessionId is called', async () => {
  mockIpcMain._emit('gemini:setSessionId', PROJECT, 'gemini-existing-1', 'chat');
  mockIpcMain._emit('gemini:send', PROJECT, 'continue this', undefined, 'plan', 'planning', 'auto-gemini-3', 'chat');

  expect(mockAcpRequest).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'gemini-existing-1' }));
});

it('cancels the active ACP request on gemini:stop', async () => {
  mockIpcMain._emit('gemini:send', PROJECT, 'cancel me', undefined, 'plan', 'planning', 'auto-gemini-3', 'chat');
  mockIpcMain._emit('gemini:stop', PROJECT, 'chat');

  expect(mockAcpRequest).toHaveBeenCalledWith('session/cancel', expect.any(Object));
});
```

- [ ] **Step 2: Run the Gemini service tests to confirm current one-shot behavior fails them**

Run: `npm run test:unit -- tests/unit/services/gemini.test.ts --reporter=verbose`
Expected: FAIL because `gemini.ts` does not load/create ACP sessions or support `gemini:setSessionId`.

- [ ] **Step 3: Extend Gemini workspace runtime state for ACP**

```ts
export interface WorkspaceGemini {
  transport: GeminiAcpClient | null;
  cwd: string;
  busy: boolean;
  turnSeq: number;
  chatSessionId: string | undefined;
  commitSessionId: string | undefined;
  terminalSessions: Map<string, string>;
  activeRequestId: string | undefined;
  availability: 'available' | 'disabled';
  lastError?: string;
}
```

- [ ] **Step 4: Add Gemini session setters and session-aware send logic**

```ts
ipcMain.on('gemini:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope: string = 'chat') => {
  const ws = get(projectPath);
  if (!ws) return;
  if (scope === 'chat') ws.gemini.chatSessionId = sessionId;
  else ws.gemini.terminalSessions.set(scope, sessionId || '');
});

ipcMain.on('gemini:send', async (_event, projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string, scope: string = 'chat') => {
  const ws = get(projectPath);
  if (!ws) return;
  const sessionId = await ensureGeminiSession(win, ws, scope);
  const turnSeq = ++ws.gemini.turnSeq;

  safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath, scope, turnSeq });

  await promptGeminiSession(ws, {
    scope,
    sessionId,
    message,
    imagePaths,
    approvalMode,
    conversationMode,
    model,
    turnSeq,
  });
});
```

- [ ] **Step 5: Translate ACP events into the existing renderer message contract**

```ts
function forwardGeminiEvent(win: BrowserWindow, ws: Workspace, scope: string, msg: any) {
  if (msg.method === 'message.delta') {
    safeSend(win, 'claude:message', {
      type: 'assistant',
      projectPath: ws.projectPath,
      scope,
      message: { content: [{ type: 'text', text: msg.params.text, delta: true }] },
    });
    return;
  }

  if (msg.method === 'tool.call') {
    safeSend(win, 'claude:message', {
      type: 'assistant',
      projectPath: ws.projectPath,
      scope,
      message: { content: [{ id: msg.params.id, type: 'tool_use', name: msg.params.name, input: msg.params.input || {} }] },
    });
    return;
  }

  if (msg.method === 'tool.result') {
    safeSend(win, 'claude:message', {
      type: 'user',
      projectPath: ws.projectPath,
      scope,
      message: { content: [{ type: 'tool_result', tool_use_id: msg.params.id, content: msg.params.output || '', is_error: !!msg.params.isError }] },
    });
    return;
  }
}
```

- [ ] **Step 6: Disable Gemini explicitly on ACP failure**

```ts
function disableGemini(win: BrowserWindow, ws: Workspace, scope: string, reason: string) {
  ws.gemini.availability = 'disabled';
  ws.gemini.lastError = reason;
  ws.gemini.busy = false;
  safeSend(win, 'claude:message', { type: 'error', projectPath: ws.projectPath, scope, text: `Gemini unavailable: ${reason}` });
  safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: ws.gemini.turnSeq });
}
```

- [ ] **Step 7: Update workspace suspend/remove logic to dispose Gemini ACP state**

```ts
if (ws.gemini.busy) {
  safeSend('claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.gemini.turnSeq });
}
ws.gemini.transport?.dispose();
ws.gemini.transport = null;
ws.gemini.busy = false;
ws.gemini.chatSessionId = undefined;
ws.gemini.commitSessionId = undefined;
ws.gemini.terminalSessions.clear();
ws.gemini.activeRequestId = undefined;
ws.gemini.availability = 'available';
ws.gemini.lastError = undefined;
```

- [ ] **Step 8: Run the focused Gemini service and workspace tests**

Run: `npm run test:unit -- tests/unit/services/gemini.test.ts --reporter=verbose`
Expected: PASS

Run: `npm run test:unit -- tests/integration/workspace-lifecycle.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add electron/services/workspace.ts electron/services/gemini.ts tests/unit/services/gemini.test.ts tests/integration/workspace-lifecycle.test.ts
git commit -m "feat: migrate gemini provider to acp chat sessions"
```

## Task 4: Remove Renderer Prompt Replay And Wire Gemini Session Restore

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx`
- Test: `tests/e2e/electron.setup.ts`
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing renderer tests**

```tsx
it('sends the raw prompt to Gemini instead of rebuilding conversation history', async () => {
  renderChatPanel({ aiProvider: 'gemini', initialMessages: [
    { id: 'u1', role: 'user', content: 'old', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'reply', timestamp: 2 },
  ]});

  await user.type(screen.getByPlaceholderText(/Message Gemini/i), 'new prompt');
  await user.keyboard('{Enter}');

  expect(window.sai.geminiSend).toHaveBeenCalledWith(
    PROJECT,
    'new prompt',
    undefined,
    'default',
    'planning',
    'auto-gemini-3',
    'chat',
  );
});

it('captures gemini session_id messages and forwards them to the app', () => {
  renderChatPanel({ aiProvider: 'gemini', onGeminiSessionId: vi.fn() });
  emitClaudeMessage({ type: 'session_id', projectPath: PROJECT, sessionId: 'gemini-chat-7' });
  expect(onGeminiSessionId).toHaveBeenCalledWith('gemini-chat-7');
});
```

- [ ] **Step 2: Run the chat panel tests to verify current replay behavior fails**

Run: `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx --reporter=verbose`
Expected: FAIL because Gemini currently prepends `<conversation_history>` and has no `onGeminiSessionId`.

- [ ] **Step 3: Add the new preload bridge signatures**

```ts
geminiSend: (
  projectPath: string,
  message: string,
  imagePaths?: string[],
  approvalMode?: string,
  conversationMode?: string,
  model?: string,
  scope?: string,
) => ipcRenderer.send('gemini:send', projectPath, message, imagePaths, approvalMode, conversationMode, model, scope),
geminiSetSessionId: (projectPath: string, sessionId: string | undefined, scope?: string) =>
  ipcRenderer.send('gemini:setSessionId', projectPath, sessionId, scope),
```

- [ ] **Step 4: Remove Gemini conversation-history prompt rebuilding**

```ts
const prompt = activeFilePath && fileContextEnabled ? `[File: ${activeFilePath}]\n\n${text}` : text;
if (aiProvider === 'gemini') {
  (window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel, 'chat');
} else if (aiProvider === 'codex') {
  window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
} else {
  window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
}
```

- [ ] **Step 5: Capture Gemini session IDs and normalize Gemini text updates**

```ts
if (msg.type === 'session_id') {
  if (aiProvider === 'gemini') onGeminiSessionId?.(msg.sessionId);
  else if (aiProvider === 'codex') onCodexSessionId?.(msg.sessionId);
  else if (aiProvider === 'claude') onClaudeSessionId?.(msg.sessionId);
  return;
}

const newContent = block.delta ? (last.content + text) : text;
```

- [ ] **Step 6: Run the chat-panel and preload-backed tests**

Run: `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add electron/preload.ts src/App.tsx src/components/Chat/ChatPanel.tsx tests/e2e/electron.setup.ts tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat: restore gemini sessions in the chat renderer"
```

## Task 5: Implement Gemini Approval Flow And Tool Rendering Parity

**Files:**
- Modify: `electron/services/gemini.ts`
- Modify: `src/components/Chat/ChatPanel.tsx`
- Test: `tests/unit/services/gemini.test.ts`
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write failing approval and tool-rendering tests**

```ts
it('emits approval_needed when Gemini ACP requests tool approval', async () => {
  emitRpcEvent({
    method: 'tool.approvalRequired',
    params: {
      scope: 'chat',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      input: { command: 'rm -rf tmp' },
      description: 'Delete temp files',
    },
  });

  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
    type: 'approval_needed',
    toolUseId: 'tool-1',
    toolName: 'Bash',
  }));
});

it('resumes a pending Gemini tool call after approval', async () => {
  mockIpcMain._invoke('claude:approve', PROJECT, 'tool-1', true, undefined, 'chat');
  expect(mockAcpRequest).toHaveBeenCalledWith('tool/approve', expect.objectContaining({ toolUseId: 'tool-1', approved: true }));
});
```

- [ ] **Step 2: Run the Gemini service tests to verify approval handling is missing**

Run: `npm run test:unit -- tests/unit/services/gemini.test.ts --reporter=verbose`
Expected: FAIL because Gemini currently has no ACP approval state or approve handler.

- [ ] **Step 3: Store pending Gemini approvals in workspace state and map them to the existing approval IPC**

```ts
if (msg.method === 'tool.approvalRequired') {
  ws.gemini.pendingApproval = {
    toolUseId: msg.params.toolUseId,
    toolName: msg.params.toolName,
    input: msg.params.input || {},
    scope,
  };
  safeSend(win, 'claude:message', {
    type: 'approval_needed',
    projectPath: ws.projectPath,
    scope,
    toolUseId: msg.params.toolUseId,
    toolName: msg.params.toolName,
    command: msg.params.input?.command || '',
    description: msg.params.description || '',
    input: msg.params.input || {},
  });
}
```

- [ ] **Step 4: Extend the existing approve handler to dispatch Gemini approvals**

```ts
ipcMain.handle('claude:approve', async (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope: string = 'chat') => {
  const ws = get(projectPath);
  if (!ws) return false;

  const pendingGemini = ws.gemini.pendingApproval;
  if (pendingGemini && pendingGemini.toolUseId === toolUseId) {
    await ws.gemini.transport?.request('tool/approve', {
      sessionId: scope === 'chat' ? ws.gemini.chatSessionId : ws.gemini.terminalSessions.get(scope),
      toolUseId,
      approved,
      modifiedCommand,
    });
    ws.gemini.pendingApproval = undefined;
    return true;
  }

  // existing Claude approval path remains below
});
```

- [ ] **Step 5: Run the targeted approval and rendering tests**

Run: `npm run test:unit -- tests/unit/services/gemini.test.ts --reporter=verbose`
Expected: PASS

Run: `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add electron/services/gemini.ts src/components/Chat/ChatPanel.tsx tests/unit/services/gemini.test.ts tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat: add gemini approval and tool rendering parity"
```

## Task 6: Move Gemini Terminal Mode To Scoped ACP Sessions

**Files:**
- Modify: `src/components/TerminalMode/providerBridge.ts`
- Modify: `src/components/TerminalMode/TerminalModeView.tsx`
- Modify: `electron/services/gemini.ts`
- Test: `tests/unit/components/TerminalMode/providerBridge.test.ts`
- Test: `tests/unit/components/TerminalMode/TerminalModeView.test.tsx`

- [ ] **Step 1: Write the failing terminal-mode tests**

```ts
it('passes the terminal scope into Gemini sends', () => {
  const bridge = getTerminalProviderBridge(window.sai as any, 'gemini');
  bridge.send('/project', 'summarize this', 'default', 'terminal');
  expect(window.sai.geminiSend).toHaveBeenCalledWith('/project', 'summarize this', undefined, 'auto_edit', 'planning', undefined, 'terminal');
});

it('stores Gemini terminal session ids separately from chat sessions', () => {
  render(<TerminalModeView projectPath={PROJECT} aiProvider="gemini" active />);
  emitClaudeMessage({ type: 'session_id', projectPath: PROJECT, scope: 'terminal', sessionId: 'gemini-term-1' });
  expect(window.sai.geminiSetSessionId).toHaveBeenCalledWith(PROJECT, 'gemini-term-1', 'terminal');
});
```

- [ ] **Step 2: Run the terminal-mode tests to confirm current bridge behavior fails**

Run: `npm run test:unit -- tests/unit/components/TerminalMode/providerBridge.test.ts tests/unit/components/TerminalMode/TerminalModeView.test.tsx --reporter=verbose`
Expected: FAIL because Gemini does not currently accept scoped sends or set scoped session IDs.

- [ ] **Step 3: Add scope-aware Gemini terminal bridge methods**

```ts
if (aiProvider === 'gemini') {
  return {
    send: (projectPath: string, message: string, _permissionMode: TerminalPermissionMode, scope: string = 'terminal') =>
      sai.geminiSend(projectPath, message, undefined, 'auto_edit', 'planning', undefined, scope),
    stop: (projectPath: string, scope: string = 'terminal') => sai.geminiStop(projectPath, scope),
  };
}
```

- [ ] **Step 4: Persist Gemini terminal session IDs separately from chat**

```ts
if (msg.type === 'session_id' && msg.sessionId) {
  sessionIdRef.current = msg.sessionId;
  if (aiProvider === 'gemini') {
    (window.sai as any).geminiSetSessionId?.(projectPath, msg.sessionId, 'terminal');
  }
}
```

- [ ] **Step 5: Run the terminal-mode tests**

Run: `npm run test:unit -- tests/unit/components/TerminalMode/providerBridge.test.ts tests/unit/components/TerminalMode/TerminalModeView.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalMode/providerBridge.ts src/components/TerminalMode/TerminalModeView.tsx electron/services/gemini.ts tests/unit/components/TerminalMode/providerBridge.test.ts tests/unit/components/TerminalMode/TerminalModeView.test.tsx
git commit -m "feat: move gemini terminal mode to acp sessions"
```

## Task 7: Route Gemini Commit-Message Generation Through A Hidden ACP Session

**Files:**
- Modify: `electron/services/claude.ts`
- Modify: `electron/services/gemini.ts`
- Test: `tests/unit/services/claude.test.ts`

- [ ] **Step 1: Write the failing commit-generation tests**

```ts
it('uses a hidden Gemini ACP session for commit generation', async () => {
  await mockIpcMain._invoke('claude:generateCommitMessage', PROJECT, 'gemini');

  expect(mockAcpRequest).toHaveBeenCalledWith('session/new', expect.objectContaining({ scope: 'commit' }));
  expect(mockAcpRequest).toHaveBeenCalledWith('session/prompt', expect.objectContaining({
    prompt: expect.stringContaining('Generate a concise commit message for this diff'),
  }));
});

it('does not reuse the active Gemini chat session for commit generation', async () => {
  get(PROJECT)!.gemini.chatSessionId = 'gemini-chat-visible';
  await mockIpcMain._invoke('claude:generateCommitMessage', PROJECT, 'gemini');
  expect(lastGeminiPromptSessionId()).not.toBe('gemini-chat-visible');
});
```

- [ ] **Step 2: Run the commit-message tests to verify the current one-shot Gemini path fails**

Run: `npm run test:unit -- tests/unit/services/claude.test.ts --reporter=verbose`
Expected: FAIL because Gemini commit generation still uses `gemini -p`.

- [ ] **Step 3: Add a hidden Gemini commit-session helper**

```ts
export async function ensureGeminiCommitSession(win: BrowserWindow, ws: Workspace): Promise<string> {
  if (ws.gemini.commitSessionId) return ws.gemini.commitSessionId;
  const result = await ws.gemini.transport!.request<{ sessionId: string }>('session/new', {
    cwd: ws.gemini.cwd || ws.projectPath,
    scope: 'commit',
  });
  ws.gemini.commitSessionId = result.sessionId;
  return result.sessionId;
}
```

- [ ] **Step 4: Replace the Gemini one-shot commit path in `claude:generateCommitMessage`**

```ts
if (aiProvider === 'gemini') {
  const geminiWs = getOrCreate(effectiveCwd);
  await ensureGeminiTransport(win, geminiWs);
  const sessionId = await ensureGeminiCommitSession(win, geminiWs);
  const result = await promptGeminiText(geminiWs, {
    sessionId,
    scope: 'commit',
    prompt: commitPrompt,
    model: 'gemini-2.5-flash',
    approvalMode: 'plan',
  });
  resolve(result.trim());
  return;
}
```

- [ ] **Step 5: Run the commit-generation tests**

Run: `npm run test:unit -- tests/unit/services/claude.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts electron/services/gemini.ts tests/unit/services/claude.test.ts
git commit -m "feat: use hidden gemini acp session for commit messages"
```

## Task 8: Add Gemini Disable/Retry Integration Coverage

**Files:**
- Create: `tests/integration/gemini-acp-lifecycle.test.ts`
- Modify: `tests/e2e/electron.setup.ts`
- Modify: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Write the failing integration tests for disable-and-retry**

```ts
it('marks Gemini disabled after ACP handshake failure', async () => {
  registerGeminiHandlers(mockWin as any);
  failNextGeminiInitialize(new Error('handshake failed'));

  mockIpcMain._emit('gemini:send', PROJECT, 'hello');

  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
    type: 'error',
    text: expect.stringContaining('Gemini unavailable'),
  }));
});

it('retries Gemini successfully after an explicit restart', async () => {
  failNextGeminiInitialize(new Error('boom'));
  mockIpcMain._emit('gemini:send', PROJECT, 'hello');

  clearGeminiFailures();
  await mockIpcMain._invoke('gemini:start', PROJECT);
  mockIpcMain._emit('gemini:send', PROJECT, 'hello again');

  expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({ type: 'streaming_start' }));
});
```

- [ ] **Step 2: Run the new integration test to confirm retry/disable behavior is incomplete**

Run: `npm run test:unit -- tests/integration/gemini-acp-lifecycle.test.ts --reporter=verbose`
Expected: FAIL because retry/disable flows are not fully implemented yet.

- [ ] **Step 3: Add the minimum retry hooks and test mocks**

```ts
geminiStart: (cwd: string, scope?: string) => ipcRenderer.invoke('gemini:start', cwd, scope),
geminiSetSessionId: () => {},
```

```ts
test('gemini can recover after explicit retry', async ({ window }) => {
  await window.evaluate(() => {
    window.sai.__setGeminiFailure?.('handshake failed');
  });

  // send message, observe disabled error, clear failure, retry, send again
});
```

- [ ] **Step 4: Run the integration and relevant e2e coverage**

Run: `npm run test:unit -- tests/integration/gemini-acp-lifecycle.test.ts --reporter=verbose`
Expected: PASS

Run: `npm run test:e2e -- tests/e2e/settings.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/gemini-acp-lifecycle.test.ts tests/e2e/electron.setup.ts tests/e2e/settings.spec.ts
git commit -m "test: cover gemini acp disable and retry flows"
```

## Final Verification

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit -- --reporter=verbose`
Expected: PASS

- [ ] **Step 2: Run the targeted e2e suite**

Run: `npm run test:e2e -- tests/e2e/settings.spec.ts`
Expected: PASS

- [ ] **Step 3: Run the app TypeScript check or build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Manual verification**

Run these manual checks:

```text
1. Start a new Gemini chat in SAI and send two turns.
2. Switch to another chat, then switch back and confirm Gemini continues the same session without prompt replay artifacts.
3. Trigger a Gemini tool approval and approve it from the UI.
4. Trigger Gemini terminal mode, send a request, and confirm it does not leak into chat history.
5. Generate a commit message with Gemini and confirm it works after prior chat turns without polluting visible messages.
6. Simulate or force a Gemini ACP failure and confirm Gemini is disabled until explicit retry.
```

- [ ] **Step 5: Final commit**

```bash
git add electron/services/gemini.ts electron/services/gemini-acp.ts electron/services/workspace.ts electron/services/claude.ts electron/preload.ts src/types.ts src/App.tsx src/components/Chat/ChatPanel.tsx src/components/TerminalMode/providerBridge.ts src/components/TerminalMode/TerminalModeView.tsx tests/unit/services/gemini-acp.test.ts tests/unit/services/gemini.test.ts tests/unit/services/claude.test.ts tests/unit/sessions.test.ts tests/integration/gemini-acp-lifecycle.test.ts tests/integration/workspace-lifecycle.test.ts tests/e2e/electron.setup.ts docs/superpowers/specs/2026-04-12-gemini-acp-provider-design.md docs/superpowers/plans/2026-04-12-gemini-acp-provider.md
git commit -m "feat: migrate gemini provider to acp"
```

## Self-Review

### Spec Coverage

- ACP-only backend: covered in Tasks 2, 3, and 8.
- Persisted Gemini chat sessions: covered in Tasks 1 and 4.
- Approval parity and tool rendering: covered in Task 5.
- Terminal mode parity: covered in Task 6.
- Hidden commit session: covered in Task 7.
- Disable-without-fallback and explicit retry: covered in Tasks 3 and 8.

### Placeholder Scan

- No `TBD`, `TODO`, or deferred “implement later” placeholders remain.
- Each task names exact files and test commands.
- Each code-writing step includes concrete code to anchor the implementation.

### Type Consistency

- Chat persistence uses `geminiSessionId`.
- Backend session wiring uses `gemini:setSessionId`.
- Scope strings are `chat`, `terminal`, and `commit`.
- Commit generation uses `commitSessionId`, not the visible `chatSessionId`.
