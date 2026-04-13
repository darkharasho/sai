# IndexedDB Migration & History Retention

## Overview

Migrate all chat session storage from localStorage to IndexedDB, and add a global "save history for X days" retention setting. This eliminates the ~10MB localStorage quota that silently drops messages, provides unlimited storage, and gives users control over data lifetime.

## Storage Layer: `src/chatDb.ts`

New module replacing `src/sessions.ts` as the storage backend. Uses a single IndexedDB database `sai-chat` with two object stores:

- **`sessions`** — keyed by `id`, indexed on `projectPath` and `updatedAt`. Each record includes `projectPath` as a stored field (so sessions can be queried by project). Stores session metadata (title, timestamps, provider, pinned, messageCount) but NOT message bodies.
- **`messages`** — keyed by `sessionId`, stores the `ChatMessage[]` array for each session. Kept separate so listing sessions in the sidebar doesn't load all message bodies.

All public functions are async (return Promises). A thin wrapper opens the DB once on first call and reuses the connection. No external dependencies — just the native `indexedDB` API wrapped in Promise helpers.

### Public API

```typescript
dbGetSessions(projectPath: string): Promise<ChatSession[]>
dbGetMessages(sessionId: string): Promise<ChatMessage[]>
dbSaveSession(projectPath: string, session: ChatSession): Promise<void>
dbDeleteSession(sessionId: string): Promise<void>
dbPurgeExpired(retentionDays: number | null): Promise<number>
```

- `dbSaveSession` saves session metadata + messages in a single transaction. Computes and stores `messageCount` from the messages array.
- `dbPurgeExpired` deletes sessions where `updatedAt` is older than `retentionDays`. Returns count deleted. `null` means unlimited (no purge). Pinned sessions are exempt.

## Migration from localStorage

On first access, `chatDb.ts` checks for existing localStorage data (any `sai-sessions-index-*` keys). If found:

1. Reads all session indexes across all project paths.
2. For each session, loads messages from `sai-session-msgs-{id}`.
3. Writes everything into IndexedDB in a single transaction.
4. Removes all `sai-sessions-index-*` and `sai-session-msgs-*` keys from localStorage.
5. Also handles the two legacy formats (`sai-chat-sessions`, `sai-chat-sessions-{path}`) — consolidating all migration paths into one place.

Migration runs once, automatically, transparent to the user. localStorage keys are only deleted after the IndexedDB write succeeds. The existing `migrateLegacySessions()` function in `sessions.ts` is removed.

## Retention Setting & Cleanup

**Setting:** `historyRetention` in `settings.json` via the existing settings system. Value is number of days, or `null` for unlimited. Default: `14`.

**Cleanup triggers:**
- App startup (after DB init and migration).
- When the retention setting is changed (so reducing from 30 to 7 days takes effect immediately).

**Purge logic:** Compares each session's `updatedAt` against `Date.now() - (retentionDays * 86400000)`. Deletes both the session entry and its messages. Pinned sessions are exempt from purging.

## Settings UI

A new **"Data & Storage"** page in SettingsModal with a dropdown for retention period:
- 1 week
- 2 weeks (default)
- 1 month
- 3 months
- Unlimited

## Caller Refactoring

### `src/sessions.ts`

All localStorage logic removed. Retains only pure utility functions:
- `generateSmartTitle`, `createSession`, `formatSessionDate`, `formatSessionTime`, `exportSessionAsMarkdown`

Storage functions replaced by `chatDb.ts` equivalents:
- `loadSessions` → `dbGetSessions`
- `loadSessionMessages` → `dbGetMessages`
- `saveSessionMessages` + `saveSessions` + `upsertSession` → `dbSaveSession`
- `deleteSession` → `dbDeleteSession`
- `toggleSessionPin` → handled inline via `dbSaveSession`
- `migrateLegacySessions` → removed (handled by `chatDb.ts` migration)

### `src/App.tsx`

All 7 save sites and 1 load site switch from sync to async (`dbSaveSession`/`dbGetSessions`/`dbGetMessages`). Changes:
- State updaters and callbacks become `async` with `await`.
- `beforeunload` handler: fire-and-forget the save (messages are already saved after each turn, so the periodic save is a safety net — losing the final unload save is acceptable).
- 30-second auto-save: already in a `setInterval` callback, becomes async.
- Retention purge runs on workspace initialization and when `historyRetention` setting changes.

### `src/components/Chat/ChatHistorySidebar.tsx`

- `getMessageCount` simplifies to `session.messageCount` (always available from index).
- Export, rename, delete operations become async.
- Search content loading switches to `dbGetMessages`.

### `src/types.ts`

- `messageCount` becomes required (`number`, not `number | undefined`).
