/**
 * Per-session transcript cache in IndexedDB.
 *
 * Gives the chat view something to render immediately on mount or after a
 * reload, instead of an empty pane while the WebSocket reconnects and the
 * server replays `session.history`. The cache is best-effort: any IDB
 * failure resolves silently to a no-op so callers can treat it as a hint,
 * not a source of truth. The server's history reply always wins.
 *
 * Storage: one record per sessionId. Records track `savedAt` so callers can
 * prune old sessions if the store ever grows uncomfortable; we don't auto-evict
 * here because session counts are bounded by user actions.
 */

const DB_NAME = 'sai-remote';
const DB_VERSION = 1;
const STORE = 'transcripts';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

interface CacheRecord<T> { sessionId: string; messages: T[]; savedAt: number }

export async function loadTranscript<T>(sessionId: string): Promise<T[] | null> {
  if (!sessionId) return null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sessionId);
      req.onsuccess = () => {
        const rec = req.result as CacheRecord<T> | undefined;
        resolve(rec && Array.isArray(rec.messages) ? rec.messages : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function saveTranscript<T>(sessionId: string, messages: T[]): Promise<void> {
  if (!sessionId) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ sessionId, messages, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

export async function clearTranscript(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
