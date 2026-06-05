import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  swarmInit,
  swarmCreateTask,
  swarmGetTasks,
  swarmClearDb,
} from '@/swarmDb';
import { reconcileTasksOnStartup, findOrphanApprovalIds } from '@/lib/swarmReconcile';
import type { SwarmTask } from '@/types';

function makeTask(overrides: Partial<SwarmTask> = {}): SwarmTask {
  return {
    id: 'x',
    workspaceId: '/p',
    sessionId: 's',
    title: 't',
    prompt: 'p',
    provider: 'claude',
    model: 'opus',
    approvalPolicy: 'auto-read',
    status: 'streaming',
    branch: 'b',
    baseBranch: 'main',
    worktreePath: '/wt',
    createdAt: 1,
    lastActivityAt: 1,
    costEstimate: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await swarmClearDb();
  await swarmInit();
});

describe('reconcileTasksOnStartup', () => {
  it('demotes streaming tasks to paused', async () => {
    await swarmCreateTask(makeTask({ id: 'x', status: 'streaming' }));
    await reconcileTasksOnStartup('/p');
    const [t] = await swarmGetTasks('/p');
    expect(t.status).toBe('paused');
  });

  it('demotes awaiting_approval to paused', async () => {
    await swarmCreateTask(makeTask({ id: 'y', status: 'awaiting_approval' }));
    await reconcileTasksOnStartup('/p');
    const [t] = await swarmGetTasks('/p');
    expect(t.status).toBe('paused');
  });

  it('leaves other statuses untouched', async () => {
    await swarmCreateTask(makeTask({ id: 'a', status: 'queued' }));
    await swarmCreateTask(makeTask({ id: 'b', status: 'done' }));
    await swarmCreateTask(makeTask({ id: 'c', status: 'paused' }));
    await reconcileTasksOnStartup('/p');
    const tasks = await swarmGetTasks('/p');
    const byId = Object.fromEntries(tasks.map(t => [t.id, t.status]));
    expect(byId.a).toBe('queued');
    expect(byId.b).toBe('done');
    expect(byId.c).toBe('paused');
  });
});

describe('findOrphanApprovalIds', () => {
  const appr = (id: string, taskId: string) => ({
    id, taskId, workspaceId: '/p', toolName: 'Bash', toolUseId: 'u', createdAt: 1,
  });

  it('returns approvals whose taskId has no live task', () => {
    const tasks = [makeTask({ id: 't1' })];
    const approvals = [appr('a1', 't1'), appr('a2', 'gone'), appr('a3', 'alsoGone')];
    expect(findOrphanApprovalIds(tasks, approvals).sort()).toEqual(['a2', 'a3']);
  });

  it('returns empty when every approval has a live task', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    const approvals = [appr('a1', 't1'), appr('a2', 't2')];
    expect(findOrphanApprovalIds(tasks, approvals)).toEqual([]);
  });

  it('treats all approvals as orphans when there are no tasks', () => {
    const approvals = [appr('a1', 't1'), appr('a2', 't2')];
    expect(findOrphanApprovalIds([], approvals).sort()).toEqual(['a1', 'a2']);
  });
});
