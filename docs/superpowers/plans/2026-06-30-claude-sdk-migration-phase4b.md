# Claude SDK Migration — Phase 4b Implementation Plan (orchestrator/swarm in SDK mode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the swarm orchestrator (`kind === 'orchestrator'`) work in SDK mode — an in-process swarm MCP server, the orchestrator system prompt, and built-in-tool restriction — so the whole SDK path is flip-ready.

**Architecture:** Mirror Phase 3's chat MCP server for the swarm tools (new `buildSwarmMcpServer` under server key `swarm`, bare tool names, reusing the shared `dispatchSwarmTool`); extend `sdkOptions` with orchestrator options (full-replace system prompt string + `tools:[]` + `disallowedTools`); wire both into `SdkBackend._createSession` for orchestrator scopes, plumbing the already-present `StartArgs.orchestratorContext`. Cards render from the SDK's real `tool_use` stream (Approach Y — no synthetic injection).

**Tech Stack:** TypeScript, Electron main, `@anthropic-ai/claude-agent-sdk@0.3.196`, Vitest.

## Global Constraints

- Run vitest with `npx vitest run <path> --maxWorkers=2`. Respect any project `vitest.config` worker cap ≤2.
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `'cli'` mode behavior MUST remain unchanged; `CliBackend` retained; the `claudeBackend` flag still defaults `cli` (the user flips it after dogfooding).
- The swarm MCP server MUST be registered under key `swarm` (constant `SWARM_MCP_SERVER_NAME = 'swarm'`), and tools advertised under their **bare** names (`spawn_task`, not `swarm_spawn_task`), so the model-facing name is `mcp__swarm__spawn_task` — exactly what `SwarmToolCardSelector` (`SWARM_PREFIX = 'mcp__swarm__'`, switch on the bare `baseName`) matches. Handlers dispatch with the bare `def.name`.
- Orchestrator scopes do NOT register a `swarmOrchestratorSessions` entry in SDK mode (no `swarm:set-orchestrator-session`), so `dispatchSwarmTool`'s synthetic-card injection stays skipped (Approach Y — the real SDK `tool_use` drives the cards; avoids duplicates).
- Orchestrator system prompt is a FULL replacement (SDK `systemPrompt` as a plain string), NOT the `{ preset:'claude_code', append }` form.
- Reuse existing shared units: `dispatchSwarmTool`/`getSaiToolDispatch` (Phase 2/3), `jsonSchemaToZodShape` (Phase 3), `toMcpSuccessContent`/`toMcpErrorContent` (Phase 3), `buildOrchestratorSystemPrompt`/`resolveOrchestratorPromptContext` (`src/lib/orchestratorSystemPrompt.ts`). No renderer/IPC/`types.ts` changes.
- SDK `Options` facts: `tools?: string[] | {type:'preset';preset:'claude_code'}` (`[]` disables all built-ins); `disallowedTools?: string[]`; `systemPrompt?: string | ... ` (plain string = full replacement); NO `strictMcpConfig` field; the SDK never surfaces slash commands to the model (no `--disable-slash-commands` equivalent needed).

---

## File Structure

- `electron/services/claudeBackend/swarmMcpServer.ts` — **new.** `buildSwarmMcpServer({ workspace, dispatch })` → an `sdk`-type MCP server named `swarm` registering the `SWARM_TOOL_SCHEMA` tools under bare names, delegating to the shared dispatch. Mirror of `saiMcpServer.ts`.
- `electron/services/claudeBackend/sdkOptions.ts` — **modified.** Add `systemPromptOverride?: string` (full-replace) and orchestrator `tools:[]` + `disallowedTools`.
- `electron/services/claudeBackend/sdkBackend.ts` — **modified.** `start` stores `orchestratorContext` in `scopeMeta`; `_createSession` orchestrator branch (swarm server + system-prompt override); constructor dep `buildSwarmMcpServer`.
- `electron/services/claudeBackend/index.ts` — **modified.** Inject `buildSwarmMcpServer`.
- Tests: `tests/unit/electron/swarmMcpServer.test.ts` (new), `tests/unit/electron/sdkOptions.test.ts` (extend), `tests/unit/electron/sdkBackend.test.ts` (extend).

---

## Task 1: buildSwarmMcpServer

**Files:**
- Create: `electron/services/claudeBackend/swarmMcpServer.ts`
- Test: `tests/unit/electron/swarmMcpServer.test.ts`

