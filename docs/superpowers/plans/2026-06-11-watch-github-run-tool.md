# `watch_github_run` MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex URL-detection that spawns the GitHub Actions watcher card with an explicit `watch_github_run` SAI MCP tool.

**Architecture:** A new pure module `githubRunResolver.ts` owns run resolution (URL parse, explicit run id, branch → newest run with retry) and tool-call → watch-target extraction. The live MCP bridge in `App.tsx` resolves and returns run JSON immediately. ChatMessage/ChatPanel keep their existing watcher row, allowlist dedupe, and snapshot persistence, but derive targets from `watch_github_run` tool calls instead of scanning text. Both `githubWatcher.ts` detection files are deleted.

**Tech Stack:** TypeScript, React, Vitest (config already caps workers at 2 — do not raise it).

**Spec:** `docs/superpowers/specs/2026-06-11-github-actions-watch-tool-design.md`

---

### Task 1: Resolver module — types, `parseRunUrl`, `watchTargetsFromMessage`

**Files:**
- Create: `src/components/Chat/githubRunResolver.ts`
- Test: `tests/unit/components/Chat/githubRunResolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/Chat/githubRunResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseRunUrl,
  watchTargetFromToolCall,
  watchTargetsFromMessage,
} from '../../../../src/components/Chat/githubRunResolver';

describe('parseRunUrl', () => {
  it('parses a real run URL', () => {
    expect(parseRunUrl('https://github.com/darkharasho/sai/actions/runs/123456')).toEqual({
      kind: 'run', owner: 'darkharasho', repo: 'sai', runId: '123456',
      url: 'https://github.com/darkharasho/sai/actions/runs/123456',
    });
  });

  it('strips trailing path segments like /job/789', () => {
    const t = parseRunUrl('https://github.com/o/r/actions/runs/42/job/789');
    expect(t).toMatchObject({ owner: 'o', repo: 'r', runId: '42' });
    expect(t!.url).toBe('https://github.com/o/r/actions/runs/42');
  });

  it('parses dev fake-run URLs', () => {
    expect(parseRunUrl('sai://fake-run/demo1?outcome=failure&speed=fast')).toEqual({
      kind: 'run', owner: 'fake', repo: 'fake', runId: 'demo1',
      url: 'sai://fake-run/demo1?outcome=failure&speed=fast',
    });
  });

  it('rejects non-run URLs', () => {
    expect(parseRunUrl('https://github.com/o/r/pull/5')).toBeNull();
    expect(parseRunUrl('not a url')).toBeNull();
  });
});

describe('watchTargetFromToolCall', () => {
  it('ignores tool calls with other names', () => {
    expect(watchTargetFromToolCall({ name: 'sai_render_html', input: '{}', output: '{}' })).toBeNull();
  });

  it('builds a target from the resolved tool output (MCP-prefixed name)', () => {
    const out = JSON.stringify({
      owner: 'o', repo: 'r', runId: '99',
      url: 'https://github.com/o/r/actions/runs/99', status: 'in_progress',
    });
    expect(watchTargetFromToolCall({
      name: 'mcp__swarm__sai_watch_github_run',
      input: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }),
      output: out,
    })).toEqual({
      kind: 'run', owner: 'o', repo: 'r', runId: '99',
      url: 'https://github.com/o/r/actions/runs/99',
    });
  });

  it('falls back to parsing the input url when there is no output yet', () => {
    expect(watchTargetFromToolCall({
      name: 'mcp__swarm__sai_watch_github_run',
      input: JSON.stringify({ url: 'https://github.com/o/r/actions/runs/7' }),
      output: undefined,
    })).toMatchObject({ owner: 'o', repo: 'r', runId: '7' });
  });

  it('returns null for branch-mode input with no output yet', () => {
    expect(watchTargetFromToolCall({
      name: 'sai_watch_github_run',
      input: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }),
      output: undefined,
    })).toBeNull();
  });

  it('tolerates unparseable output by falling back to input', () => {
    expect(watchTargetFromToolCall({
      name: 'sai_watch_github_run',
      input: JSON.stringify({ url: 'https://github.com/o/r/actions/runs/7' }),
      output: 'Error: kaboom',
    })).toMatchObject({ runId: '7' });
  });
});

describe('watchTargetsFromMessage', () => {
  it('collects targets from watch tool calls, deduped by url', () => {
    const out = JSON.stringify({ owner: 'o', repo: 'r', runId: '5', url: 'https://github.com/o/r/actions/runs/5' });
    const tc = { id: 'a', type: 'mcp' as const, name: 'mcp__swarm__sai_watch_github_run', input: '{}', output: out };
    const msg = { toolCalls: [tc, { ...tc, id: 'b' }] };
    const targets = watchTargetsFromMessage(msg);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ owner: 'o', repo: 'r', runId: '5' });
  });

  it('returns [] for messages without watch tool calls', () => {
    expect(watchTargetsFromMessage({ toolCalls: [] })).toEqual([]);
    expect(watchTargetsFromMessage({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/components/Chat/githubRunResolver.test.ts`
