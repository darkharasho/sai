# Claude CLI → Agent SDK Migration — Phase 4a: Daily-chat parity gaps (SDK mode)

**Date:** 2026-06-30
**Status:** Design (pending review), then plan + execute
**Depends on:** Phases 0–3 (adapter seam, SdkBackend core chat, approvals/question/plan, chat tools as in-process SDK MCP server — all merged to main).

## Background

SDK mode (`claudeBackend: 'sdk'`) now handles core chat, approvals, AskUserQuestion/ExitPlanMode, and SAI's chat render tools. But several behaviors the CLI path has are still missing or stubbed in `SdkBackend`, and they would bite in everyday single-agent use. This phase closes those gaps so SDK mode is solid as a daily driver for chat/task scopes. The user intends to flip the flag to `sdk` and dogfood it through normal use — but only after Phase 4b (orchestrator/swarm in SDK) also lands, since the backend is selected once globally and flipping routes every scope through `SdkBackend`. Phase 4a does NOT flip the default and does NOT delete `CliBackend`.

Gap audit (CLI path → SDK path), with current locations:
- **Images:** `CliBackend.sendImpl` prepends `[Attached image: <path>]` refs to the prompt (`claude.ts:748–751`). `SdkBackend.send` (`sdkBackend.ts:139`) does not destructure `imagePaths`; they are silently dropped.
- **Idle scope sweep:** CLI runs a 5-min timer stopping scopes idle >30 min (`claude.ts:1541–1575`, pure logic in `electron/services/idleScopeSweep.ts` `sweepIdleScopes`). `SdkBackend` has no sweep; its per-scope `sessions` persist indefinitely.
- **Remote origin clamp:** `CliBackend.sendImpl` clamps the permission mode when `origin === 'remote'` via `clamp(effectivePermMode, remoteCeiling)` (`claude.ts:732–742`). `SdkBackend.send` ignores `origin`.
- **settingSources:** `sdkOptions.ts` sets no `settingSources`; the SDK runtime inherits the user's global `~/.claude/settings.json`. A global `defaultMode: bypassPermissions` makes the runtime auto-allow everything, so `canUseTool` never fires and SAI's approval flow is silently disabled (documented in the `sdkOptions.ts` NOTE comment).
- **User MCP config passthrough:** CLI forwards each `mcpConfigPath` setting via `--mcp-config` (`claude.ts:281–290`). SDK mode never reads `mcpConfigPath`.
- **Slash commands cache:** CLI caches slash commands from the `init` system message to `slash-commands-cache.json` (`claude.ts:49–61, 1422–1425`). `SdkBackend.start()` always returns `{ slashCommands: [] }`.
- **/compact:** `SdkBackend.compact` (`sdkBackend.ts:212`) pushes `/compact` as a user message without emitting `streaming_start`; whether that drives the runtime's real compaction is unverified.

## Scope

**In scope (chat + task scopes in SDK mode):** image forwarding, idle scope sweep, remote origin clamp, `settingSources` control, user MCP config passthrough, slash-commands cache capture, `/compact` correctness. Unit tests per gap; a real-app dogfood for the two behaviors that can't be unit-asserted (`settingSources`, `/compact`).

**Out of scope (Phase 4b / later):** orchestrator/swarm tools in SDK mode (Phase 4b). Making the one-shot helpers (`generateCommitMessage`, `generateTitle`, `getModels`, `alwaysAllow`) SDK-native — they already work by shelling out to `claude -p` regardless of backend, so this is cleanup, not parity. Deleting `CliBackend` / the `claudeBackend` flag (kept for dogfooding). Real SDK image content-blocks (a strict improvement over CLI text-refs) — noted as a follow-up; this phase matches CLI behavior.

## Design

### 1. Image forwarding (parity with CLI)

`SdkBackend.send` destructures `imagePaths` and, when present, prepends the same refs the CLI builds before the message is pushed into the input channel:

```
const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
const text = imageRefs ? `${imageRefs}\n\n${message}` : message;
```

This is behavior-identical to `CliBackend`. (Follow-up, not this phase: send real `image` content blocks in the `SDKUserMessage` so the model actually sees the pixels — strictly better, but a divergence from CLI parity.)

### 2. Idle scope sweep (SDK-side)

`SdkBackend` owns a sweep timer that reuses the existing pure `sweepIdleScopes` helper. `SdkBackend` tracks, per scope session: `lastActivityAt` (set on `send` and on each drained SDK message), `streaming` (already known from session state), and `awaitingInput` (true when the scope has a pending approval, question, or plan-review). The timer (same `SWEEP_INTERVAL_MS` = 5 min) builds records `{ workspaceId, scope, lastActivityAt, streaming, awaitingInput }` from its `sessions` map and calls `sweepIdleScopes` with `idleMs` = `IDLE_SCOPE_MS` (30 min) and a `stop(workspaceId, scope)` that emits `scope_suspended` (via the same `emitChatMessage` path) and calls `SdkBackend.interrupt(workspaceId, scope)`. The CLI sweep in `claude.ts` is untouched; only the active backend's sweep runs (the sweep is started/stopped with the backend lifecycle, mirroring how `destroy()` already tears sessions down).

### 3. Remote origin clamp

`SdkBackend.send` destructures `origin` and, when `origin === 'remote'`, clamps the effective permission mode using the same ceiling source and `clamp` helper the CLI uses (`claude.ts:732–742`). The `clamp` function and the `remoteCeiling` getter are exported from their current module if not already, so both backends share one implementation (no logic duplication). The clamped mode flows into `buildSdkOptions` exactly as the unclamped mode does today.

### 4. settingSources control (planning-validated mechanism)