**Interfaces:**
- Consumes: `SWARM_TOOL_SCHEMA` from `../../../src/lib/swarmOrchestratorTools`; `jsonSchemaToZodShape`; `toMcpSuccessContent`/`toMcpErrorContent`; `SaiToolDispatch` from `../saiToolBridge`; `createSdkMcpServer`/`tool`/`McpSdkServerConfigWithInstance` from the SDK.
- Produces: `SWARM_MCP_SERVER_NAME = 'swarm'`; `interface SwarmMcpDeps { workspace: string; dispatch: SaiToolDispatch }`; `buildSwarmMcpServer(deps): McpSdkServerConfigWithInstance` — registers each `SWARM_TOOL_SCHEMA` tool under its **bare** name; handler calls `dispatch({ tool: <bare name>, input: args, workspace })`; test-only non-enumerable `__handlersForTest` map.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/electron/swarmMcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSwarmMcpServer, SWARM_MCP_SERVER_NAME } from '../../../electron/services/claudeBackend/swarmMcpServer';
import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';

describe('buildSwarmMcpServer', () => {
  it('builds an sdk-type server named "swarm"', () => {
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    expect(server.type).toBe('sdk');
    expect(server.name).toBe(SWARM_MCP_SERVER_NAME);
    expect(SWARM_MCP_SERVER_NAME).toBe('swarm');
    expect(server.instance).toBeDefined();
  });

  it('registers every swarm tool under its BARE name', () => {
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    const handlers = (server as any).__handlersForTest as Map<string, unknown>;
    expect(handlers.size).toBe(SWARM_TOOL_SCHEMA.length);
    for (const def of SWARM_TOOL_SCHEMA) {
      expect(handlers.has(def.name)).toBe(true); // bare name, e.g. 'spawn_task' (NOT 'swarm_spawn_task')
    }
  });

  it('handler routes to dispatch with the bare tool name + workspace, wraps success', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('spawn_task');
    const result = await handler({ prompt: 'do it' });
    expect(dispatch).toHaveBeenCalledWith({ tool: 'spawn_task', input: { prompt: 'do it' }, workspace: '/ws' });
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify({ ok: true }) });
  });

  it('handler wraps a dispatch error with isError', async () => {
    const dispatch = vi.fn(async () => { throw new Error('boom'); });
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('land');
    const result = await handler({ taskRef: 't1' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });
});
```

- [ ] **Step 2: Run test — verify it FAILS**

Run: `npx vitest run tests/unit/electron/swarmMcpServer.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (mirror `saiMcpServer.ts`; differences: iterate `SWARM_TOOL_SCHEMA`, bare names, key `swarm`)

```typescript
// electron/services/claudeBackend/swarmMcpServer.ts
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';
import { jsonSchemaToZodShape } from './jsonSchemaToZod';
import { toMcpSuccessContent, toMcpErrorContent } from '../mcpToolContent';
import type { SaiToolDispatch } from '../saiToolBridge';

export const SWARM_MCP_SERVER_NAME = 'swarm';

export interface SwarmMcpDeps {
  workspace: string;
  dispatch: SaiToolDispatch;
}

/**
 * Build the in-process SDK MCP server exposing the swarm ORCHESTRATOR tools in
 * SDK mode. Registered under server key `swarm` and tools advertised under their
 * BARE names (e.g. `spawn_task`), so the model sees `mcp__swarm__spawn_task` —
 * exactly what SwarmToolCardSelector (SWARM_PREFIX 'mcp__swarm__', switch on the
 * bare baseName) matches, letting the SDK's real tool_use drive the cards (no
 * synthetic injection). Each handler delegates to the shared renderer round-trip
 * via `dispatch`. Built per orchestrator scope so `workspace` is bound.
 */
export function buildSwarmMcpServer(deps: SwarmMcpDeps): McpSdkServerConfigWithInstance {
  const { workspace, dispatch } = deps;
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const tools = SWARM_TOOL_SCHEMA.map((def) => {
    const handler = async (args: Record<string, unknown>) => {
      try {
        const result = await dispatch({ tool: def.name, input: args, workspace });
        return toMcpSuccessContent(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toMcpErrorContent(msg);
      }
    };
    handlersForTest.set(def.name, handler);
    return tool(
      def.name, // bare name → mcp__swarm__<name>
      def.description,
      jsonSchemaToZodShape(def.input_schema),
      handler as Parameters<typeof tool>[3],
    );
  });

  const server = createSdkMcpServer({ name: SWARM_MCP_SERVER_NAME, version: '1.0.0', tools });
  Object.defineProperty(server, '__handlersForTest', { value: handlersForTest, enumerable: false });
  return server;
}
```

