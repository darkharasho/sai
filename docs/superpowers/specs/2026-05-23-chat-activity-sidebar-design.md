# Chat activity in the history sidebar

**Date:** 2026-05-23
**Status:** Approved for planning

## Problem

The Chats tab already lists every session for a project in `ChatHistorySidebar`, but the sidebar is passive: there's no way to tell at a glance which background chats are still streaming, which are blocked on approval, or which have new output you haven't read. Users hopping between several conversations in the same repo have to open each chat to find out what changed.

The workspace switcher solves the equivalent problem across projects (live activity dots, status colors). We want the same affordance inside a single project for its chats — and notifications when a backgrounded chat needs attention.

## Goals

1. Show live per-chat status (running / awaiting approval / error / idle) in `ChatHistorySidebar`.
2. Show unread state for chats with new assistant output since the user last viewed them.
3. Toast the user when a non-active chat finishes a turn or enters an approval-pending state. Clicking the toast jumps to that chat.
4. Verify (and lock in with a test) that swapping between chats persists the outgoing chat's state.

## Non-goals

- Cross-project activity (already covered by the workspace switcher).
- Token/cost or model badges per chat.
- Sorting the chat list by activity — recency sort already surfaces active chats.
- A new top-level switcher; this is an augmentation of the existing sidebar only.

## Design

### 1. Status indicator: provider-chip ring

Every row in `ChatHistorySidebar` already renders a small provider-color chip (`PROVIDER_COLORS` in `src/components/Chat/ChatHistorySidebar.tsx`). The chip becomes the status surface:

| State            | Treatment                                                  | Source of truth                                                       |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `running`        | Soft pulse animation on the chip border (uses `--accent`). | `streamingSessionIds` derived from `streamingScopes` for this project |
| `awaiting_input` | Chip border swapped to amber (`var(--orange)`), no anim.   | `awaitingSessionIds` (see §5)                                         |
| `error`          | Chip border swapped to red (`var(--red)`).                 | Last message on the session has an error flag                         |
| `idle`           | Chip unchanged.                                            | none of the above                                                     |

Rationale: avoids adding new chrome to every row, doesn't read as a clock or spinner, and the chip is already the element the eye lands on.

### 2. Unread indicator

- New optional field on `ChatSession`: `lastViewedAt?: number`.
- Stamped to `Date.now()` inside `handleSelectSession` (`src/App.tsx:2559`), and persisted via `dbSaveSession`.
- A chat is unread iff it is **not** the currently active session and `session.updatedAt > (session.lastViewedAt ?? session.updatedAt)`.
- Visual: title weight bumped to 600 plus a small `--accent` dot to the right of the timestamp.
- Migration: missing `lastViewedAt` falls back to `updatedAt`, so existing chats don't all light up as unread on first run after upgrade.

### 3. Toasts for background-chat events

Reuse `WorkspaceToast` with one tone extension:

- `ToastTone` gains `'attention'` (amber, glyph `!`).
- `WorkspaceToast` gains an optional `onClick` prop; when set, clicking the toast invokes it before dismissal.

Trigger logic lives in a `useEffect` in `App.tsx` that diffs the previous `streamingSessionIds` and `awaitingSessionIds` against the current values each render:

1. **Turn finished:** a session id that was in the prior `streamingSessionIds` set is no longer present, AND the session is not the currently active session → enqueue toast `"Reply ready in '<title>'"` (success tone).
2. **Approval pending:** a session id newly appears in `awaitingSessionIds`, AND it is not the currently active session → enqueue toast `"Approval needed in '<title>'"` (attention tone).

Toast behavior:

- Click → `handleSelectSession(sessionId)`, which also switches the Chats sidebar open if it isn't already.
- Coalesce: if more than one event fires within ~1s, stack vertically; cap at 3 visible at once, FIFO eviction.
- Auto-dismiss after 4s (existing `WorkspaceToast` behavior).
- Suppress nothing in v1 — even if the sidebar is open, the toast still fires. Suppression rules can be added later if noisy.

### 4. Session persistence on swap — verification only

`handleSelectSession` already calls `flushAndPersist(activeProjectPath)` before switching, and `dbSaveSession` runs on streaming flushes, natural pauses, and explicit saves throughout `App.tsx`. This is currently correct.

To prevent regression, add a unit/integration test that:

- Renders `App` with an active session that has in-flight unsaved messages.
- Calls `handleSelectSession` (via clicking another session in the sidebar).
- Asserts `dbSaveSession` was called with the outgoing session's path and id **before** the active session id changes.

### 5. Where status comes from

- **`streamingSessionIds: Set<string>`** — derived in `App.tsx` from `streamingScopes` by filtering keys matching `${activeProjectPath}:` and extracting the session id suffix.
- **`awaitingSessionIds: Set<string>`** — needs a small investigation during planning to find the canonical source. `ApprovalBanner` is the consumer side; we'll trace its data back to the per-session approval state and expose a derived set with the same shape. If no per-session approval signal exists yet, the planning step will scope that addition as a sub-task before the sidebar work.
- **Error state** — read from the session's tail message: `session.messages[last]?.error === true` (or equivalent flag — to be confirmed during planning when reading `parseAiError.ts` and `ChatMessage.tsx`).

Both sets are passed as props into `ChatHistorySidebar`. No new global state.

## Files touched

- `src/types.ts` — add `lastViewedAt?: number` to `ChatSession`; add `'attention'` to `ToastTone`.
- `src/components/Chat/ChatHistorySidebar.tsx` — new props `streamingSessionIds`, `awaitingSessionIds`, `errorSessionIds`; chip ring states; unread row style.
- `src/components/WorkspaceToast.tsx` — `'attention'` tone, optional `onClick`.
- `src/App.tsx` — derive the three sets, stamp `lastViewedAt` in `handleSelectSession`, diff-effect for toasts, render a stacked toast queue.
- `tests/unit/components/Chat/ChatHistorySidebar.test.tsx` — assert ring/unread rendering for each state.
- New test covering persistence-on-swap (location TBD during planning — likely co-located with existing App tests).
- Stylesheet hosting the sidebar styles — pulse animation, attention tone color.

## Open questions to resolve during planning

1. Exact source of `awaitingSessionIds`. May require exposing a per-session derived state.
2. Exact source of `errorSessionIds`. May reduce to a simple `session.messages[last]?.error` read; confirm field name.
3. Where the persistence-on-swap test should live (extend an existing App test file vs. add new).
