# Codex App Server Questions and MCP Elicitation Implementation Plan

> **Execution:** follow the established subagent-driven workflow: implementation, spec review, then quality review for every task.

**Goal:** Let an App Server Codex turn ask structured user questions and MCP elicitation forms/URLs in SAI Desktop, then return an exact correlated answer without weakening the existing approval or provider boundaries.

**Architecture:** Reuse the App Server client's claimed server-request registry.  The App Server backend claims and scopes `item/tool/requestUserInput` and `mcpServer/elicitation/request`, normalizing both into dedicated renderer events and retaining one-shot pending responders.  Desktop uses a provider-neutral in-chat question panel for request-user-input and a bounded MCP elicitation panel for forms/URLs.  Existing approval cards remain exclusively for approval methods.  Unsupported dynamic tools remain fail-closed for a later slice.

**Protocol boundary:** Every App Server frame remains headerless JSONL.  User-input replies follow the request's declared options/schema; MCP elicitation replies are `accept` with validated content or `decline`/`cancel` with `content: null`.  Auto-resolution is explicit and only occurs when App Server provides `autoResolutionMs`; stale, timed-out, cross-scope, and duplicate answers never write to App Server.

## Task 1: Extend scoped backend request normalization

**Files:**
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Modify `tests/unit/electron/appServerBackend.test.ts`

1. Add red fixtures for `item/tool/requestUserInput` and `mcpServer/elicitation/request` matching and mismatching active thread/turn state, including `serverRequest/resolved` cleanup.
2. Claim a request only for the active owning scope.  Normalize user-input requests to a safe question event with opaque handle, prompt, bounded option/field schema, and optional `autoResolutionMs`.
3. Normalize MCP elicitation to a distinct safe event: server name, message, form schema or URL, and opaque handle.  Do not expose arbitrary server payloads or use an approval event as a surrogate.
4. Retire both request types on resolved notification, turn completion/interruption, session replacement, suspension, timeout, and transport failure.  Stale/unknown requests receive a protocol-valid decline/cancel response with no renderer event.
5. Add backend methods for typed question/elicitation responses.  Validate against the stored request shape and do not permit caller-supplied arbitrary JSON.

**Commit:** `feat(codex): surface App Server input requests`

## Task 2: Add scoped IPC response contracts

**Files:**
- Modify `electron/services/codexBackend/index.ts`
- Modify `electron/services/codex.ts`
- Modify `electron/preload.ts`
- Modify `src/types.ts`
- Add/update dispatch, IPC, and preload tests

1. Add separate typed `answerUserInput` and `resolveMcpElicitation` backend/dispatcher methods.  SDK returns typed unsupported results.
2. Add narrow dedicated IPC/preload names so no legacy Claude question/approval signature can collide.
3. Validate project/scope/handle ownership and decision payloads before dispatch.  For user-input, validate option IDs and schema-shaped fields; for MCP forms, validate content against the supplied safe schema subset; for URLs only accept/decline/cancel—SAI must not navigate or proxy credentials.
4. Make every answer one-shot, clear pending state only on an `{ ok: true }` response, and report typed failure to the renderer for stale/unsupported input.
5. Run focused bridge tests.

**Commit:** `feat(codex): add input request IPC`

## Task 3: Render desktop question and MCP elicitation panels

**Files:**
- Modify `src/types.ts`
- Modify `src/components/Chat/ChatPanel.tsx`
- Create/modify `src/components/Chat/UserInputRequestPanel.tsx`
- Create/modify `src/components/Chat/McpElicitationPanel.tsx`
- Add component tests

1. Reuse existing provider-neutral question state where compatible, adding App Server request metadata without changing Claude question behavior.
2. Render structured user-input controls from the normalized, bounded schema and optional answer choices.  Support explicit submit/cancel and auto-resolution countdown only when supplied by the host.
3. Render MCP form fields with explicit submit/decline/cancel.  URL elicitation displays the source server, message, and destination URL with an explicit user action; it never auto-opens an external URL or treats it as an approval.
4. Keep activity/indicator state actionable while pending, clear only after successful IPC acknowledgement or an authoritative resolved event, and ignore stale events.
5. Add regressions proving existing Claude AskUserQuestion and approvals are unchanged; SDK Codex never renders a nonfunctional panel.

**Commit:** `feat(chat): render Codex input requests`

## Task 4: Verify and document

1. Run focused client/backend/dispatcher/IPC/preload/component tests, TypeScript, and the production build; distinguish inherited diagnostics from changed paths.
2. Inspect the diff for headerless frames, exact scope/request correlation, schema/option validation, no URL auto-launch, and no stale response write.
3. Update parity verification with exact results and next gaps: dynamic tools, Codex config/MCP management, Remote/mobile action routing, and Swarm approval persistence.

**Commit:** `docs: verify Codex App Server input requests`
