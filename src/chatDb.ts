import type { ChatSession, ChatMessage } from '@/types';

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
    request.onerror = () => reject(request.error);
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
  if (retentionDays === null) return 0;

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
