import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import GitHubWatcherCard, { watcherRetryDelay } from '../../../../src/components/Chat/GitHubWatcherCard';

describe('watcherRetryDelay', () => {
  it('backs off 5s → 10s → 20s → 40s, caps at 60s, gives up after 8 failures', () => {
    expect([1, 2, 3, 4, 5, 7].map(watcherRetryDelay)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    expect(watcherRetryDelay(8)).toBeNull();
  });
});

describe('GitHubWatcherCard poll errors', () => {
  const run = { status: 'in_progress', conclusion: null, name: 'Build', display_title: 'release: v9', html_url: 'https://github.com/o/r/actions/runs/1' };
  let devlog: ReturnType<typeof vi.fn>;
  let apiGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    devlog = vi.fn();
    apiGet = vi.fn();
    (window as any).sai = { githubApiGet: apiGet, devlog };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).sai;
  });

  const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it('logs the failing path, retries instead of dying, and recovers', async () => {
    let fail = true;
    apiGet.mockImplementation(async (path: string) => {
      if (fail) return { ok: false, status: 404, body: { message: 'Not Found' } };
      return path.endsWith('/jobs') ? { ok: true, status: 200, body: { jobs: [] } } : { ok: true, status: 200, body: run };
    });
    const target = { kind: 'run' as const, owner: 'o', repo: 'r', runId: String(Date.now()), url: `https://github.com/o/r/actions/runs/retry-${Date.now()}` };
    render(<GitHubWatcherCard target={target} />);
    await flush();

    expect(devlog).toHaveBeenCalledWith('ghWatcher.pollError', expect.objectContaining({
      url: target.url, status: 404, path: expect.stringContaining(`/actions/runs/${target.runId}`), failures: 1, retryInMs: 5000,
    }));
    expect(screen.getByText(/Retrying \(404 Not Found\)/)).toBeTruthy();
    expect(screen.queryByText('Watcher error')).toBeNull();

    fail = false;
    await flush(5000);
    expect(devlog).toHaveBeenCalledWith('ghWatcher.recovered', { url: target.url, afterFailures: 1 });
    expect(screen.queryByText(/Retrying/)).toBeNull();
  });

  it('gives up with the error after repeated failures', async () => {
    apiGet.mockResolvedValue({ ok: false, status: 404, body: { message: 'Not Found' } });
    const target = { kind: 'run' as const, owner: 'o', repo: 'r', runId: '2', url: `https://github.com/o/r/actions/runs/giveup-${Date.now()}` };
    render(<GitHubWatcherCard target={target} />);
    await flush();
    for (let i = 1; i < 8; i++) await flush(watcherRetryDelay(i)!);
    expect(devlog).toHaveBeenCalledWith('ghWatcher.gaveUp', expect.objectContaining({ failures: 8 }));
    expect(screen.getByText('404 Not Found')).toBeTruthy();
  });
});
