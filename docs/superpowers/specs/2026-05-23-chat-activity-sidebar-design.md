# Per-session chat scopes and activity in the history sidebar

**Date:** 2026-05-23
**Status:** Approved for planning (revised to scope B after architecture investigation)

## Problem

The Chats tab lists every session for a project in `ChatHistorySidebar`, but the sidebar is passive: there's no way to tell at a glance which chats are still running, which are blocked on approval, or which have new output you haven't read. The user wants to hop between several conversations in the same repo the same way they hop between workspaces — with live activity visible at a glance and notifications when a backgrounded chat needs attention.

Investigation surfaced the real blocker: today, only ONE non-swarm chat per project can run at a time. The frontend passes the literal string `"chat"` as the provider scope for all regular chats (`src/App.tsx:1757`), so all chat sessions in a project share one backend process. Switching chats calls `claudeSetSessionId` / `codexSetSessionId` / `geminiSetSessionId` to rebind that single scope to a different session ID. A backgrounded chat's turn doesn't continue — it stops being the active "chat" scope the moment you swap.

The backend already supports arbitrary per-scope processes (swarm tasks use the session ID as the scope). The fix is to do the same for regular chats: scope = session ID, one process per chat session, no rebinding on swap.

## Goals

1. Each chat session has its own provider scope and process. Multiple chats in the same project can stream concurrently.
2. `ChatHistorySidebar` shows live per-chat status (running / awaiting approval / error / idle) and unread state.
3. Toast the user when a non-active chat finishes a turn or enters an approval-pending state. Clicking jumps to that chat.
4. Swapping chats is a pure UI/state-routing change — no backend `setSessionId` rebind, no risk of dropping in-flight output.
5. Old single-`"chat"`-scope sessions migrate cleanly on first run after upgrade.

## Non-goals

- Cross-project activity (already covered by the workspace switcher).
- Token/cost or model badges per chat.
- Sorting the chat list by activity — recency sort already surfaces active chats.
- A new top-level switcher; sidebar augmentation only.
- Touching swarm task scoping — it already uses session-id-as-scope and stays as-is.

## Design

### 1. Backend scoping change

The provider services already accept any string as `scope`. They keep one process per `(workspaceId, scope)` and route events with the scope echoed back (`claude:message`, `codex:message`, `gemini:message`). No service-layer changes are required.

What changes is the **frontend's choice of scope string** for regular chats:

- Before: every regular chat send/approve/stop uses `scope = "chat"`.
- After: every regular chat call uses `scope = session.id`.

Swarm task and orchestrator sessions already use `scope = session.id`, so this unifies the model: scope IS the session id, always.

### 2. Process lifecycle

A process spins up lazily on the first send for a scope (existing behavior in `getClaude`/`getCodex`/`getGemini`). It stays alive across UI swaps. It's torn down when:

- The session is deleted (`dbDeleteSession`) → new IPC: `*:stop` already exists and accepts a scope; call it before deleting.
- The workspace is closed → existing workspace-shutdown path iterates known scopes for that workspace and stops each.
- An idle-timeout sweep runs (new): scopes whose session has had no activity for >30 min and is not currently streaming get stopped. Reason: avoid unbounded process count as users accumulate chats. Configurable via a constant; not user-facing in v1.

### 3. `claudeSetSessionId` / `codexSetSessionId` / `geminiSetSessionId`

These exist so the frontend can rebind the single `"chat"` scope to a different session id when the user swaps. After the change, that rebinding is unnecessary — each session has its own scope/process from the start, with its own provider session id stored on the process record.

