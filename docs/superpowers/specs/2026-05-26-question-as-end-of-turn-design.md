# AskUserQuestion as End-of-Turn Status — Design

**Date:** 2026-05-26
**Scope:** Workspace status indicators (desktop + mobile)

## Problem

When the AI invokes the `AskUserQuestion` tool, the CLI pauses waiting for the user to answer. The `result` message never arrives until the answer is supplied, so the workspace stays in `streaming`/`busy` status — the indicator dot shows the "running" color and the thinking spinner keeps spinning. Functionally the AI is idle: it is the human who is the bottleneck. We want the visual to reflect that, while still resuming correctly once the answer is given.

`notifyQuestion` (the system notification) already fires when the question is posed. That part of the request is satisfied today; this spec covers the status indicator.

## Goals

1. While an `AskUserQuestion` is unanswered, the workspace status indicator displays the same as `completed` (green / idle-but-attention) on **both desktop and mobile**.
2. The chat panel's "thinking" spinner is hidden during that interval.
3. When the user answers, the status returns to `streaming`/`busy` and the spinner returns — no double-counting, no stuck states.
4. No "X has finished" completion toast and no `notifyCompletion` system notification fires for the question pause — the conversation is not finished, only paused. The existing `notifyQuestion` notification is unchanged.

## Non-goals

- Changing the underlying `busy`/`streaming` state machine (those still reflect "CLI process is alive and the turn hasn't ended").
- Changing how the question card is rendered in the chat transcript.
- Adding a new system-notification type.
- Suppressing the unread-message badge increment that `question_needed` already produces for inactive workspaces.

## Design

### Status model

Add a fifth boolean to `WorkspaceStatus`: `awaitingQuestion: boolean`. It represents "the AI has handed control back to the human for an answer." It is independent of `busy` and `streaming` — both can be true at the same time as `awaitingQuestion`, and they remain true (because the CLI process is still alive). `awaitingQuestion` is purely a visual override.

Updated priority (highest first):

```
approval > awaitingQuestion > streaming > busy > completed > idle
```

Visual mapping (both desktop and mobile):
- `awaitingQuestion` → renders the same as `completed` (green / attention dot).
- Thinking spinner: hidden when `awaitingQuestion` is true, even if `streaming` is true.

### Why a separate field, not "clear streaming and reset on answer"

Two reasons:
1. `streaming_start` is only emitted from the user-prompt path (`claude.ts:546`, `:749`), not from `answerImpl`. Reusing it from the answer path would require either re-emitting it with side-effects (`busyScopeCountRef` would double-count) or adding a new event type. A separate flag avoids touching the working state machine.
2. The underlying truth is that the CLI process is still alive and the turn hasn't ended. Lying about `streaming`/`busy` for visual reasons would surprise other consumers (quit confirmation, lock checks, swarm task state, etc.).

### State tracking (desktop, `src/App.tsx`)

- New state: `awaitingQuestionWorkspaces: Set<string>`.
- On `question_needed` event: add `msg.projectPath` to the set.
- On `question_answered` event: remove it.
- On `result`/`done` event: remove it (cleanup safety — covers the case where the turn ends via interrupt or error without a question_answered).
- `workspaceStatusRef` gains an `awaitingQuestion: Set<string>` member.
- `statusFor()` in the `listWorkspaces` proxy includes `awaitingQuestion`.
- The `workspaceStatusRef` sync effect (around `src/App.tsx:389-421`) includes `awaitingQuestion` in the diff payload sent to mobile via `remoteEmitWorkspaceStatus`.

### Status payload (wire)

The existing `remoteEmitWorkspaceStatus` payload gains `awaitingQuestion: boolean`. Existing clients that don't know about the field continue working — they just won't show the green override. Mobile `WorkspaceStatus` type is widened to include it.

### Mobile (`src/renderer-remote/lib/workspaceStatusStore.ts`)

- `WorkspaceStatus` gains `awaitingQuestion: boolean`.
- `WorkspaceStatusPriority` gains `'awaitingQuestion'`.
- `priority()` returns `'awaitingQuestion'` immediately after `'approval'`.
- The `allFalse` check (used to drop idle entries from the map) includes the new field.

### Spinner suppression

Identify each thinking-spinner consumer and add an `awaitingQuestion` guard:

**Desktop:**
- `src/components/Chat/ChatPanel.tsx:1325` — `const showThinking = isStreaming;` becomes `const showThinking = isStreaming && !awaitingQuestion;`. `ChatPanel` gains an `awaitingQuestion?: boolean` prop, threaded from `App.tsx`.

**Mobile:**
- `src/renderer-remote/chat/Transcript.tsx:232` — the `{streaming && <ThinkingAnimation ... />}` block becomes `{streaming && !awaitingQuestion && ...}`. `Transcript` gains an `awaitingQuestion?: boolean` prop, threaded from `Chat.tsx` which reads it from the `workspaceStatusStore`.

Status dots derived from the priority enum (sidebar, header, mobile drawer) update automatically via the priority change. No extra guards needed there.

