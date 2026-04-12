# Gemini ACP Provider Design

**Date:** 2026-04-12
**Status:** Draft

## Goal

Replace SAI's current Gemini headless prompt wrapper with a full ACP-backed provider so Gemini can support the same major product surface as the other providers:

- Chat
- Tool approvals
- Tool rendering
- Terminal mode
- Commit-message generation
- Session restore across saved SAI chats

## Why Change

The current Gemini integration is built around `gemini -p` one-shot turns. SAI reconstructs context in the renderer by flattening recent messages into a synthetic prompt. That creates multiple problems:

- Session switching restores UI messages, not real Gemini session state
- Tool results and structured turns are degraded into plain text context
- Turn continuity depends on prompt reconstruction quality
- Terminal mode and background tasks do not share the same operational model
- The backend has no durable Gemini session primitive comparable to Claude or Codex

ACP provides an explicit programmatic session protocol that is a better fit for SAI's provider architecture.

## Scope

This design covers:

- Gemini chat in the main chat panel
- Gemini terminal mode
- Gemini tool approval flow
- Gemini tool call and tool result rendering
- Gemini session persistence and restore
- Gemini commit-message generation through a separate hidden session
- Runtime disablement when ACP fails

This design does not cover:

- Claude or Codex architecture changes
- Gemini context compaction in the first pass
- Fallback to `gemini -p` if ACP fails

## Product Decisions

### Backend Choice

Gemini will use ACP as its only runtime backend.

If ACP fails to initialize, load a session, or complete a prompt, Gemini is treated as unavailable for that workspace or session until the user retries. SAI must not silently fall back to headless `-p`.

### Session Model

Gemini will have real persisted provider session IDs in SAI state.

- One visible Gemini ACP session per saved SAI chat session
- One Gemini ACP terminal session per terminal-mode tab or scope
- One separate hidden Gemini ACP session for commit-message generation

Commit-message generation must not pollute the active chat session.

### User Experience Target

Gemini should achieve visible parity with the existing provider UX:

- Streaming assistant output
- Approval prompts for blocked tools
- Tool call cards and tool result rendering
- Restored conversations when a saved session is selected
- Stop/cancel behavior for in-flight turns

Internal implementation details may differ where ACP requires it, but the user-facing behavior should match existing SAI expectations.

## Architecture

### Main Process Service

Replace the current `electron/services/gemini.ts` one-shot wrapper with an ACP session manager.

The service owns:

- Gemini process lifecycle
- ACP stdio transport
- Session creation and loading
- Request/response correlation
- Event translation from ACP into SAI's `claude:message` event stream
- Workspace-scoped Gemini availability state

The service should expose an internal model like:

- `transport`: one ACP client connection backed by a `gemini --acp` child process
- `chatSessions`: map of SAI session ID to Gemini ACP session ID
- `activeChatSessionId`: current Gemini ACP session for the workspace
- `terminalSessions`: map of terminal scope or tab ID to Gemini ACP session ID
- `commitSessionId`: hidden Gemini ACP session ID for background commit prompts
- `busy`: whether a prompt is in flight for a given Gemini session
- `availability`: `available` or `disabled` with last failure reason

### Renderer Contract

The renderer should stop constructing synthetic Gemini history prompts.

Instead:

- `gemini:start` ensures the Gemini ACP transport exists and reports readiness or disabled state
- `gemini:send` targets the active chat ACP session directly
- `gemini:stop` cancels the active Gemini request
- Session switching updates the active Gemini ACP session ID in the backend

The renderer remains responsible for normal message state and display, but not for rebuilding Gemini conversation state.

## Data Model Changes

### Session Persistence

Add Gemini provider session fields to persisted chat sessions.

`src/types.ts`

- Add `geminiSessionId?: string`
- Do not persist terminal-scope Gemini ACP session IDs across app restarts in the first pass; terminal sessions are recreated when terminal tabs are recreated

`src/App.tsx`

- Persist `geminiSessionId` on the active SAI chat session
- Restore that session ID when selecting a saved chat
- Clear it when starting a new chat

### Workspace Runtime State

`electron/services/workspace.ts`

Extend Gemini runtime state beyond the current process/buffer flags to include:

- ACP process handle
- Request map for in-flight prompts
- Active chat Gemini session ID
- Hidden commit Gemini session ID
- Per-terminal Gemini session IDs
- Availability and last error

## Event Translation

ACP events must be translated into SAI's existing renderer-facing message format so the UI does not need a provider-specific rendering path.