Expected: FAIL — cannot resolve `src/components/Chat/githubRunResolver`.

- [ ] **Step 3: Write the implementation**

Create `src/components/Chat/githubRunResolver.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/components/Chat/githubRunResolver.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/githubRunResolver.ts tests/unit/components/Chat/githubRunResolver.test.ts
git commit -m "feat(github): run resolver module — url parse + tool-call watch targets"
```

---

### Task 2: Resolver module — async `resolveWatchRun`

**Files:**
- Modify: `src/components/Chat/githubRunResolver.ts`
- Test: `tests/unit/components/Chat/githubRunResolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/components/Chat/githubRunResolver.test.ts` (add `vi` and `resolveWatchRun` to the existing imports):

```ts
import { resolveWatchRun, type GitHubApiGet } from '../../../../src/components/Chat/githubRunResolver';
import { vi } from 'vitest';

describe('resolveWatchRun', () => {
  const noSleep = () => Promise.resolve();

  it('url mode: fetches run details', async () => {
    const apiGet: GitHubApiGet = vi.fn(async () => ({
      ok: true, status: 200,
      body: { id: 123, status: 'in_progress', conclusion: null, display_title: 'release v1', html_url: 'https://github.com/o/r/actions/runs/123' },
    }));
    const r = await resolveWatchRun({ url: 'https://github.com/o/r/actions/runs/123' }, apiGet);
    expect(apiGet).toHaveBeenCalledWith('/repos/o/r/actions/runs/123');
    expect(r).toEqual({
      owner: 'o', repo: 'r', runId: '123', url: 'https://github.com/o/r/actions/runs/123',
      status: 'in_progress', conclusion: null, displayTitle: 'release v1',
    });
  });

  it('url mode: fake runs short-circuit without the network', async () => {
    const apiGet = vi.fn();
    const r = await resolveWatchRun({ url: 'sai://fake-run/x?outcome=success' }, apiGet as unknown as GitHubApiGet);
    expect(apiGet).not.toHaveBeenCalled();
    expect(r).toMatchObject({ owner: 'fake', repo: 'fake', runId: 'x', status: 'in_progress' });
  });

  it('url mode: still resolves coordinates when no apiGet is available', async () => {
    const r = await resolveWatchRun({ url: 'https://github.com/o/r/actions/runs/9' }, undefined);
    expect(r).toMatchObject({ owner: 'o', repo: 'r', runId: '9' });
  });

  it('run_id mode: 404 rejects with a useful message', async () => {
    const apiGet: GitHubApiGet = async () => ({ ok: false, status: 404, body: null });
    await expect(resolveWatchRun({ owner: 'o', repo: 'r', run_id: '404404' }, apiGet))
      .rejects.toThrow(/404404.*o\/r.*404/);
  });

  it('run_id mode: requires owner and repo', async () => {
    await expect(resolveWatchRun({ run_id: '1' }, undefined)).rejects.toThrow(/owner and repo/);
  });

  it('branch mode: picks the newest run, filtered by workflow file name', async () => {
    const apiGet: GitHubApiGet = vi.fn(async () => ({
      ok: true, status: 200,
      body: { workflow_runs: [
        { id: 2, path: '.github/workflows/lint.yml', name: 'Lint', status: 'queued', conclusion: null, html_url: 'https://github.com/o/r/actions/runs/2' },
        { id: 1, path: '.github/workflows/release.yml', name: 'Release', status: 'in_progress', conclusion: null, display_title: 'v2', html_url: 'https://github.com/o/r/actions/runs/1' },
      ] },
    }));
    const r = await resolveWatchRun(
      { owner: 'o', repo: 'r', branch: 'main', workflow: 'release.yml' },
      apiGet, { sleep: noSleep },
    );
    expect(apiGet).toHaveBeenCalledWith('/repos/o/r/actions/runs?branch=main&per_page=5');
    expect(r).toMatchObject({ runId: '1', displayTitle: 'v2', status: 'in_progress' });
  });

  it('branch mode: retries while the run list is empty, then succeeds', async () => {
    const empty = { ok: true, status: 200, body: { workflow_runs: [] } };
    const hit = { ok: true, status: 200, body: { workflow_runs: [
      { id: 5, path: '.github/workflows/ci.yml', name: 'CI', status: 'queued', conclusion: null, html_url: 'https://github.com/o/r/actions/runs/5' },
    ] } };
    const apiGet = vi.fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(hit);
    const sleep = vi.fn(noSleep);
    const r = await resolveWatchRun(
      { owner: 'o', repo: 'r', branch: 'main' },
      apiGet as unknown as GitHubApiGet,
      { retryMs: 10, timeoutMs: 100, sleep },
    );
    expect(r).toMatchObject({ runId: '5' });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('branch mode: gives up after the timeout window', async () => {
    const apiGet: GitHubApiGet = async () => ({ ok: true, status: 200, body: { workflow_runs: [] } });
    await expect(resolveWatchRun(
      { owner: 'o', repo: 'r', branch: 'main' },
      apiGet, { retryMs: 10, timeoutMs: 30, sleep: noSleep },
    )).rejects.toThrow(/no run found/);
  });

  it('branch mode: requires apiGet (GitHub auth)', async () => {
    await expect(resolveWatchRun({ owner: 'o', repo: 'r', branch: 'main' }, undefined))
      .rejects.toThrow(/GitHub API unavailable/);
  });

  it('rejects when no identifying input is given', async () => {
    await expect(resolveWatchRun({}, undefined)).rejects.toThrow(/url, run_id, or branch/);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run --project unit tests/unit/components/Chat/githubRunResolver.test.ts`
