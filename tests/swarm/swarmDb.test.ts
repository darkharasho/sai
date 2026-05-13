import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  swarmInit, swarmCreateTask, swarmGetTasks, swarmUpdateTask,
  swarmDeleteTask, swarmCreateApproval, swarmGetApprovals,
  swarmResolveApproval, swarmClearDb,
} from '@/swarmDb';
import type { SwarmTask } from '@/types';

const baseTask = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's',
  title: 't', prompt: 'p',
  provider: 'claude', model: 'opus',
  approvalPolicy: 'auto-read', status: 'queued',
  branch: 'swarm/t-a', baseBranch: 'main',
  worktreePath: null, createdAt: 1, lastActivityAt: 1,
  costEstimate: 0, toolCallCount: 0, ...over,
});

beforeEach(async () => {
  await swarmClearDb();
  await swarmInit();
});

describe('swarmDb tasks', () => {
  it('round-trips a task', async () => {
    await swarmCreateTask(baseTask({ id: 'x' }));
    const rows = await swarmGetTasks('/p');
    expect(rows.map(r => r.id)).toContain('x');
  });

  it('updates status', async () => {
    await swarmCreateTask(baseTask({ id: 'y' }));
    await swarmUpdateTask('y', { status: 'streaming' });
    const [row] = await swarmGetTasks('/p');
    expect(row.status).toBe('streaming');
  });

  it('scopes by workspaceId', async () => {
    await swarmCreateTask(baseTask({ id: 'z', workspaceId: '/p1' }));
    await swarmCreateTask(baseTask({ id: 'w', workspaceId: '/p2' }));
    expect((await swarmGetTasks('/p1')).map(r => r.id)).toEqual(['z']);
  });
});

describe('swarmDb approvals', () => {
  it('round-trips and resolves approvals', async () => {
    await swarmCreateApproval({
      id: 'a1', taskId: 't1', workspaceId: '/p',
      toolName: 'bash', toolUseId: 'u1', createdAt: 1,
    });
    expect((await swarmGetApprovals('/p'))).toHaveLength(1);
    await swarmResolveApproval('a1');
    expect((await swarmGetApprovals('/p'))).toHaveLength(0);
  });
});
