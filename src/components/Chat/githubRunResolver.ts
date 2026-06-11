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

export interface WatchRunInput {
  url?: string;
  owner?: string;
  repo?: string;
  run_id?: string | number;
  branch?: string;
  workflow?: string;
}

export interface ResolvedRun {
  owner: string;
  repo: string;
  runId: string;
  url: string;
  status?: string;
  conclusion?: string | null;
  displayTitle?: string;
}

/** Matches window.sai.githubApiGet (electron/preload.ts). */
export type GitHubApiGet = (path: string) => Promise<{ ok: boolean; status: number; body: any }>;

const BRANCH_RETRY_MS = 3000;
const BRANCH_TIMEOUT_MS = 30000;

async function describeRun(
  owner: string, repo: string, runId: string, apiGet: GitHubApiGet | undefined,
): Promise<ResolvedRun> {
  const url = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  if (!apiGet) return { owner, repo, runId, url };
  const r = await apiGet(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  if (!r.ok) throw new Error(`run ${runId} not found in ${owner}/${repo} (HTTP ${r.status})`);
  return {
    owner, repo, runId,
    url: typeof r.body?.html_url === 'string' ? r.body.html_url : url,
    status: r.body?.status,
    conclusion: r.body?.conclusion ?? null,
    displayTitle: r.body?.display_title || r.body?.name,
  };
}

function matchesWorkflow(run: any, workflow?: string): boolean {
  if (!workflow) return true;
  const w = workflow.toLowerCase();
  const path = typeof run?.path === 'string' ? run.path.toLowerCase() : '';
  const base = path.split('/').pop() ?? '';
  const name = typeof run?.name === 'string' ? run.name.toLowerCase() : '';
  return w === path || w === base || w === name;
}

async function findBranchRun(
  owner: string, repo: string, branch: string, workflow: string | undefined, apiGet: GitHubApiGet,
): Promise<ResolvedRun | null> {
  const r = await apiGet(`/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
  if (!r.ok) throw new Error(`could not list runs for ${owner}/${repo}@${branch} (HTTP ${r.status})`);
  const runs: any[] = Array.isArray(r.body?.workflow_runs) ? r.body.workflow_runs : [];
  const run = runs.find((x) => matchesWorkflow(x, workflow));
  if (!run) return null;
  return {
    owner, repo, runId: String(run.id),
    url: typeof run.html_url === 'string' ? run.html_url : `https://github.com/${owner}/${repo}/actions/runs/${run.id}`,
    status: run.status,
    conclusion: run.conclusion ?? null,
    displayTitle: run.display_title || run.name,
  };
}

export async function resolveWatchRun(
  input: WatchRunInput,
  apiGet: GitHubApiGet | undefined,
  opts: { retryMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ResolvedRun> {
  const retryMs = opts.retryMs ?? BRANCH_RETRY_MS;
  const timeoutMs = opts.timeoutMs ?? BRANCH_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));

  if (typeof input.url === 'string' && input.url.length > 0) {
    const t = parseRunUrl(input.url);
    if (!t) throw new Error(`not a GitHub Actions run URL: ${input.url}`);
    if (t.owner === 'fake') {
      return { owner: t.owner, repo: t.repo, runId: t.runId, url: t.url, status: 'in_progress' };
    }
    return describeRun(t.owner, t.repo, t.runId, apiGet);
  }

  const owner = typeof input.owner === 'string' ? input.owner : '';
  const repo = typeof input.repo === 'string' ? input.repo : '';

  if (input.run_id !== undefined && input.run_id !== null && `${input.run_id}`.length > 0) {
    if (!owner || !repo) throw new Error('run_id requires owner and repo');
    return describeRun(owner, repo, String(input.run_id), apiGet);
  }

  if (typeof input.branch === 'string' && input.branch.length > 0) {
    if (!owner || !repo) throw new Error('branch requires owner and repo');
    if (!apiGet) throw new Error('GitHub API unavailable — connect GitHub in SAI settings');
    // Right after a push, GitHub may not have created the run yet — poll briefly.
    const attempts = Math.max(1, Math.ceil(timeoutMs / retryMs));
    for (let i = 0; i < attempts; i++) {
      const run = await findBranchRun(owner, repo, input.branch, input.workflow, apiGet);
      if (run) return run;
      if (i < attempts - 1) await sleep(retryMs);
    }
    throw new Error(`no run found for ${owner}/${repo}@${input.branch}`);
  }

  throw new Error('watch_github_run requires url, run_id, or branch');
}