`handleSelectSession` (`src/App.tsx:2559`) stops calling `*SetSessionId` for regular chats. It still calls them for swarm/orchestrator paths to preserve current behavior. The IPC handlers stay (they're cheap, and swarm rerouting may still use them).

### 4. Migration

On first load after upgrade, a workspace may have:

- An existing `${projectPath}:chat` scope process running (from before the upgrade in the same session — only relevant if the process was started by an older renderer; in practice, restart clears this).
- ChatSessions with no per-session scope ever started.

Migration is a no-op: the first send to any chat session post-upgrade spins up its dedicated scope process. The legacy `"chat"` scope is left to die naturally (no one will send to it again). Add a one-time cleanup that stops any process with scope `"chat"` on first send to a session-scoped chat in that workspace.

### 5. Frontend state derivations

- **`streamingSessionIds: Set<string>`** — `new Set([...streamingScopes].filter(k => k.startsWith(activeProjectPath + ":")).map(k => k.slice(activeProjectPath.length + 1)))`. After the scoping change, each entry IS a session id.
- **`awaitingSessionIds: Set<string>`** — `approvalWorkspaces` becomes `approvalSessions: Map<string, Set<string>>` keyed by `projectPath → Set<sessionId>`. Populated by the existing approval IPC handlers (`src/App.tsx:1879`), which already carry `msg.scope` — use that as the session id directly (drop the special-case `'chat'` → active-session mapping; after the scoping change `scope` IS a session id for regular chats too).
- **`errorSessionIds: Set<string>`** — derived from in-memory sessions: a session is in the set iff its tail message has `error` set AND the user hasn't sent a follow-up since.
- **`chatStreamingWorkspaces: Set<string>`** — kept, but derived from `streamingScopes` (any scope under the workspace = workspace is streaming). Simplifies state.

### 6. Status indicator in the sidebar

Each row's provider-color chip becomes the status surface:

| State            | Treatment                                          |
| ---------------- | -------------------------------------------------- |
| `running`        | Soft pulse animation on the chip border (`--accent`). |
| `awaiting_input` | Chip border swapped to amber (`var(--orange)`).    |
| `error`          | Chip border swapped to red (`var(--red)`).         |
| `idle`           | Chip unchanged.                                    |

The chip already exists (`PROVIDER_COLORS`); no new chrome added to rows. Status sources are §5.

### 7. Unread indicator

- New optional `lastViewedAt?: number` on `ChatSession`.
- Stamped to `Date.now()` in `handleSelectSession`, persisted via `dbSaveSession`.
- Unread iff session is not the active one AND `session.updatedAt > (session.lastViewedAt ?? session.updatedAt)`.
- Visual: title weight 600 + small `--accent` dot to the right of the timestamp.
- Migration: missing `lastViewedAt` falls back to `updatedAt`, so existing chats don't all light up.

### 8. Toasts for background-chat events

Reuse `WorkspaceToast`:

- `ToastTone` gains `'attention'` (amber, glyph `!`).
- `WorkspaceToast` gains optional `onClick` that runs before dismissal.

A `useEffect` in `App.tsx` diffs the previous and current `streamingSessionIds` / `awaitingSessionIds` per render:

1. **Turn finished**: session id was streaming and now isn't, AND is not the active session → toast `"Reply ready in '<title>'"` (success tone), click → `handleSelectSession(id)`.
2. **Approval pending**: session id newly in `awaitingSessionIds`, AND is not the active session → toast `"Approval needed in '<title>'"` (attention tone), click → `handleSelectSession(id)`.

Behavior:
- Stack vertically; max 3 visible; FIFO eviction.
- Auto-dismiss after 4s (existing).
- No suppression in v1; can be added if noisy.

### 9. Session persistence on swap

`handleSelectSession` already calls `flushAndPersist(activeProjectPath)` before switching. After the scoping change, the call is even safer (the outgoing chat's backend process is untouched, no in-flight state to drop). Lock in with a test asserting `dbSaveSession` runs before the active session id changes.

## Files touched

**Frontend:**
- `src/types.ts` — `lastViewedAt?: number` on `ChatSession`; `'attention'` added to `ToastTone`.
- `src/App.tsx`:
  - Replace all `scope: 'chat'` callsites for regular chats with `scope: session.id` (sends, stops, approvals).
  - `approvalWorkspaces: Map<string, PendingApproval>` → `approvalSessions: Map<string, Map<string, PendingApproval>>` (projectPath → sessionId → approval).
  - Derive `streamingSessionIds`, `awaitingSessionIds`, `errorSessionIds` per active project.
  - Remove `*SetSessionId` calls from regular-chat path in `handleSelectSession`; keep for swarm/orchestrator.
  - Stamp `lastViewedAt`; diff-effect for toasts; render stacked toasts.
- `src/components/Chat/ChatHistorySidebar.tsx` — new props (`streamingSessionIds`, `awaitingSessionIds`, `errorSessionIds`); chip ring states; unread row style.
- `src/components/WorkspaceToast.tsx` — `'attention'` tone, optional `onClick`.

**Backend:**
- `electron/services/claude.ts`, `codex.ts`, `gemini.ts` — add an idle-timeout sweep (per scope; stop process if no activity for >30 min and not currently streaming).
- `electron/services/{claude,codex,gemini}.ts` — `*:stop` already accepts scope; ensure callers in the workspace-shutdown path iterate ALL scopes for the workspace, not just `"chat"`.

**Tests:**
- `tests/unit/components/Chat/ChatHistorySidebar.test.tsx` — chip ring + unread cases per state.
- New: persistence-on-swap test for `App` (location decided during planning).
- New: integration test asserting two chat sessions in the same workspace can stream concurrently (both `streamingScopes` entries present), driven through the IPC mock.
- New: unit test for `approvalSessions` shape and toast trigger logic.

## Risks

1. **Process proliferation.** Mitigated by idle-timeout sweep and stop-on-delete.
2. **Migration of in-flight processes from older renderers.** Restart clears these; one-time cleanup on first new-scope send for a workspace stops any straggler `"chat"`-scope process.
3. **Backend send-while-busy semantics.** Each scope already serializes per-scope; concurrent scopes are independent. No change.
4. **Approval routing across multiple awaiting chats.** Approval IPC already carries `scope`. Per-session storage in `approvalSessions` matches.

## Open questions to resolve during planning

1. Idle-timeout exact value and whether it's a constant or env var. Default: constant `IDLE_SCOPE_MS = 30 * 60 * 1000`.
2. Whether to stop a scope's process on `dbDeleteSession` (yes — adds an IPC call) or rely on idle sweep alone.
3. Exact source of `errorSessionIds` — confirm tail-message error flag during planning by reading `parseAiError.ts` and `ChatMessage.tsx`.
4. Location of the persistence-on-swap test.