- [ ] **Step 4: Run test — verify it PASSES**

Run: `npx vitest run tests/unit/electron/swarmMcpServer.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/swarmMcpServer.ts tests/unit/electron/swarmMcpServer.test.ts
git commit -m "feat(sdk): in-process swarm MCP server (orchestrator tools under key 'swarm', bare names)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Orchestrator options in sdkOptions

**Files:**
- Modify: `electron/services/claudeBackend/sdkOptions.ts`
- Test: `tests/unit/electron/sdkOptions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SdkOptionInputs` gains `systemPromptOverride?: string`. `buildSdkOptions`: when `systemPromptOverride` is a non-empty string, `opts.systemPrompt = systemPromptOverride` (plain string, full replacement) — overriding the preset+append form. For `kind === 'orchestrator'`: `opts.tools = []` and `opts.disallowedTools = ['Skill','Task','Agent','TodoWrite']`. (Orchestrator `permissionMode: 'bypassPermissions'` and absent `canUseTool` are unchanged.)

- [ ] **Step 1: Write the failing tests** (add to `sdkOptions.test.ts`)

```typescript
  it('systemPromptOverride replaces the preset systemPrompt with a plain string', () => {
    const opts = buildSdkOptions({ kind: 'orchestrator', cwd: '/ws', systemPromptOverride: 'ORCH PROMPT' });
    expect(opts.systemPrompt).toBe('ORCH PROMPT');
  });

  it('orchestrator disables built-in tools and blocks plugin tools', () => {
    const opts = buildSdkOptions({ kind: 'orchestrator', cwd: '/ws', systemPromptOverride: 'x' });
    expect(opts.tools).toEqual([]);
    expect(opts.disallowedTools).toEqual(['Skill', 'Task', 'Agent', 'TodoWrite']);
    expect(opts.permissionMode).toBe('bypassPermissions');
  });

  it('chat/task do NOT set tools:[] or disallowedTools, and keep the preset systemPrompt', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws', appendSystemPrompt: 'nudge' });
    expect(opts.tools).toBeUndefined();
    expect(opts.disallowedTools).toBeUndefined();
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'nudge' });
  });
```

- [ ] **Step 2: Run tests — verify they FAIL**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts -t "systemPromptOverride|orchestrator disables|do NOT set" --maxWorkers=2`
Expected: FAIL — `systemPromptOverride` not accepted; `tools`/`disallowedTools` unset.

- [ ] **Step 3: Implement**

Add to `SdkOptionInputs`:

```typescript
  systemPromptOverride?: string; // full-replacement system prompt (orchestrator); overrides the preset+append form
```

Destructure `systemPromptOverride` in `buildSdkOptions`. Change the `systemPrompt` derivation so an override wins:

```typescript
  const systemPrompt: Options['systemPrompt'] =
    systemPromptOverride && systemPromptOverride.length > 0
      ? systemPromptOverride
      : appendSystemPrompt && appendSystemPrompt.length > 0
        ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }
        : { type: 'preset', preset: 'claude_code' };
```

After the `opts` object is built (near the other conditional assignments), add the orchestrator tool restriction:

```typescript
  if (kind === 'orchestrator') {
    opts.tools = [];
    opts.disallowedTools = ['Skill', 'Task', 'Agent', 'TodoWrite'];
  }
```

- [ ] **Step 4: Run tests — verify they PASS**

Run: `npx vitest run tests/unit/electron/sdkOptions.test.ts --maxWorkers=2`
Expected: PASS (existing + the 3 new).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkOptions.ts tests/unit/electron/sdkOptions.test.ts
git commit -m "feat(sdk): orchestrator sdkOptions — full-replace system prompt + tools:[] + disallowedTools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the swarm server + orchestrator prompt into SdkBackend

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`start`, `scopeMeta` shape, `_createSession`, constructor dep)
- Modify: `electron/services/claudeBackend/index.ts` (inject `buildSwarmMcpServer`)
- Test: `tests/unit/electron/sdkBackend.test.ts`

**Interfaces:**
- Consumes: `buildSwarmMcpServer` (Task 1); `systemPromptOverride` on `buildSdkOptions` (Task 2); `buildOrchestratorSystemPrompt`/`resolveOrchestratorPromptContext`/`OrchestratorPromptContext` from `../../../src/lib/orchestratorSystemPrompt`; `getSaiToolDispatch` (Phase 2).
- Produces: `SdkBackend` constructor dep `buildSwarmMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined`; `scopeMeta` entries carry `orchestratorContext?`; orchestrator `_createSession` attaches `mcpServers: { swarm: server }` and passes the full orchestrator system prompt as `systemPromptOverride`.

