# Claude CLI → Agent SDK Migration — Phase 0: Adapter Seam

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan
**Scope of this spec:** Phase 0 only (the adapter seam). Later phases are summarized for context but specced separately.

## Background

Today SAI talks to Claude by spawning the `claude` CLI (`electron/services/claude.ts`,
~1571 lines): it builds CLI args, spawns the process with `--input-format stream-json
--output-format stream-json --verbose --include-partial-messages`, parses stdout
line-by-line, and routes the resulting messages to the renderer over `claude:message`
IPC. It also owns interrupts, session resume, the approval flow (which re-executes
Bash/Write/Edit/Read locally), the AskUserQuestion and ExitPlanMode flows, MCP config
injection (swarm + chat render tools), the orchestrator setup, silent compaction,
one-shot title/commit generation, idle-scope sweeping, and model discovery.

The official Agent SDK (`@anthropic-ai/claude-agent-sdk`) runs the same `claude-code`
runtime under the hood and yields the same message types, but as a typed
`AsyncGenerator<SDKMessage>` with real methods (`query.interrupt()`,
`setPermissionMode()`, a `canUseTool` approval callback, in-process MCP servers via
`createSdkMcpServer`). Migrating lets us delete brittle stdout parsing and the manual
stdin/turn-sequence juggling (the area where SAI's streaming bugs cluster, including the
v1.9.31 stale-`result` fix).

## Goal (overall migration)

Replace the CLI wrapper with the Agent SDK (**Scope C** — full re-platform, including
`canUseTool` approvals, `query.interrupt()`, and moving SAI's render/swarm tools into
in-process SDK MCP servers), behind an **adapter interface with a feature flag**
(**Rollout A**) so the CLI path remains a runtime-selectable safety net until the SDK
path is proven. (`tai` did a straight cutover; SAI uses the safer adapter because it is
heavier here — multi-scope concurrency, the local-execution approval path, swarm +
orchestrator — and `canUseTool` changes which process executes tools.)

## Decomposition (context only — each phase specced separately)

- **Phase 0 — Adapter seam (this spec).** Define `ClaudeBackend`; refactor today's CLI
  code into `CliBackend` behind a `claudeBackend: 'cli' | 'sdk'` flag wired to `'cli'`
  only. Pure refactor, zero behavior change.
- **Phase 1 — `SdkBackend` core chat.** `query()` streaming-input mode, one Query per
  scope, map `SDKMessage` → existing events, `query.interrupt()`, resume/session_id.
- **Phase 2 — `canUseTool` approvals + question/plan flows.**
- **Phase 3 — MCP re-platform** (render + swarm tools in-process; orchestrator equivalents).
- **Phase 4 — Remainder + cleanup** (orchestrator, one-shot calls, idle sweep, models;
  delete `CliBackend` + flag once proven).

## Phase 0 design

### Non-goals (Phase 0)

- No SDK code. The `'sdk'` flag value is reserved but not wired.
- No change to `preload.ts`, the renderer, IPC channel names, argument order, or return
  shapes.
- No relocation of `claude.ts` internals — `CliBackend` delegates to the existing
  exports. Physical reorganization happens lazily in later phases.
- No change to the outbound `claude:message` event path.

### Component layout

New directory `electron/services/claude/`:

- **`backend.ts`** — the `ClaudeBackend` interface plus shared argument/result types.
- **`cliBackend.ts`** — `CliBackend implements ClaudeBackend`; each method is a thin
  delegate to the existing `claude.ts` functions (`sendImpl`, `interruptImpl`,
  `approveImpl`, `answerQuestionImpl`, `answerPlanReviewImpl`, `setSessionIdImpl`,
  `getAvailableClaudeModels`, the one-shot generators, etc.).
- **`index.ts`** — dispatcher. Reads the `claudeBackend` setting once at registration,
  instantiates the chosen backend, and exposes `registerClaudeHandlers(win)` /
  `destroyClaude()`. Each `claude:*` IPC handler delegates one-line to a backend method.

`electron/main.ts` imports `registerClaudeHandlers` / `destroyClaude` from
`electron/services/claude/index.ts`. Its other direct callers (e.g. the remote bridge
calling `sendImpl` / `interruptImpl` / `setSessionIdImpl` / `approveImpl` /
`answerQuestionImpl`) obtain the active backend from the dispatcher via a
`getClaudeBackend()` accessor and call its methods — so the `claudeBackend` flag governs
**every** entry point, not just IPC. The behavior is identical in Phase 0 because the
only backend is `CliBackend`, which delegates straight to those same functions.

### Interface

```ts
interface ClaudeBackend {
  start(args: StartArgs): Promise<void>;
  send(args: SendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  compact(args: CompactArgs): void;
  approve(args: ApproveArgs): Promise<ApproveResult>;
  answerQuestion(args: AnswerQuestionArgs): Promise<boolean>;
  answerPlanReview(args: AnswerPlanArgs): Promise<boolean>;
  alwaysAllow(projectPath: string, toolPattern: string): Promise<void>;
  generateCommitMessage(cwd: string, provider?: string): Promise<string>;
  generateTitle(cwd: string, userMessage: string, provider?: string): Promise<string>;
  getModels(): { models: string[]; detected: boolean };
  destroy(): void;
}
```

Argument bag types (`StartArgs`, `SendArgs`, `CompactArgs`, `ApproveArgs`,
`AnswerQuestionArgs`, `AnswerPlanArgs`) mirror the current IPC handler signatures exactly
(see `registerClaudeHandlers` in `claude.ts`). Outbound `claude:message` events keep
flowing through `claude.ts`'s existing `emitChatMessage` (`safeSend` + `remoteBus`); the
shared event-sink abstraction is introduced in Phase 1 where the SDK backend gives it a
second consumer.

### Feature flag

A `claudeBackend` SAI setting read via the existing `readSaiSetting`, defaulting to
`'cli'`. Phase 0 only constructs `CliBackend`; selecting `'sdk'` falls back to `'cli'`
with a logged warning (no SDK backend exists yet).

### Events

Unchanged. `claude.ts` still emits `claude:message` via `safeSend` + `remoteBus`. No
abstraction is pulled forward speculatively.

### Error handling

No new failure modes. The dispatcher selects a backend at registration; an unknown flag
value logs a warning and uses `CliBackend`. Delegation preserves the existing error
handling inside each `claude.ts` function.

### Testing

- **Regression (the "no behavior change" proof):** all existing claude suites must stay
  green unchanged — `claudeBuildArgs`, `claude.test`, `ipc-streaming`, `ipc-approval`,
  `ipc-slash-commands`, `concurrent-chat-streams`, `claudeOrchestratorStart`.
- **New unit test** (`tests/unit/electron/claudeBackendDispatch.test.ts`): the dispatcher
  selects `CliBackend` when the flag is `'cli'` or absent, and each `claude:*` IPC channel
  routes to the matching backend method (assert with a stub backend). Reserved `'sdk'`
  value falls back to `CliBackend`.

### Rollback

Trivial. The flag never exposes `'sdk'` in Phase 0 and the seam is pure indirection;
reverting is removal of the new directory and restoring `main.ts`'s import path.

## Success criteria (Phase 0)

1. App behaves identically with the flag absent/`'cli'`.
2. All pre-existing claude tests pass unchanged.
3. New dispatcher test passes.
4. `ClaudeBackend` interface fully covers every `claude:*` IPC operation, so Phase 1 can
   add `SdkBackend` without touching the dispatcher, `preload.ts`, or the renderer.
