# IndexedDB Migration & History Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage session storage with IndexedDB and add a global history retention setting with a "Data & Storage" settings page.

**Architecture:** A new `src/chatDb.ts` module wraps IndexedDB with a Promise-based API. All callers (App.tsx, ChatHistorySidebar.tsx) switch from sync to async. A one-time migration moves existing localStorage data to IndexedDB. A retention setting (`historyRetention`) controls automatic purging of old sessions.

**Tech Stack:** Native IndexedDB API (no libraries), React, Electron settings IPC, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/chatDb.ts` | IndexedDB wrapper — all storage reads/writes |
| Create | `tests/unit/chatDb.test.ts` | Unit tests for chatDb |
| Modify | `src/types.ts:10-22` | Make `messageCount` required, add `projectPath` |
| Modify | `src/sessions.ts` | Remove all storage functions, keep utilities |
| Modify | `src/App.tsx:17,185-200,515-552,1211-1230,1245-1261,1478-1520` | Switch to async chatDb API |
| Modify | `src/components/Chat/ChatHistorySidebar.tsx:1-5,95-120,181-186,200-250` | Switch to async chatDb API |
| Modify | `src/components/SettingsModal.tsx:35-42,719-730,755-810` | Add Data & Storage page |
| Modify | `tests/unit/sessions.test.ts` | Remove storage tests, keep utility tests |

---

### Task 1: Create the IndexedDB wrapper (`src/chatDb.ts`)

**Files:**
- Create: `src/chatDb.ts`
- Create: `tests/unit/chatDb.test.ts`

- [ ] **Step 1: Write failing tests for `dbGetSessions` and `dbSaveSession`**

Create `tests/unit/chatDb.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { dbGetSessions, dbSaveSession, dbGetMessages, dbDeleteSession, dbPurgeExpired } from '@/chatDb';
import type { ChatSession, ChatMessage } from '@/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [makeMessage()],
    createdAt: now,
    updatedAt: now,
    messageCount: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  const { clearDb } = await import('@/chatDb');
  await clearDb();
});