Expected: FAIL — `resolveWatchRun` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/components/Chat/githubRunResolver.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/components/Chat/githubRunResolver.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/githubRunResolver.ts tests/unit/components/Chat/githubRunResolver.test.ts
git commit -m "feat(github): resolveWatchRun — url/run_id/branch resolution with retry"
```

---

### Task 3: Register the tool schema

**Files:**
- Modify: `src/lib/saiTools.ts` (append to `SAI_TOOL_SCHEMA`, before the closing `];`)

- [ ] **Step 1: Add the schema entry**

In `src/lib/saiTools.ts`, after the `capture_app` entry (the last one, ends at the `},` before `];` around line 264), insert:

```ts
  {
    name: 'watch_github_run',
    description:
      'Show a live GitHub Actions watcher card for a workflow run. USE THIS right after you push, tag, or ' +
      'trigger a workflow (git push, gh workflow run, gh pr create, npm publish) so the user can watch CI ' +
      'progress. Returns immediately with the resolved run; the card keeps updating on its own. Identify ' +
      'the run by `url`, by `owner`+`repo`+`run_id`, or by `owner`+`repo`+`branch` (resolves the newest ' +
      'run, waiting briefly if it has not been created yet). Call again with the same target to get ' +
      'current status.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full run URL: https://github.com/{owner}/{repo}/actions/runs/{id}.' },
        owner: { type: 'string', description: 'Repo owner (with run_id or branch).' },
        repo: { type: 'string', description: 'Repo name (with run_id or branch).' },
        run_id: { type: 'string', description: 'Explicit run id (requires owner and repo).' },
        branch: { type: 'string', description: 'Resolve the newest run on this branch (requires owner and repo).' },
        workflow: { type: 'string', description: "Optional workflow filter for branch mode: file name ('release.yml') or workflow name." },
      },
    },
  },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/saiTools.ts
