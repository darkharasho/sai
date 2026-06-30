# Claude CLI → Agent SDK Migration — Phase 1: SdkBackend Core Chat

**Date:** 2026-06-30
**Status:** Approved design (user authorized autonomous execution), pending implementation plan
**Depends on:** Phase 0 (adapter seam, merged to main). Builds the `'sdk'` backend behind the existing `claudeBackend` flag.

## Background

Phase 0 landed a `ClaudeBackend` interface with `CliBackend` (spawns the `claude` CLI, parses stream-json) selected by a `claudeBackend: 'cli' | 'sdk'` flag (default `'cli'`; `'sdk'` currently falls back to `CliBackend`). Phase 1 makes `'sdk'` actually drive the official `@anthropic-ai/claude-agent-sdk` (validated at `0.3.196`) for **core chat**, matching `CliBackend`'s observable behavior so the two are interchangeable behind the flag.

The SDK's `query({ prompt, options })` returns a `Query` (an `AsyncGenerator<SDKMessage>` with methods incl. `interrupt()`, `setPermissionMode()`, `setModel()`, `close()`). In streaming-input mode the prompt is an `AsyncIterable<SDKUserMessage>` (or `query.streamInput(stream)`), keeping one long-lived query per conversation. The SDK wraps the same `claude-code` runtime, so its `SDKMessage` union closely mirrors the CLI's stream-json frames (assistant / user / result / system / partial-assistant / etc.).

## Scope — boundary A (core chat only)

**In scope:** send, streaming output (assistant text + tool_use + tool_result), `interrupt()`, session resume / `session_id` capture, slash-command capture (`system/init`), usage/result handling, and faithful reproduction of the two turn-lifecycle behaviors `CliBackend` has: the `streaming_start`→`done` turn framing **and the wait/restore re-arm** (re-emit `streaming_start` when assistant output resumes after a `result`).

