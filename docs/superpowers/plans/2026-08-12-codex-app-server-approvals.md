# Codex App Server Approval Round Trips Implementation Plan

> **Execution:** use the established subagent-driven workflow: implementation, spec review, then quality review for each task.

**Goal:** Let an opted-in Codex App Server session safely surface command, file-change, and built-in permission approval requests in SAI and return a correlated, scoped decision to the exact App Server request.

**Architecture:** Extend the App Server JSON-RPC client with a first-class server-request registry rather than treating every incoming request as a fatal protocol error.  The App Server backend validates the request's owning thread and active turn, normalizes only supported approval methods to the existing provider-neutral `approval_needed` renderer channel, and tracks a single-use response handle.  The desktop approval panel remains the interaction surface, augmented only where Codex decisions differ (session approval and command amendment).  All other server requests remain fail-closed; user questions, MCP elicitation, and dynamic tools are deferred to their own explicit slices.

**Protocol boundary:** App Server stdio stays headerless JSONL and must complete `initialize` then `initialized` before all business requests.  Supported request methods are `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval`.  Decisions are constrained to the documented alternatives; SAI never grants a permission that was not requested.

## Task 1: Add correlated server-request handling to the protocol client

**Files:**
- Modify `electron/services/codexBackend/appServerClient.ts`
- Modify `tests/unit/electron/appServerClient.test.ts`

1. Write red tests for receiving a headerless server request, subscribing to its typed ID/method/params envelope, responding exactly once with a headerless result or JSON-RPC error, and rejecting a duplicate/unknown response attempt.
2. Add a narrow server-request subscription and response API to the client.  Keep request IDs opaque and preserve message ordering.
3. Change unknown requests to continue responding `-32601` and fail the preview closed.  Supported requests are not interpreted by the client; the backend must explicitly claim and settle them.
4. On process failure, destroy, or server-request cleanup, settle/remove request records so a stale desktop click cannot write into a new process.
5. Verify newline framing and the no-`jsonrpc` wire rule for every response path.

**Commit:** `feat(codex): handle App Server requests`

## Task 2: Normalize and scope App Server approval requests

**Files:**
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Modify/add `tests/unit/electron/appServerBackend.test.ts`

1. Write fixtures for command, file-change, and permissions requests with matching and stale/wrong thread/turn IDs.
2. Add a typed pending-approval registry keyed by App Server request ID.  Claim a request only when it belongs to the currently bound thread and active turn; decline stale/unknown requests at the protocol layer and do not emit a renderer card.
3. Normalize supported requests to existing `approval_needed` events with a provider-neutral request handle, scope, tool label, reason, command/cwd, network-specific context, proposed file root, or requested permission summary.  Do not expose arbitrary raw JSON to the renderer.
4. Retire pending approvals when `serverRequest/resolved`, turn completion, interrupt, session replacement, scope suspension, or App Server failure occurs.  Late renderer decisions must be rejected without protocol writes.
5. Preserve the current normal turn stream and keep the scope busy/approval-visible while a legitimate request is pending.

**Commit:** `feat(codex): surface App Server approvals`

## Task 3: Add a narrow provider-neutral decision IPC contract

**Files:**
- Modify `electron/services/codexBackend/types.ts`
- Modify `electron/services/codexBackend/index.ts`
- Modify `electron/services/codex.ts`
- Modify `electron/preload.ts`
- Modify `src/types.ts`
- Add/update focused IPC/preload tests

1. Add `approve` to `CodexBackend` and the scoped dispatcher, with project/scope/request identity and an explicit decision union.  SDK Codex returns a typed unsupported result; App Server accepts only its currently pending request.
2. Add a narrow `codex:approve` IPC handler and preload method.  Do not repurpose `claude:approve`, which has incompatible identifiers and persistence semantics.
3. Validate payloads at Electron boundaries: no arbitrary permission payloads, no cross-scope request IDs, no decision not offered by `availableDecisions`, and no command amendment unless the request supports it.
4. Map decisions exactly: command/file `accept`, `acceptForSession`, `decline`, `cancel`; command amendment only as the documented `acceptWithExecpolicyAmendment`; permissions only a subset of the original request with `turn` or `session` scope.
5. Run IPC/preload/dispatch tests.

**Commit:** `feat(codex): add scoped approval decisions`

## Task 4: Reuse and safely extend the desktop approval panel

**Files:**
- Modify `src/types.ts`
- Modify `src/components/Chat/ChatPanel.tsx`
- Modify `src/components/Chat/ApprovalPanel.tsx`
- Add/update component tests

1. Extend `PendingApproval` with optional provider/decision metadata while retaining existing Claude, Gemini, and Kimi behavior.
2. Route Codex `approval_needed` events to the same panel.  `Approve`, `Deny`, and `Always Allow` become the exact offered App Server decision (for example `acceptForSession` only when offered); do not show an unavailable option.
3. Render clear, bounded details: command and cwd, network host/protocol when it is a network approval, file grant root, or a summarized requested permission set.  Keep absolute paths explicit but do not broaden or redact the actual request semantics.
4. Ensure clicking after request resolution is harmless, clears local pending state, and does not leave an approval indicator stuck.  SDK Codex must never show a nonfunctional approval panel.
5. Add component coverage for Codex decisions plus a regression for existing Claude approval behavior.

**Commit:** `feat(chat): render Codex App Server approvals`

## Task 5: Verify and document the slice

1. Run focused protocol/backend/IPC/preload/renderer tests, TypeScript checking, and the production build.
2. Inspect the diff for headerless responses, exact thread/turn/request correlation, stale decision rejection, offered-decision enforcement, and no automatic permission escalation.
3. Update the parity verification document with exact results and explicit follow-ups: structured user questions, MCP elicitation, dynamic tools, approval persistence/recovery for Swarm, and Remote/mobile action routing.

**Commit:** `docs: verify Codex App Server approvals`
