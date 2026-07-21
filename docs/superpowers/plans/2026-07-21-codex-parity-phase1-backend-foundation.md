# Codex Parity Phase 1: Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SAI's ad hoc Codex process adapter with a scoped backend abstraction whose default implementation uses `@openai/codex-sdk`, while preserving a tested legacy CLI rollback path and leaving Claude as SAI's default provider.

**Architecture:** Add a `CodexBackend` contract and one runtime per workspace/scope. The SDK backend owns typed Codex `Thread` instances and maps SDK events into SAI's existing renderer envelope for behavior-preserving migration; later phases replace that compatibility envelope with the provider-neutral event model. Backend selection is cached process-wide, defaults to SDK only after Codex is selected, and exposes the old CLI implementation as an explicit rollback option.

**Tech Stack:** Electron 36, TypeScript 5.7, React 19, Vitest 4, `@openai/codex-sdk` 0.144.6, Codex CLI JSONL events

---

## Scope and sequencing

This plan implements Phase 1 of [the approved parity design](../specs/2026-07-21-codex-first-class-parity-design.md). It deliberately does not add app-server, interactive Codex approvals, final provider-neutral tool cards, swarm execution, MCP navigation, or plugins/skills UI. Those are independently testable phases built on the contract introduced here.

At the end of this phase:

- a user who selects Codex runs through `@openai/codex-sdk` by default;
- existing Codex histories resume through SDK threads;
- sessions are isolated by workspace and scope;
- stop, suspend, close, and app shutdown affect only owned scopes;
- images, model, sandbox/approval preset, meta-workspace instructions, and future reasoning effort are represented in typed options;
- the old direct CLI backend remains selectable as `cli` for rollback;
- the current renderer continues to receive compatible `claude:message` envelopes;
- the app-wide provider default remains `claude`.

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add the official Codex SDK dependency |
| `package-lock.json` | Modify | Lock SDK and transitive packages |
| `electron/services/codexBackend/types.ts` | Create | Backend contract, scope/config types, typed capability errors |
| `electron/services/codexBackend/sdkOptions.ts` | Create | Pure mapping from SAI controls to SDK options/input |
| `electron/services/codexBackend/sdkEventMap.ts` | Create | Temporary SDK-event to current SAI-envelope compatibility mapper |
| `electron/services/codexBackend/sdkBackend.ts` | Create | Scoped SDK thread runtime |
| `electron/services/codexBackend/cliBackend.ts` | Create | Legacy direct-CLI rollback backend extracted from current service |
| `electron/services/codexBackend/index.ts` | Create | Backend selection, caching, workspace hooks, test seam |
| `electron/services/codex.ts` | Rewrite | Thin IPC registration delegating to the selected backend |
| `electron/services/workspace.ts` | Modify | Support multiple external backend lifecycle hooks |
| `electron/preload.ts` | Modify | Thread Codex scope/kind/effort/cwd through direct and unified APIs |
| `electron/main.ts` | Modify | Destroy the active Codex backend during shutdown |
| `src/components/Chat/ChatPanel.tsx` | Modify | Route Codex with scope-aware IPC and event filtering |
| `src/components/SettingsModal.tsx` | Modify | Add temporary SDK-default / CLI-rollback Codex backend selector |
| `tests/unit/electron/codexBackendDispatch.test.ts` | Create | Selection and IPC delegation tests |
| `tests/unit/electron/codexSdkOptions.test.ts` | Create | Option/input mapping tests |
| `tests/unit/electron/codexSdkEventMap.test.ts` | Create | Exhaustive SDK event compatibility tests |
| `tests/unit/electron/codexSdkBackend.test.ts` | Create | Scoped thread lifecycle tests |
| `tests/unit/services/codex.test.ts` | Modify | Preserve legacy backend behavior tests |
| `tests/unit/services/workspace.test.ts` | Modify | Multi-backend suspend/quiescence tests |
| `tests/unit/preload.test.ts` | Modify | Scope-aware Codex bridge tests |
| `tests/unit/components/Chat/ChatPanel.test.tsx` | Modify | Codex scope routing/filter tests |
| `tests/unit/components/SettingsModal.test.tsx` | Modify | Backend selector and unchanged-provider-default tests |
| `tests/helpers/ipc-mock.ts` | Modify | Add scope-aware Codex mock signatures |

---

### Task 1: Add the SDK and define the backend contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `electron/services/codexBackend/types.ts`

- [ ] **Step 1: Install the exact audited SDK version**

Run:

```bash
npm install @openai/codex-sdk@0.144.6
```

Expected: `package.json` contains `"@openai/codex-sdk": "^0.144.6"` and the lockfile resolves version `0.144.6`.

- [ ] **Step 2: Create the Codex backend contract**

Create `electron/services/codexBackend/types.ts`:

```typescript
import type { ModelReasoningEffort } from '@openai/codex-sdk';

export type CodexBackendKind = 'cli' | 'sdk';
export type CodexSessionKind = 'chat' | 'task' | 'orchestrator';
export type CodexPermission = 'auto' | 'read-only' | 'full-access';

export interface CodexStartArgs {
  projectPath: string;
  scope?: string;
  kind?: CodexSessionKind;
  orchestratorContext?: Record<string, unknown> | null;
  scopeCwd?: string;
  metaPreamble?: string;
}

export interface CodexSendArgs {
  projectPath: string;
  message: string;
  imagePaths?: string[];
  permission?: CodexPermission | string;
  effort?: ModelReasoningEffort | string;
  model?: string;
  scope?: string;
  origin?: 'desktop' | 'remote';
}

export interface CodexModelOption {
  id: string;
  name: string;
}

export interface CodexModelResult {
  models: CodexModelOption[];
  defaultModel: string;
}

export type CodexCapability =
  | 'compact'
  | 'interactive-approval'
  | 'answer-question'
  | 'answer-plan-review';

export class CodexCapabilityError extends Error {
  readonly code = 'CODEX_CAPABILITY_UNAVAILABLE';

  constructor(
    readonly capability: CodexCapability,
    readonly requiredBackend: CodexBackendKind | null,
    message: string,
  ) {
    super(message);
    this.name = 'CodexCapabilityError';
  }
}

export interface CodexBackend {
  start(args: CodexStartArgs): Promise<void> | void;
  send(args: CodexSendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  reconcileScope(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  getModels(forceRefresh?: boolean): Promise<CodexModelResult>;
  suspendWorkspace(projectPath: string): void;
  isWorkspaceBusy(projectPath: string): boolean;
  destroy(): void;
}

export const codexScope = (scope?: string): string => scope || 'chat';
export const codexScopeKey = (projectPath: string, scope?: string): string =>
  `${projectPath}\u0000${codexScope(scope)}`;
```

- [ ] **Step 3: Type-check the new contract**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit the dependency and contract**

```bash
git add package.json package-lock.json electron/services/codexBackend/types.ts
git commit -m "feat(codex): define backend contract"
```

---

### Task 2: Build and test pure SDK option mapping

**Files:**
- Create: `electron/services/codexBackend/sdkOptions.ts`
- Create: `tests/unit/electron/codexSdkOptions.test.ts`