### Multi-scope edge cases

- A workspace can have multiple concurrent scopes (chat + swarm tasks). The `awaitingQuestion` flag is workspace-scoped, mirroring how `busy`/`streaming` aggregate across scopes today. If any scope is awaiting a question, the workspace shows the override; this is correct because the visual is per-workspace, and a swarm task asking a question is just as much an end-of-turn for that workspace.

### Notifications

- `notifyQuestion` continues to fire from `claude.ts:405` — unchanged.
- `notifyCompletion` is NOT called on `question_needed`.
- The in-app "X has finished" toast (`src/App.tsx:2196`) is NOT triggered on `question_needed` (it lives inside the `result`/`done` handler — already isolated).
- The unread-message badge already increments on `question_needed` for inactive workspaces (`src/App.tsx:2049-2057`); leave that alone.

## Component boundaries

- **`workspaceStatusStore.ts`** (mobile): the field is added here and the priority logic updates. Self-contained.
- **`App.tsx`** (desktop): owns the new Set and the wire emission. No other component reads it directly.
- **Spinner consumers**: each adds a local guard. Each guard is one line.
- **`claude.ts`**: no change — it already emits `question_needed`/`question_answered`.

## Data flow

```
claude.ts emits question_needed
       │
       ▼
App.tsx ── awaitingQuestionWorkspaces.add(projectPath) ──┐
       │                                                  │
       │                                                  ▼
       │              workspaceStatusRef sync effect → remoteEmitWorkspaceStatus
       │                                                  │
       │                                                  ▼
       │                                          mobile receives status
       │                                                  │
       │                                                  ▼
       │                                    workspaceStatusStore.set({ awaitingQuestion: true })
       │                                                  │
       ▼                                                  ▼
  desktop UI                                       mobile UI
  - dot: green (priority)                          - dot: green (priority)
  - spinner: hidden                                - spinner: hidden

(user answers)
       │
       ▼
claude.ts emits question_answered
       │
       ▼
App.tsx ── awaitingQuestionWorkspaces.delete ─────┐
                                                   │
                          (same emit path, awaitingQuestion: false)
```

## Error handling

- If `question_answered` is lost (process killed, network blip, workspace-scoped state reset): the next `result`/`done` clears the set as a safety net.
- If the workspace is destroyed mid-question: existing workspace teardown already clears `awaitingQuestionAnswer`/`pendingQuestionId` in the bridge layer; the renderer's set entry is cleared by the corresponding status delta on next render.

## Testing

**Unit — `tests/unit/remote/workspace-status-store.test.ts` (extend):**
- `priority` returns `'awaitingQuestion'` when `awaitingQuestion: true` and `streaming: true` (proves priority wins over streaming).
- `priority` returns `'approval'` when both `approval` and `awaitingQuestion` are true (approval still wins).
- Setting a status with all flags false (including `awaitingQuestion: false`) removes the entry from the store.

**Unit — `tests/unit/App-question-status.test.tsx` (new, lightweight):**

Difficult to unit-test the full App.tsx reducer pattern. Instead, extract the bookkeeping into a tiny pure helper that both the production code and tests share:

`src/lib/awaitingQuestionTracker.ts` (new):
- `applyQuestionEvent(prev: Set<string>, msg: { type, projectPath }): Set<string>` — returns the next set given a `question_needed`/`question_answered`/`result`/`done` message.
- Tests cover: add on `question_needed`, remove on `question_answered`, remove on `result`, remove on `done`, idempotent on unrelated types.

`App.tsx` then calls `setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg))` from the relevant message handlers.

**Integration — `tests/integration/remote/mobile-state-coherence.test.ts` (extend, if scope allows):**
- Simulate a `question_needed` over the wire; assert the status delta sent to mobile carries `awaitingQuestion: true`.
- Simulate a `question_answered`; assert the next delta carries `awaitingQuestion: false`.

Skip the integration extension if it requires substantial new harness code — the unit coverage on the tracker plus the priority store is sufficient evidence.

## Files

- `src/renderer-remote/lib/workspaceStatusStore.ts` — add field + priority case + allFalse check.
- `tests/unit/remote/workspace-status-store.test.ts` — extend.
- `src/lib/awaitingQuestionTracker.ts` — **new** pure helper.
- `tests/unit/lib/awaitingQuestionTracker.test.ts` — **new**.
- `src/App.tsx` — new Set, wire emission field, refs/proxy, message handlers using the tracker.
- `src/renderer-remote/App.tsx` — accept the new field from the wire payload (cast/parsing only).
- `src/components/Chat/ChatPanel.tsx` — add `awaitingQuestion?` prop, guard `showThinking`.
- `src/App.tsx` — pass `awaitingQuestionWorkspaces.has(projectPath)` down to `ChatPanel`.
- `src/renderer-remote/chat/Transcript.tsx` — add `awaitingQuestion?` prop, guard the spinner block.
- `src/renderer-remote/chat/Chat.tsx` — read `awaitingQuestion` from the store and pass to `Transcript`.
