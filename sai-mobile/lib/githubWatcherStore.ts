// In-memory mirror of the desktop watcher's snapshots, populated by
// github.watcher events forwarded from the bridge. Keyed by
// `${messageId} ${url}` (matches the bridge's replay key). Mirrors
// src/renderer-remote/chat/githubWatcherStore.ts.

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

// Module-level singleton so callers don't need to thread a store reference
// through every level of the component tree.
export const githubWatcherStore = createGithubWatcherStore();

// ---- Target detection (port of src/renderer-remote/chat/githubWatcher.ts) ----

export interface GitHubWatchTarget {
  kind: 'run';
  owner: string;
  repo: string;
  runId: string;
  url: string;
}

const RUN_URL_RE = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/(\d+)/g;
const FAKE_RUN_RE = /sai:\/\/fake-run\/([^\s)"'<]+)/g;

export function detectWatchTargets(text: string): GitHubWatchTarget[] {
  if (!text) return [];
  const found = new Map<string, GitHubWatchTarget>();
  for (const m of text.matchAll(RUN_URL_RE)) {
    const t: GitHubWatchTarget = { kind: 'run', owner: m[1], repo: m[2], runId: m[3], url: m[0] };
    if (!found.has(t.url)) found.set(t.url, t);
  }
  for (const m of text.matchAll(FAKE_RUN_RE)) {
    const url = m[0];
    if (!found.has(url)) {
      found.set(url, { kind: 'run', owner: 'fake', repo: 'fake', runId: m[1].split('?')[0], url });
    }
  }
  return Array.from(found.values());
}