### Chat Output

- Assistant text maps to `assistant` messages with text blocks
- Tool calls map to `assistant` messages with `tool_use` blocks
- Tool results map to `user` messages with `tool_result` blocks where needed for existing UI update logic
- Turn completion maps to `result` plus `done`
- Failures map to `error` plus `done`

### Approvals

When ACP indicates a tool action requires approval:

- Cache the pending Gemini tool request in the main process
- Emit the existing `approval_needed` event shape
- Resume or deny the ACP tool request when the renderer responds

This keeps the current approval UI intact.

### Streaming Semantics

Gemini ACP output should be normalized before forwarding so the renderer sees a stable contract.

- If ACP emits deltas, aggregate them in the main process and send coherent text updates
- If ACP emits snapshots, replace rather than append
- The renderer should not need Gemini-specific assumptions about delta behavior

This removes the current fragility where Gemini text is always appended.

## Terminal Mode

Gemini terminal mode should use ACP sessions rather than the one-shot headless path.

- Each Gemini terminal tab or scope gets its own ACP session ID
- Terminal prompts are routed to that scoped Gemini session
- Stop cancels the scoped Gemini request, not the workspace chat session
- Tool and text events render through the existing terminal AI response components

Terminal mode should not share the main chat session, because the interaction pattern is different and cross-contamination would be hard to reason about.

## Commit-Message Generation

Commit-message generation will use a hidden Gemini ACP session per workspace.

Rules:

- Never reuse the visible chat session
- Create the hidden session lazily on first Gemini commit-message request
- Reuse it for later commit-message requests in the same workspace
- Keep its prompts out of the visible chat history

If the hidden commit session fails, return a visible error to the caller and mark Gemini unavailable for commit generation until retry.

## Failure Model

### No Fallback

If ACP fails, SAI does not switch to `gemini -p`.

Instead:

- Mark Gemini disabled for the affected workspace or session
- Surface a clear system error in chat or the invoking UI
- Require explicit user retry or provider switch

### Failure Cases

The following conditions disable Gemini for the affected scope:

- ACP process spawn failure
- ACP handshake failure
- Session create or load failure
- Prompt request failure
- Approval continuation failure
- Unexpected transport termination during a turn

### Recovery

Recovery is explicit:

- User retries Gemini in that workspace or chat
- Main process re-creates the ACP transport
- Session is reloaded if the saved Gemini session ID is still valid
- If not valid, the user is told the Gemini session cannot be restored and a fresh Gemini session is created only after explicit retry

## Migration Plan

### Phase 1

Introduce Gemini ACP service and data model support behind the existing renderer contract.

### Phase 2

Move main chat Gemini sends from prompt replay to real ACP sessions.

### Phase 3

Add approval handling and tool translation parity.

### Phase 4

Move terminal mode to ACP-backed Gemini sessions.

### Phase 5

Move commit-message generation to the hidden Gemini ACP session.

### Phase 6

Remove the old prompt-replay Gemini path and dead state fields.

## Testing Strategy

Add unit coverage for:

- ACP transport startup and shutdown
- Session creation and load flows
- Event translation into SAI message shapes
- Approval request and response paths
- Cancel and stop behavior
- Hidden commit session behavior
- Disabled-state handling after ACP failures

Add integration coverage for:

- New Gemini chat creation
- Saved chat restore with `geminiSessionId`
- Switching between saved Gemini chats
- Tool approval flows
- Gemini terminal mode send and stop
- Commit-message generation through the hidden session
- Gemini disabled state after simulated ACP failure

## Risks

### ACP Event Complexity

ACP has a richer event model than the current wrapper. Poor translation could recreate the same instability at a lower layer.

Mitigation:

- Normalize ACP events in the main process
- Keep renderer message contracts stable
- Add focused translation tests

### Scope Leakage

Chat, terminal, and commit sessions could accidentally share state.

Mitigation:

- Distinct Gemini session IDs for each scope
- No reuse of visible chat session for commit-message generation

### Restore Edge Cases

Saved Gemini session IDs may become invalid or unavailable.

Mitigation:

- Detect load failures explicitly
- Disable Gemini for that scope with a clear retry path
- Never silently create a new session during restore without telling the user

## Recommendation

Proceed with a full ACP-backed Gemini provider implementation and remove the synthetic prompt-replay design for Gemini chat. That is the only path that can realistically deliver durable parity for context flow, approvals, terminal mode, and background task generation.
