import { describe, it, expect, vi } from 'vitest';
import {
  runSwarmTask,
  permModeForPolicy,
  codexPermissionForPolicy,
  cwdForTask,
} from '@/lib/swarmTaskRunner';
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
    codexStart: vi.fn().mockResolvedValue(undefined),
    codexSend: vi.fn(),
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

describe('codexPermissionForPolicy', () => {
  it('maps auto → full-access', () => {
    expect(codexPermissionForPolicy('auto')).toBe('full-access');
  });
  it('maps auto-read → auto', () => {
    expect(codexPermissionForPolicy('auto-read')).toBe('auto');
  });
  it('maps always-ask → auto', () => {
    expect(codexPermissionForPolicy('always-ask')).toBe('auto');
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
  it('starts claude with workspace key + scopeCwd=worktree so events route to the right workspace', async () => {
    const task = makeTask({ worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    const dispatched = await runSwarmTask(task, deps);

    expect(dispatched).toBe(true);
    // workspace key stays the project root; the scope's cwd is the worktree.
    expect(deps.claudeStart).toHaveBeenCalledWith('/tmp/project', 'session-1', 'task', undefined, '/tmp/wt');
    expect(deps.claudeSend).toHaveBeenCalledTimes(1);
    expect(deps.claudeSend).toHaveBeenCalledWith(
      '/tmp/project',
      'create hello.txt with hi',
      undefined,
      'default',
      undefined,
      'claude-sonnet',
      'session-1',
    );
  });

  it('falls back to workspaceId for scopeCwd when no worktree is materialized', async () => {
    const task = makeTask({ worktreePath: null });
    const deps = makeDeps();

    await runSwarmTask(task, deps);

    expect(deps.claudeStart).toHaveBeenCalledWith('/tmp/project', 'session-1', 'task', undefined, '/tmp/project');
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

  it('starts a Codex task in the worktree-scoped session', async () => {
    const task = makeTask({ provider: 'codex', model: 'gpt-5.6', worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    const dispatched = await runSwarmTask(task, deps);

    expect(dispatched).toBe(true);
    expect(deps.codexStart).toHaveBeenCalledWith('/tmp/project', 'session-1', 'task', undefined, '/tmp/wt');
    expect(deps.codexSend).toHaveBeenCalledWith(
      '/tmp/project',
      'create hello.txt with hi',
      undefined,
      'auto',
      undefined,
      'gpt-5.6',
      'session-1',
    );
    expect(deps.claudeStart).not.toHaveBeenCalled();
    expect(deps.claudeSend).not.toHaveBeenCalled();
  });

  it('uses full-access for a Codex task with approvalPolicy=auto', async () => {
    const task = makeTask({ provider: 'codex', approvalPolicy: 'auto', worktreePath: '/tmp/wt' });
    const deps = makeDeps();

    await runSwarmTask(task, deps);

    expect(deps.codexSend.mock.calls[0][3]).toBe('full-access');
  });

  it('returns false and skips IPC when provider is not claude', async () => {
    const task = makeTask({ provider: 'gemini' });
    const deps = makeDeps();

    const dispatched = await runSwarmTask(task, deps);

    expect(dispatched).toBe(false);
    expect(deps.claudeStart).not.toHaveBeenCalled();
    expect(deps.claudeSend).not.toHaveBeenCalled();
    expect(deps.codexStart).not.toHaveBeenCalled();
    expect(deps.codexSend).not.toHaveBeenCalled();
  });
});
