// Port of src/components/Chat/githubWatcher.ts, narrowed for the PWA which
// only sees rendered assistant text (tool calls are separate messages whose
// text is also scanned). No polling lives here — snapshots are relayed by
// the desktop watcher over the bus.

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
