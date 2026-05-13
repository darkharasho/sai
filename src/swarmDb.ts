import type { SwarmTask, SwarmApproval } from './types';

const DB_NAME = 'sai-swarm';
const DB_VERSION = 1;
const TASKS = 'swarm_tasks';
const APPR = 'swarm_approvals';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains(TASKS)) {
        const s = d.createObjectStore(TASKS, { keyPath: 'id' });
        s.createIndex('workspaceId', 'workspaceId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!d.objectStoreNames.contains(APPR)) {
        const s = d.createObjectStore(APPR, { keyPath: 'id' });
        s.createIndex('workspaceId', 'workspaceId', { unique: false });
        s.createIndex('taskId', 'taskId', { unique: false });
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

/** Initialise (or no-op if already open). */
export async function swarmInit(): Promise<void> {
  await openDb();
}

/** Close and delete the database. Used in tests and for full resets. */
export async function swarmClearDb(): Promise<void> {
  if (dbPromise) {
    const d = await dbPromise;
    d.close();
    dbPromise = null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbReq<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function swarmCreateTask(t: SwarmTask): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TASKS, 'readwrite');
    tx.objectStore(TASKS).put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function swarmGetTask(id: string): Promise<SwarmTask | undefined> {
  const db = await openDb();
  const tx = db.transaction(TASKS, 'readonly');
  return idbReq(tx.objectStore(TASKS).get(id)) as Promise<SwarmTask | undefined>;
}

export async function swarmGetTasks(workspaceId: string): Promise<SwarmTask[]> {
  const db = await openDb();
  const tx = db.transaction(TASKS, 'readonly');
  const idx = tx.objectStore(TASKS).index('workspaceId');
  return idbReq(idx.getAll(IDBKeyRange.only(workspaceId)));
}

export async function swarmUpdateTask(id: string, patch: Partial<SwarmTask>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TASKS, 'readwrite');
    const store = tx.objectStore(TASKS);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const cur = getReq.result as SwarmTask | undefined;
      if (!cur) {
        // Task not found — resolve without writing (same behaviour as before)
        resolve();
        return;
      }
      store.put({ ...cur, ...patch, lastActivityAt: Date.now() });
    };
    getReq.onerror = () => reject(getReq.error);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function swarmDeleteTask(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TASKS, 'readwrite');
    tx.objectStore(TASKS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function swarmCreateApproval(a: SwarmApproval): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APPR, 'readwrite');
    tx.objectStore(APPR).put(a);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function swarmGetApprovals(workspaceId: string): Promise<SwarmApproval[]> {
  const db = await openDb();
  const tx = db.transaction(APPR, 'readonly');
  const idx = tx.objectStore(APPR).index('workspaceId');
  return idbReq(idx.getAll(IDBKeyRange.only(workspaceId)));
}

export async function swarmResolveApproval(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APPR, 'readwrite');
    tx.objectStore(APPR).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