- [ ] **Step 1: Write failing permission and thread-option tests**

Create `tests/unit/electron/codexSdkOptions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildCodexSdkOptions, buildCodexInput } from '@electron/services/codexBackend/sdkOptions';

describe('buildCodexSdkOptions', () => {
  it.each([
    ['auto', 'workspace-write', 'on-request'],
    ['read-only', 'read-only', 'never'],
    ['full-access', 'danger-full-access', 'never'],
  ] as const)('maps %s permissions', (permission, sandboxMode, approvalPolicy) => {
    expect(buildCodexSdkOptions({ cwd: '/repo', permission })).toMatchObject({
      thread: { workingDirectory: '/repo', sandboxMode, approvalPolicy },
    });
  });

  it('includes model, effort, additional directories, and meta instructions', () => {
    const result = buildCodexSdkOptions({
      cwd: '/worktree',
      model: 'gpt-5.3-codex',
      effort: 'xhigh',
      metaPreamble: 'Projects live under /meta',
      additionalDirectories: ['/shared'],
    });
    expect(result.thread).toMatchObject({
      workingDirectory: '/worktree',
      model: 'gpt-5.3-codex',
      modelReasoningEffort: 'xhigh',
      additionalDirectories: ['/shared'],
    });
    expect(result.clientConfig).toEqual({ developer_instructions: 'Projects live under /meta' });
  });

  it('omits invalid effort instead of passing an unsupported value', () => {
    expect(buildCodexSdkOptions({ cwd: '/repo', effort: 'max' }).thread.modelReasoningEffort).toBeUndefined();
  });
});

describe('buildCodexInput', () => {
  it('returns plain text without images', () => {
    expect(buildCodexInput('hello')).toBe('hello');
  });

  it('returns structured text and local images', () => {
    expect(buildCodexInput('inspect', ['/tmp/a.png'])).toEqual([
      { type: 'text', text: 'inspect' },
      { type: 'local_image', path: '/tmp/a.png' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkOptions.test.ts
```

Expected: FAIL because `sdkOptions.ts` does not exist.

- [ ] **Step 3: Implement the pure mapper**

Create `electron/services/codexBackend/sdkOptions.ts`:

```typescript
import type {
  ApprovalMode,
  Input,
  ModelReasoningEffort,
  SandboxMode,
  ThreadOptions,
} from '@openai/codex-sdk';
import type { CodexPermission } from './types';

const EFFORTS = new Set<ModelReasoningEffort>(['minimal', 'low', 'medium', 'high', 'xhigh']);

export interface CodexSdkOptionInput {
  cwd: string;
  permission?: CodexPermission | string;
  effort?: string;
  model?: string;
  metaPreamble?: string;
  additionalDirectories?: string[];
}

export interface BuiltCodexSdkOptions {
  thread: ThreadOptions;
  clientConfig: Record<string, string>;
}

function permissionOptions(permission?: string): {
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalMode;
} {
  if (permission === 'read-only') return { sandboxMode: 'read-only', approvalPolicy: 'never' };
  if (permission === 'full-access') return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
  return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' };
}

export function buildCodexSdkOptions(input: CodexSdkOptionInput): BuiltCodexSdkOptions {
  const thread: ThreadOptions = {
    workingDirectory: input.cwd,
    ...permissionOptions(input.permission),
  };
  if (input.model) thread.model = input.model;
  if (input.effort && EFFORTS.has(input.effort as ModelReasoningEffort)) {
    thread.modelReasoningEffort = input.effort as ModelReasoningEffort;
  }
  if (input.additionalDirectories?.length) thread.additionalDirectories = input.additionalDirectories;
  return {
    thread,
    clientConfig: input.metaPreamble ? { developer_instructions: input.metaPreamble } : {},
  };
}

export function buildCodexInput(message: string, imagePaths?: string[]): Input {
  if (!imagePaths?.length) return message;
  return [
    { type: 'text', text: message },
    ...imagePaths.map((path) => ({ type: 'local_image' as const, path })),
  ];
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npx vitest run --project unit tests/unit/electron/codexSdkOptions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/codexBackend/sdkOptions.ts tests/unit/electron/codexSdkOptions.test.ts
git commit -m "feat(codex): map SAI controls to SDK options"
```

---

### Task 3: Map every stable SDK event into the compatibility envelope

**Files:**
- Create: `electron/services/codexBackend/sdkEventMap.ts`
- Create: `tests/unit/electron/codexSdkEventMap.test.ts`

- [ ] **Step 1: Write table-driven failing mapper tests**

Create `tests/unit/electron/codexSdkEventMap.test.ts`. Cover every `ThreadEvent` variant and every `ThreadItem` variant. The core assertions must include:

```typescript
import { describe, expect, it } from 'vitest';
import { mapCodexSdkEvent } from '@electron/services/codexBackend/sdkEventMap';

const ctx = { projectPath: '/repo', scope: 'scope-a', turnSeq: 3 };

describe('mapCodexSdkEvent', () => {
  it('maps thread identity', () => {
    expect(mapCodexSdkEvent({ type: 'thread.started', thread_id: 'thr-1' }, ctx)).toEqual([
      { type: 'session_id', sessionId: 'thr-1', projectPath: '/repo', scope: 'scope-a' },
    ]);
  });

  it('maps a completed reasoning summary to the dedicated reasoning channel', () => {
    expect(mapCodexSdkEvent({
      type: 'item.completed',
      item: { id: 'r1', type: 'reasoning', text: 'Checked both call paths.' },
    }, ctx)).toEqual([
      { type: 'reasoning_delta', text: 'Checked both call paths.', projectPath: '/repo', scope: 'scope-a', turnSeq: 3 },
    ]);
  });

  it('maps command start and completion with the same tool id', () => {
    const started = mapCodexSdkEvent({
      type: 'item.started',
      item: { id: 'cmd-1', type: 'command_execution', command: 'npm test', aggregated_output: '', status: 'in_progress' },
    }, ctx);
    const completed = mapCodexSdkEvent({
      type: 'item.completed',
      item: { id: 'cmd-1', type: 'command_execution', command: 'npm test', aggregated_output: 'ok', exit_code: 0, status: 'completed' },
    }, ctx);
    expect(started[0]).toMatchObject({ type: 'assistant', message: { content: [{ id: 'cmd-1', type: 'tool_use', name: 'Bash' }] } });
    expect(completed[0]).toMatchObject({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'cmd-1', content: 'ok', is_error: false }] } });
  });

  it('maps file changes', () => {
    const start = mapCodexSdkEvent({
      type: 'item.started',
      item: { id: 'f1', type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }], status: 'completed' },
    }, ctx);
    const complete = mapCodexSdkEvent({
      type: 'item.completed',
      item: { id: 'f1', type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }], status: 'completed' },
    }, ctx);
    expect(start[0]).toMatchObject({ message: { content: [{ id: 'f1', name: 'Edit' }] } });
    expect(complete[0]).toMatchObject({ message: { content: [{ tool_use_id: 'f1', is_error: false }] } });
  });

  it('maps MCP success and failure', () => {
    const started = mapCodexSdkEvent({
      type: 'item.started',
      item: { id: 'm1', type: 'mcp_tool_call', server: 'github', tool: 'search', arguments: { q: 'bug' }, status: 'in_progress' },
    }, ctx);
    expect(started[0]).toMatchObject({ message: { content: [{ name: 'mcp__github__search', input: { q: 'bug' } }] } });
    const failed = mapCodexSdkEvent({
      type: 'item.completed',
      item: { id: 'm1', type: 'mcp_tool_call', server: 'github', tool: 'search', arguments: {}, error: { message: 'denied' }, status: 'failed' },
    }, ctx);
    expect(failed[0]).toMatchObject({ message: { content: [{ tool_use_id: 'm1', content: 'denied', is_error: true }] } });
  });

  it('maps web search, todo updates, and item errors', () => {
    expect(mapCodexSdkEvent({
      type: 'item.started', item: { id: 'w1', type: 'web_search', query: 'Codex SDK' },
    }, ctx)[0]).toMatchObject({ message: { content: [{ name: 'WebSearch', input: { query: 'Codex SDK' } }] } });
    expect(mapCodexSdkEvent({
      type: 'item.started', item: { id: 't1', type: 'todo_list', items: [{ text: 'test', completed: false }] },
    }, ctx)[0]).toMatchObject({ message: { content: [{ name: 'TodoWrite' }] } });
    expect(mapCodexSdkEvent({
      type: 'item.completed', item: { id: 'e1', type: 'error', message: 'non-fatal' },
    }, ctx)).toEqual([expect.objectContaining({ type: 'error', text: 'non-fatal' })]);
    expect(mapCodexSdkEvent({
      type: 'item.updated', item: { id: 'w1', type: 'web_search', query: 'Codex SDK' },
    }, ctx)).toEqual([]);
  });

  it('maps completed usage including reasoning output tokens', () => {
    expect(mapCodexSdkEvent({
      type: 'turn.completed',
      usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 3 },
    }, ctx)).toEqual([
      expect.objectContaining({
        type: 'result',
        usage: expect.objectContaining({ input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 3 }),
      }),
      expect.objectContaining({ type: 'done', turnSeq: 3 }),
    ]);
  });

  it('maps failed turns and fatal stream errors to error then done', () => {
    expect(mapCodexSdkEvent({ type: 'turn.failed', error: { message: 'boom' } }, ctx).map((e) => e.type)).toEqual(['error', 'done']);
    expect(mapCodexSdkEvent({ type: 'error', message: 'broken stream' }, ctx).map((e) => e.type)).toEqual(['error', 'done']);
  });
});
```

Add one more assertion beside these fixtures for an `agent_message` completion producing an assistant text block. The explicit `item.updated` assertion documents that compatibility mode intentionally defers progress updates to Phase 2.

- [ ] **Step 2: Run the mapper tests and confirm failure**

```bash
npx vitest run --project unit tests/unit/electron/codexSdkEventMap.test.ts
```

Expected: FAIL because the mapper does not exist.

- [ ] **Step 3: Implement an exhaustive mapper**

Create `electron/services/codexBackend/sdkEventMap.ts` with:

```typescript
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';

export interface CodexMapContext {
  projectPath: string;
  scope: string;
  turnSeq: number;
}

type SaiEnvelope = Record<string, unknown> & { type: string };

const base = (ctx: CodexMapContext) => ({
  projectPath: ctx.projectPath,
  scope: ctx.scope,
  turnSeq: ctx.turnSeq,
});

function toolUse(id: string, name: string, input: unknown, ctx: CodexMapContext): SaiEnvelope {
  return {
    type: 'assistant',
    ...base(ctx),
    message: { content: [{ id, type: 'tool_use', name, input }] },
  };
}

function toolResult(id: string, content: unknown, isError: boolean, ctx: CodexMapContext): SaiEnvelope {
  return {
    type: 'user',
    ...base(ctx),
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  };
}

function startedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  switch (item.type) {
    case 'command_execution': return [toolUse(item.id, 'Bash', { command: item.command }, ctx)];
    case 'file_change': return [toolUse(item.id, 'Edit', { changes: item.changes }, ctx)];
    case 'mcp_tool_call': return [toolUse(item.id, `mcp__${item.server}__${item.tool}`, item.arguments, ctx)];
    case 'web_search': return [toolUse(item.id, 'WebSearch', { query: item.query }, ctx)];
    case 'todo_list': return [toolUse(item.id, 'TodoWrite', { todos: item.items }, ctx)];
    case 'agent_message':
    case 'reasoning':
    case 'error':
      return [];
  }
}

function completedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  switch (item.type) {
    case 'agent_message':
      return item.text ? [{ type: 'assistant', ...base(ctx), message: { content: [{ type: 'text', text: item.text }] } }] : [];
    case 'reasoning':
      return item.text ? [{ type: 'reasoning_delta', text: item.text, ...base(ctx) }] : [];
    case 'command_execution':
      return [toolResult(item.id, item.aggregated_output, item.status === 'failed' || (item.exit_code ?? 0) !== 0, ctx)];
    case 'file_change':
      return [toolResult(item.id, JSON.stringify(item.changes), item.status === 'failed', ctx)];
    case 'mcp_tool_call':
      return [toolResult(item.id, item.error?.message ?? item.result?.content ?? '', item.status === 'failed', ctx)];
    case 'web_search':
      return [toolResult(item.id, item.query, false, ctx)];
    case 'todo_list':
      return [toolResult(item.id, JSON.stringify(item.items), false, ctx)];
    case 'error':
      return [{ type: 'error', text: item.message, ...base(ctx) }];
  }
}

export function mapCodexSdkEvent(event: ThreadEvent, ctx: CodexMapContext): SaiEnvelope[] {
  switch (event.type) {
    case 'thread.started':
      return [{ type: 'session_id', sessionId: event.thread_id, projectPath: ctx.projectPath, scope: ctx.scope }];
    case 'turn.started':
      return [];
    case 'item.started':
      return startedItem(event.item, ctx);
    case 'item.updated':
      return [];
    case 'item.completed':
      return completedItem(event.item, ctx);
    case 'turn.completed':
      return [
        {
          type: 'result', ...base(ctx),
          usage: {
            input_tokens: event.usage.input_tokens,
            cache_read_input_tokens: event.usage.cached_input_tokens,
            cache_creation_input_tokens: 0,
            output_tokens: event.usage.output_tokens,
            reasoning_output_tokens: event.usage.reasoning_output_tokens,
          },
        },
        { type: 'done', ...base(ctx) },
      ];
    case 'turn.failed':
      return [{ type: 'error', text: event.error.message, ...base(ctx) }, { type: 'done', ...base(ctx) }];
    case 'error':
      return [{ type: 'error', text: event.message, ...base(ctx) }, { type: 'done', ...base(ctx) }];
  }
}
```

Keep the switches exhaustive: do not add a `default` branch. If the SDK union changes, TypeScript or tests should force an explicit decision.

- [ ] **Step 4: Run mapper tests and type-check**

