import type { ChatSession, ChatMessage } from './types';

const DB_NAME = 'sai-chat';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('projectPath', 'projectPath', { unique: false });
        sessions.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'sessionId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open blocked by another connection'));
    };
  });

  return dbPromise;
}

export async function dbGetSessions(projectPath: string): Promise<ChatSession[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const index = store.index('projectPath');
    const request = index.getAll(projectPath);

    request.onsuccess = () => {
      const sessions: ChatSession[] = request.result;
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function dbGetMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const request = store.get(sessionId);

    request.onsuccess = () => {
      resolve(request.result?.messages ?? []);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function dbSaveSession(projectPath: string, session: ChatSession): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'messages'], 'readwrite');

    // Store session metadata without messages
    const sessionData = {
      ...session,
      messages: [],
      messageCount: session.messages.length,
      projectPath,
    };
    tx.objectStore('sessions').put(sessionData);

    // Store messages separately
    tx.objectStore('messages').put({
      sessionId: session.id,
      messages: session.messages,
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDeleteSession(sessionId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'messages'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);
    tx.objectStore('messages').delete(sessionId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbPurgeExpired(retentionDays: number | null): Promise<number> {
  if (retentionDays === null || retentionDays <= 0) return 0;

  const db = await openDb();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'messages'], 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.openCursor();
    let deleted = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return; // transaction will complete

      const session = cursor.value as ChatSession & { projectPath: string };
      if (!session.pinned && session.updatedAt < cutoff) {
        cursor.delete();
        tx.objectStore('messages').delete(session.id);
        deleted++;
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
  });
}

let migrated = false;

export function _resetMigrationFlag(): void {
  migrated = false;
}

export async function migrateFromLocalStorage(): Promise<void> {
  if (migrated) return;
  migrated = true;

  try {
    const keysToRemove: string[] = [];
    const saves: Array<{ projectPath: string; session: ChatSession }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Current format: sai-sessions-index-{projectPath}
      if (key.startsWith('sai-sessions-index-')) {
        const projectPath = key.slice('sai-sessions-index-'.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const sessions: ChatSession[] = JSON.parse(raw);
        keysToRemove.push(key);

        for (const session of sessions) {
          const msgKey = `sai-session-msgs-${session.id}`;
          const msgRaw = localStorage.getItem(msgKey);
          const messages: ChatMessage[] = msgRaw ? JSON.parse(msgRaw) : [];
          keysToRemove.push(msgKey);
          saves.push({ projectPath, session: { ...session, messages } });
        }
        continue;
      }

      // Legacy single-key format: sai-chat-sessions (exact match)
      if (key === 'sai-chat-sessions') {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const sessions: ChatSession[] = JSON.parse(raw);
        keysToRemove.push(key);

        for (const session of sessions) {
          saves.push({ projectPath: '', session });
        }
        continue;
      }

      // Old per-path format: sai-chat-sessions-{projectPath}
      if (key.startsWith('sai-chat-sessions-')) {
        const projectPath = key.slice('sai-chat-sessions-'.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const sessions: ChatSession[] = JSON.parse(raw);
        keysToRemove.push(key);

        for (const session of sessions) {
          saves.push({ projectPath, session });
        }
        continue;
      }
    }

    // Write all to IndexedDB
    for (const { projectPath, session } of saves) {
      await dbSaveSession(projectPath, session);
    }

    // Remove localStorage keys only after successful writes
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn('migrateFromLocalStorage failed:', error);
    migrated = false;
  }
}

export async function clearDb(): Promise<void> {
  // Close existing connection so we can delete the DB
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