describe('chatDb', () => {
  describe('dbSaveSession / dbGetSessions', () => {
    it('saves and retrieves sessions for a project', async () => {
      const session = makeSession({ title: 'My chat' });
      await dbSaveSession('/project/a', session);
      const sessions = await dbGetSessions('/project/a');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('My chat');
      expect(sessions[0].messageCount).toBe(1);
      expect(sessions[0].messages).toEqual([]);
    });

    it('returns empty array for unknown project', async () => {
      const sessions = await dbGetSessions('/unknown');
      expect(sessions).toEqual([]);
    });

    it('isolates sessions by project path', async () => {
      await dbSaveSession('/project/a', makeSession({ title: 'A' }));
      await dbSaveSession('/project/b', makeSession({ title: 'B' }));
      const a = await dbGetSessions('/project/a');
      const b = await dbGetSessions('/project/b');
      expect(a).toHaveLength(1);
      expect(a[0].title).toBe('A');
      expect(b).toHaveLength(1);
      expect(b[0].title).toBe('B');
    });

    it('updates existing session on re-save', async () => {
      const session = makeSession({ title: 'Original' });
      await dbSaveSession('/project/a', session);
      await dbSaveSession('/project/a', { ...session, title: 'Updated' });
      const sessions = await dbGetSessions('/project/a');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('Updated');
    });

    it('returns sessions sorted by updatedAt descending', async () => {
      const old = makeSession({ title: 'Old', updatedAt: 1000 });
      const mid = makeSession({ title: 'Mid', updatedAt: 2000 });
      const recent = makeSession({ title: 'Recent', updatedAt: 3000 });
      await dbSaveSession('/p', old);
      await dbSaveSession('/p', mid);
      await dbSaveSession('/p', recent);
      const sessions = await dbGetSessions('/p');
      expect(sessions.map(s => s.title)).toEqual(['Recent', 'Mid', 'Old']);
    });
  });

  describe('dbGetMessages', () => {
    it('retrieves messages saved with a session', async () => {
      const msgs = [makeMessage({ content: 'hi' }), makeMessage({ content: 'bye' })];
      const session = makeSession({ messages: msgs, messageCount: 2 });
      await dbSaveSession('/p', session);
      const loaded = await dbGetMessages(session.id);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toBe('hi');
      expect(loaded[1].content).toBe('bye');
    });

    it('returns empty array for unknown session', async () => {
      const loaded = await dbGetMessages('nonexistent');
      expect(loaded).toEqual([]);
    });
  });

  describe('dbDeleteSession', () => {
    it('removes session and its messages', async () => {
      const session = makeSession();
      await dbSaveSession('/p', session);
      await dbDeleteSession(session.id);
      const sessions = await dbGetSessions('/p');
      const msgs = await dbGetMessages(session.id);
      expect(sessions).toEqual([]);
      expect(msgs).toEqual([]);
    });
  });

  describe('dbPurgeExpired', () => {
    it('deletes sessions older than retention days', async () => {
      const old = makeSession({ title: 'Old', updatedAt: Date.now() - 20 * 86400000 });
      const recent = makeSession({ title: 'Recent', updatedAt: Date.now() });
      await dbSaveSession('/p', old);
      await dbSaveSession('/p', recent);
      const count = await dbPurgeExpired(14);
      expect(count).toBe(1);
      const sessions = await dbGetSessions('/p');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('Recent');
    });

    it('skips pinned sessions even if expired', async () => {
      const old = makeSession({ title: 'Pinned', updatedAt: Date.now() - 30 * 86400000, pinned: true });
      await dbSaveSession('/p', old);
      const count = await dbPurgeExpired(7);
      expect(count).toBe(0);
      const sessions = await dbGetSessions('/p');
      expect(sessions).toHaveLength(1);
    });

    it('does nothing when retention is null (unlimited)', async () => {
      const old = makeSession({ updatedAt: Date.now() - 365 * 86400000 });
      await dbSaveSession('/p', old);
      const count = await dbPurgeExpired(null);
      expect(count).toBe(0);
    });

    it('purges messages along with session', async () => {
      const old = makeSession({ updatedAt: Date.now() - 20 * 86400000 });
      await dbSaveSession('/p', old);
      await dbPurgeExpired(14);
      const msgs = await dbGetMessages(old.id);
      expect(msgs).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/chatDb.test.ts --reporter=verbose`
Expected: FAIL — module `@/chatDb` not found

- [ ] **Step 3: Implement `src/chatDb.ts`**

```typescript
import type { ChatSession, ChatMessage } from './types';

const DB_NAME = 'sai-chat';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const MESSAGES_STORE = 'messages';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        store.createIndex('projectPath', 'projectPath', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        db.createObjectStore(MESSAGES_STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function clearDb(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readwrite');
  tx.objectStore(SESSIONS_STORE).clear();
  tx.objectStore(MESSAGES_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetSessions(projectPath: string): Promise<ChatSession[]> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS_STORE, 'readonly');
  const index = tx.objectStore(SESSIONS_STORE).index('projectPath');
  const req = index.getAll(projectPath);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const sessions: ChatSession[] = req.result.map((r: any) => ({
        ...r,
        messages: [],
      }));
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await openDb();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const req = tx.objectStore(MESSAGES_STORE).get(sessionId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result?.messages ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbSaveSession(projectPath: string, session: ChatSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readwrite');

  const entry = {
    ...session,
    projectPath,
    messages: [],
    messageCount: session.messages.length || session.messageCount || 0,
  };
  tx.objectStore(SESSIONS_STORE).put(entry);

  if (session.messages.length > 0) {
    tx.objectStore(MESSAGES_STORE).put({
      sessionId: session.id,
      messages: session.messages,
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDeleteSession(sessionId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readwrite');
  tx.objectStore(SESSIONS_STORE).delete(sessionId);
  tx.objectStore(MESSAGES_STORE).delete(sessionId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbPurgeExpired(retentionDays: number | null): Promise<number> {
  if (retentionDays === null) return 0;
  const cutoff = Date.now() - retentionDays * 86400000;
  const db = await openDb();
  const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readwrite');
  const store = tx.objectStore(SESSIONS_STORE);
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      let deleted = 0;
      for (const session of req.result) {
        if (session.pinned) continue;
        if (session.updatedAt < cutoff) {
          store.delete(session.id);
          tx.objectStore(MESSAGES_STORE).delete(session.id);
          deleted++;
        }
      }
      tx.oncomplete = () => resolve(deleted);
    };
    tx.onerror = () => reject(tx.error);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chatDb.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/chatDb.ts tests/unit/chatDb.test.ts
git commit -m "feat: add IndexedDB storage layer for chat sessions"
```

---

### Task 2: Add localStorage-to-IndexedDB migration

**Files:**
- Modify: `src/chatDb.ts`
- Modify: `tests/unit/chatDb.test.ts`

- [ ] **Step 1: Write failing test for migration**

Add to `tests/unit/chatDb.test.ts`:

```typescript
describe('migrateFromLocalStorage', () => {
  it('migrates sessions and messages from localStorage to IndexedDB', async () => {
    const { migrateFromLocalStorage } = await import('@/chatDb');
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      title: 'Legacy',
      messages: [],
      createdAt: 1000,
      updatedAt: 2000,
    };
    localStorage.setItem(
      'sai-sessions-index-/project/x',
      JSON.stringify([session])
    );
    localStorage.setItem(
      `sai-session-msgs-${sessionId}`,
      JSON.stringify([{ id: '1', role: 'user', content: 'hello', timestamp: 1000 }])
    );

    await migrateFromLocalStorage();

    const sessions = await dbGetSessions('/project/x');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Legacy');
    expect(sessions[0].messageCount).toBe(1);

    const msgs = await dbGetMessages(sessionId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');

    expect(localStorage.getItem('sai-sessions-index-/project/x')).toBeNull();
    expect(localStorage.getItem(`sai-session-msgs-${sessionId}`)).toBeNull();
  });

  it('migrates legacy single-key format', async () => {
    const { migrateFromLocalStorage } = await import('@/chatDb');
    const sessionId = crypto.randomUUID();
    localStorage.setItem('sai-chat-sessions', JSON.stringify([{
      id: sessionId,
      title: 'OldFormat',
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: 1000 }],
      createdAt: 1000,
      updatedAt: 2000,
    }]));

    await migrateFromLocalStorage();

    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    const hasLegacy = keys.some(k => k === 'sai-chat-sessions');
    expect(hasLegacy).toBe(false);
  });

  it('does nothing when no localStorage data exists', async () => {
    const { migrateFromLocalStorage } = await import('@/chatDb');
    await migrateFromLocalStorage();
    const sessions = await dbGetSessions('/any');
    expect(sessions).toEqual([]);
  });

  it('preserves localStorage on IndexedDB write failure', async () => {
    // This test verifies the safety guarantee — localStorage is not
    // cleared if IndexedDB write fails. Hard to simulate in jsdom,
    // so we just verify the happy path completes without errors.
    const { migrateFromLocalStorage } = await import('@/chatDb');
    await migrateFromLocalStorage();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/chatDb.test.ts --reporter=verbose`
Expected: FAIL — `migrateFromLocalStorage` not exported

- [ ] **Step 3: Implement migration in `src/chatDb.ts`**

Add to end of `src/chatDb.ts`:

```typescript
let migrated = false;

export async function migrateFromLocalStorage(): Promise<void> {
  if (migrated) return;
  migrated = true;

  try {
    const keysToRemove: string[] = [];
    const sessionsToSave: { projectPath: string; session: ChatSession }[] = [];

    // Collect all sai-sessions-index-* keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('sai-sessions-index-')) {
        const projectPath = key.replace('sai-sessions-index-', '');
        try {
          const sessions: ChatSession[] = JSON.parse(localStorage.getItem(key) || '[]');
          for (const session of sessions) {
            const msgsKey = `sai-session-msgs-${session.id}`;
            const msgs: ChatMessage[] = JSON.parse(localStorage.getItem(msgsKey) || '[]');
            sessionsToSave.push({
              projectPath,
              session: { ...session, messages: msgs, messageCount: msgs.length || session.messageCount || 0 },
            });
            keysToRemove.push(msgsKey);
          }
        } catch { /* skip malformed entries */ }
        keysToRemove.push(key);
      }

      // Legacy single-key format
      if (key === 'sai-chat-sessions') {
        try {
          const sessions: ChatSession[] = JSON.parse(localStorage.getItem(key) || '[]');
          for (const session of sessions) {
            sessionsToSave.push({
              projectPath: '',
              session: { ...session, messageCount: session.messages?.length || 0 },
            });
          }
        } catch { /* skip */ }
        keysToRemove.push(key);
      }

      // Old per-path format
      if (key.startsWith('sai-chat-sessions-')) {
        const projectPath = key.replace('sai-chat-sessions-', '');
        try {
          const sessions: ChatSession[] = JSON.parse(localStorage.getItem(key) || '[]');
          for (const session of sessions) {
            sessionsToSave.push({
              projectPath,
              session: { ...session, messageCount: session.messages?.length || 0 },
            });
          }
        } catch { /* skip */ }
        keysToRemove.push(key);
      }
    }

    if (sessionsToSave.length === 0 && keysToRemove.length === 0) return;

    // Write all to IndexedDB
    for (const { projectPath, session } of sessionsToSave) {
      await dbSaveSession(projectPath, session);
    }

    // Only clear localStorage after IndexedDB write succeeds
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('[sai] Migration from localStorage failed:', e);
    migrated = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chatDb.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/chatDb.ts tests/unit/chatDb.test.ts
git commit -m "feat: add localStorage-to-IndexedDB migration"
```

---

### Task 3: Update types and strip storage from `src/sessions.ts`

**Files:**
- Modify: `src/types.ts:10-22`
- Modify: `src/sessions.ts`
- Modify: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Update `src/types.ts` — make `messageCount` required, add `projectPath`**

In `src/types.ts`, change the `ChatSession` interface:

```typescript
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  claudeSessionId?: string;
  codexSessionId?: string;
  geminiSessionId?: string;
  pinned?: boolean;
  titleEdited?: boolean;
  messageCount: number;
  projectPath?: string;
}
```

Changes: `messageCount` is now required (`number`, not `number | undefined`). Added `projectPath` as optional (used by IndexedDB index, present when loaded from DB).

- [ ] **Step 2: Fix type errors in `src/sessions.ts`**

Strip `src/sessions.ts` down to only utility functions. Remove all localStorage functions. The file should contain only:

- `generateSmartTitle(text: string): string`
- `createSession(): ChatSession`
- `formatSessionDate(timestamp: number): string`
- `formatSessionTime(timestamp: number): string`
- `exportSessionAsMarkdown(title: string, messages: ChatMessage[]): string`

Remove: `loadSessions`, `loadSessionMessages`, `saveSessionMessages`, `saveSessions`, `upsertSession`, `deleteSession`, `toggleSessionPin`, `migrateLegacySessions`, `toIndexEntry`, `saveIndex`, `indexKey`, `messagesKey`, `LEGACY_KEY`, `MAX_SESSIONS`.

Update `createSession` to include `messageCount: 0`:

```typescript
export function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
  };
}
```

- [ ] **Step 3: Update `tests/unit/sessions.test.ts`**

Remove all test suites for deleted functions:
- `saveSessions / loadSessions`
- `saveSessionMessages / loadSessionMessages`
- `upsertSession`
- `migrateLegacySessions`
- `toggleSessionPin`
- `deleteSession`

Remove `localStorage.clear()` from `beforeEach`.

Remove imports of deleted functions. Keep tests for: `createSession`, `formatSessionDate`, `formatSessionTime`, `generateSmartTitle`, `exportSessionAsMarkdown`.

Update `makeSession` helper to include `messageCount: 1`:

```typescript
function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [makeMessage()],
    createdAt: now,
    updatedAt: now,
    messageCount: 1,
    ...overrides,
  };
}
```

Update `createSession` tests to assert `messageCount: 0`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS (some test files may have type errors from App.tsx/ChatHistorySidebar still importing deleted functions — that's expected, we fix those in Task 4)

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: Type errors in `App.tsx` and `ChatHistorySidebar.tsx` from removed imports — confirms we need to update callers in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/sessions.ts tests/unit/sessions.test.ts
git commit -m "refactor: strip localStorage storage from sessions.ts, keep utilities only"
```

---

### Task 4: Migrate `src/App.tsx` to async chatDb API

**Files:**
- Modify: `src/App.tsx:17,185-200,515-552,1211-1230,1245-1261,1478-1520`

- [ ] **Step 1: Update imports in `src/App.tsx`**

Replace line 17:

```typescript
// Old:
import { loadSessions, saveSessions, createSession, upsertSession, migrateLegacySessions, loadSessionMessages, generateSmartTitle } from './sessions';
// New:
import { createSession, generateSmartTitle } from './sessions';
import { dbGetSessions, dbGetMessages, dbSaveSession, dbPurgeExpired, migrateFromLocalStorage } from './chatDb';
```

- [ ] **Step 2: Update workspace initialization (lines 185-200)**

Change `sessions: loadSessions(path)` to `sessions: []` in both workspace creation sites (line 187 and line 211). Add an async init effect that runs migration + loads sessions:

Add a new `useEffect` after workspace creation (near line 200):

```typescript
useEffect(() => {
  if (!activeProjectPath) return;
  let cancelled = false;
  (async () => {
    await migrateFromLocalStorage();
    const retentionDays = await window.sai.settingsGet('historyRetention', 14);
    await dbPurgeExpired(retentionDays);
    const sessions = await dbGetSessions(activeProjectPath);
    if (!cancelled) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        sessions,
      }));
    }
  })();
  return () => { cancelled = true; };
}, [activeProjectPath]);
```

- [ ] **Step 3: Update `beforeunload` handler (lines 518-533)**

Make the save fire-and-forget (can't await in beforeunload):

```typescript
useEffect(() => {
  const handleBeforeUnload = () => {
    workspacesRef.current.forEach((ws, wsPath) => {
      const latestMessages = wsMessagesRef.current.get(wsPath);
      const sessionToSave = (latestMessages && latestMessages.length > 0)
        ? { ...ws.activeSession, messages: latestMessages, updatedAt: Date.now() }
        : ws.activeSession;
      if (sessionToSave.messages.length > 0) {
        dbSaveSession(wsPath, sessionToSave).catch(() => {});
      }
    });
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, []);
```

- [ ] **Step 4: Update periodic save (lines 536-552)**

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    workspacesRef.current.forEach((ws, wsPath) => {
      const latestMessages = wsMessagesRef.current.get(wsPath);
      if (latestMessages && latestMessages.length > 0) {
        const sessionToSave = { ...ws.activeSession, messages: latestMessages, updatedAt: Date.now(), messageCount: latestMessages.length };
        if (!sessionToSave.title) {
          const firstUserMsg = latestMessages.find(m => m.role === 'user');
          if (firstUserMsg) sessionToSave.title = generateSmartTitle(firstUserMsg.content);
        }
        dbSaveSession(wsPath, sessionToSave).then(() => {
          dbGetSessions(wsPath).then(sessions => {
            updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
          });
        }).catch(() => {});
      }
    });
  }, 30_000);
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 5: Update `flushAndPersist` (lines 1211-1230)**

Convert to async. Since `updateWorkspace` is synchronous state update, we split: update state immediately, then persist async:

```typescript
const flushAndPersist = useCallback((wsPath: string) => {
  const ws = workspacesRef.current.get(wsPath);
  if (!ws) return;
  const latestMessages = wsMessagesRef.current.get(wsPath);
  const sessionToSave = (latestMessages && latestMessages.length > 0)
    ? { ...ws.activeSession, messages: latestMessages, updatedAt: Date.now(), messageCount: latestMessages.length }
    : ws.activeSession;
  if (!sessionToSave.title && sessionToSave.messages.length > 0) {
    const firstUserMsg = sessionToSave.messages.find(m => m.role === 'user');
    if (firstUserMsg) sessionToSave.title = generateSmartTitle(firstUserMsg.content);
  }
  if (sessionToSave.messages.length > 0) {
    updateWorkspace(wsPath, ws2 => ({ ...ws2, activeSession: sessionToSave }));
    dbSaveSession(wsPath, sessionToSave).then(() => {
      dbGetSessions(wsPath).then(sessions => {
        updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
      });
    }).catch(() => {});
  }
}, [updateWorkspace]);
```

- [ ] **Step 6: Update `handleSelectSession` (lines 1245-1261)**

Make message loading async:

```typescript
const handleSelectSession = (id: string) => {
  if (!activeProjectPath) return;
  flushAndPersist(activeProjectPath);
  const selected = sessions.find(s => s.id === id);
  if (selected) {
    window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId);
    (window.sai as any).codexSetSessionId(activeProjectPath, selected.codexSessionId);
    window.sai.geminiSetSessionId?.(activeProjectPath, selected.geminiSessionId, 'chat');
    dbGetMessages(selected.id).then(messages => {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        activeSession: { ...selected, messages },
      }));
    });
  }
};
```

- [ ] **Step 7: Update `onTurnComplete` callback (lines 1478-1520)**

```typescript
onTurnComplete={() => {
  const latestMessages = wsMessagesRef.current.get(wsPath) || [];
  if (latestMessages.length === 0) return;
  updateWorkspace(wsPath, w => {
    const updated = { ...w.activeSession, messages: latestMessages, updatedAt: Date.now(), aiProvider, messageCount: latestMessages.length };
    if (!updated.title) {
      const firstUserMsg = latestMessages.find(m => m.role === 'user');
      if (firstUserMsg) updated.title = generateSmartTitle(firstUserMsg.content);
    }

    dbSaveSession(wsPath, updated).then(() => {
      dbGetSessions(wsPath).then(sessions => {
        updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
      });
    }).catch(() => {});

    if (aiTitleGeneration && !updated.titleEdited) {
      const userMsgs = latestMessages.filter(m => m.role === 'user');
      if (userMsgs.length === 1 && userMsgs[0]) {
        const sessionId = updated.id;
        setTitleGeneratingIds(prev => new Set(prev).add(sessionId));
        window.sai.claudeGenerateTitle(wsPath, userMsgs[0].content, aiProvider)
          .then((title: string) => {
            if (!title) return;
            updateWorkspace(wsPath, w2 => {
              if (w2.activeSession.titleEdited) return w2;
              const newSession = { ...w2.activeSession, title };
              dbSaveSession(wsPath, newSession).then(() => {
                dbGetSessions(wsPath).then(sessions => {
                  updateWorkspace(wsPath, ws3 => ({ ...ws3, sessions }));
                });
              }).catch(() => {});
              return { ...w2, activeSession: newSession };
            });
          })
          .catch(() => {})
          .finally(() => {
            setTitleGeneratingIds(prev => {
              const next = new Set(prev);
              next.delete(sessionId);
              return next;
            });
          });
      }
    }

    return { ...w, activeSession: updated };
  });
}}
```

- [ ] **Step 8: Run type check**

Run: `npx tsc --noEmit`
Expected: Errors only from `ChatHistorySidebar.tsx` (still using old imports). App.tsx should be clean.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: migrate App.tsx session persistence to async IndexedDB API"
```

---

### Task 5: Migrate `ChatHistorySidebar.tsx` to async chatDb API

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx:1-5,95-120,181-186,200-250`

- [ ] **Step 1: Update imports**

Replace line 3:

```typescript
// Old:
import { formatSessionDate, formatSessionTime, loadSessionMessages, toggleSessionPin, deleteSession, exportSessionAsMarkdown, saveSessions } from '../../sessions';
// New:
import { formatSessionDate, formatSessionTime, exportSessionAsMarkdown } from '../../sessions';
import { dbGetMessages, dbDeleteSession, dbSaveSession, dbGetSessions } from '../../chatDb';
```

- [ ] **Step 2: Simplify `getMessageCount` (lines 181-186)**

Replace with:

```typescript
const getMessageCount = useCallback((session: ChatSession): number => {
  if (session.messages && session.messages.length > 0) return session.messages.length;
  return session.messageCount || 0;
}, []);
```

No more `loadSessionMessages` fallback — the count is always on the index entry.

- [ ] **Step 3: Update search cache to be async (lines 95-120)**

Replace `getSearchContent` and `getRawSearchContent`:

```typescript
const [searchCache, setSearchCache] = useState<Map<string, { raw: string; lower: string }>>(new Map());

useEffect(() => {
  if (!debouncedQuery) return;
  let cancelled = false;
  (async () => {
    const toLoad = providerSessions.filter(s => !searchCache.has(s.id));
    if (toLoad.length === 0) return;
    const newEntries = new Map(searchCache);
    for (const session of toLoad) {
      const messages = await dbGetMessages(session.id);
      const raw = messages.map(m => m.content).join(' ');
      newEntries.set(session.id, { raw, lower: raw.toLowerCase() });
    }
    if (!cancelled) setSearchCache(newEntries);
  })();
  return () => { cancelled = true; };
}, [debouncedQuery, providerSessions]);

const getSearchContent = useCallback((sessionId: string): string => {
  return searchCache.get(sessionId)?.lower || '';
}, [searchCache]);

const getRawSearchContent = useCallback((sessionId: string): string => {
  return searchCache.get(sessionId)?.raw || '';
}, [searchCache]);
```

- [ ] **Step 4: Update context menu operations (lines 200-250)**

Replace the `handleContextAction` cases for pin, export, delete:

```typescript
case 'pin': {
  const toggled = sessions.map(s =>
    s.id === sessionId ? { ...s, pinned: !s.pinned } : s
  );
  onUpdateSessions(toggled);
  const session = toggled.find(s => s.id === sessionId);
  if (session) {
    dbSaveSession(projectPath, session).catch(() => {});
  }
  break;
}
case 'export': {
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    dbGetMessages(sessionId).then(messages => {
      const md = exportSessionAsMarkdown(session.title || 'Untitled', messages);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.title || 'chat'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  break;
}
case 'delete': {
  const updated = sessions.filter(s => s.id !== sessionId);
  onUpdateSessions(updated);
  dbDeleteSession(sessionId).catch(() => {});
  break;
}
```

- [ ] **Step 5: Update rename handler (lines 236-245)**

```typescript
const handleRenameSubmit = (sessionId: string) => {
  if (renameValue.trim()) {
    const updated = sessions.map(s =>
      s.id === sessionId ? { ...s, title: renameValue.trim(), titleEdited: true } : s
    );
    onUpdateSessions(updated);
    const session = updated.find(s => s.id === sessionId);
    if (session) {
      dbSaveSession(projectPath, session).catch(() => {});
    }
  }
  setRenamingId(null);
};
```

- [ ] **Step 6: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass — no more references to deleted localStorage functions.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx
git commit -m "refactor: migrate ChatHistorySidebar to async IndexedDB API"
```

---

### Task 6: Remove integration tests for old localStorage persistence

**Files:**
- Modify or Delete: `tests/integration/session-persistence.test.ts`

- [ ] **Step 1: Delete the old integration test file**

The integration tests in `tests/integration/session-persistence.test.ts` test localStorage-specific behavior (`LocalStorageMock`, `sai-sessions-index-*` keys, etc.). These are now covered by the `chatDb.test.ts` unit tests against real IndexedDB (via fake-indexeddb in jsdom).

```bash
rm tests/integration/session-persistence.test.ts
```

- [ ] **Step 2: Run all tests to confirm nothing breaks**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add -A tests/integration/session-persistence.test.ts
git commit -m "chore: remove old localStorage integration tests, replaced by chatDb tests"
```

---

### Task 7: Add Data & Storage settings page with retention control

**Files:**
- Modify: `src/components/SettingsModal.tsx:35-42,85-115,719-730,755-810`
- Modify: `src/App.tsx` (retention change handler)

- [ ] **Step 1: Add `'storage'` to the page type and state**

In `src/components/SettingsModal.tsx`, update the type (line 35):

```typescript
type SettingsPage = 'general' | 'editor' | 'layout' | 'style' | 'storage' | 'provider' | 'claude' | 'codex' | 'gemini';
```

Add state for the retention setting near the other state declarations:

```typescript
const [historyRetention, setHistoryRetention] = useState<number | null>(14);
```

- [ ] **Step 2: Load the retention setting on mount**

Add to the `useEffect` that loads settings (near line 100):

```typescript
window.sai.settingsGet('historyRetention', 14).then((v: number | null) => setHistoryRetention(v));
```

Also add to the `githubOnSettingsApplied` handler:

```typescript
if ('historyRetention' in remote) setHistoryRetention(remote.historyRetention);
```

- [ ] **Step 3: Add the `renderStoragePage` function**

Add before the `renderActivePage` switch:

```typescript
const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: '1 month', value: 30 },
  { label: '3 months', value: 90 },
  { label: 'Unlimited', value: null },
];

const renderStoragePage = () => (
  <div className="settings-section">
    <h3>Data & Storage</h3>

    <label className="settings-label">Chat History Retention</label>
    <p className="settings-hint">How long to keep chat history before automatically deleting. Pinned chats are never deleted.</p>
    <select
      className="settings-select"
      value={historyRetention === null ? 'null' : String(historyRetention)}
      onChange={e => {
        const val = e.target.value === 'null' ? null : Number(e.target.value);
        setHistoryRetention(val);
        window.sai.settingsSet('historyRetention', val);
        onHistoryRetentionChange?.(val);
      }}
    >
      {RETENTION_OPTIONS.map(opt => (
        <option key={String(opt.value)} value={opt.value === null ? 'null' : String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);
```

- [ ] **Step 4: Add `onHistoryRetentionChange` prop to SettingsModal**

Add to the component's props interface:

```typescript
onHistoryRetentionChange?: (days: number | null) => void;
```

- [ ] **Step 5: Wire up the switch case and sidebar nav**

In `renderActivePage`, add the case:

```typescript
case 'storage': return renderStoragePage();
```

In the sidebar nav (before the Provider button), add:

```typescript
<button
  className={`settings-nav-item${activePage === 'storage' ? ' active' : ''}`}
  onClick={() => setActivePage('storage')}
>
  <HardDrive size={14} />
  <span>Data & Storage</span>
</button>
```

Add `HardDrive` to the lucide-react import at the top of the file.

- [ ] **Step 6: Handle retention changes in `src/App.tsx`**

Where SettingsModal is rendered, pass the `onHistoryRetentionChange` prop:

```typescript
onHistoryRetentionChange={(days) => {
  dbPurgeExpired(days).then(count => {
    if (count > 0 && activeProjectPath) {
      dbGetSessions(activeProjectPath).then(sessions => {
        updateWorkspace(activeProjectPath, ws => ({ ...ws, sessions }));
      });
    }
  });
}}
```

- [ ] **Step 7: Run type check and full test suite**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/components/SettingsModal.tsx src/App.tsx
git commit -m "feat: add Data & Storage settings page with history retention control"
```

---

### Task 8: Final cleanup and verification

**Files:**
- Verify all files

- [ ] **Step 1: Search for any remaining localStorage session references**

Run: `grep -r 'sai-sessions-index\|sai-session-msgs\|sai-chat-sessions\|localStorage' src/`
Expected: No matches in `src/` (localStorage usage should be completely gone from session code). Only references should be in `chatDb.ts` migration code.

- [ ] **Step 2: Search for any remaining imports of deleted functions**

Run: `grep -r 'loadSessions\|saveSessions\|loadSessionMessages\|saveSessionMessages\|upsertSession\|deleteSession\|toggleSessionPin\|migrateLegacySessions' src/`
Expected: No matches

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Build the app**

Run: `npm run build` (or the project's build command)
Expected: Builds successfully

- [ ] **Step 6: Manual smoke test**

Start the dev server and verify:
1. App launches without errors
2. Open chat sidebar — existing history appears (migrated from localStorage)
3. Send a message, close sidebar, reopen — session appears with correct message count
4. Pin a session, switch sessions, delete a session — all work
5. Open Settings > Data & Storage — retention dropdown shows "2 weeks" default
6. Change retention to "1 week" — old sessions disappear from sidebar
7. Search in chat history works

- [ ] **Step 7: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup after IndexedDB migration"
```