```bash
npx vitest run --project unit tests/unit/electron/codexSdkEventMap.test.ts
npx tsc --noEmit
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/codexBackend/sdkEventMap.ts tests/unit/electron/codexSdkEventMap.test.ts
git commit -m "feat(codex): map SDK events into chat envelopes"
```

---

### Task 4: Implement the scoped SDK backend

**Files:**
- Create: `electron/services/codexBackend/sdkBackend.ts`
- Create: `tests/unit/electron/codexSdkBackend.test.ts`

- [ ] **Step 1: Write failing scoped-lifecycle tests with injected SDK fakes**

Create `tests/unit/electron/codexSdkBackend.test.ts`. Define a fake client/thread rather than spawning Codex:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { SdkCodexBackend } from '@electron/services/codexBackend/sdkBackend';

async function* stream(events: any[]) {
  for (const event of events) yield event;
}

function harness() {
  const emitted: any[] = [];
  const threads: any[] = [];
  const createClient = vi.fn(() => ({
    startThread: vi.fn((options) => {
      const thread = {
        id: null,
        options,
        runStreamed: vi.fn(async () => ({ events: stream([
          { type: 'thread.started', thread_id: `thr-${threads.length + 1}` },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
        ]) })),
      };
      threads.push(thread);
      return thread;
    }),
    resumeThread: vi.fn((id, options) => {
      const thread = { id, options, runStreamed: vi.fn(async () => ({ events: stream([]) })) };
      threads.push(thread);
      return thread;
    }),
  }));
  const backend = new SdkCodexBackend({ createClient, emit: (event) => emitted.push(event) });
  return { backend, createClient, emitted, threads };
}

