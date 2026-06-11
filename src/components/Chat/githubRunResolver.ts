import type { ChatMessage, ToolCall } from '../../types';

export interface GitHubWatchTarget {
  kind: 'run';
  owner: string;
  repo: string;
  runId: string;
  url: string;
}

const RUN_URL_RE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/(\d+)/;
// Dev-only scripted URLs: sai://fake-run/<id>[?outcome=success|failure|cancelled&speed=fast|slow]
// bypass the network and run a scripted timeline inside GitHubWatcherCard.
const FAKE_RUN_RE = /^sai:\/\/fake-run\/([^\s)"'<]+)/;

export function parseRunUrl(url: string): GitHubWatchTarget | null {
  const fake = url.match(FAKE_RUN_RE);
  if (fake) return { kind: 'run', owner: 'fake', repo: 'fake', runId: fake[1].split('?')[0], url };
  const m = url.match(RUN_URL_RE);
  if (!m) return null;
  return { kind: 'run', owner: m[1], repo: m[2], runId: m[3], url: m[0] };
}

// Matches both the bare tool name (live dispatch) and MCP-prefixed names
// (mcp__swarm__sai_watch_github_run) seen on persisted tool calls.
function isWatchToolCall(name: string): boolean {
  return name === 'watch_github_run' || name.endsWith('sai_watch_github_run');
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function targetFromJson(raw: unknown): GitHubWatchTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.url !== 'string') return null;
  if (typeof o.owner === 'string' && typeof o.repo === 'string' &&
      (typeof o.runId === 'string' || typeof o.runId === 'number')) {
    return { kind: 'run', owner: o.owner, repo: o.repo, runId: String(o.runId), url: o.url };
  }
  return parseRunUrl(o.url);
}

export function watchTargetFromToolCall(
  tc: Pick<ToolCall, 'name' | 'input' | 'output'>,
): GitHubWatchTarget | null {
  if (!isWatchToolCall(tc.name || '')) return null;
  // Prefer the resolved tool result; fall back to the input url (covers a call
  // still in flight, or one that errored after the model passed an explicit url).
  return targetFromJson(parseJson(tc.output)) ?? targetFromJson(parseJson(tc.input));
}

export function watchTargetsFromMessage(
  message: Pick<ChatMessage, 'toolCalls'>,
): GitHubWatchTarget[] {
  const found = new Map<string, GitHubWatchTarget>();
  for (const tc of message.toolCalls || []) {
    const t = watchTargetFromToolCall(tc);
    if (t && !found.has(t.url)) found.set(t.url, t);
  }
  return Array.from(found.values());
}
