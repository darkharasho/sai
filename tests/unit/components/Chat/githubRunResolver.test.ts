import { describe, it, expect, vi } from 'vitest';
import {
  parseRunUrl,
  watchTargetFromToolCall,
  watchTargetsFromMessage,
  resolveWatchRun,
  type GitHubApiGet,
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