- [ ] **Step 1: Write the failing tests**

```typescript
  it('(26) orchestrator scope attaches mcpServers.swarm + full orchestrator systemPrompt (plain string)', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const fakeSwarm = { type: 'sdk', name: 'swarm', instance: {} } as any;
    const buildSwarmMcpServer = vi.fn(() => fakeSwarm);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildSwarmMcpServer });
    backend.start({ projectPath: PROJECT, scope: 'orch', scopeCwd: PROJECT, kind: 'orchestrator', orchestratorContext: { defaultModel: 'opus', concurrencyCap: 3 } });
    backend.send({ projectPath: PROJECT, message: 'go', scope: 'orch', permMode: 'bypass' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    expect(buildSwarmMcpServer).toHaveBeenCalledWith(PROJECT);
    expect(capturedOptions.mcpServers).toEqual({ swarm: fakeSwarm });
    expect(typeof capturedOptions.systemPrompt).toBe('string'); // full replacement, not preset object
    expect(capturedOptions.systemPrompt.length).toBeGreaterThan(50); // the built orchestrator prompt
    expect(capturedOptions.tools).toEqual([]);
    expect(capturedOptions.permissionMode).toBe('bypassPermissions');
    fakeQuery.close();
  });

  it('(27) chat scope does not attach the swarm server', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: any) => { capturedOptions = args.options; return fakeQuery; });
    const buildSwarmMcpServer = vi.fn(() => ({ type: 'sdk', name: 'swarm', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildSwarmMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((r) => { const c = () => capturedOptions ? r() : setTimeout(c, 5); setTimeout(c, 5); });

    expect(buildSwarmMcpServer).not.toHaveBeenCalled();
    expect(capturedOptions.mcpServers?.swarm).toBeUndefined();
    fakeQuery.close();
  });
```

- [ ] **Step 2: Run tests — verify they FAIL**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "(26)|(27)" --maxWorkers=2`
Expected: FAIL — `buildSwarmMcpServer` dep not accepted; no swarm server / systemPrompt is a preset object.

- [ ] **Step 3a: sdkBackend.ts — imports + dep + scopeMeta**

Add imports:

```typescript
import { buildOrchestratorSystemPrompt, resolveOrchestratorPromptContext, type OrchestratorPromptContext } from '../../../src/lib/orchestratorSystemPrompt';
```

Extend the constructor deps type with:

```typescript
  buildSwarmMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
```

Store it: `this._buildSwarmMcpServer = deps?.buildSwarmMcpServer;` (add the private field `private readonly _buildSwarmMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;`).

Extend `scopeMeta`'s stored shape to include `orchestratorContext?: Record<string, unknown> | null` and set it in `start`:

```typescript
    const { projectPath, scope, scopeCwd, kind = 'chat', metaPreamble, orchestratorContext } = args;
    // ...
    this.scopeMeta.set(scopeKey, { cwd, kind, appendSystemPrompt: metaPreamble, orchestratorContext });
```
(Update the `scopeMeta` Map type annotation to include `orchestratorContext?: Record<string, unknown> | null`.)

- [ ] **Step 3b: sdkBackend.ts — _createSession orchestrator branch**

In `_createSession`, alongside the existing `if (kind === 'chat')` block, add an orchestrator branch (declare `let systemPromptOverride: string | undefined;` near the `mcpServers`/`chatAppendSystemPrompt` locals):

```typescript
    if (kind === 'orchestrator') {
      const server = this._buildSwarmMcpServer?.(cwd);
      if (server) {
        mcpServers = { swarm: server };
      }
      // Build the full orchestrator system prompt (full replacement, not append),
      // mirroring claude.ts buildArgs: derive workspacePath/Name from cwd when absent.
      const raw = (meta?.orchestratorContext ?? {}) as Partial<OrchestratorPromptContext>;
      const ctx = resolveOrchestratorPromptContext({
        ...raw,
        workspacePath: raw.workspacePath || cwd,
        workspaceName: raw.workspaceName || (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : undefined),
      });
      systemPromptOverride = buildOrchestratorSystemPrompt(ctx);
    }