**Explicitly deferred (the known Phase-1 gap):**
- Tool **approvals** (the deny/re-execute flow): SDK mode runs with a fixed `permissionMode: 'acceptEdits'` (matching today's CLI default) — no approval UI. → Phase 2 (`canUseTool`).
- **AskUserQuestion / ExitPlanMode** cards. → Phase 2.
- SAI **MCP** (render_html/render_component, swarm/orchestrator). → Phase 3.
- One-shot title/commit generation, idle sweep, models discovery already work via `CliBackend` and are untouched (the SDK backend only overrides the chat send/stream/interrupt/session methods; `SdkBackend` may delegate the rest to the existing impls in Phase 1).

The flag keeps `'cli'` the default, so this gap is invisible to normal users; `'sdk'` is for dogfooding plain chat + auto-accepted edits.

## Design

### Runtime source (decided: option i)

Point the SDK at the **user's installed `claude`** via `Options.pathToClaudeCodeExecutable` (the same binary `CliBackend` spawns), for exact version parity and no bundled-runtime bloat.

**Contingency:** Phase 1's first task is a spike validating SDK `0.3.196` + installed CLI `2.1.195` actually interoperate (a minimal `query()` round-trips a turn). If they are incompatible, fall back to **option ii** (the runtime bundled with the SDK — omit `pathToClaudeCodeExecutable`) and record the decision in the plan. No other design choice depends on which runtime is used.

### Dependencies

Add `@anthropic-ai/claude-agent-sdk` and its peers (`zod@^4`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`) to `dependencies`. None are currently present (SAI's swarm MCP is socket-based, not the official MCP SDK). Verify the Electron 36 / Node 24 main process bundles them (the SDK is ESM/Node — confirm the electron-main build includes it; if the bundler externalizes it, ensure it's resolvable at runtime).

### Components

- **`electron/services/claudeBackend/sdkBackend.ts`** — `class SdkBackend implements ClaudeBackend`. Owns `Map<scopeKey, ScopeSession>` where `ScopeSession = { query: Query, pushInput(msg), turnSeq, activeTurnSeq, sessionId, streaming, ... }`. Implements `start`, `send`, `interrupt`, `setSessionId`, `compact`. Delegates `approve`, `answerQuestion`, `answerPlanReview`, `alwaysAllow`, `generateCommitMessage`, `generateTitle`, `getModels` to the existing `claude.ts` impls in Phase 1 (a thin reuse — those are CLI-independent or out-of-scope until later phases).
- **`electron/services/claudeBackend/sdkMessageMap.ts`** — pure mapper: `SDKMessage` → `Array<claude:message payload>`. This is the heart of parity and is unit-tested in isolation against representative `SDKMessage` fixtures. Mirrors the existing `claude.ts` stdout-handler semantics: assistant→assistant, user(tool_result)→user, result→[result, done], system/init→slash-commands+forward, session_id capture, plus the **resume-after-wait re-arm** decision (when an assistant frame would be emitted while the scope's `streaming` is false, prepend a synthetic `streaming_start`).
- **`electron/services/claudeBackend/sdkOptions.ts`** — pure builder: maps SAI's per-scope config (permMode/effort/model/cwd/kind/workspace) to the SDK `Options` object (the analogue of `buildArgs`). Phase 1 sets `permissionMode: 'acceptEdits'` (or `bypassPermissions` for the existing bypass cases), `model`, `effort`, `cwd`, `includePartialMessages: true`, `resume` when a sessionId exists, `pathToClaudeCodeExecutable` (per the runtime decision), `systemPrompt: { type: 'preset', preset: 'claude_code', append: <CHAT nudges> }`. MCP servers and `canUseTool` are NOT set in Phase 1.
- **`getClaudeBackend()` (index.ts)** — flip the `'sdk'` branch from the warn-and-fallback stub to constructing `SdkBackend`.

### Data flow (one scope, one turn)

1. `send(args)` → ensure a `ScopeSession` exists (create `query()` with streaming input + mapped options, or reuse). Bump `turnSeq`, set `streaming=true`, emit `streaming_start`. Push an `SDKUserMessage` (`{type:'user', message:{role:'user', content}}`) into the scope's input stream.
2. A per-scope async loop drains `for await (const m of query)`, runs `mapSdkMessage(m, session)` → emits each resulting `claude:message` via the shared emit path (`safeSend` + remoteBus — the same `emitChatMessage` Phase 0 left in place). `result` → emit `result` + `done` and set `streaming=false`. An assistant frame arriving while `streaming===false` triggers the re-arm (`streaming_start` + `streaming=true`), exactly as the CLI fix does.
3. `interrupt(scope)` → `session.query.interrupt()`; emit `done` for the current turnSeq.
4. `setSessionId(scope, id)` → `session.query.close()` and drop the session; next `send` recreates with `resume: id`.

### Error handling

- Query/loop errors (`for await` throws, or `SDKResultMessage.subtype === 'error'`) → emit a `claude:message` `{type:'error'}` (non-fatal stderr semantics preserved) and, on a fatal/process-death equivalent, emit `done` so the UI doesn't hang — matching the CLI backend's exit/error handlers.
- The SDK's `stderr` callback → forward as `{type:'error'}`.
- Teardown: add an **optional** `destroy?(): void` to the `ClaudeBackend` interface (Phase 0 has none). `SdkBackend.destroy()` calls `query.close()` on every live scope session; `CliBackend` leaves it unimplemented (its process lifecycle is already managed in `claude.ts`). The dispatcher's `destroyClaude()` calls `getClaudeBackend().destroy?.()` in addition to its existing `claude.ts` cleanup, so SDK queries are closed on window/app teardown.

### Testing

- **`sdkMessageMap` unit tests** (the parity core): feed representative `SDKMessage` fixtures (assistant text delta, tool_use, tool_result user, result success, system/init with slash_commands, a wait→resume sequence) and assert the exact `claude:message` array, including the re-arm `streaming_start` on resume-after-`result`. No SDK process needed — pure function.
- **`sdkOptions` unit tests**: assert the Options object for the chat and bypass cases (permissionMode, model, resume, pathToClaudeCodeExecutable, systemPrompt preset+append).
- **`SdkBackend` tests** with the SDK's `query` mocked (inject a fake async-generator + an `interrupt` spy): assert send emits `streaming_start` then maps a scripted message stream to the right events; assert `interrupt()` calls `query.interrupt()`; assert `setSessionId` closes + next send passes `resume`.
- **Spike (task 1)**: a throwaway script proving a real `query()` round-trips against the installed CLI; not a committed test.
- All existing suites stay green; `'cli'` remains default so nothing regresses.

## Non-goals (Phase 1)

No approval/question/plan UI in SDK mode, no SAI MCP in SDK mode, no removal of `CliBackend`, no change to `'cli'` behavior, no renderer/preload changes (the mapper emits the same `claude:message` shapes the renderer already consumes).

## Success criteria

1. With `claudeBackend: 'sdk'`, a plain chat turn streams assistant text + runs auto-accepted tools + ends correctly, visually indistinguishable from `'cli'` for that subset.
2. `interrupt()` stops a turn; the wait/restore re-arm keeps the Stop button + thinking alive across a background-task wait (parity with the v1.9.32 CLI fix).
3. Session resume works (`session_id` captured; switching sessions resumes).
4. `sdkMessageMap` + `sdkOptions` are pure and unit-tested; `SdkBackend` tested with a mocked query.
5. `'cli'` default unchanged; full suite green; tsc clean.
