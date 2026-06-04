import type { ChatMessage, ToolCall } from '../../types';

export interface GitHubWatchTarget {
  kind: 'run';
  owner: string;
  repo: string;
  runId: string;
  url: string;
}

const RUN_URL_RE = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/(\d+)/g;
// Dev-only scripted URLs: sai://fake-run/<id>[?outcome=success|failure|cancelled&speed=fast|slow]
// bypass the network and run a scripted timeline.
const FAKE_RUN_RE = /sai:\/\/fake-run\/([^\s)"'<]+)/g;
const GH_RUN_VIEW_RE = /\bgh\s+run\s+view\s+(\d+)(?:[\s\S]*?--repo\s+([^/\s]+)\/(\S+))?/;

function scanFake(hay: string, out: Map<string, GitHubWatchTarget>): void {
  for (const m of hay.matchAll(FAKE_RUN_RE)) {
    const t: GitHubWatchTarget = { kind: 'run', owner: 'fake', repo: 'fake', runId: m[1].split('?')[0], url: m[0] };
    if (!out.has(t.url)) out.set(t.url, t);
  }
}

function scanText(hay: string, out: Map<string, GitHubWatchTarget>): void {
  for (const m of hay.matchAll(RUN_URL_RE)) {
    const t: GitHubWatchTarget = { kind: 'run', owner: m[1], repo: m[2], runId: m[3], url: m[0] };
    if (!out.has(t.url)) out.set(t.url, t);
  }
}

// Commands that create or trigger workflow runs — only these should produce watcher cards.
const MUTATION_RE = /\b(git\s+push|git\s+tag|gh\s+workflow\s+run|gh\s+pr\s+create|npm\s+publish)\b/;
// Commands that only query run status — never produce watcher cards from their output.
const QUERY_RE = /\b(gh\s+run\s+(list|view|watch)|gh\s+api\b)/;

function scanToolCall(tc: ToolCall, out: Map<string, GitHubWatchTarget>): void {
  const input = tc.input || '';
  const output = tc.output || '';

  if (tc.type === 'terminal_command') {
    // For terminal commands, only scan output for action URLs when the command
    // is a mutation (push, tag, workflow run). Query commands (gh run list/view)
    // return existing run URLs that shouldn't spawn watcher cards.
    const isMutation = MUTATION_RE.test(input);
    const isQuery = QUERY_RE.test(input);
    if (isMutation && !isQuery) {
      scanText(output, out);
    }
    // Also support explicit `gh run view <id> --repo owner/repo`
    const runCli = input.match(GH_RUN_VIEW_RE);
    if (runCli && runCli[2] && runCli[3] && isMutation) {
      const url = `https://github.com/${runCli[2]}/${runCli[3]}/actions/runs/${runCli[1]}`;
      if (!out.has(url)) out.set(url, { kind: 'run', owner: runCli[2], repo: runCli[3], runId: runCli[1], url });
    }
  } else {
    // Non-terminal tool calls (e.g. WebFetch) — scan both input and output
    scanText(`${input}\n${output}`, out);
  }
}

export function detectWatchTargets(message: Pick<ChatMessage, 'role' | 'content' | 'toolCalls'>): GitHubWatchTarget[] {
  const found = new Map<string, GitHubWatchTarget>();
  if (message.role === 'assistant' && message.content) scanText(message.content, found);
  for (const tc of message.toolCalls || []) scanToolCall(tc, found);
  if (import.meta.env.DEV && message.content) scanFake(message.content, found);
  return Array.from(found.values());
}
