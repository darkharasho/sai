# Codex App Server Transport Implementation Plan

> **Execution:** use the established subagent-driven workflow for every task: implementation, spec review, then quality review.

**Goal:** Add an opt-in Codex App Server preview backend that can safely start and resume scoped conversations, stream assistant text and reasoning summaries, and fall back to the SDK backend when it cannot be used.

**Architecture:** Keep the SDK backend as the default.  Add a long-lived JSON-RPC-over-stdio App Server client behind the existing `CodexBackend` interface, with one App Server thread per SAI scope.  Only expose a verified protocol subset in this slice: initialization, threads, turns, interruption, model discovery, text, reasoning summaries, and completion.  Unsupported server requests fail closed and make the preview unavailable; approval UX and richer command/MCP controls are explicitly deferred to the next slice.

**Tech stack:** Electron/Node child processes and streams, TypeScript, Vitest, the bundled Codex CLI's `app-server` command.

## File structure

- `electron/services/codexBackend/appServerClient.ts` — lifecycle-safe JSON-RPC client and initialization handshake.
- `electron/services/codexBackend/appServerEventMap.ts` — stable App Server notifications to SAI chat events.
- `electron/services/codexBackend/appServerBackend.ts` — scoped thread/turn implementation of `CodexBackend`.
- `electron/services/codexBackend/types.ts` — backend-mode and preview-status contracts.
- `electron/services/codexBackend/index.ts` — default-SDK selection, preview creation, and safe fallback.
- `electron/services/codex.ts`, `electron/preload.ts`, `src/types.ts` — narrow IPC bridge for mode and status.
- renderer settings owner — persisted mode picker with SDK as default and an actionable fallback reason.
- `electron/services/codexBackend/__tests__/...` — protocol, mapping, scope, fallback, and selection coverage.

## Task 1: Build a lifecycle-safe App Server protocol client

**Files:**
- Create `electron/services/codexBackend/appServerClient.ts`
- Create `electron/services/codexBackend/__tests__/appServerClient.test.ts`

1. Write tests with a fake child process for: newline-delimited request serialization; `initialize` followed by `initialized`; response correlation; malformed JSON; child exit while a request is pending; and idempotent destroy.
2. Add a small typed client interface (`start`, `request`, `notify`, notification subscription, `destroy`) plus typed protocol errors.
3. Spawn the resolved bundled Codex executable with `['app-server']`, `shell: false`, and piped stdio.  Do not inherit the user's shell or write protocol data to stdout.
4. Enforce the initialization gate: send `initialize`, wait for success, send `initialized`, and reject any business request until it finishes.
5. Parse each stdout line independently.  Treat malformed JSON, unexpected response IDs, process errors, and premature exits as controlled client failures that reject pending work and notify subscribers.
6. When the server sends a request SAI does not yet support, respond with JSON-RPC `-32601` rather than silently ignoring it.  Surface a preview-unavailable reason rather than pretending that interactive approval is available.
7. Run the focused test file.

**Commit:** `feat(codex): add App Server protocol client`

## Task 2: Map the verified App Server event subset

**Files:**
- Create `electron/services/codexBackend/appServerEventMap.ts`
- Create `electron/services/codexBackend/__tests__/appServerEventMap.test.ts`

1. Write fixtures/tests for `thread/started`, `turn/started`, assistant-message deltas, reasoning-summary deltas, known tool/todo items, item completion, `turn/completed`, and unknown notifications.
2. Convert assistant deltas to SAI text chunks and reasoning-summary deltas to the existing visible reasoning channel; never synthesize hidden chain-of-thought.
3. Preserve the same stable event shape used by the SDK backend for known tool and task activity, so the existing renderer/subagent activity plumbing remains reusable.
4. Emit terminal result/done events only for the matching turn, with explicit normal/failed/interrupted status.  Unknown events must be ignored safely and logged only through local diagnostics.
5. Run the focused mapper tests.

**Commit:** `feat(codex): map App Server stream events`

## Task 3: Implement scoped App Server threads and turns

**Files:**
- Create `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Create `electron/services/codexBackend/__tests__/appServerBackend.test.ts`

1. Extend types with `CodexBackendMode = 'sdk' | 'app-server'` and a compact preview-status envelope; do not alter normal chat event contracts.
2. Write tests showing that `start` creates a `thread/start` with the correct scope cwd; that a persisted session resumes only when idle; that `send` starts a matching `turn/start`; and that interrupt/reconcile/suspend affect only the intended scope.
3. Maintain a scope-to-thread/active-turn registry.  Discard notifications for a stale thread or stale turn so a delayed process event cannot mutate a newer chat.
4. Use `turn/interrupt` for targeted cancellation.  On app-server loss, settle the affected scope with a controlled error and make later starts select the SDK fallback.
5. Use `model/list` only after successful initialization.  If a requested capability such as image input lacks a confirmed stable App Server request shape, return a typed unsupported error instead of silently dropping it.
6. Run the focused backend tests.

**Commit:** `feat(codex): add scoped App Server backend`

## Task 4: Select the preview explicitly and fall back safely

**Files:**
- Modify `electron/services/codexBackend/index.ts`
- Modify `electron/services/codex.ts`
- Modify `electron/preload.ts`
- Modify `src/types.ts`
- Modify the existing Codex settings owner
- Add focused selection/IPC tests beside their owners

1. Add a persisted backend-mode setting.  Its default is `sdk`; `app-server` is labelled Preview.
2. Make backend resolution lazy.  A failed App Server spawn/handshake/unsupported server request returns a status with a human-readable reason and selects the SDK backend for new work.
3. Never swap an active backend mid-turn.  The selected/fallback backend applies to a new session or subsequent turn after the affected scope has settled.
4. Add narrow IPC endpoints for reading/writing mode and reading preview availability.  Keep the existing `codex:*` call signatures compatible.
5. Add the desktop setting: `SDK (default)` and `App Server (preview)`, plus a concise disabled/fallback explanation.  Do not claim approval, command-control, MCP, or image parity in this slice.
6. Run settings/IPC tests and focused Codex tests.

**Commit:** `feat(settings): add Codex App Server preview`

## Task 5: Verify the complete slice

1. Run all Codex backend tests, relevant renderer tests, TypeScript checking, and the production build commands used by the repository.
2. Inspect the diff for protocol writes, stale-event isolation, no silent fallback during an active turn, and no unsupported capability advertised as working.
3. Record the commands and results in the parity verification document, including the intentional follow-up scope: approval requests, command/MCP control, image input if supported, and full App Server Swarm orchestration.

**Commit:** `docs: verify Codex App Server transport`