**Goal:** SAI's explicitly-chosen `permissionMode` governs each query, so a user's global `~/.claude/settings.json` `defaultMode: bypassPermissions` cannot silently auto-allow every tool and disable SAI's `canUseTool` approval flow. SAI's project context (CLAUDE.md, project `.claude/settings`) should still apply where it doesn't conflict with SAI owning the permission decision.

**Mechanism (validated by a planning spike):** the SDK `Options.settingSources` field controls which on-disk settings layers the runtime reads. The plan's first task spikes the exact values (e.g. excluding the user-global layer while keeping project/local, or `[]` plus SAI re-supplying the needed context) and confirms in a real run that with a global `bypassPermissions` set, a non-pre-approved tool still triggers `canUseTool`. The spec commits to the goal and to picking the `settingSources` configuration that achieves it; if no `settingSources` value works, the fallback is to pass the permission decision entirely through `permissionMode` + `canUseTool` and document the residual (e.g. user must not set a global bypass). This gap is the one most in need of the real-app dogfood gate.

### 5. User MCP config passthrough

`SdkBackend` reads the `mcpConfigPath` setting (string or array of strings) the same way the CLI does. For each path, it reads and parses the MCP config JSON (`{ "mcpServers": { <name>: <McpServerConfig> } }`) and merges those server entries into the `mcpServers` map passed to `buildSdkOptions`, alongside SAI's in-process `sai` server (chat) — name collisions resolve in favor of SAI's built-in `sai` key. The SDK natively accepts stdio/SSE/HTTP server configs, so the parsed entries pass through unchanged. Malformed/missing config files are skipped with a logged warning (never crash a send). Applies to chat and task scopes (matching the CLI, which passes `--mcp-config` for chat/task, not orchestrator).

### 6. Slash-commands cache + /compact

- **Slash commands:** `SdkBackend.start()` returns the slash commands read from the shared `slash-commands-cache.json` (the same cache the CLI reads/writes, via the existing helpers) instead of an empty array. When the drain receives the SDK `system`/`init` message, it captures `slash_commands` from it and updates that cache, so subsequent `start()` calls (and the CLI path) see the current set. If the cache is empty on first run, `start()` returns `[]` and the cache is populated once the first session initializes.
- **/compact:** `SdkBackend.compact` emits `streaming_start` (so the Stop button + thinking animation show during compaction) before pushing `/compact` into the input channel. A planning spike confirms that pushing `/compact` drives the runtime's real compaction (expected, since the SDK drives the same claude-code runtime); if it does not, switch to the SDK's compact API if one is exposed, decided at that point.

### Components touched

- `electron/services/claudeBackend/sdkBackend.ts` — `send` (images, origin clamp, lastActivityAt), `start` (slash cache), `compact` (streaming_start), the drain (lastActivityAt, slash_commands capture), a new idle-sweep timer + per-session activity tracking, `mcpConfigPath` merge into the `_createSession` mcpServers.
- `electron/services/claudeBackend/sdkOptions.ts` — `settingSources` field (mechanism per the spike); accept the merged `mcpServers` (already a passthrough from Phase 3).
- `electron/services/claude.ts` (or wherever they live) — export `clamp` / the `remoteCeiling` getter and the slash-cache read/write helpers so `SdkBackend` shares them (no logic duplication).
- Renderer / IPC / `types.ts`: no changes — the events (`scope_suspended`) and IPC already exist.

## Testing

- **Unit (mocked):** `sdkBackend.test.ts` — `send` with `imagePaths` prepends the refs into the pushed user message; `send` with `origin:'remote'` clamps the mode passed to `buildSdkOptions`; the idle sweep builds the right records and its `stop` callback emits `scope_suspended` + calls `interrupt` (drive the pure helper with a fake clock — no real timers); `_createSession` merges parsed `mcpConfigPath` servers into `mcpServers`; `start()` returns the cached slash commands and the drain updates the cache on `system/init`; `compact` emits `streaming_start`. `sdkOptions.test.ts` — `settingSources` is set to the chosen value.
- **Shared-helper exports:** existing CLI tests that cover `clamp` / the slash cache stay green (the helpers are exported, not moved/changed).
- **Real-app dogfood (the gate):** in SDK mode — (a) with a global `defaultMode: bypassPermissions`, ask the agent to run a non-pre-approved tool and confirm the approval card still appears (settingSources works); (b) trigger `/compact` and confirm the conversation actually compacts with the thinking animation showing; (c) leave a scope idle >30 min (or a shortened test interval) and confirm it suspends; (d) attach an image and confirm the ref reaches the agent; (e) point `mcpConfigPath` at a test MCP server and confirm its tools load.
- `'cli'` default unchanged; full suite green; tsc clean.

## Non-goals / risks

- **Risk (settingSources):** the SDK may not expose a `settingSources` value that cleanly excludes only the global bypass while keeping project context. The planning spike resolves this; the fallback (permissionMode + canUseTool, document the residual) keeps the phase shippable.
- **Risk (/compact):** pushing `/compact` may not trigger runtime compaction; the spike resolves it (SDK compact API fallback).
- Orchestrator/swarm parity is Phase 4b. One-shot SDK-native helpers and `CliBackend` deletion are later cleanup.

## Success criteria

1. In SDK mode, image attachments reach the agent (CLI-identical refs), idle scopes suspend after 30 min, and remote-origin sends respect the remote permission ceiling — all unit-covered.
2. With a global `bypassPermissions`, a non-pre-approved tool still triggers SAI's approval card in SDK mode (settingSources goal met, dogfood-confirmed).
3. `/compact` compacts the conversation in SDK mode with activity shown; user `mcpConfigPath` servers load; `start()` returns real slash commands.
4. `'cli'` mode unchanged; full suite green; tsc clean. The `claudeBackend` flag still defaults `cli`; `CliBackend` retained.
