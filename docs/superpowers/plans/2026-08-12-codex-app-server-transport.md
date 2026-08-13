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

### Verification record — 2026-08-12

- `npm test -- --project unit tests/unit/electron/appServerClient.test.ts tests/unit/electron/appServerEventMap.test.ts tests/unit/electron/appServerBackend.test.ts tests/unit/electron/codexBackendDispatch.test.ts tests/unit/electron/codexBundledModels.test.ts tests/unit/electron/codexSdkBackend.test.ts tests/unit/electron/codexSdkEventMap.test.ts tests/unit/electron/codexSdkOptions.test.ts tests/unit/electron/codexTelemetry.test.ts tests/unit/components/SettingsModal.test.tsx tests/unit/preload.test.ts tests/unit/lib/codexEffort.test.ts` completed with **12 files and 287 tests passed**.
- `npx tsc --noEmit` completed with exit code 0.
- `npm run build` completed with exit code 0, including TypeScript, the desktop Vite build, the Remote PWA build, and the mobile-PWA asset sync.  It left the worktree clean.
- `git diff --check 720fc794..HEAD` completed with exit code 0.  A focused source review confirmed that the client writes newline-delimited JSON-RPC to the bundled executable with `shell: false`; initialization is gated; malformed/unknown protocol traffic and unsupported server requests make the preview unavailable; thread/turn notifications are matched to the active scoped owner; and a preview failure remains pinned until that conversation is reset rather than silently moving an active turn.

The verified preview deliberately does **not** offer interactive approval handling, command/MCP configuration or control, image input, or App Server-backed Swarm orchestration.  App Server requests are answered with JSON-RPC `-32601` and the preview becomes unavailable; image input emits a typed unsupported error.  Tool and MCP *activity* may be rendered from the stream, but no interactive control surface is claimed by this slice.

### Approval-round-trip verification record — 2026-08-12

- `npm test -- --project unit tests/unit/electron/appServerClient.test.ts tests/unit/electron/appServerEventMap.test.ts tests/unit/electron/appServerBackend.test.ts tests/unit/electron/codexBackendDispatch.test.ts tests/unit/preload.test.ts tests/unit/components/Chat/ApprovalPanel.test.tsx tests/unit/components/Chat/ChatPanel.test.tsx` completed with **7 files and 223 tests passed**.  This covers protocol framing, server-request lifecycle, scoped backend routing, the narrow IPC/preload bridge, and the desktop approval panel.
- `git diff --check 202b7733..HEAD` and `git diff --check` completed with exit code 0.  The approval slice adds 20 files/edits relative to the transport verification commit; no whitespace errors or unrelated generated artifacts were introduced.
- Source and fixture review confirmed that every App Server response is headerless newline-delimited JSON; the renderer only receives a sanitized request handle; the backend correlates a decision to its active project, scope, thread, turn, and one pending protocol request.  Stale or already-resolved decisions return `not-pending` without a protocol write.  Command decisions must be offered by the server, amendments must exactly equal the proposed amendment, and permission grants must be a requested subset with an explicit `turn` or `session` scope.  The UI only presents actions the server offered; it does not auto-grant permissions.
- `npx tsc --noEmit` is currently blocked by **10 pre-existing diagnostics in `electron/services/claudeBackend/**`** (CLI `approve` return typing plus MCP SDK schema/content typing).  It reports no diagnostic in the App Server, Codex approval, IPC/preload, or renderer files changed by this slice.  `npm run build` stops at the same TypeScript diagnostics before Vite/PWA packaging begins, so this verification does not claim a production build.

Deliberate follow-ups remain: structured user questions, MCP elicitation and dynamic tools, approval persistence/recovery for Swarm worktrees, Remote/mobile action routing, and a live Electron/App Server smoke with a real Codex process.  Those need their own protocol contracts and tests; this slice does not silently route them through the new approval bridge.

### Input-request verification record — 2026-08-12

- `npm run test:unit -- tests/unit/electron/appServerClient.test.ts tests/unit/electron/appServerEventMap.test.ts tests/unit/electron/appServerBackend.test.ts tests/unit/electron/codexBackendDispatch.test.ts tests/unit/electron/codexSdkBackend.test.ts tests/unit/components/Chat/AppServerInputPanels.test.tsx tests/unit/components/Chat/ChatPanel.test.tsx` completed with **7 files and 239 tests passed**.
- `npm run test:unit -- --reporter=dot` completed with **209 files passed, 2,552 tests passed, and 3 skipped**.  Its test-only console warnings (JSDOM `scrollTo`, temporary remote bridge ports, and expected failure-fixture logs) did not fail the suite.
- `npx tsc --noEmit` and `npm run build` both stop with exit code 2 at the same **10 inherited diagnostics under `electron/services/claudeBackend/**`**: CLI approval return typing, nullable backend selection, JSON-schema/Zod mutability, MCP SDK schema/content types, and Claude SDK content/MCP-config types.  Neither reports a diagnostic in the App Server input, Codex dispatcher, IPC/preload, or renderer files changed in this slice.  The production command stops at `tsc`, before Vite/PWA packaging, so no production-build success is claimed.
- `git diff --check e294da62..HEAD` completed with exit code 0.  Source and fixture audit confirmed that App Server writes remain headerless newline-delimited JSON; only the stored server-request responder can write a reply; and a renderer response must match exactly one pending request in its owning project, scope, active thread, and active turn.  A resolved, retired, duplicate, unknown, or cross-scope handle returns `not-pending` and performs no write.
- User-input replies serialize only the normalized question IDs and offered option IDs (or explicitly allowed bounded custom text).  MCP form values are rechecked against the retained safe schema subset; MCP URL elicitation accepts only `content: null`.  URL panels display a validated `http`/`https` destination but contain no link, `window.open`, `shell.openExternal`, navigation, or credential proxy.  Timed-out and stale server requests receive protocol-valid empty/cancel replies rather than renderer-visible actions.

