# Kimi K3 Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kimi K3 (Moonshot AI) as a fourth AI provider in SAI via kimi-cli's ACP mode, sharing an extracted ACP layer with the existing Gemini integration.

**Architecture:** Extract the generic parts of the Gemini ACP integration into a shared client (`acp.ts`) and provider-service factory (`acpProvider.ts`); `gemini.ts` and a new `kimi.ts` become thin configs. The renderer gains `'kimi'` in the `AIProvider` union with gemini-mirrored props/state. All provider events keep riding the `claude:message` IPC channel.

**Tech Stack:** Electron main process (TypeScript), React renderer, vitest, ACP (Agent Client Protocol, JSON-RPC over stdio) via the `kimi acp` subcommand of [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli).

**Spec:** `docs/superpowers/specs/2026-07-22-kimi-provider-design.md`

## Global Constraints

- Run tests with `npx vitest run --maxWorkers=2` (machine-wide memory rule; never unbounded workers).
- `npx tsc --noEmit` must pass at the end of every task (sole exception: Task 6 widens the `AIProvider` union before the renderer catches up — its gate is explicitly narrower, see Task 6 Step 4; Tasks 7–8 burn the remaining errors down to zero).
- The existing test `tests/unit/electron/geminiAcpImages.test.ts` must stay green through every task (it imports from `electron/services/gemini.ts` — keep that module's exports stable via re-exports).
- No credentials stored in SAI. Kimi auth is owned by kimi-cli (`kimi /login`).
- Follow the symlinked-home rule: never compare paths by string equality (`/home/mstephens` vs `/var/home/mstephens`).
- Do not commit the untracked `.codex` directory.
- Commit at the end of every task with a conventional-commit message ending in the Claude Fable co-author trailer.
- Icons in the composer are rendered via CSS `mask-image`, so provider SVGs must be single-color silhouettes.
- Kimi UI color: use `var(--text)` in renderer inline styles and `#fff` in `PROVIDER_OPTIONS` (same treatment as Codex).

---

### Task 1: Generic ACP client (`electron/services/acp.ts`)

**Files:**
- Create: `electron/services/acp.ts`
- Modify: `electron/services/gemini-acp.ts` (becomes a thin wrapper)
- Test: `tests/unit/electron/acpClient.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createAcpClient(options: AcpClientOptions): AcpClient` where `AcpClientOptions = { command: string; args: string[]; label: string; cwd: string; env: NodeJS.ProcessEnv; clientInfo?: { name: string; version: string }; spawnImpl?: typeof spawn }` and `AcpClient = { start(): Promise<void>; request<T>(method, params?): Promise<T>; notify(method, params?): void; onEvent(listener): () => void; dispose(): void }`. `gemini-acp.ts` keeps exporting `createGeminiAcpClient` and the `GeminiAcpClient` / `GeminiAcpClientOptions` types with identical behavior (error strings still start with `Gemini ACP …`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/electron/acpClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createAcpClient } from '../../../electron/services/acp';

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function makeClient(child: any, overrides: Partial<Parameters<typeof createAcpClient>[0]> = {}) {
  const spawnImpl = vi.fn(() => child);
  const client = createAcpClient({
    command: 'kimi',
    args: ['acp'],
    label: 'Kimi ACP',
    cwd: '/tmp/proj',
    env: { PATH: '/usr/bin' },
    spawnImpl: spawnImpl as any,
    ...overrides,
  });
  return { client, spawnImpl };
}

function reply(child: any, msg: unknown) {
  child.stdout.emit('data', Buffer.from(JSON.stringify(msg) + '\n'));
}

describe('createAcpClient', () => {
  it('spawns the configured command with args and cwd', async () => {
    const child = fakeChild();
    const { client, spawnImpl } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    expect(spawnImpl).toHaveBeenCalledWith('kimi', ['acp'], expect.objectContaining({ cwd: '/tmp/proj' }));
  });

  it('sends initialize as request id 0 and resolves start on its response', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    const firstWrite = JSON.parse(child.stdin.write.mock.calls[0][0]);
    expect(firstWrite).toMatchObject({ id: 0, method: 'initialize' });
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await expect(started).resolves.toBeUndefined();
  });

  it('routes responses to pending requests and events to listeners', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    const events: unknown[] = [];
    client.onEvent(e => events.push(e));
    const req = client.request<{ ok: boolean }>('session/new', { cwd: '/tmp/proj' });
    const sent = JSON.parse(child.stdin.write.mock.calls.at(-1)[0]);
    reply(child, { jsonrpc: '2.0', method: 'session/update', params: { n: 1 } });
    reply(child, { jsonrpc: '2.0', id: sent.id, result: { ok: true } });
    await expect(req).resolves.toEqual({ ok: true });
    expect(events).toEqual([{ jsonrpc: '2.0', method: 'session/update', params: { n: 1 } }]);
  });

  it('rejects pending requests with the label when the process exits', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    const req = client.request('session/prompt', {});
    child.emit('exit');
    await expect(req).rejects.toThrow('Kimi ACP transport exited');
  });

  it('uses the label in the not-started error', () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    expect(() => client.notify('x')).toThrow('Kimi ACP transport not started');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/acpClient.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module '../../../electron/services/acp'` (or equivalent resolve error).

- [ ] **Step 3: Create `electron/services/acp.ts`**

Copy the entire body of `electron/services/gemini-acp.ts` into `electron/services/acp.ts`, then apply these changes (everything else stays byte-identical — the framing, pending map, and start handshake logic are already correct):

```ts
import { spawn, ChildProcess } from 'node:child_process';

export interface AcpClientOptions {
  /** Executable to spawn, e.g. 'gemini' or 'kimi'. */
  command: string;
  /** Arguments, e.g. ['--acp'] or ['acp']. */
  args: string[];
  /** Human-readable prefix for error messages, e.g. 'Gemini ACP'. Error-string
   *  prefixes are load-bearing: acpProvider's transport-failure detection
   *  matches on `${label} transport` / `${label} initialize`. */
  label: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo?: { name: string; version: string };
  /** Test seam. Defaults to node:child_process spawn. */
  spawnImpl?: typeof spawn;
}

export interface AcpClient {
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onEvent(listener: (event: unknown) => void): () => void;
  dispose(): void;
}

export function createAcpClient(options: AcpClientOptions): AcpClient {
  const { label } = options;
  const spawnFn = options.spawnImpl ?? spawn;
  // ... rest of the former createGeminiAcpClient body, with these substitutions:
}
```

Substitutions inside the moved body:

| Old (gemini-acp.ts) | New (acp.ts) |
|---|---|
| `createGeminiAcpClient(options: GeminiAcpClientOptions)` | `createAcpClient(options: AcpClientOptions)` |
| `'Gemini ACP transport not started'` (2 sites) | `` `${label} transport not started` `` |
| `'Gemini ACP initialize failed'` | `` `${label} initialize failed` `` |
| `'Gemini ACP request failed'` | `` `${label} request failed` `` |
| `` `Gemini ACP transport error: ${error.message}` `` | `` `${label} transport error: ${error.message}` `` |
| `'Gemini ACP transport exited'` | `` `${label} transport exited` `` |
| `'Gemini ACP transport disposed'` | `` `${label} transport disposed` `` |
| `spawn('gemini', ['--acp'], {` | `spawnFn(options.command, options.args, {` |

- [ ] **Step 4: Rewrite `electron/services/gemini-acp.ts` as a wrapper**

Replace the whole file with:

```ts
import { createAcpClient, type AcpClient, type AcpClientOptions } from './acp';

export interface GeminiAcpClientOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo?: { name: string; version: string };
}

export type GeminiAcpClient = AcpClient;

export function createGeminiAcpClient(options: GeminiAcpClientOptions): GeminiAcpClient {
  const acpOptions: AcpClientOptions = {
    ...options,
    command: 'gemini',
    args: ['--acp'],
    label: 'Gemini ACP',
  };
  return createAcpClient(acpOptions);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/electron/acpClient.test.ts tests/unit/electron/geminiAcpImages.test.ts --maxWorkers=2 && npx tsc --noEmit`
Expected: both test files PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/acp.ts electron/services/gemini-acp.ts tests/unit/electron/acpClient.test.ts
git commit -m "refactor(acp): extract generic ACP client from gemini-acp"
```

---

### Task 2: Shared ACP workspace state + `ws.kimi`

**Files:**
- Modify: `electron/services/workspace.ts`

**Interfaces:**
- Consumes: `AcpClient` type from Task 1.
- Produces: `export interface AcpWorkspaceState { … }` (former `WorkspaceGemini`, with `transport: AcpClient | null`), kept alias `export type WorkspaceGemini = AcpWorkspaceState`, `Workspace.kimi: AcpWorkspaceState`, `newAcpState(projectPath: string): AcpWorkspaceState`, and a `resetAcpState(state, safeSend, projectPath)` suspend helper. Later tasks rely on `ws.kimi` existing on every workspace with the exact same shape as `ws.gemini`.

- [ ] **Step 1: Rename the state interface and add the alias**

In `electron/services/workspace.ts`, rename `interface WorkspaceGemini` to `AcpWorkspaceState`, change its `transport` field type from `GeminiAcpClient | null` to `AcpClient | null` (import `type { AcpClient } from './acp'`, drop the `gemini-acp` import), and add below it:

```ts
/** Back-compat alias — the Gemini state shape is now the shared ACP provider state. */
export type WorkspaceGemini = AcpWorkspaceState;
```

Update the doc comment on `metaPreamble` to say "the provider" instead of "gemini".

- [ ] **Step 2: Add `kimi` to the Workspace interface**

```ts
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
```

- [ ] **Step 3: Extract the state factory and use it for both slots**

Add above `getOrCreate`:

```ts
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
```

In `getOrCreate`, replace the inline `gemini: { … }` object literal with `gemini: newAcpState(projectPath)` and add `kimi: newAcpState(projectPath)`.

- [ ] **Step 4: Extract and reuse the suspend cleanup**

In `suspend()`, the block starting at `// Kill Gemini process` (from `if (ws.gemini.busy)` through `ws.gemini.pendingApproval = null;`) becomes a helper, called for both slots:

```ts
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
```

In `suspend()`, replace the gemini block with:

```ts
// Reset ACP providers (Gemini, Kimi)
resetAcpState(ws.gemini, safeSend, ws.projectPath);
resetAcpState(ws.kimi, safeSend, ws.projectPath);
```

Note: `registerWorkspaceBackendHooks('kimi', …)` is NOT needed — that seam exists for backends whose sessions live outside this registry (Claude SDK, Codex SDK). Kimi state lives in `ws.kimi`, so `suspend()` handles it directly, same as Gemini. (This corrects a spec line; record the deviation in the final commit message of Task 10.)

- [ ] **Step 5: Run full unit suite + typecheck**

Run: `npx vitest run --maxWorkers=2 && npx tsc --noEmit`
Expected: PASS (no behavior change for existing providers; anything importing `WorkspaceGemini` still compiles via the alias).

- [ ] **Step 6: Commit**

```bash
git add electron/services/workspace.ts
git commit -m "refactor(workspace): shared AcpWorkspaceState + ws.kimi slot"
```

---

### Task 3: ACP provider-service factory (`electron/services/acpProvider.ts`)

**Files:**
- Create: `electron/services/acpProvider.ts`
- Modify: `electron/services/gemini.ts` (becomes a thin config + re-exports)
- Test: `tests/unit/electron/acpProviderTranslate.test.ts` (new), `tests/unit/electron/geminiAcpImages.test.ts` (must stay green unmodified)

**Interfaces:**
- Consumes: `createAcpClient` (Task 1), `AcpWorkspaceState` + `Workspace` (Task 2).
- Produces:

```ts
export interface AcpProviderConfig {
  key: 'gemini' | 'kimi';        // IPC channel prefix AND Workspace slot name
  displayName: string;           // 'Gemini' | 'Kimi' — user-facing copy + notifyCompletion
  label: string;                 // 'Gemini ACP' | 'Kimi ACP' — must match acp client label
  command: string;
  args: string[];
  models: { id: string; name: string }[];
  defaultModel: string;
  /** Model substituted when conversationMode === 'fast' (Gemini only). */
  fastModel?: string;
  /** Extra sentence appended to transport-failure errors (install/login guidance). */
  installHint?: string;
}
export function registerAcpProviderHandlers(win: BrowserWindow, config: AcpProviderConfig): void;
export function ensureAcpTransport(win: BrowserWindow, ws: Workspace, config: AcpProviderConfig): Promise<AcpClient>;
export function ensureAcpCommitSession(win: BrowserWindow, ws: Workspace, config: AcpProviderConfig): Promise<string>;
export function promptAcpText(win: BrowserWindow, ws: Workspace, config: AcpProviderConfig, options: { sessionId: string; scope: string; prompt: string; imagePaths?: string[]; approvalMode?: string; conversationMode?: string; model?: string }): Promise<string>;
export function acpContentToToolResult(content: any[] | undefined): string | any[];
export function translateAcpEvent(msg: any, projectPath: string, scope: string): any | null;
```

- `gemini.ts` keeps exporting: `registerGeminiHandlers(win)`, `ensureGeminiTransport(win, ws)`, `ensureGeminiCommitSession(win, ws)`, `promptGeminiText(win, ws, options)`, `acpContentToToolResult` (re-export) — the signatures `electron/services/claude.ts` and `tests/unit/electron/geminiAcpImages.test.ts` already import.

- [ ] **Step 1: Write the failing translate test**

Create `tests/unit/electron/acpProviderTranslate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({ notifyCompletion: vi.fn() }));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(), get: vi.fn(), touchActivity: vi.fn(),
}));

import { translateAcpEvent } from '../../../electron/services/acpProvider';

describe('translateAcpEvent', () => {
  it('maps agent_message_chunk to a streaming assistant delta', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } },
    }, '/p', 'chat');
    expect(out).toMatchObject({
      type: 'assistant', projectPath: '/p', scope: 'chat',
      message: { content: [{ type: 'text', text: 'hi', delta: true }] },
    });
  });

  it('maps ACP-standard kinds (kimi dialect) to Claude tool names', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', title: 'ls -la' } },
    }, '/p', 'chat');
    expect(out.message.content[0]).toMatchObject({ id: 't1', type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } });
  });

  it('maps failed tool_call_update to an error tool_result', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'boom' } }] } },
    }, '/p', 'chat');
    expect(out.message.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/acpProviderTranslate.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `electron/services/acpProvider`.

- [ ] **Step 3: Create `acpProvider.ts` by moving `gemini.ts` wholesale**

Move everything in `gemini.ts` EXCEPT the `GEMINI_MODELS` / `GEMINI_DEFAULT_MODEL` constants into `acpProvider.ts`, then parameterize. Mechanical substitution table (apply to the whole moved body):

| Old | New |
|---|---|
| `import { createGeminiAcpClient } from './gemini-acp';` | `import { createAcpClient, type AcpClient } from './acp';` |
| every `ws.gemini` | `state(ws)` — where each moved function gains a leading/threaded `config: AcpProviderConfig` param and `const state = (ws: Workspace) => ws[config.key];` |
| `createGeminiAcpClient({ cwd, env, clientInfo })` | `createAcpClient({ cwd, env, clientInfo, command: config.command, args: config.args, label: config.label })` |
| `'gemini:models'`, `'gemini:start'`, `'gemini:send'`, `'gemini:stop'`, `'gemini:approve'`, `'gemini:setSessionId'` | `` `${config.key}:models` `` etc. |
| `` `Gemini unavailable: ${reason}` `` | `` `${config.displayName} unavailable: ${reason}` `` |
| `'Gemini startup failed'` | `` `${config.displayName} startup failed` `` |
| `'Gemini request failed'` | `` `${config.displayName} request failed` `` |
| `` `Gemini approval failed: …` `` | `` `${config.displayName} approval failed: …` `` |
| `'Gemini request timed out: no response for 2 minutes'` | `` `${config.displayName} request timed out: no response for 2 minutes` `` |
| `errorMsg.startsWith('Gemini ACP transport')` | `` errorMsg.startsWith(`${config.label} transport`) `` |
| `errorMsg.startsWith('Gemini ACP initialize')` | `` errorMsg.startsWith(`${config.label} initialize`) `` |
| `notifyCompletion(win, ws.projectPath, { provider: 'Gemini' })` | `notifyCompletion(win, ws.projectPath, { provider: config.displayName })` |
| `model: conversationMode === 'fast' ? 'gemini-2.5-flash' : (model \|\| GEMINI_DEFAULT_MODEL)` | `model: conversationMode === 'fast' && config.fastModel ? config.fastModel : (model \|\| config.defaultModel)` |
| `GEMINI_MODELS` / `GEMINI_DEFAULT_MODEL` in the `:models` handler | `config.models` / `config.defaultModel` |
| function names `disableGemini`, `ensureGeminiTransport`, `ensureGeminiCommitSession`, `promptGeminiText`, `registerGeminiHandlers`, `buildGeminiProjectBootstrap`, `geminiKindToName`, `geminiKindToInput` | `disableAcpProvider`, `ensureAcpTransport`, `ensureAcpCommitSession`, `promptAcpText`, `registerAcpProviderHandlers`, `buildProjectBootstrap`, `acpKindToName`, `acpKindToInput` |
| `GEMINI_BOOTSTRAP_FILES` | `BOOTSTRAP_FILES` (add `'AGENTS.md'` to the list — kimi-cli reads AGENTS.md, and it costs nothing for Gemini) |

Additional required changes while moving:

1. **Install hint.** In `disableAcpProvider`, the error text becomes:

```ts
const hint = config.installHint ? ` ${config.installHint}` : '';
safeSend(win, 'claude:message', {
  type: 'error',
  projectPath: ws.projectPath,
  scope,
  text: `${config.displayName} unavailable: ${reason}.${hint}`,
});
```

2. **Kind mapping.** Extend `acpKindToName` and `acpKindToInput` with the ACP-standard kind strings kimi-cli emits (the Gemini dialect strings stay). Add these cases to the existing switches:

```ts
// acpKindToName — add:
case 'read': return 'Read';
case 'edit': return 'Edit';
case 'delete': case 'move': return 'Bash';
case 'execute': return 'Bash';
case 'search': return 'Grep';
case 'fetch': return 'WebFetch';
case 'think': return 'Thinking';
```

```ts
// acpKindToInput — add 'read' and 'edit' to the file-path group,
// 'execute' to the command group, 'search' to the pattern group, e.g.:
case 'read':
case 'edit':            // → same branch as 'read_file' … 'patch_file'
case 'execute':         // → same branch as 'run_shell_command' … 'shell'
case 'search':          // → same branch as 'search_file_content' / 'search_files'
```

3. **Exports.** Export `AcpProviderConfig`, `registerAcpProviderHandlers`, `ensureAcpTransport`, `ensureAcpCommitSession`, `promptAcpText`, `acpContentToToolResult`, `translateAcpEvent` (the moved `translateAcpEvent` is config-free — keep it that way; kind mapping helpers stay internal but shared).

- [ ] **Step 4: Rewrite `gemini.ts` as a thin config**

Replace the whole file with:

```ts
import { BrowserWindow } from 'electron';
import type { Workspace } from './workspace';
import {
  registerAcpProviderHandlers,
  ensureAcpTransport,
  ensureAcpCommitSession,
  promptAcpText,
  acpContentToToolResult,
  type AcpProviderConfig,
} from './acpProvider';

export const GEMINI_CONFIG: AcpProviderConfig = {
  key: 'gemini',
  displayName: 'Gemini',
  label: 'Gemini ACP',
  command: 'gemini',
  args: ['--acp'],
  models: [
    { id: 'auto-gemini-3', name: 'Auto (Gemini 3)' },
    { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
  ],
  defaultModel: 'auto-gemini-3',
  fastModel: 'gemini-2.5-flash',
};

// Signature-stable wrappers — imported by electron/services/claude.ts and tests.
export { acpContentToToolResult };
export const registerGeminiHandlers = (win: BrowserWindow) => registerAcpProviderHandlers(win, GEMINI_CONFIG);
export const ensureGeminiTransport = (win: BrowserWindow, ws: Workspace) => ensureAcpTransport(win, ws, GEMINI_CONFIG);
export const ensureGeminiCommitSession = (win: BrowserWindow, ws: Workspace) => ensureAcpCommitSession(win, ws, GEMINI_CONFIG);
export const promptGeminiText = (
  win: BrowserWindow,
  ws: Workspace,
  options: Parameters<typeof promptAcpText>[3],
) => promptAcpText(win, ws, GEMINI_CONFIG, options);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/electron/acpProviderTranslate.test.ts tests/unit/electron/geminiAcpImages.test.ts --maxWorkers=2 && npx tsc --noEmit`
Expected: both PASS (geminiAcpImages.test.ts unmodified), tsc clean. If `geminiAcpImages.test.ts` mocks modules that `acpProvider.ts` now imports, the existing `vi.mock` paths still cover them because `gemini.ts` re-exports from `acpProvider.ts` which imports the same `./notify` / `./workspace` modules — verify, and if a new unmocked import breaks it, add the equivalent `vi.mock` line to the NEW test file only, never edit assertions in the old one.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/acpProvider.ts electron/services/gemini.ts tests/unit/electron/acpProviderTranslate.test.ts
git commit -m "refactor(acp): extract provider-service factory; gemini becomes thin config"
```

---

### Task 4: Kimi provider service + registration

**Files:**
- Create: `electron/services/kimi.ts`
- Modify: `electron/main.ts` (imports around line 83, registration around line 512)
- Test: `tests/unit/electron/kimiHandlers.test.ts`

**Interfaces:**
- Consumes: `registerAcpProviderHandlers`, `AcpProviderConfig`, `ensureAcpTransport`, `ensureAcpCommitSession`, `promptAcpText` (Task 3).
- Produces: `KIMI_CONFIG`, `registerKimiHandlers(win)`, `ensureKimiTransport(win, ws)`, `ensureKimiCommitSession(win, ws)`, `promptKimiText(win, ws, options)` — Task 9 (commit messages) uses the last three. IPC channels `kimi:models|start|send|stop|approve|setSessionId` with the exact same payload shapes as `gemini:*`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/electron/kimiHandlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handleMock = vi.fn();
const onMock = vi.fn();
vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: (...a: unknown[]) => onMock(...a), handle: (...a: unknown[]) => handleMock(...a) },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({ notifyCompletion: vi.fn() }));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(), get: vi.fn(), touchActivity: vi.fn(),
}));

import { registerKimiHandlers, KIMI_CONFIG } from '../../../electron/services/kimi';

describe('registerKimiHandlers', () => {
  beforeEach(() => { handleMock.mockClear(); onMock.mockClear(); });

  it('registers the kimi:* IPC namespace', () => {
    registerKimiHandlers({} as any);
    const handled = handleMock.mock.calls.map(c => c[0]);
    const listened = onMock.mock.calls.map(c => c[0]);
    expect(handled).toEqual(expect.arrayContaining(['kimi:models', 'kimi:start']));
    expect(listened).toEqual(expect.arrayContaining(['kimi:send', 'kimi:stop', 'kimi:approve', 'kimi:setSessionId']));
  });

  it('spawns `kimi acp` with kimi-k3 as default model', () => {
    expect(KIMI_CONFIG).toMatchObject({
      key: 'kimi', command: 'kimi', args: ['acp'], defaultModel: 'kimi-k3', label: 'Kimi ACP',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/kimiHandlers.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `electron/services/kimi`.

- [ ] **Step 3: Create `electron/services/kimi.ts`**

```ts
import { BrowserWindow } from 'electron';
import type { Workspace } from './workspace';
import {
  registerAcpProviderHandlers,
  ensureAcpTransport,
  ensureAcpCommitSession,
  promptAcpText,
  type AcpProviderConfig,
} from './acpProvider';

export const KIMI_CONFIG: AcpProviderConfig = {
  key: 'kimi',
  displayName: 'Kimi',
  label: 'Kimi ACP',
  command: 'kimi',
  args: ['acp'],
  models: [
    { id: 'kimi-k3', name: 'Kimi K3' },
  ],
  defaultModel: 'kimi-k3',
  installHint: 'Install kimi-cli (github.com/MoonshotAI/kimi-cli), run `kimi` once and `/login`, then retry.',
};

export const registerKimiHandlers = (win: BrowserWindow) => registerAcpProviderHandlers(win, KIMI_CONFIG);
export const ensureKimiTransport = (win: BrowserWindow, ws: Workspace) => ensureAcpTransport(win, ws, KIMI_CONFIG);
export const ensureKimiCommitSession = (win: BrowserWindow, ws: Workspace) => ensureAcpCommitSession(win, ws, KIMI_CONFIG);
export const promptKimiText = (
  win: BrowserWindow,
  ws: Workspace,
  options: Parameters<typeof promptAcpText>[3],
) => promptAcpText(win, ws, KIMI_CONFIG, options);
```

(Model catalog is intentionally just `kimi-k3` for v1; the live smoke in Task 10 checks `kimi acp` accepts a `model` param at all — if it doesn't, set `models: []` here: the renderer hides the picker when the catalog is empty (Task 7) and the CLI's own default model is used.)

- [ ] **Step 4: Register in `electron/main.ts`**

Next to the existing gemini import (`import { registerGeminiHandlers } from './services/gemini';`, ~line 83) add:

```ts
import { registerKimiHandlers } from './services/kimi';
```

Next to `registerGeminiHandlers(mainWindow);` (~line 512) add:

```ts
registerKimiHandlers(mainWindow);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/electron/kimiHandlers.test.ts --maxWorkers=2 && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/kimi.ts electron/main.ts tests/unit/electron/kimiHandlers.test.ts
git commit -m "feat(kimi): kimi provider service over shared ACP factory"
```

---

### Task 5: Preload bridge

**Files:**
- Modify: `electron/preload.ts` (gemini block ends ~line 97; `provider.*` bridge lines 100–146)

**Interfaces:**
- Produces (on `window.sai`): `kimiModels()`, `kimiStart(cwd, metaPreamble?)`, `kimiSend(projectPath, message, imagePaths?, approvalMode?, model?, scope?)`, `kimiStop(projectPath, scope?)`, `kimiApprove(projectPath, toolUseId, approved, modifiedCommand?, scope?)`, `kimiSetSessionId(projectPath, sessionId, scope?)`; `provider.start/send/stop/setSessionId` accept `'kimi'`. Note `kimi:send`'s IPC payload keeps the 7-positional gemini shape (conversationMode slot sent as `undefined`).

- [ ] **Step 1: Add the kimi methods**

Directly below the `geminiSetSessionId` entry (~line 97) add:

```ts
  // Kimi CLI (ACP)
  kimiModels: () => ipcRenderer.invoke('kimi:models'),
  kimiStart: (cwd: string, metaPreamble?: string) => ipcRenderer.invoke('kimi:start', cwd, metaPreamble),
  kimiSend: (projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, model?: string, scope?: string) =>
    ipcRenderer.send('kimi:send', projectPath, message, imagePaths, approvalMode, undefined /* conversationMode */, model, scope),
  kimiStop: (projectPath: string, scope?: string) => ipcRenderer.send('kimi:stop', projectPath, scope),
  kimiApprove: (projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope?: string) =>
    ipcRenderer.send('kimi:approve', projectPath, toolUseId, approved, modifiedCommand, scope),
  kimiSetSessionId: (projectPath: string, sessionId: string | undefined, scope?: string) =>
    ipcRenderer.send('kimi:setSessionId', projectPath, sessionId, scope),
```

- [ ] **Step 2: Extend the generic `provider.*` bridge**

In each of the four switches (`start`, `send`, `stop`, `setSessionId`), insert a kimi branch BEFORE the codex fallback `else`:

```ts
      } else if (provider === 'kimi') {
        return ipcRenderer.invoke('kimi:start', cwd, opts.metaPreamble);
```

```ts
      } else if (provider === 'kimi') {
        ipcRenderer.send('kimi:send', projectPath, message, images, opts.approvalMode, undefined, opts.model, opts.scope);
```

```ts
      } else if (provider === 'kimi') {
        ipcRenderer.send('kimi:stop', projectPath, scope);
```

```ts
      } else if (provider === 'kimi') {
        ipcRenderer.send('kimi:setSessionId', projectPath, sessionId, scope);
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add electron/preload.ts
git commit -m "feat(kimi): preload bridge (kimi:* + provider routing)"
```

---

### Task 6: Types + capabilities

**Files:**
- Modify: `src/types.ts` (line 62 `AIProvider`, line 188 literal union, the `Session` interface containing `geminiSessionId`)
- Modify: `src/providers/capabilities.ts`
- Test: `tests/unit/providers/capabilities.test.ts` (create if absent; check `ls tests/unit` for an existing capabilities test first and extend it instead)

**Interfaces:**
- Produces: `AIProvider = 'claude' | 'codex' | 'gemini' | 'kimi'`, `AI_PROVIDERS` const array, `isAIProvider(v): v is AIProvider` type guard, `Session.kimiSessionId?: string`, `getCapabilities('kimi')`. Tasks 7–9 use `isAIProvider` to replace `(v === 'claude' || v === 'codex' || v === 'gemini')` guard chains.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../../src/providers/capabilities';
import { isAIProvider, AI_PROVIDERS } from '../../../src/types';

describe('kimi provider plumbing', () => {
  it('kimi capabilities: gemini-level minus conversation mode', () => {
    expect(getCapabilities('kimi')).toEqual({
      hasOrchestrator: false,
      hasSlashCommands: false,
      hasEffortMode: false,
      hasConversationMode: false,
      hasApprovalMode: true,
      supportsImages: true,
      supportsTerminalScope: true,
      supportsMultiScope: true,
      hasMcp: false,
      hasPlugins: false,
    });
  });

  it('isAIProvider accepts all four providers and rejects junk', () => {
    expect(AI_PROVIDERS).toEqual(['claude', 'codex', 'gemini', 'kimi']);
    expect(isAIProvider('kimi')).toBe(true);
    expect(isAIProvider('grok')).toBe(false);
    expect(isAIProvider(undefined)).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/providers/capabilities.test.ts --maxWorkers=2` → Expected: FAIL.

- [ ] **Step 2: Update `src/types.ts`**

Replace line 62 with:

```ts
export const AI_PROVIDERS = ['claude', 'codex', 'gemini', 'kimi'] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export function isAIProvider(v: unknown): v is AIProvider {
  return typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
}
```

At line 188 replace `aiProvider?: 'claude' | 'codex' | 'gemini';` with `aiProvider?: AIProvider;`.

In the session type that declares `geminiSessionId` (search `geminiSessionId` in `src/types.ts`), add alongside it:

```ts
  kimiSessionId?: string;
```

- [ ] **Step 3: Add the capabilities entry**

In `src/providers/capabilities.ts`, add to `CAPABILITIES` after `codex`:

```ts
  kimi: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: false,
    hasPlugins: false,
  },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/providers/capabilities.test.ts --maxWorkers=2 && npx tsc --noEmit`
Expected: test PASS. tsc will now FAIL at every renderer site with a non-exhaustive provider union (e.g. `SettingsModal.tsx` literal casts) — that is Task 7/8's work. If tsc errors exist, list them, confirm every one is in `src/App.tsx`, `src/components/SettingsModal.tsx`, `src/components/Chat/ChatPanel.tsx`, or `src/components/Chat/ChatInput.tsx`, and proceed (the commit gate for THIS task is the vitest pass plus no errors outside those four files).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/providers/capabilities.ts tests/unit/providers/capabilities.test.ts
git commit -m "feat(kimi): AIProvider union, isAIProvider guard, capabilities entry"
```

---

### Task 7: Renderer — ChatPanel + ChatInput

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `src/components/Chat/ChatInput.tsx`

**Interfaces:**
- Consumes: `isAIProvider`, capabilities (Task 6), `window.sai.kimi*` (Task 5).
- Produces new props (Task 8's App.tsx wiring passes them):
  - ChatPanel: `kimiModel: string`, `onKimiModelChange: (m: string) => void`, `kimiModels: { id: string; name: string }[]`, `kimiApprovalMode: 'default' | 'auto_edit' | 'yolo' | 'plan'`, `onKimiApprovalModeChange: (m: 'default' | 'auto_edit' | 'yolo' | 'plan') => void`, `onKimiSessionId?: (sessionId: string) => void`
  - ChatInput: `kimiModel?: string`, `kimiModels?: { id: string; name: string }[]`, `onKimiModelChange?`, `kimiApprovalMode?`, `onKimiApprovalModeChange?` (same types as the gemini twins)

- [ ] **Step 1: ChatPanel — props**

Add the six props above to `ChatPanelProps` (next to their gemini twins at lines 129–140) and destructure them in the component signature (line 444).

- [ ] **Step 2: ChatPanel — dispatch sites**

Apply these exact edits (line numbers are pre-task anchors; match on content):

- **~743 (startFn):**
```ts
    const startFn = aiProvider === 'gemini' ? (window.sai as any).geminiStart
      : aiProvider === 'kimi' ? (window.sai as any).kimiStart
      : aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
```
(The `startArgs` ternary right below already routes non-claude/codex to `[projectPath || '', metaPreamble]` — kimi falls into that branch untouched.)

- **~806 (expectedScope):**
```ts
      const expectedScope = (aiProvider === 'gemini' || aiProvider === 'kimi') ? 'chat' : claudeScope;
```

- **~827 (session_id):** after the gemini branch add:
```ts
        } else if (aiProvider === 'kimi') {
          onKimiSessionId?.(msg.sessionId);
```

- **~1889/1899/1909 (handleApprove / handleDeny / handleAlwaysAllow):** in each, change the condition and inner call to:
```ts
    if (aiProvider === 'gemini' || aiProvider === 'kimi') {
      const approve = aiProvider === 'kimi' ? (window.sai as any).kimiApprove : (window.sai as any).geminiApprove;
```
then use `approve?.(projectPath, pendingApproval.toolUseId, …, 'chat')` with the same true/false/modifiedCommand arguments each handler already passes. In `handleAlwaysAllow`, the comment becomes `// ACP providers don't support always-allow patterns — just approve this instance`.

- **~2041 and ~2126 (bypass-queue stop):** both become:
```ts
      if (aiProvider === 'gemini') (window.sai as any).geminiStop?.(projectPath);
      else if (aiProvider === 'kimi') (window.sai as any).kimiStop?.(projectPath);
      else if (aiProvider === 'codex') window.sai.codexStop?.(projectPath, claudeScope);
      else window.sai.claudeStop?.(projectPath, claudeScope);
```

- **~2068 (handleSend):** after the gemini branch add:
```ts
    } else if (aiProvider === 'kimi') {
      (window.sai as any).kimiSend(projectPath, prompt, imagePaths, kimiApprovalMode, kimiModel, 'chat');
```

- **~2440 (onStop prop):**
```ts
            onStop={() => aiProvider === 'gemini' ? (window.sai as any).geminiStop(projectPath) : aiProvider === 'kimi' ? (window.sai as any).kimiStop(projectPath) : aiProvider === 'codex' ? window.sai.codexStop(projectPath, claudeScope) : window.sai.claudeStop?.(projectPath, claudeScope)}
```

- **~2466–2472 (props forwarded to ChatInput):** alongside the gemini props add:
```tsx
            kimiModel={kimiModel}
            kimiModels={kimiModels}
            onKimiModelChange={onKimiModelChange}
            kimiApprovalMode={kimiApprovalMode}
            onKimiApprovalModeChange={onKimiApprovalModeChange}
```

- [ ] **Step 3: ChatInput — props and provider cosmetics**

- Line 67: `aiProvider?: 'claude' | 'codex' | 'gemini';` → `aiProvider?: AIProvider;` (import `type { AIProvider }` from `../../types`).
- Add the five kimi props next to their gemini twins (lines 81–86) with defaults in the destructure: `kimiModel = 'kimi-k3'`, `kimiModels = []`, `kimiApprovalMode = 'default'`.
- **Placeholder icon (~948–949):** extend both ternaries:
```ts
                maskImage: `url('${aiProvider === 'codex' ? 'svg/codex.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : aiProvider === 'kimi' ? 'svg/kimi.svg' : 'svg/claude.svg'}')`,
```
(same for `WebkitMaskImage`).
- **Placeholder text (~953):**
```ts
`Message ${aiProvider === 'codex' ? 'Codex' : aiProvider === 'gemini' ? 'Gemini' : aiProvider === 'kimi' ? 'Kimi' : 'Claude'}...`
```

- [ ] **Step 4: ChatInput — model selector + approval button**

- After the `{/* Model selector — Gemini */}` block (`aiProvider === 'gemini' && (…)` ending ~line 1357), add a kimi clone. Copy that JSX block exactly and substitute: condition `aiProvider === 'kimi'`, `geminiModels`→`kimiModels`, `geminiModel`→`kimiModel`, `onGeminiModelChange`→`onKimiModelChange`, both `#4285f4` color literals → `var(--text)`. Additionally wrap the whole block so an empty catalog hides the picker (the "model param unsupported" fallback from the spec):
```tsx
          {aiProvider === 'kimi' && kimiModels.length > 0 && (
            …cloned selector…
          )}
```
- **Approval-mode button (~1386):** the chain `aiProvider === 'claude' ? (…) : aiProvider === 'gemini' ? (…) : (…codex…)`. Insert a kimi arm after the gemini arm, cloning the gemini button JSX with `geminiApprovalMode`→`kimiApprovalMode`, `onGeminiApprovalModeChange`→`onKimiApprovalModeChange` (the mode list `['default','auto_edit','yolo','plan']` and labels stay identical).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors in ChatPanel/ChatInput (App/SettingsModal errors remain until Task 8 — confirm the error list shrank accordingly).

```bash
git add src/components/Chat/ChatPanel.tsx src/components/Chat/ChatInput.tsx
git commit -m "feat(kimi): chat panel + composer wiring"
```

---

### Task 8: Renderer — App.tsx + SettingsModal

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: everything above. Settings keys introduced: `kimiModel`, `kimiApprovalMode` (persisted via the same `onSettingChange` pipeline as `geminiModel`/`geminiApprovalMode`).

- [ ] **Step 1: App.tsx — state (near lines 270–273)**

```ts
  const [kimiModel, setKimiModel] = useState('kimi-k3');
  const [kimiModels, setKimiModels] = useState<{ id: string; name: string }[]>([]);
  const [kimiApprovalMode, setKimiApprovalMode] = useState<GeminiApprovalMode>('default');
```

(`GeminiApprovalMode` is the existing `'default' | 'auto_edit' | 'yolo' | 'plan'` type — reuse it; do NOT mint a duplicate.)

- [ ] **Step 2: App.tsx — model catalog fetch (near line 2327)**

Below the `geminiModels` fetch add the same pattern:

```ts
    (window.sai as any).kimiModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (!result) return;
      setKimiModels(result.models);
      setKimiModel(prev => result.models.some(m => m.id === prev) ? prev : result.defaultModel);
    }).catch(() => { /* main process not ready */ });
```

(Mirror the gemini fetch's exact guard/setter style at that site — if it differs from the above, follow the local pattern.)

- [ ] **Step 3: App.tsx — mechanical branch extensions**

Work through this checklist; after each, re-grep to confirm no site is missed. Find sites with:
`grep -n "=== 'gemini'" src/App.tsx`

1. **1052, 1054, 2119, 2122, 5511, 5536, 5553** — literal guard chains `(x === 'claude' || x === 'codex' || x === 'gemini')`: replace each whole parenthesized chain with `isAIProvider(x)` (import `isAIProvider` from `./types`; keep the surrounding expression otherwise intact, e.g. `defaultTaskProvider: isAIProvider(provider) ? provider : null`). The `as AIProvider` casts after the guards become unnecessary — remove them where the guard now narrows.
2. **2203, 2204** — same replacement for the `remote.aiProvider` / `remote.commitMessageProvider` guards: `isAIProvider(remote.aiProvider)`.
3. **1324 (swarm stopProvider):** add before the claude fallback: `if (p === 'kimi') return (window.sai as any).kimiStop?.(ws);`
4. **1370 (swarm resolveApproval):** add: `else if (p === 'kimi') (window.sai as any).kimiApprove?.(workspaceId, toolUseId, approved, undefined, scope);`
5. **3954 (providerOverride chain):** add `|| providerOverride === 'kimi'` alongside the gemini check.
6. **4349–4350 (panel icon):**
```ts
    const providerSvg = aiProvider === 'codex' ? 'svg/codex.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : aiProvider === 'kimi' ? 'svg/kimi.svg' : 'svg/claude.svg';
    const providerColor = aiProvider === 'codex' ? 'var(--text)' : aiProvider === 'gemini' ? '#4285f4' : aiProvider === 'kimi' ? 'var(--text)' : '#e27b4a';
```
7. **3999 and 4074 (session restore):** below each `geminiSetSessionId` line add:
```ts
    window.sai.kimiSetSessionId?.(activeProjectPath, selected.kimiSessionId, 'chat');
```
(`kimiSetSessionId` reaches the renderer via `(window.sai as any)` if the `window.sai` type surface isn't extended — match how `geminiSetSessionId` is typed at those sites and do the same.)
8. **4570-block and 4916-block (ChatPanel prop spreads):** in BOTH ChatPanel usages add, next to the gemini props:
```tsx
                  kimiModel={kimiModel}
                  kimiModels={kimiModels}
                  onKimiModelChange={handleKimiModelChange}
                  kimiApprovalMode={kimiApprovalMode}
                  onKimiApprovalModeChange={handleKimiApprovalModeChange}
```
9. **4632 and 5025 (onGeminiSessionId callbacks):** clone each callback as `onKimiSessionId`, writing `kimiSessionId` instead of `geminiSessionId` into the session object (same structure, e.g. `sessions: w.sessions.map(s => s.id === orchSessionId ? { ...s, kimiSessionId: sessionId } : s)`).
10. **5517–5519 (settings dispatch):** add:
```ts
          if (key === 'kimiModel') handleKimiModelChange(value);
          if (key === 'kimiApprovalMode') handleKimiApprovalModeChange(value);
```
11. **Handlers:** find `handleGeminiModelChange` / `handleGeminiApprovalModeChange` definitions and clone them as `handleKimiModelChange` / `handleKimiApprovalModeChange` operating on the kimi state setters and persisting under the `kimiModel` / `kimiApprovalMode` settings keys (identical body shape, substituted names).

- [ ] **Step 4: SettingsModal.tsx**

1. Line 78 `SettingsPage` union: add `'kimi'` after `'gemini'`.
2. `PROVIDER_OPTIONS` (line 89): type becomes `{ id: AIProvider; … }[]` (import `AIProvider` — and `isAIProvider` — from `../types`); add:
```ts
  { id: 'kimi', label: 'Kimi CLI', svg: 'svg/kimi.svg', color: '#fff' },
```
3. State (line ~100): `aiProvider` / `commitMessageProvider` state types become `AIProvider`.
4. Guards at 251, 260, 276, 311: replace the literal chains with `isAIProvider(v)` / `isAIProvider(remote.aiProvider)` etc., dropping the now-redundant casts.
5. Add state next to the gemini defaults:
```ts
  const [kimiDefaultModel, setKimiDefaultModel] = useState('kimi-k3');
  const [kimiDefaultApprovalMode, setKimiDefaultApprovalMode] = useState<'default' | 'auto_edit' | 'yolo' | 'plan'>('default');
```
Mirror the gemini defaults' load/save plumbing exactly (search `geminiDefaultModel` for every read/write site — settings load effect, save handler, `onSettingChange('kimiModel', …)` / `onSettingChange('kimiApprovalMode', …)`).
6. Provider settings page: locate the gemini page JSX (search for where `geminiDefaultModel` is rendered — the section gated on the `'gemini'` settings page) and clone it as the `'kimi'` page with: title "Kimi CLI", the model dropdown over `[{ id: 'kimi-k3', name: 'Kimi K3' }]`, the approval-mode selector bound to `kimiDefaultApprovalMode`, minus any conversation-mode control, plus a static hint paragraph in the page's existing help-text style:
```tsx
<p className="settings-hint">Kimi runs through kimi-cli's ACP mode. Install kimi-cli and run <code>kimi</code> once in a terminal to <code>/login</code> before first use.</p>
```
(Match the actual hint-class name used by neighboring pages; `settings-hint` is a guess — copy whatever the gemini page uses.)
7. Add the `'kimi'` nav entry wherever the page list renders `'gemini'` (same list that drives `SettingsPage`).

- [ ] **Step 5: Full typecheck + suite**

Run: `npx tsc --noEmit && npx vitest run --maxWorkers=2`
Expected: tsc fully clean now (zero provider-union errors anywhere); suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/SettingsModal.tsx
git commit -m "feat(kimi): app state, settings page, provider selection"
```

---

### Task 9: Icon + commit-message generation

**Files:**
- Create: `public/svg/kimi.svg`
- Modify: `electron/services/claude.ts` (commit-message provider branch, ~lines 1436–1452; imports at line 12)

**Interfaces:**
- Consumes: `ensureKimiTransport`, `ensureKimiCommitSession`, `promptKimiText` (Task 4).

- [ ] **Step 1: Add the icon**

Create `public/svg/kimi.svg` — single-color silhouette (rendered via CSS mask, so only the path shape matters; this is a clean geometric "K" mark, swappable later for the official logo):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 2.5h3.6v8.1l6.9-8.1h4.5l-7.7 8.7 8.2 10.3h-4.6l-6.1-7.8-1.2 1.3v6.5H4.5V2.5z"/></svg>
```

- [ ] **Step 2: Commit-message branch in `claude.ts`**

Extend the import at line 12's neighborhood:

```ts
import { ensureKimiTransport, ensureKimiCommitSession, promptKimiText } from './kimi';
```

After the `if (aiProvider === 'gemini') { … }` block (~1436–1452) add the parallel branch:

```ts
  if (aiProvider === 'kimi') {
    try {
      const kimiWs = getOrCreate(effectiveCwd);
      kimiWs.kimi.cwd = effectiveCwd;
      await ensureKimiTransport(mainWin!, kimiWs);
      const sessionId = await ensureKimiCommitSession(mainWin!, kimiWs);
      const result = await promptKimiText(mainWin!, kimiWs, {
        sessionId,
        scope: 'commit',
        prompt: commitPrompt,
        approvalMode: 'plan',
        model: 'kimi-k3',
      });
      return result.trim();
    } catch {
      return '';
    }
  }
```

Also check the `commitMessageProvider` option surfaces: `grep -n "commitMessageProvider" src/components/SettingsModal.tsx src/App.tsx` — the dropdown listing claude/codex/gemini gains a kimi option (same list PROVIDER_OPTIONS feeds, or its local equivalent; if it's a separate literal array, append `kimi`).

- [ ] **Step 3: Typecheck + suite + commit**

Run: `npx tsc --noEmit && npx vitest run --maxWorkers=2`
Expected: clean/PASS.

```bash
git add public/svg/kimi.svg electron/services/claude.ts src/components/SettingsModal.tsx src/App.tsx
git commit -m "feat(kimi): provider icon + commit-message generation via kimi"
```

---

### Task 10: Full verification + live smoke

**Files:** none created; fixes only if verification finds issues.

- [ ] **Step 1: Clean-tree verification**

```bash
npx tsc --noEmit && npx vitest run --maxWorkers=2
```
Expected: zero errors, full suite PASS.

- [ ] **Step 2: Regression grep**

```bash
grep -rn "=== 'gemini'" src/ | grep -v "kimi"
```
Review every hit: each must be either (a) genuinely gemini-only (conversation mode, gemini colors/svg) or (b) adjacent to a kimi branch added in Tasks 7–8. Any site that dispatches/guards providers without a kimi path is a bug — fix it.

- [ ] **Step 3: Launch the app for a Gemini regression smoke**

Use the project's dev launch (`npm run dev` per package.json scripts). In a workspace with Gemini selected: send a message, watch streaming, stop a turn. Expected: unchanged behavior (this validates the factory extraction against the live Gemini CLI).

- [ ] **Step 4: Kimi live smoke (requires kimi-cli installed + logged in)**

Preconditions (user machine, one-time): install kimi-cli per https://github.com/MoonshotAI/kimi-cli, run `kimi` in a terminal, `/login`.

Checklist:
- Select Kimi in Settings → provider; tile shows the K icon.
- New chat: send "list the files in this repo's electron/services directory" — expect streaming text + tool cards (Bash/Glob-style) rendered.
- Trigger an approval (e.g. ask it to run a shell command with approval mode `default`) — approve and deny paths both resolve.
- Stop button interrupts a streaming turn; a follow-up message works afterwards.
- Model picker: visible with "Kimi K3" (or intentionally hidden if `kimi acp` rejected the model param — record which).
- Kill the `kimi` process externally mid-turn — expect "Kimi unavailable: … Install kimi-cli …" error and a clean `done` (no stuck spinner).
- With kimi-cli NOT on PATH (temporarily `PATH=/usr/bin` env or rename), starting a Kimi chat shows the install hint, and switching back to Claude still works.
- Commit-message generation with `commitMessageProvider = kimi` produces a message.

- [ ] **Step 5: Final commit + record spec deviation**

If steps 1–4 required fixes, commit them (`fix(kimi): …`). Then close out:

```bash
git commit --allow-empty -m "chore(kimi): verification pass complete

Spec deviation: registerWorkspaceBackendHooks('kimi') intentionally omitted —
kimi state lives in the workspace registry (ws.kimi) so suspend() owns cleanup
directly, matching the Gemini precedent."
```

(Skip the empty commit if a real fix commit already carries the note.)