describe('SdkCodexBackend', () => {
  it('isolates threads by workspace and scope', async () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'a', scopeCwd: '/wt/a' });
    h.backend.start({ projectPath: '/repo', scope: 'b', scopeCwd: '/wt/b' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'A' });
    h.backend.send({ projectPath: '/repo', scope: 'b', message: 'B' });
    await vi.waitFor(() => expect(h.threads).toHaveLength(2));
    expect(h.threads.map((t) => t.options.workingDirectory)).toEqual(['/wt/a', '/wt/b']);
  });

  it('resumes a supplied session id in the owning scope', async () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.setSessionId('/repo', 'saved-thread', 'a');
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'continue' });
    await vi.waitFor(() => expect(h.createClient).toHaveBeenCalled());
    const client = h.createClient.mock.results[0].value;
    expect(client.resumeThread).toHaveBeenCalledWith('saved-thread', expect.objectContaining({ workingDirectory: '/repo' }));
  });

  it('emits scope and turn identity on every forwarded event', async () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'a' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'hello' });
    await vi.waitFor(() => expect(h.emitted.some((e) => e.type === 'done')).toBe(true));
    expect(h.emitted.every((e) => e.scope === 'a')).toBe(true);
    expect(h.emitted.find((e) => e.type === 'streaming_start')).toMatchObject({ turnSeq: 1 });
  });

  it('passes structured images and meta-workspace instructions', async () => {
    const h = harness();
    h.backend.start({ projectPath: '/repo', scope: 'a', metaPreamble: 'META' });
    h.backend.send({ projectPath: '/repo', scope: 'a', message: 'inspect', imagePaths: ['/tmp/ui.png'] });
    await vi.waitFor(() => expect(h.threads).toHaveLength(1));
    expect(h.createClient).toHaveBeenCalledWith(expect.objectContaining({ config: { developer_instructions: 'META' } }));
    expect(h.threads[0].runStreamed).toHaveBeenCalledWith([
      { type: 'text', text: 'inspect' },
      { type: 'local_image', path: '/tmp/ui.png' },
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('interrupts only the requested scope and reports workspace busy state', async () => {
    const signals: AbortSignal[] = [];
    const createClient = vi.fn(() => ({
      startThread: vi.fn(() => ({
        id: null,
        runStreamed: vi.fn(async (_input, options) => {
          signals.push(options.signal);
          return { events: (async function* () {
            yield { type: 'turn.started' };
            await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
          })() };
        }),
      })),
      resumeThread: vi.fn(),
    }));
    const backend = new SdkCodexBackend({ createClient, emit: vi.fn() });
    backend.start({ projectPath: '/repo', scope: 'a' });
    backend.start({ projectPath: '/repo', scope: 'b' });
    backend.send({ projectPath: '/repo', scope: 'a', message: 'A' });
    backend.send({ projectPath: '/repo', scope: 'b', message: 'B' });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(backend.isWorkspaceBusy('/repo')).toBe(true);
    backend.interrupt('/repo', 'a');
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(backend.isWorkspaceBusy('/repo')).toBe(true);
    backend.destroy();
  });

  it('suspends every scope for one workspace without touching another', async () => {
    const signals = new Map<string, AbortSignal>();
    const createClient = vi.fn(() => ({
      startThread: vi.fn((threadOptions) => ({
        id: null,
        runStreamed: vi.fn(async (_input, options) => {
          signals.set(threadOptions.workingDirectory, options.signal);
          return { events: (async function* () {
            await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
          })() };
        }),
      })),
      resumeThread: vi.fn(),
    }));
    const backend = new SdkCodexBackend({ createClient, emit: vi.fn() });
    for (const [projectPath, scope, scopeCwd] of [['/one', 'a', '/one-a'], ['/one', 'b', '/one-b'], ['/two', 'a', '/two-a']] as const) {
      backend.start({ projectPath, scope, scopeCwd });
      backend.send({ projectPath, scope, message: scope });
    }
    await vi.waitFor(() => expect(signals.size).toBe(3));
    backend.suspendWorkspace('/one');
    expect(signals.get('/one-a')?.aborted).toBe(true);
    expect(signals.get('/one-b')?.aborted).toBe(true);
    expect(signals.get('/two-a')?.aborted).toBe(false);
    backend.destroy();
  });

  it('reconciles an idle scope with an unconditional done event', () => {
    const h = harness();
    h.backend.reconcileScope('/repo', 'missing');
    expect(h.emitted.at(-1)).toMatchObject({ type: 'done', projectPath: '/repo', scope: 'missing', turnSeq: null });
  });
});
```

- [ ] **Step 2: Run the backend tests and confirm failure**

```bash
npx vitest run --project unit tests/unit/electron/codexSdkBackend.test.ts
```

Expected: FAIL because `SdkCodexBackend` does not exist.

- [ ] **Step 3: Implement the backend with injectable boundaries**

Create `electron/services/codexBackend/sdkBackend.ts` with these concrete structures:

```typescript
import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, Thread, ThreadOptions } from '@openai/codex-sdk';
import { enrichedEnv } from '../shellEnv';
import { buildCodexInput, buildCodexSdkOptions } from './sdkOptions';
import { mapCodexSdkEvent } from './sdkEventMap';
import { codexScope, codexScopeKey } from './types';
import type { CodexBackend, CodexSendArgs, CodexStartArgs } from './types';

interface ThreadLike {
  readonly id: string | null;
  runStreamed: Thread['runStreamed'];
}

interface ClientLike {
  startThread(options?: ThreadOptions): ThreadLike;
  resumeThread(id: string, options?: ThreadOptions): ThreadLike;
}

interface ScopeRuntime {
  projectPath: string;
  scope: string;
  cwd: string;
  kind: 'chat' | 'task' | 'orchestrator';
  metaPreamble: string;
  sessionId?: string;
  thread?: ThreadLike;
  client?: ClientLike;
  configKey?: string;
  turnSeq: number;
  busy: boolean;
  abort?: AbortController;
}

export interface SdkCodexBackendDeps {
  createClient?: (options: CodexOptions) => ClientLike;
  emit?: (event: Record<string, unknown>) => void;
  getModels?: (forceRefresh?: boolean) => ReturnType<CodexBackend['getModels']>;
}

export class SdkCodexBackend implements CodexBackend {
  private readonly scopes = new Map<string, ScopeRuntime>();
  private readonly createClient: NonNullable<SdkCodexBackendDeps['createClient']>;
  private readonly emit: NonNullable<SdkCodexBackendDeps['emit']>;

  constructor(private readonly deps: SdkCodexBackendDeps = {}) {
    this.createClient = deps.createClient ?? ((options) => new Codex(options));
    this.emit = deps.emit ?? (() => undefined);
  }

  start(args: CodexStartArgs): void {
    const scope = codexScope(args.scope);
    const key = codexScopeKey(args.projectPath, scope);
    const previous = this.scopes.get(key);
    this.scopes.set(key, {
      projectPath: args.projectPath,
      scope,
      cwd: args.scopeCwd || args.projectPath,
      kind: args.kind || 'chat',
      metaPreamble: args.metaPreamble || '',
      sessionId: previous?.sessionId,
      thread: previous?.thread,
      client: previous?.client,
      configKey: previous?.configKey,
      turnSeq: previous?.turnSeq ?? 0,
      busy: previous?.busy ?? false,
      abort: previous?.abort,
    });
    this.emit({ type: 'ready', projectPath: args.projectPath, scope });
  }

  send(args: CodexSendArgs): void {
    void this.runTurn(args);
  }

  private async runTurn(args: CodexSendArgs): Promise<void> {
    const scope = codexScope(args.scope);
    const key = codexScopeKey(args.projectPath, scope);
    if (!this.scopes.has(key)) this.start({ projectPath: args.projectPath, scope });
    const runtime = this.scopes.get(key)!;
    if (runtime.busy) this.interrupt(args.projectPath, scope);

    const built = buildCodexSdkOptions({
      cwd: runtime.cwd,
      permission: args.permission,
      effort: args.effort,
      model: args.model,
      metaPreamble: runtime.metaPreamble,
    });
    const configKey = JSON.stringify({
      cwd: runtime.cwd,
      permission: args.permission || 'auto',
      effort: args.effort || '',
      model: args.model || '',
      metaPreamble: runtime.metaPreamble,
      additionalDirectories: built.thread.additionalDirectories || [],
    });
    if (!runtime.thread || runtime.configKey !== configKey) {
      const env = Object.fromEntries(
        Object.entries(enrichedEnv()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      runtime.client = this.createClient({ env, config: built.clientConfig });
      runtime.thread = runtime.sessionId
        ? runtime.client.resumeThread(runtime.sessionId, built.thread)
        : runtime.client.startThread(built.thread);
      runtime.configKey = configKey;
    }

    const controller = new AbortController();
    runtime.abort = controller;
    runtime.busy = true;
    runtime.turnSeq += 1;
    const turnSeq = runtime.turnSeq;
    let emittedDone = false;
    this.emit({ type: 'streaming_start', projectPath: runtime.projectPath, scope, turnSeq, sessionId: runtime.sessionId ?? null });

    try {
      const streamed = await runtime.thread.runStreamed(
        buildCodexInput(args.message, args.imagePaths),
        { signal: controller.signal },
      );
      for await (const event of streamed.events) {
        if (runtime.abort !== controller) return;
        if (event.type === 'thread.started') runtime.sessionId = event.thread_id;
        const mapped = mapCodexSdkEvent(event, { projectPath: runtime.projectPath, scope, turnSeq });
        for (const envelope of mapped) {
          if (envelope.type === 'done') emittedDone = true;
          this.emit(envelope);
        }
      }
      if (!emittedDone && runtime.abort === controller) {
        this.emit({ type: 'done', projectPath: runtime.projectPath, scope, turnSeq });
      }
    } catch (error) {
      if (runtime.abort !== controller) return;
      if (!controller.signal.aborted) {
        this.emit({
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
          projectPath: runtime.projectPath,
          scope,
          turnSeq,
        });
      }
      if (!emittedDone) this.emit({ type: 'done', projectPath: runtime.projectPath, scope, turnSeq });
    } finally {
      if (runtime.abort === controller) {
        runtime.abort = undefined;
        runtime.busy = false;
      }
    }
  }

  interrupt(projectPath: string, scope?: string): void {
    const runtime = this.scopes.get(codexScopeKey(projectPath, scope));
    if (!runtime) return;
    runtime.abort?.abort();
  }

  reconcileScope(projectPath: string, scope?: string): void {
    const name = codexScope(scope);
    const runtime = this.scopes.get(codexScopeKey(projectPath, name));
    if (!runtime?.busy) this.emit({ type: 'done', projectPath, scope: name, turnSeq: null });
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const name = codexScope(scope);
    const key = codexScopeKey(projectPath, name);
    if (!this.scopes.has(key)) this.start({ projectPath, scope: name });
    const runtime = this.scopes.get(key)!;
    runtime.abort?.abort();
    runtime.abort = undefined;
    runtime.busy = false;
    runtime.sessionId = sessionId;
    runtime.thread = undefined;
    runtime.client = undefined;
    runtime.configKey = undefined;
  }

  async getModels(forceRefresh = false) {
    if (!this.deps.getModels) return { models: [], defaultModel: '' };
    return this.deps.getModels(forceRefresh);
  }

  suspendWorkspace(projectPath: string): void {
    for (const [key, runtime] of this.scopes) {
      if (runtime.projectPath !== projectPath) continue;
      runtime.abort?.abort();
      if (runtime.busy) {
        this.emit({ type: 'done', projectPath, scope: runtime.scope, turnSeq: runtime.turnSeq });
      }
      this.scopes.delete(key);
    }
  }

  isWorkspaceBusy(projectPath: string): boolean {
    return [...this.scopes.values()].some((runtime) => runtime.projectPath === projectPath && runtime.busy);
  }

  destroy(): void {
    for (const runtime of this.scopes.values()) runtime.abort?.abort();
    this.scopes.clear();
  }
}
```

- [ ] **Step 4: Prove terminal event emission is exactly-once**

Add this regression test to `codexSdkBackend.test.ts`:

```typescript
it('emits one done when turn.completed already supplies the terminal event', async () => {
  const h = harness();
  h.backend.start({ projectPath: '/repo', scope: 'a' });
  h.backend.send({ projectPath: '/repo', scope: 'a', message: 'hello' });
  await vi.waitFor(() => expect(h.emitted.some((event) => event.type === 'done')).toBe(true));
  expect(h.emitted.filter((event) => event.type === 'done')).toHaveLength(1);
});
```

- [ ] **Step 5: Run focused tests and type-check**

```bash
npx vitest run --project unit tests/unit/electron/codexSdkBackend.test.ts tests/unit/electron/codexSdkEventMap.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/codexBackend/sdkBackend.ts tests/unit/electron/codexSdkBackend.test.ts
git commit -m "feat(codex): add scoped SDK backend"
```

---

### Task 5: Extract the existing CLI implementation as a rollback backend

**Files:**
- Create: `electron/services/codexBackend/cliBackend.ts`
- Modify: `tests/unit/services/codex.test.ts`

- [ ] **Step 1: Add characterization tests for the backend contract**

Extend `tests/unit/services/codex.test.ts` so the current assertions instantiate `CliCodexBackend` directly. Add tests proving:

```typescript
expect(backend.start({ projectPath: PROJECT })).toBeUndefined();
backend.send({ projectPath: PROJECT, message: 'hello', permission: 'auto', model: 'gpt-5.3-codex' });
expect(mockSpawnFn).toHaveBeenCalledWith('codex', expect.arrayContaining(['exec', '--json', '--full-auto', '-m', 'gpt-5.3-codex']), expect.any(Object));
backend.interrupt(PROJECT, 'chat');
expect(process.kill).toHaveBeenCalled();
```

Also preserve the existing JSONL translation, clean stdin EOF, model-list refresh, notification, resume, malformed-line, stderr, exit, and stale-process tests.

- [ ] **Step 2: Run the characterization suite before extraction**

```bash
npx vitest run --project unit tests/unit/services/codex.test.ts
```

Expected: existing tests PASS; new import/contract assertions FAIL until extraction.

- [ ] **Step 3: Move legacy behavior behind `CliCodexBackend`**

Create `electron/services/codexBackend/cliBackend.ts` by moving the current direct-process implementation from `electron/services/codex.ts`. Preserve these named code paths unchanged:

- enriched environment and Windows shell behavior;
- app-server `model/list` cache and force refresh;
- `exec` / `exec resume --json` argument construction;
- permission, model, image, and prompt ordering;
- session ID capture;
- buffered JSONL parsing;
- stderr suppression;
- completion notification delay;
- stale-process identity checks;
- final-buffer flush and exactly-once `done`.

Export the existing model loader as `fetchCodexModels(forceRefresh)`. Wrap the moved start/send/stop/set-session bodies with `CliCodexBackend.start`, `.send`, `.interrupt`, and `.setSessionId`. Add the following lifecycle methods to the class:

```typescript
reconcileScope(projectPath: string, scope = 'chat'): void {
  const ws = get(projectPath);
  if (!ws?.codex.busy) emit({ type: 'done', projectPath, scope, turnSeq: null });
}

getModels(forceRefresh = false) {
  return fetchCodexModels(forceRefresh);
}

suspendWorkspace(projectPath: string): void {
  const ws = get(projectPath);
  if (!ws) return;
  if (ws.codex.process) ws.codex.process.kill();
  ws.codex.process = null;
  ws.codex.busy = false;
}

isWorkspaceBusy(projectPath: string): boolean {
  return get(projectPath)?.codex.busy ?? false;
}

destroy(): void {
  for (const ws of listAllWorkspaces()) this.suspendWorkspace(ws.projectPath);
}
```

Store the latest requested scope on `WorkspaceCodex` before spawning and use it when stamping events. This rollback backend still has one process per workspace, so a second scope interrupts the first; SDK is the only backend advertised for scoped concurrency.

- [ ] **Step 4: Run legacy tests**

```bash
npx vitest run --project unit tests/unit/services/codex.test.ts
```

Expected: PASS with the same behavioral coverage through `CliCodexBackend`.

- [ ] **Step 5: Commit**

```bash
git add electron/services/codexBackend/cliBackend.ts tests/unit/services/codex.test.ts
git commit -m "refactor(codex): preserve CLI as rollback backend"
```

---

### Task 6: Add backend selection and thin IPC dispatch

**Files:**
- Create: `electron/services/codexBackend/index.ts`
- Rewrite: `electron/services/codex.ts`
- Create: `tests/unit/electron/codexBackendDispatch.test.ts`

- [ ] **Step 1: Write failing backend-selection tests**

Create `tests/unit/electron/codexBackendDispatch.test.ts` using hoisted mocks for settings, Electron IPC, `CliCodexBackend`, and `SdkCodexBackend`. Cover:

```typescript
expect(getCodexBackendSetting()).toBe('sdk'); // unset
expect(getCodexBackendSetting()).toBe('cli'); // explicit rollback
expect(getCodexBackendSetting()).toBe('sdk'); // unknown value
expect(getCodexBackend()).toBeInstanceOf(SdkCodexBackend);
```

Inject a stub with `__setCodexBackendForTests`, register IPC, and assert exact delegation for:

- `codex:start` including scope, kind, orchestrator context, scope cwd, and meta preamble;
- `codex:send` including images, permission, effort, model, scope, and origin;
- `codex:stop` with scope;
- `codex:setSessionId` with scope;
- `codex:reconcileScope` with scope;
- `codex:models` with force refresh.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run --project unit tests/unit/electron/codexBackendDispatch.test.ts
```

Expected: FAIL because the selector and thin IPC service do not exist.

- [ ] **Step 3: Implement the selector**

Create `electron/services/codexBackend/index.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { registerWorkspaceBackendHooks } from '../workspace';
import { emitChatMessage } from '../claude';
import { CliCodexBackend } from './cliBackend';
import { fetchCodexModels } from './cliBackend';
import { SdkCodexBackend } from './sdkBackend';
import type { CodexBackend, CodexBackendKind } from './types';
export * from './types';

function readSetting(key: string): unknown {
  try {
    const file = path.join(app.getPath('userData'), 'settings.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'))[key];
  } catch {
    return undefined;
  }
}

export function getCodexBackendSetting(): CodexBackendKind {
  return readSetting('codexBackend') === 'cli' ? 'cli' : 'sdk';
}

let active: CodexBackend | null = null;

export function getCodexBackend(): CodexBackend {
  if (active) return active;
  active = getCodexBackendSetting() === 'cli'
    ? new CliCodexBackend()
    : new SdkCodexBackend({ emit: emitChatMessage, getModels: fetchCodexModels });
  registerWorkspaceBackendHooks('codex', {
    suspend: (projectPath) => active?.suspendWorkspace(projectPath),
    isBusy: (projectPath) => active?.isWorkspaceBusy(projectPath) ?? false,
  });
  return active;
}

export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  active = backend;
}

export function destroyCodexBackendIfActive(): void {
  active?.destroy();
  active = null;
}
```

Keep the setting reader local and unit-testable; do not import Claude's `readSaiSetting` into the Codex boundary.

- [ ] **Step 4: Rewrite `electron/services/codex.ts` as IPC-only routing**

The file should contain only safe window emission setup plus `registerCodexHandlers`. Its core dispatch is:

```typescript
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { getCodexBackend } from './codexBackend';

export function registerCodexHandlers(_win: BrowserWindow): void {
  ipcMain.handle('codex:models', (_event, forceRefresh?: boolean) =>
    getCodexBackend().getModels(Boolean(forceRefresh)));
  ipcMain.handle('codex:start', (_event, projectPath, scope, kind, orchestratorContext, scopeCwd, metaPreamble) =>
    getCodexBackend().start({ projectPath, scope, kind, orchestratorContext, scopeCwd, metaPreamble }));
  ipcMain.on('codex:send', (_event, projectPath, message, imagePaths, permission, effort, model, scope, origin) =>
    getCodexBackend().send({ projectPath, message, imagePaths, permission, effort, model, scope, origin }));
  ipcMain.on('codex:stop', (_event, projectPath, scope) => getCodexBackend().interrupt(projectPath, scope));
  ipcMain.on('codex:setSessionId', (_event, projectPath, sessionId, scope) =>
    getCodexBackend().setSessionId(projectPath, sessionId, scope));
  ipcMain.on('codex:reconcileScope', (_event, projectPath, scope) =>
    getCodexBackend().reconcileScope(projectPath, scope));
}
```

- [ ] **Step 5: Run dispatch, legacy, and SDK tests**

```bash
npx vitest run --project unit \
  tests/unit/electron/codexBackendDispatch.test.ts \
  tests/unit/electron/codexSdkBackend.test.ts \
  tests/unit/services/codex.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/codexBackend/index.ts electron/services/codex.ts tests/unit/electron/codexBackendDispatch.test.ts
git commit -m "feat(codex): dispatch IPC through selectable backends"
```

---

### Task 7: Make workspace lifecycle hooks multi-provider safe

**Files:**
- Modify: `electron/services/workspace.ts`
- Modify: `electron/services/claudeBackend/index.ts`
- Modify: `electron/services/codexBackend/index.ts`
- Modify: `electron/main.ts`
- Modify: `tests/unit/services/workspace.test.ts`

- [ ] **Step 1: Write failing multi-hook tests**

Extend `tests/unit/services/workspace.test.ts`:

```typescript
it('suspends every registered external provider backend', async () => {
  const { getOrCreate, registerWorkspaceBackendHooks, suspend } = await loadService();
  getOrCreate('/repo');
  const claudeSuspend = vi.fn();
  const codexSuspend = vi.fn();
  registerWorkspaceBackendHooks('claude', { suspend: claudeSuspend });
  registerWorkspaceBackendHooks('codex', { suspend: codexSuspend });
  suspend('/repo', createWin() as never);
  expect(claudeSuspend).toHaveBeenCalledWith('/repo');
  expect(codexSuspend).toHaveBeenCalledWith('/repo');
});

it('is not quiescent when any registered provider reports busy', async () => {
  const { getOrCreate, registerWorkspaceBackendHooks, isWorkspaceQuiescent } = await loadService();
  const ws = getOrCreate('/repo');
  registerWorkspaceBackendHooks('claude', { isBusy: () => false });
  registerWorkspaceBackendHooks('codex', { isBusy: () => true });
  expect(isWorkspaceQuiescent(ws)).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run --project unit tests/unit/services/workspace.test.ts
```

Expected: FAIL because `registerWorkspaceBackendHooks` accepts one hook object.

- [ ] **Step 3: Replace the singleton hook with a keyed registry**

In `electron/services/workspace.ts`, replace the singleton with:

```typescript
const backendHooks = new Map<string, WorkspaceBackendHooks>();

export function registerWorkspaceBackendHooks(provider: string, hooks: WorkspaceBackendHooks): void {
  backendHooks.set(provider, hooks);
}
```

In `suspend`, iterate every hook and call `suspend`. In `isWorkspaceQuiescent`, return false when any hook reports busy. Update Claude registration to `registerWorkspaceBackendHooks('claude', ...)` and keep Codex registration as `codex`.

- [ ] **Step 4: Destroy the Codex backend on app shutdown**

Import `destroyCodexBackendIfActive` in `electron/main.ts`. In the existing cleanup path beside `destroyClaude()`, call:

```typescript
try { destroyCodexBackendIfActive(); } catch { /* backend is already down */ }
```

- [ ] **Step 5: Run lifecycle tests**

```bash
npx vitest run --project unit tests/unit/services/workspace.test.ts tests/unit/electron/claudeBackendDispatch.test.ts tests/unit/electron/codexBackendDispatch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/workspace.ts electron/services/claudeBackend/index.ts electron/services/codexBackend/index.ts electron/main.ts tests/unit/services/workspace.test.ts
git commit -m "refactor: support lifecycle hooks for multiple AI backends"
```

---

### Task 8: Thread scope and effort through preload and ChatPanel

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/preload.test.ts`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`
- Modify: `tests/helpers/ipc-mock.ts`

- [ ] **Step 1: Update failing preload expectations first**

Change Codex expectations in `tests/unit/preload.test.ts` to require the full scope-aware signature:

```typescript
exposed.codexStart('/proj', 'scope-a', 'task', undefined, '/worktree', 'meta');
expect(invoke).toHaveBeenCalledWith('codex:start', '/proj', 'scope-a', 'task', undefined, '/worktree', 'meta');

exposed.codexSend('/proj', 'hi', [], 'auto', 'xhigh', 'gpt-5.3-codex', 'scope-a');
expect(send).toHaveBeenCalledWith('codex:send', '/proj', 'hi', [], 'auto', 'xhigh', 'gpt-5.3-codex', 'scope-a', undefined);

exposed.codexStop('/proj', 'scope-a');
expect(send).toHaveBeenCalledWith('codex:stop', '/proj', 'scope-a');

exposed.codexSetSessionId('/proj', 'thr-1', 'scope-a');
expect(send).toHaveBeenCalledWith('codex:setSessionId', '/proj', 'thr-1', 'scope-a');
```

Update `window.sai.provider` Codex cases to pass `scope`, `kind`, `scopeCwd`, `effortLevel`, and `metaPreamble` rather than dropping them.

- [ ] **Step 2: Run preload tests and confirm failure**

```bash
npx vitest run --project unit tests/unit/preload.test.ts
```

Expected: FAIL on the old positional Codex IPC shapes.

- [ ] **Step 3: Update the preload bridge**

Use these public signatures in `electron/preload.ts`:

```typescript
codexStart: (cwd, scope, kind, orchestratorContext, scopeCwd, metaPreamble) =>
  ipcRenderer.invoke('codex:start', cwd, scope, kind, orchestratorContext, scopeCwd, metaPreamble),
codexSend: (projectPath, message, imagePaths, permission, effort, model, scope, origin) =>
  ipcRenderer.send('codex:send', projectPath, message, imagePaths, permission, effort, model, scope, origin),
codexStop: (projectPath, scope) => ipcRenderer.send('codex:stop', projectPath, scope),
codexSetSessionId: (projectPath, sessionId, scope) =>
  ipcRenderer.send('codex:setSessionId', projectPath, sessionId, scope),
codexReconcileScope: (projectPath, scope) => ipcRenderer.send('codex:reconcileScope', projectPath, scope),
```

Update the unified provider object with the same fields.

- [ ] **Step 4: Add ChatPanel routing tests**

In `tests/unit/components/Chat/ChatPanel.test.tsx`, add tests proving a Codex panel with `claudeScope="scope-a"`:

- calls `codexStart(projectPath, 'scope-a', claudeKind, orchestratorContext, scopeCwd, metaPreamble)`;
- calls `codexSend` with `scope-a`;
- ignores a Codex event stamped `scope-b`;
- accepts a Codex event stamped `scope-a`;
- stops only `scope-a`.

Use the existing ChatPanel render helper and `createMockSai`; do not build a second harness.

- [ ] **Step 5: Update ChatPanel provider routing**

Replace the fixed-Codex-chat assumptions:

```typescript
const expectedScope = aiProvider === 'gemini' ? 'chat' : claudeScope;
```

Start Codex with the same scope/kind/cwd metadata supplied to Claude. Pass `claudeScope` to Codex send, stop, and set-session calls. Do not rename the public `claudeScope` prop in this phase; Phase 2's provider-neutral renderer refactor will rename it without mixing transport risk into this change.

- [ ] **Step 6: Update shared mocks and run focused tests**

Add `codexReconcileScope` and updated signatures to `tests/helpers/ipc-mock.ts`, then run:

```bash
npx vitest run --project unit tests/unit/preload.test.ts tests/unit/components/Chat/ChatPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/preload.ts src/components/Chat/ChatPanel.tsx tests/unit/preload.test.ts tests/unit/components/Chat/ChatPanel.test.tsx tests/helpers/ipc-mock.ts
git commit -m "feat(codex): preserve scope identity through renderer IPC"
```

---

### Task 9: Add SDK-default and CLI-rollback settings without changing the provider default

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `tests/unit/components/SettingsModal.test.tsx`

- [ ] **Step 1: Write failing settings tests**

Add to `tests/unit/components/SettingsModal.test.tsx`:

```typescript
it('shows SDK as the default Codex backend and preserves Claude as provider default', async () => {
  render(<SettingsModal {...defaultProps} />);
  await userEvent.click(screen.getByText('Codex'));
  expect((screen.getByLabelText('Codex backend') as HTMLSelectElement).value).toBe('sdk');
  expect(mockSai.settingsSet).not.toHaveBeenCalledWith('aiProvider', 'codex');
});

it('persists the explicit CLI rollback backend', async () => {
  render(<SettingsModal {...defaultProps} />);
  await userEvent.click(screen.getByText('Codex'));
  await userEvent.selectOptions(screen.getByLabelText('Codex backend'), 'cli');
  expect(mockSai.settingsSet).toHaveBeenCalledWith('codexBackend', 'cli');
});
```

Ensure the settings mock returns `undefined` for `codexBackend` and `claude` for `aiProvider` unless a test overrides it.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run --project unit tests/unit/components/SettingsModal.test.tsx
```

Expected: FAIL because no Codex backend selector exists.

- [ ] **Step 3: Add the temporary selector**

Add state and loading:

```typescript
const [codexBackend, setCodexBackend] = useState<'sdk' | 'cli'>('sdk');

window.sai.settingsGet('codexBackend', 'sdk').then((value: string) => {
  setCodexBackend(value === 'cli' ? 'cli' : 'sdk');
});
```

Add the first Codex settings row:

```tsx
<div className="settings-row">
  <div className="settings-row-info">
    <div className="settings-row-name">Backend</div>
    <div className="settings-row-desc">
      SDK is the default Codex integration. CLI keeps the previous integration available as a temporary rollback path. Restart SAI after changing.
    </div>
  </div>
  <select
    aria-label="Codex backend"
    className="settings-select"
    value={codexBackend}
    onChange={(event) => {
      const value = event.target.value === 'cli' ? 'cli' : 'sdk';
      setCodexBackend(value);
      window.sai.settingsSet('codexBackend', value);
    }}
  >
    <option value="sdk">SDK (default)</option>
    <option value="cli">CLI (legacy rollback)</option>
  </select>
</div>
```

Do not write `aiProvider` in this handler and do not change the existing initial provider state.

- [ ] **Step 4: Run settings tests**

```bash
npx vitest run --project unit tests/unit/components/SettingsModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx tests/unit/components/SettingsModal.test.tsx
git commit -m "feat(codex): expose SDK backend with CLI rollback"
```

---

### Task 10: Complete Phase 1 regression and smoke verification

**Files:**
- Modify only files required by failures found below

- [ ] **Step 1: Run all Codex and bridge unit tests**

```bash
npx vitest run --project unit \
  tests/unit/services/codex.test.ts \
  tests/unit/electron/codexBackendDispatch.test.ts \
  tests/unit/electron/codexSdkOptions.test.ts \
  tests/unit/electron/codexSdkEventMap.test.ts \
  tests/unit/electron/codexSdkBackend.test.ts \
  tests/unit/services/workspace.test.ts \
  tests/unit/preload.test.ts \
  tests/unit/components/Chat/ChatPanel.test.tsx \
  tests/unit/components/SettingsModal.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the complete automated regression suite**

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests PASS, TypeScript reports no errors, and the production build succeeds.

- [ ] **Step 3: Verify the provider default mechanically**

Run:

```bash
rg -n "useState<.*AIProvider.*claude|settingsGet\('aiProvider'.*claude|aiProvider.*'claude'" src/App.tsx src/components/SettingsModal.tsx
```

Expected: the app and settings fallbacks remain `claude`; no new fallback selects Codex.

- [ ] **Step 4: Manual SDK smoke test**

Run `npm run electron:dev`, explicitly select Codex, and verify:

1. Backend defaults to SDK only on the Codex settings page.
2. A new chat streams a completion and persists its Codex thread ID.
3. A follow-up turn resumes the same thread.
4. Stop ends only the active chat and leaves another workspace chat running.
5. Switching chats and returning resumes the correct thread.
6. Model and each existing permission preset reach Codex.
7. An attached image is visible to Codex.
8. A meta workspace prompt understands its synthetic-root project layout.
9. Suspending or closing a workspace aborts only its Codex scopes.
10. Restarting SAI restores Codex history and continuation.
11. Switching Claude → Codex → Gemini → Claude preserves each provider's history and settings.
12. A fresh user-data directory still opens with Claude selected.

- [ ] **Step 5: Manual CLI rollback smoke test**

Choose `CLI (legacy rollback)`, restart, and verify one new turn, one resumed turn, image input, stop, and model refresh behave as before.

- [ ] **Step 6: Commit any verification fixes**

If verification required changes:

```bash
git add -p
git commit -m "fix(codex): address backend foundation verification"
```

If no fixes were required, do not create an empty commit.

---

## Phase 1 exit gate

Do not start Phase 2 until all of the following are true:

- SDK is the selected Codex backend when `codexBackend` is unset.
- Claude remains the app-wide default provider.
- The SDK and CLI rollback smoke tests both pass.
- Scoped SDK tests prove no cross-workspace or cross-scope interruption.
- Existing Claude, Gemini, workspace, preload, ChatPanel, and settings regressions pass.
- The compatibility mapper has an explicit decision for every stable SDK event/item union member.
- No app-server, swarm, MCP-navigation, or renderer-normalization work has leaked into this phase.
