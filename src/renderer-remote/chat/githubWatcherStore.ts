// In-memory mirror of the desktop watcher's snapshots, populated by
// github.watcher events forwarded from the bridge. Keyed by
// `${messageId} ${url}` (matches the bridge's replay key).

export interface GithubWatcherSnapshotShape {
  url: string;
  kind: 'run';
  phase: 'pending' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'neutral' | 'error';
  capturedAt: number;
  data: Record<string, unknown>;
}

type Sub = (key: string, snap: GithubWatcherSnapshotShape | undefined) => void;

export interface GithubWatcherStore {
  get(messageId: string, url: string): GithubWatcherSnapshotShape | undefined;
  set(messageId: string, url: string, snap: GithubWatcherSnapshotShape): void;
  subscribe(fn: Sub): () => void;
}

export function createGithubWatcherStore(): GithubWatcherStore {
  const map = new Map<string, GithubWatcherSnapshotShape>();
  const subs = new Set<Sub>();
  const k = (messageId: string, url: string) => `${messageId} ${url}`;
  return {
    get: (m, u) => map.get(k(m, u)),
    set: (m, u, snap) => {
      map.set(k(m, u), snap);
      for (const fn of subs) { try { fn(k(m, u), snap); } catch { /* isolate */ } }
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
