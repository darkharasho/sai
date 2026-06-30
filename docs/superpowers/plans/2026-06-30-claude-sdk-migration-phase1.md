# Claude SDK Migration — Phase 1 (SdkBackend Core Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `claudeBackend: 'sdk'` drive `@anthropic-ai/claude-agent-sdk` for core chat (send / stream / interrupt / session resume), matching `CliBackend`'s observable `claude:message` output for that subset.

**Architecture:** Three new files under `electron/services/claudeBackend/`: `sdkOptions.ts` (pure builder: SAI config → SDK `Options`), `sdkMessageMap.ts` (pure mapper: `SDKMessage` → `claude:message` payloads, replicating `claude.ts`'s stdout-handler semantics incl. the wait/restore re-arm), and `sdkBackend.ts` (`SdkBackend implements ClaudeBackend`, one persistent `query()` per scope, delegating non-chat methods to existing `claude.ts` impls). The dispatcher's `'sdk'` branch is flipped from fallback to `new SdkBackend()`.

**Tech Stack:** TypeScript (strict), Electron 36 / Node 24 main process, `@anthropic-ai/claude-agent-sdk@0.3.196`, Vitest (`--maxWorkers=2`).

**Spike result (already done, committed in 4b3493bb):** SDK 0.3.196 + installed CLI 2.1.195 round-trip via `pathToClaudeCodeExecutable` works; `SDKMessage` types are identical to the CLI stream-json frames; `query.interrupt()` exists; `session_id` is captured. Runtime = option (i), installed binary. No fallback needed.

## Global Constraints

- Vitest runs with `--maxWorkers=2`.
- `'cli'` stays the default backend; the full existing suite stays green; no preload/renderer/IPC-shape changes (the mapper emits the same `claude:message` payloads the renderer already consumes).
- Pure modules (`sdkOptions`, `sdkMessageMap`) take no SDK process and are unit-tested in isolation.
- The mapper must reproduce `claude.ts`'s existing stdout-handler output for each message type (it is the parity source of truth) INCLUDING the resume-after-wait re-arm (`if assistant frame arrives while streaming=false → prepend a synthetic streaming_start`) and `result → [result, done]`.
- Phase 1 sets `permissionMode: 'acceptEdits'` (or `'bypassPermissions'` for the orchestrator/bypass cases) and does NOT set `mcpServers` or `canUseTool` (deferred to Phases 2/3).
- `pathToClaudeCodeExecutable` resolves to the user's `claude` (reuse the resolution `claude.ts` uses when spawning; do not hardcode a path — find it the same way).

---

### Task 1: `sdkOptions.ts` — pure Options builder

**Files:** Create `electron/services/claudeBackend/sdkOptions.ts`; Test `tests/unit/electron/sdkOptions.test.ts`.

**Interface produced:**
```ts
import type { Options } from '@anthropic-ai/claude-agent-sdk';
export interface SdkOptionInputs {
  kind: 'chat' | 'task' | 'orchestrator';
  permMode?: string;          // 'bypass' | 'default' | undefined
  effort?: string;            // 'low'|'medium'|'high'|'max'
  model?: string;
  cwd: string;
  sessionId?: string;         // when set → resume
  claudeExecutablePath?: string;
  appendSystemPrompt?: string; // CHAT_RENDER_NUDGE + CHAT_GITHUB_WATCH_NUDGE + metaPreamble, joined
}
export function buildSdkOptions(input: SdkOptionInputs): Options;
```

**Behavior (mirror `buildArgs` in claude.ts for the chat path, minus MCP):**
- `permissionMode`: `'bypassPermissions'` if `kind === 'orchestrator' || permMode === 'bypass'`, else `'acceptEdits'`.
- `effort` if in `['low','medium','high','max']`; `model` if set; `cwd`; `includePartialMessages: true`.
- `resume: sessionId` when `sessionId` is set.
- `pathToClaudeCodeExecutable: claudeExecutablePath` when set.
- `systemPrompt: { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }` when `appendSystemPrompt` is non-empty; otherwise `{ type: 'preset', preset: 'claude_code' }`.
- Do NOT set `mcpServers`, `canUseTool`, `strictMcpConfig`, `tools` in Phase 1.

**TDD steps:**
- [ ] Write failing tests: (a) chat default → `permissionMode==='acceptEdits'`, `includePartialMessages===true`, preset systemPrompt; (b) `permMode:'bypass'` → `'bypassPermissions'`; (c) `kind:'orchestrator'` → `'bypassPermissions'`; (d) `sessionId` set → `resume` equals it; (e) `appendSystemPrompt` set → `systemPrompt.append` equals it; (f) `claudeExecutablePath` set → `pathToClaudeCodeExecutable` equals it; (g) no MCP/canUseTool keys present.
- [ ] Run `npx vitest run tests/unit/electron/sdkOptions.test.ts --maxWorkers=2` → RED (module missing).
- [ ] Implement `buildSdkOptions`.
- [ ] Run → GREEN. `npx tsc --noEmit -p tsconfig.json` → 0.
- [ ] Commit: `feat(claude): add SDK Options builder for SdkBackend`.

---

### Task 2: `sdkMessageMap.ts` — pure SDKMessage → claude:message mapper

**Files:** Create `electron/services/claudeBackend/sdkMessageMap.ts`; Test `tests/unit/electron/sdkMessageMap.test.ts`.

**Interface produced:**
```ts
export interface MapperState { streaming: boolean; sessionIdSeen: boolean; }
export interface MappedEmit { type: string; [k: string]: unknown }   // a claude:message payload (without projectPath/scope; caller adds those)
export interface MapResult { emits: MappedEmit[]; state: MapperState; sessionId?: string; }
// Pure: given an incoming SDKMessage and the prior per-scope state, return the claude:message
// payloads to emit (in order) and the next state. No I/O.
export function mapSdkMessage(msg: any, state: MapperState): MapResult;
```

**Behavior — reproduce `claude.ts`'s stdout-handler output for each type (READ that handler and mirror it):**
- `session_id`/first frame carrying `session_id`: capture into `sessionId` (emit a `session_id` payload once, like claude.ts does on first capture).
- `system` + `subtype:'init'`: emit the system message (carries `slash_commands`); also forward.
- `system` other subtypes / `rate_limit_event`: forward as-is (renderer skips noise / handles rate_limit) — same as claude.ts.
- `assistant`: **first apply the re-arm rule** — if `state.streaming === false`, prepend a synthetic `{ type: 'streaming_start' }` emit and set `state.streaming = true` (this is the wait/restore parity; mirror claude.ts's `if (msg.type==='assistant' && !claude.streaming)` re-arm — note the mapper does not own turnSeq; the BACKEND assigns turnSeq when it consumes a `streaming_start` emit, see Task 3). Then forward the assistant payload.
- `user` (tool_result): forward as-is.
- `result`: emit `result` payload then `done` payload; set `state.streaming = false`.
- partial-assistant / `stream_event`: forward (renderer's fast-path consumes deltas) — match claude.ts behavior.
- Unknown types: forward as-is (do not drop).

**Notes:** The mapper is intentionally turnSeq-free and emit-shape-only; the backend (Task 3) owns turnSeq/streaming_start emission timing and the per-scope `MapperState`. Keep the mapper a pure function so the parity rules are unit-testable without a process.

**TDD steps:**
- [ ] Read `electron/services/claude.ts` stdout handler to get the exact forwarded shapes per type.
- [ ] Write failing tests with `SDKMessage`-shaped fixtures: (a) assistant while `streaming:true` → single assistant emit, state unchanged; (b) assistant while `streaming:false` → `[streaming_start, assistant]` and `state.streaming` becomes true (the re-arm); (c) result → `[result, done]`, `state.streaming` false; (d) system/init → emit carries `slash_commands`; (e) a scripted wait→resume sequence (assistant, result, assistant) → second assistant triggers a re-arm `streaming_start`; (f) user tool_result forwarded; (g) unknown type forwarded.
- [ ] Run → RED.
- [ ] Implement `mapSdkMessage`.
- [ ] Run → GREEN; tsc → 0.
- [ ] Commit: `feat(claude): add SDKMessage→claude:message mapper with wait/restore re-arm`.

---

### Task 3: `sdkBackend.ts` — SdkBackend with one persistent query per scope

**Files:** Create `electron/services/claudeBackend/sdkBackend.ts`; Test `tests/unit/electron/sdkBackend.test.ts`.

**Interface produced:** `export class SdkBackend implements ClaudeBackend` with a constructor accepting injectable deps for testing:
```ts
export interface SdkBackendDeps {
  queryFn?: typeof import('@anthropic-ai/claude-agent-sdk').query; // default: real query
  emit?: (payload: Record<string, unknown>) => void;              // default: the shared emitChatMessage
  resolveClaudePath?: () => string | undefined;                   // default: same resolution claude.ts uses
}
constructor(deps?: SdkBackendDeps)
```

**Behavior:**
- Owns `Map<scopeKey, ScopeSession>`; `scopeKey = projectPath + ' ' + (scope||'chat')`. `ScopeSession = { query, pushInput, inputQueue, turnSeq, activeTurnSeq, sessionId, mapperState, cwd, appendSystemPrompt, kind, draining }`.
- `start(args)`: record cwd/kind/appendSystemPrompt for the scope (no process yet); return `{ slashCommands: [] }` (slash commands arrive via `system/init` once a query runs — Phase 1 may return cached/empty; do not block).
- `send(args)`: ensure a `ScopeSession`. If none, create one: build options via `buildSdkOptions({ kind, permMode, effort, model, cwd, sessionId, claudeExecutablePath: resolveClaudePath(), appendSystemPrompt })`, create an async-iterable input channel, call `queryFn({ prompt: inputIterable, options })`, store it, and start a drain loop. Bump `turnSeq`; set `activeTurnSeq = turnSeq`; set `mapperState.streaming = true`; `emit({type:'streaming_start', turnSeq})`. Push `{ type:'user', message:{ role:'user', content }, parent_tool_use_id:null }` into the input channel.
- Drain loop (per scope): `for await (const m of query) { const { emits, sessionId } = mapSdkMessage(m, session.mapperState); for (const e of emits) { if (e.type==='streaming_start') { session.turnSeq++; session.activeTurnSeq = session.turnSeq; emit({...e, turnSeq: session.turnSeq}); } else if (e.type==='result' || e.type==='done') { emit({...e, turnSeq: session.activeTurnSeq}); } else emit(e); } if (sessionId) session.sessionId = sessionId; }`. On loop throw → `emit({type:'error', text})` + `emit({type:'done', turnSeq: session.activeTurnSeq})`.
- `interrupt(projectPath, scope)`: `session.query.interrupt()`; the resulting `result` closes the turn (drain emits done). If no session, no-op.
- `setSessionId(projectPath, sessionId, scope)`: `session.query.close()`; delete the scope session, but remember `sessionId` so the next `send` creates a query with `resume`.
- `compact(args)`: Phase 1 — push a `{role:'user', content:'/compact'}` message like `send` but without emitting `streaming_start` (best-effort; acceptable if minimal). [If this proves unreliable with the SDK, mark DONE_WITH_CONCERNS and note for Phase 2.]
- `approve`, `answerQuestion`, `answerPlanReview`, `alwaysAllow`, `generateCommitMessage`, `generateTitle`, `getModels`: delegate to the existing `claude.ts` impls (import them), identical to `CliBackend`.
- `destroy()`: `query.close()` every live session; clear the map.

**TDD steps:**
- [ ] Write failing tests with a fake `queryFn` returning a controllable async-generator + an `interrupt` spy, and a captured `emit`:
  - send → first emit is `streaming_start` (turnSeq 1); a scripted `result` message → `result` then `done` (turnSeq 1).
  - a wait→resume script (result, then assistant, then result) → a SECOND `streaming_start` (turnSeq 2) is emitted before the resumed assistant, and the final `done` carries turnSeq 2.
  - `interrupt()` calls the query's `interrupt` spy.
  - `setSessionId(id)` then `send` → `queryFn` was called with `options.resume === id`.
  - `destroy()` calls `query.close()`.
- [ ] Run → RED.
- [ ] Implement `SdkBackend`.
- [ ] Run → GREEN; tsc → 0.
- [ ] Commit: `feat(claude): add SdkBackend (persistent query per scope, core chat)`.

---

### Task 4: wire the dispatcher + interface `destroy` + teardown

**Files:** Modify `electron/services/claudeBackend/types.ts` (add optional `destroy?(): void`), `electron/services/claudeBackend/index.ts` (flip `'sdk'` branch), `electron/services/claude.ts` (call `getClaudeBackend().destroy?.()` in `destroyClaude`); Test: extend `tests/unit/electron/claudeBackendDispatch.test.ts`.

**Behavior:**
- `ClaudeBackend` gains `destroy?(): void` (optional — `CliBackend` need not implement it).
- `getClaudeBackend()`: `which === 'sdk'` now `active = new SdkBackend()` (remove the warn-and-fallback).
- `destroyClaude()` in `claude.ts`: after its existing cleanup, call the active backend's `destroy?.()` (import `getClaudeBackend`). Guard the circular import the same call-time-only way as Task 5 of Phase 0.

**TDD steps:**
- [ ] Write failing test: with flag `'sdk'`, `getClaudeBackend()` returns an `SdkBackend` instance (reset cache via `__setClaudeBackendForTests(null)`); `destroy?.()` is callable.
- [ ] Run → RED.
- [ ] Implement (add `destroy?` to interface; flip branch; wire `destroyClaude`).
- [ ] Run → GREEN; tsc → 0.
- [ ] Commit: `feat(claude): select SdkBackend for claudeBackend=sdk + destroy teardown`.

---

### Task 5: full verification + dogfood note

**Files:** none (verification only) — plus a short note appended to the spec's "known gap" if anything surfaced.

**Steps:**
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0.
- [ ] `npm test` → full suite green (existing + new sdk* tests), 0 failures.
- [ ] Manual dogfood (document result in the task report, not a committed test): set `claudeBackend: 'sdk'` in SAI settings, run a plain chat turn + an auto-accepted edit + an interrupt + a background-task wait; confirm streaming, Stop button, thinking, and the wait/restore re-arm behave like `'cli'`. Note any parity gaps for Phase 2/3.
- [ ] Commit (if any doc note): `docs: Phase 1 SdkBackend dogfood notes`.

## Self-Review

- Spec coverage: lifecycle (Task 3), runtime option i / pathToClaudeCodeExecutable (Tasks 1,3), message mapping incl. re-arm (Task 2), options mapping (Task 1), dispatcher flip + destroy (Task 4), tests (all), zero-cli-change + suite green (Task 5). Deps + spike already committed (4b3493bb).
- Deferred-by-design (NOT gaps): approvals/canUseTool, AskUserQuestion/ExitPlanMode, SAI MCP — Phases 2/3; `SdkBackend` delegates approve/answer*/alwaysAllow/generate*/getModels to existing impls.
- Placeholder scan: the only soft spot is `compact` (Task 3) — explicitly allowed to land minimal/DONE_WITH_CONCERNS; everything else is concrete.
- Type consistency: `MapperState`/`MapResult` (Task 2) consumed by `SdkBackend` drain loop (Task 3); `SdkOptionInputs`/`buildSdkOptions` (Task 1) consumed by `SdkBackend.send` (Task 3); `destroy?()` added in Task 4 and implemented in Task 3's `SdkBackend`.