Remaining parity gaps are dynamic App Server tools, Codex configuration/MCP management, Remote/mobile routing for approval and input actions, Swarm approval/input persistence, and a real Electron/App Server smoke run.  These input panels deliberately remain Desktop-only; they do not claim Remote/mobile action support.

### Dynamic-tools and Swarm-bridge verification record — 2026-08-12

- Focused protocol and bridge coverage completed with **13 files and 186 tests passed**: the App Server client/event/backend and Codex dispatcher/MCP configuration tests contributed **6 files / 138 tests**, while the Swarm approval, MCP protocol, dispatcher, router, tool taxonomy, and approval-policy/routing tests contributed **7 files / 48 tests**.  This covers capability negotiation, catalogue setup, malformed/duplicate/stale calls, client and workspace/scope isolation, result retirement, and the typed Swarm approval route.
- `npm run test:unit` completed with exit code 0.  Test-only console output includes the existing JSDOM `scrollTo` notice and temporary Remote bridge port messages; neither fails the suite.
- `npx tsc --noEmit` and `npm run build` both stop with exit code 2 at the same **10 inherited diagnostics under `electron/services/claudeBackend/**`**: CLI approval return typing, nullable backend selection, JSON-schema/Zod mutability, MCP SDK schema/content types, and Claude SDK content/MCP-config types.  Neither command reports a diagnostic in the App Server Dynamic Tool bridge, Codex dispatcher, Swarm integration, IPC/preload, or renderer code changed in this slice.  The production command stops at `tsc`, before Vite/PWA packaging, so this verification does not claim a production build.
- `git diff --check e294da62..HEAD` and `git diff --check` completed with exit code 0.  Source and fixture audit confirms the App Server receives a catalogue generated only from `SWARM_TOOL_SCHEMA`; renderer and remote input cannot define Dynamic Tools.  Calls are accepted only for an active App Server **orchestrator** thread and turn from its owning client, then dispatched with the backend-owned workspace and scope.  Unknown, malformed, stale, duplicate, cross-client, or non-orchestrator calls return a bounded failure result and do not reach the dispatcher.  Responses are bounded, recursively sanitized, and redact sensitive key names.
- The bridge exposes no generic shell, filesystem, network, renderer-eval, or raw-secret capability.  Its sole callable catalogue is the existing named Swarm operation taxonomy; consequential task actions continue through that taxonomy's existing approval path.  The readiness probe uses a separate archived thread with one inert no-input tool and never forwards to Swarm.

Remaining parity gaps are Codex configuration/MCP management, plugins/skills management, Remote/mobile interactive action routing, durable Swarm approval/input persistence and recovery, image input, and a live Electron/App Server smoke with a real Codex process.  The Dynamic Tool bridge is intentionally Desktop/App Server preview only; it does not create a generic Remote execution channel.

### Codex MCP runtime-status verification record — 2026-08-12

- Focused coverage completed with **6 files and 187 tests passed**: the App
  Server client/backend, Codex dispatcher, preload, MCP sidebar, and provider
  capability suites. This covers bounded `mcpServerStatus/list`
  pagination/sanitization, lifecycle updates, SDK-unavailable/fallback states,
  Electron argument validation, and the Codex-only read-only sidebar.
- `npm run test:unit` completed with exit code 0: **210 files passed, 2,591
  tests passed, and 3 skipped**. Its existing JSDOM `scrollTo` notices did not
  fail the suite.
- `npx tsc --noEmit` and the repository's `npm run build` both stop with exit
  code 2 at the same **10 inherited diagnostics in
  `electron/services/claudeBackend/**`** (CLI approval return typing, nullable
  backend selection, JSON-schema/Zod mutability, and Claude MCP/SDK schema or
  content types). Neither reports a diagnostic in the App Server MCP status,
  Codex IPC/preload, capability, or sidebar files in this slice. `npm run
  build` therefore does not reach its Vite/PWA stages. The independent
  `npx vite build && npm run build:pwa-mobile` completed with exit code 0,
  including desktop Vite, Remote PWA, and generated mobile asset sync.
- `git diff --check 5dd86f5b..HEAD` and `git diff --check` completed with exit
  code 0; the worktree was clean after the verification build. The source
  audit confirms that this slice makes only the App Server
  `mcpServerStatus/list` request and consumes its startup-status notification.
  It adds no `config/*` request, TOML read/write, OAuth or reload action, or
  MCP tool-call endpoint. The renderer receives only a bounded name,
  lifecycle, authentication class, tool count, and safe failure reason;
  configuration, headers, resources, URLs, environment, and raw protocol
  errors are excluded.
- Cross-client isolation is explicit: aggregate status is exposed only while
  one App Server client has served one SAI scope. A second scope permanently
  marks that client unavailable for runtime status, and updates cannot cross
  the standard/orchestrator client boundary. The dedicated `codex:*` IPC route
  does not invoke the Claude MCP service; the pre-existing generic chat
  emitter remains separate from MCP configuration/runtime operations.

Deferred work remains deliberately separate: confirmation-gated Codex TOML
configuration editing, reload and OAuth actions, per-tool policy controls,
ephemeral SAI MCP bridge configuration, Remote/mobile runtime-status and
action surfaces, plugins/skills management, and a real Electron/App Server
smoke against an installed Codex host.