git commit -m "feat(github): register watch_github_run in SAI_TOOL_SCHEMA"
```

---

### Task 4: Live dispatch branch in App.tsx

**Files:**
- Modify: `src/App.tsx` (the `onSwarmToolRequest` handler, around line 1434–1450)

- [ ] **Step 1: Add the import**

Near the other render imports at the top of `src/App.tsx` (next to `import { handleRenderToolRequest } from './render/handleRenderToolRequest';`, line ~57), add:

```ts
import { resolveWatchRun } from './components/Chat/githubRunResolver';
```

- [ ] **Step 2: Add the dispatch branch**

Inside the `sai.onSwarmToolRequest((req…) => {` callback, immediately after the `inspect_element`/`capture_app` branch (its `return;` is around line 1447) and before the `render_mermaid` branch, insert:

```ts
      if (req.tool === 'watch_github_run') {
        const saiAny = sai as { githubApiGet?: (p: string) => Promise<{ ok: boolean; status: number; body: any }> };
        void resolveWatchRun(req.input ?? {}, saiAny.githubApiGet).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

(`respondSwarmToolError` flows back through `swarm-mcp-server.ts` `tools/call` as an `isError` text result, so SAI sees resolution failures.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(github): dispatch watch_github_run over the MCP tool bridge"
```

---

### Task 5: Desktop chat — watcher row from tool calls; delete URL detection

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx:11,757-759`
- Modify: `src/components/Chat/ChatPanel.tsx:72,1267,1390-1397`
- Modify: `src/components/Chat/GitHubWatcherCard.tsx:5`
- Delete: `src/components/Chat/githubWatcher.ts`

- [ ] **Step 1: ChatMessage — swap detection for tool-call targets**

In `src/components/Chat/ChatMessage.tsx` line 11, replace:

```ts
import { detectWatchTargets } from './githubWatcher';
```

with:

```ts
import { watchTargetsFromMessage } from './githubRunResolver';
```

At lines 757–759, replace:

```ts
  const watcherTargets = watcherUrlAllowlist
    ? detectWatchTargets(message).filter(t => watcherUrlAllowlist.has(t.url))
    : detectWatchTargets(message);
```

with:

```ts
  const watcherTargets = watcherUrlAllowlist
    ? watchTargetsFromMessage(message).filter(t => watcherUrlAllowlist.has(t.url))
    : watchTargetsFromMessage(message);
```

- [ ] **Step 2: ChatPanel — allowlist source + dev fake-run flow**

In `src/components/Chat/ChatPanel.tsx` line 72, replace:

```ts
import { detectWatchTargets } from './githubWatcher';
```

with:

```ts
import { watchTargetsFromMessage } from './githubRunResolver';
```

At line 1267 (inside the `watcherUrlsByMessageId` memo), replace:

```ts
      const targets = detectWatchTargets(m);
```

with:

```ts
      const targets = watchTargetsFromMessage(m);
```

In `handleSend` (lines ~1390–1397), the dev fake-run path currently relies on text detection of a user message. Replace:

```ts
    // Dev-only: messages containing sai://fake-* render the watcher card without
    // round-tripping to the LLM. Lets us preview live behavior with no real API calls.
    if (import.meta.env.DEV && /sai:\/\/fake-run\//.test(text)) {
      const userId = `fake-watcher-${Date.now()}`;
      setMessages(prev => [...prev, { id: userId, role: 'user', content: text, timestamp: Date.now(), images }]);
      flushMessagesToParent();
      return;
    }
```

with:

```ts
    // Dev-only: messages containing sai://fake-* render the watcher card without
    // round-tripping to the LLM. Synthesizes a watch_github_run tool call (the
    // card now mounts from tool calls, not text detection).
    if (import.meta.env.DEV && /sai:\/\/fake-run\//.test(text)) {
      const url = text.match(/sai:\/\/fake-run\/[^\s)"'<]*/)![0];
      const runId = url.replace(/^sai:\/\/fake-run\//, '').split('?')[0];
      const ts = Date.now();
      setMessages(prev => [...prev,
        { id: `fake-watcher-user-${ts}`, role: 'user', content: text, timestamp: ts, images },
        {
          id: `fake-watcher-${ts}`, role: 'assistant', content: '', timestamp: ts + 1,
          toolCalls: [{
            id: `fake-watch-${ts}`, type: 'mcp', name: 'mcp__swarm__sai_watch_github_run',
            input: JSON.stringify({ url }),
            output: JSON.stringify({ owner: 'fake', repo: 'fake', runId, url, status: 'in_progress' }),
          }],
        },
      ]);
      flushMessagesToParent();
      return;
    }
```

- [ ] **Step 3: GitHubWatcherCard — move the type import**

In `src/components/Chat/GitHubWatcherCard.tsx` line 5, replace:

```ts
import type { GitHubWatchTarget } from './githubWatcher';
```

with:

```ts
import type { GitHubWatchTarget } from './githubRunResolver';
```

- [ ] **Step 4: Delete the detection module**

```bash
git rm src/components/Chat/githubWatcher.ts
```

- [ ] **Step 5: Verify nothing else imports it, then typecheck + tests**

Run: `grep -rn "githubWatcher'" src --include="*.ts" --include="*.tsx" | grep -v renderer-remote`
Expected: no output.

Run: `npx tsc --noEmit && npx vitest run --project unit`
Expected: clean typecheck, all unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/Chat
git commit -m "feat(github): desktop watcher card mounts from watch_github_run tool calls"
```

---

### Task 6: PWA — watcher card from tool messages; delete the PWA detector

**Files:**
- Modify: `src/renderer-remote/chat/Transcript.tsx:8-10,183-196,220,242-244`
- Modify: `src/renderer-remote/chat/GitHubWatcherCard.tsx:3`
- Delete: `src/renderer-remote/chat/githubWatcher.ts`

- [ ] **Step 1: PWA GitHubWatcherCard — move the type import**

In `src/renderer-remote/chat/GitHubWatcherCard.tsx` line 3, replace:

```ts
import type { GitHubWatchTarget } from './githubWatcher';
```

with:

```ts
import type { GitHubWatchTarget } from '../../components/Chat/githubRunResolver';
```

(The PWA already imports from `src/components/Chat` — see `rehypeEmojiIcons` in Transcript.tsx — and `githubRunResolver.ts` is a pure module with no desktop-only dependencies.)

- [ ] **Step 2: Transcript — mount the card on watch tool messages**

In `src/renderer-remote/chat/Transcript.tsx` line 9, replace:

```ts
import { detectWatchTargets } from './githubWatcher';
```

with:

```ts
import { watchTargetFromToolCall } from '../../components/Chat/githubRunResolver';
```

Replace the `m.role === 'tool'` branch (lines 183–196) with:

```tsx
        if (m.role === 'tool') {
          const watchTarget = watchTargetFromToolCall({
            name: m.toolName ?? '',
            input: JSON.stringify(m.toolInput ?? {}),
            output: typeof m.toolResult === 'string' ? m.toolResult : JSON.stringify(m.toolResult ?? null),
          });
          return (
            <div key={m.id} data-msg-id={m.id} style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
              <ToolCard
                name={m.toolName ?? 'tool'}
                input={m.toolInput}
                result={m.toolResult}
                status={m.toolStatus ?? 'running'}
                toolUseId={m.toolUseId}
                onAnswerQuestion={onAnswerQuestion}
              />
              {watchTarget && (
                <GitHubWatcherCard messageId={m.id} target={watchTarget} watcherStore={watcherStore} />
              )}
            </div>
          );
        }
```

Then remove the text-detection leftovers: delete line 220:

```ts
        const watcherTargets = !isUser && m.text ? detectWatchTargets(m.text) : [];
```

and delete lines 242–244:

```tsx
                {watcherTargets.map((t) => (
                  <GitHubWatcherCard key={t.url} messageId={m.id} target={t} watcherStore={watcherStore} />
                ))}
```

- [ ] **Step 3: Delete the PWA detector**

```bash
git rm src/renderer-remote/chat/githubWatcher.ts
```

- [ ] **Step 4: Typecheck + build the PWA bundle**

Run: `npx tsc --noEmit && npx vite build --config vite.config.pwa.ts`
Expected: clean typecheck, successful PWA build.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer-remote
git commit -m "feat(github): PWA watcher card mounts from watch_github_run tool messages"
```

---

### Task 7: Full verification + manual smoke test

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all unit/integration tests pass. (vitest.config already caps workers at 2 — do not override upward.)

- [ ] **Step 2: Manual fake-run smoke test (dev app)**

Start the app (`npm run dev`), then in a chat type:

```
sai://fake-run/demo?outcome=success&speed=fast
```

Expected: a GitHub Actions watcher card appears under a synthetic assistant message and animates the scripted run to Success. Reload the chat — the card rehydrates from the persisted snapshot without re-running.

- [ ] **Step 3: Note for dogfooding the live tool**

The running SAI session does not pick up new `SAI_TOOL_SCHEMA` entries — restart SAI, then ask the in-app agent to push a trivial change (or call `watch_github_run` with an explicit run URL) and confirm the tool returns resolved-run JSON and the card mounts.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "test(github): watch_github_run verification fixups"
```

(Skip if the tree is clean.)