```

Pass both into `buildSdkOptions({ ... })`: add `systemPromptOverride` and keep `mcpServers`. (For orchestrator, `appendSystemPrompt`/`chatAppendSystemPrompt` is irrelevant — the override wins in `buildSdkOptions`.)

- [ ] **Step 3c: index.ts — inject buildSwarmMcpServer**

In `getClaudeBackend()` where `new SdkBackend({...})` is constructed, add (alongside `buildChatMcpServer`):

```typescript
import { buildSwarmMcpServer } from './swarmMcpServer';
// ...
      buildSwarmMcpServer: (workspace: string) => {
        const dispatch = getSaiToolDispatch();
        if (!dispatch) return undefined;
        return buildSwarmMcpServer({ workspace, dispatch });
      },
```

- [ ] **Step 4: Run tests — verify they PASS**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: PASS (existing + (26)+(27)).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkBackend.ts electron/services/claudeBackend/index.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): wire swarm MCP server + orchestrator system prompt into SdkBackend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Flip-readiness verification + dogfood gate

**Files:** none (verification); update spec/memory status.

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] **Step 2: Full suite** — `npm test` → all green.
- [ ] **Step 3: Flip-readiness audit (documented checklist).** Confirm, by reading `SdkBackend` + `getClaudeBackend`, that every `ClaudeBackend` method is real (not stubbed/CLI-assuming) for chat, task, AND orchestrator in SDK mode:
  - `start` (returns cached slashCommands; stores orchestratorContext) · `send` (images/clamp/activity) · `interrupt` · `setSessionId` · `compact` · `approve`/`answerQuestion`/`answerPlanReview` · `alwaysAllow`/`generateCommitMessage`/`generateTitle`/`getModels` (delegate to `claude.ts` impls — backend-agnostic, work regardless) · `destroy` · idle sweep.
  - Confirm orchestrator: swarm server attached (key `swarm`), full system prompt, `tools:[]`, bypass permissions, NO `sai` server / nudges / canUseTool.
  - Record the checklist result in the ledger. Anything found missing → raise as a new task (do not silently pass).
- [ ] **Step 4: Real-app dogfood (the gate, requires the user).** Build off this branch (`npm run dev`), Settings → Claude → Backend → SDK, restart. In SDK mode, start an orchestrator and confirm:
  1. `spawn_task` → the SpawnTaskCard renders (Approach Y — from the real `tool_use`); the task actually spawns and streams.
  2. `query_status` shows tasks; `land`/`discard` and `pause_task`/`resume_task` work.
  3. NO stray/duplicate orchestrator cards; built-in tools (Bash/Read/Edit) are NOT available to the orchestrator (it only has `mcp__swarm__*`).
  4. The orchestrator system prompt is in effect (it dispatches tasks rather than coding itself).
  - If cards misbehave (result/status not rendering, or stray cards), adopt Approach X: advertise `swarm_<name>` and set the orchestrator session so `dispatchSwarmTool`'s synthetic injection drives cards. This is a documented, contained fallback (Task 1 naming + a `swarm:set-orchestrator-session` call on orchestrator start).
- [ ] **Step 5: Update spec status + memory.** Mark Phase 4b implemented. Note the SDK path is now complete and flip-ready; the flag flip (`claudeBackend: 'sdk'` default) is the user's post-dogfood follow-up; remaining cleanup (one-shot SDK-native, delete CliBackend + flag) is optional/later.

---

## Self-Review (against the Phase 4b spec)

**Spec coverage:** §1 orchestratorContext plumbing → Task 3 (start + scopeMeta + _createSession). §2 buildSwarmMcpServer → Task 1. §3 orchestrator sdkOptions → Task 2. §4 wire into _createSession → Task 3. §5 Approach Y cards (bare names, key swarm, no synthetic injection) → Task 1 naming + the Global Constraints (no `swarm:set-orchestrator-session` in SDK) + Task 4 dogfood. §6 flip-readiness → Task 4.

**Placeholder scan:** none — every code step has complete code. The card-rendering + full-swarm-flow behavior is an explicit Task 4 dogfood item with a documented Approach-X fallback, not a placeholder.

**Type consistency:** `buildSwarmMcpServer`/`SWARM_MCP_SERVER_NAME` (Task 1) consumed by Task 3's dep + index injection; `systemPromptOverride` on `SdkOptionInputs` (Task 2) consumed by Task 3's `buildSdkOptions` call; `buildOrchestratorSystemPrompt`/`resolveOrchestratorPromptContext`/`OrchestratorPromptContext` (Task 3) come from `src/lib/orchestratorSystemPrompt.ts`; `SWARM_TOOL_SCHEMA` entries are `{name, description, input_schema}` (verified). Orchestrator scopes attach `{ swarm }` (Task 3), never the Phase-3 `{ sai }`.
