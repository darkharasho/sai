import { describe, it, expect, vi } from 'vitest';
import { runSwarmTask, permModeForPolicy, cwdForTask } from '@/lib/swarmTaskRunner';
import type { SwarmTask } from '@/types';

function makeTask(overrides: Partial<SwarmTask> = {}): SwarmTask {
  return {
    id: 'task-1',
    workspaceId: '/tmp/project',
    sessionId: 'session-1',
    title: 'demo',
    prompt: 'create hello.txt with hi',
    provider: 'claude',
    model: 'claude-sonnet',
    approvalPolicy: 'always-ask',
    status: 'streaming',
    branch: 'feat/x',
    baseBranch: 'main',
    worktreePath: null,
    createdAt: 1,
    lastActivityAt: 2,
    costEstimate: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

function makeDeps() {
  return {
    claudeStart: vi.fn().mockResolvedValue(undefined),
    claudeSend: vi.fn(),
  };
}

describe('permModeForPolicy', () => {
  it('maps auto → bypass', () => {
    expect(permModeForPolicy('auto')).toBe('bypass');
  });
  it('maps auto-read → default', () => {
    expect(permModeForPolicy('auto-read')).toBe('default');
  });
  it('maps always-ask → default', () => {
    expect(permModeForPolicy('always-ask')).toBe('default');
  });
});

describe('cwdForTask', () => {
  it('prefers worktreePath when set', () => {
    expect(cwdForTask({ worktreePath: '/tmp/wt', workspaceId: '/tmp/proj' })).toBe('/tmp/wt');
  });
  it('falls back to workspaceId when worktreePath is null', () => {
    expect(cwdForTask({ worktreePath: null, workspaceId: '/tmp/proj' })).toBe('/tmp/proj');
  });
});

describe('runSwarmTask', () => {
  it('starts claude in the worktree path with the task scope and kind=task', async () => {
    const task = makeTask({ worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    const dispatched = await runSwarmTask(task, deps);

    expect(dispatched).toBe(true);
    expect(deps.claudeStart).toHaveBeenCalledWith('/tmp/wt', 'session-1', 'task');
    expect(deps.claudeSend).toHaveBeenCalledTimes(1);
    expect(deps.claudeSend).toHaveBeenCalledWith(
      '/tmp/wt',
      'create hello.txt with hi',
      undefined,
      'default',
      undefined,
      'claude-sonnet',
      'session-1',
    );
  });

  it('falls back to workspaceId when no worktree is materialized', async () => {
    const task = makeTask({ worktreePath: null });
    const deps = makeDeps();

    await runSwarmTask(task, deps);

    expect(deps.claudeStart).toHaveBeenCalledWith('/tmp/project', 'session-1', 'task');
    expect(deps.claudeSend.mock.calls[0][0]).toBe('/tmp/project');
  });

  it('passes bypass permMode for approvalPolicy=auto', async () => {
    const task = makeTask({ approvalPolicy: 'auto', worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    await runSwarmTask(task, deps);

    expect(deps.claudeSend.mock.calls[0][3]).toBe('bypass');
  });

  it('passes default permMode for approvalPolicy=auto-read', async () => {
    const task = makeTask({ approvalPolicy: 'auto-read', worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    await runSwarmTask(task, deps);

    expect(deps.claudeSend.mock.calls[0][3]).toBe('default');
  });

  it('returns false and skips IPC when provider is not claude', async () => {
    const task = makeTask({ provider: 'codex' });
    const deps = makeDeps();

    const dispatched = await runSwarmTask(task, deps);

    expect(dispatched).toBe(false);
    expect(deps.claudeStart).not.toHaveBeenCalled();
    expect(deps.claudeSend).not.toHaveBeenCalled();
  });
});
