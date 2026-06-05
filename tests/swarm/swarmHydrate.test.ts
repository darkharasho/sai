import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  swarmInit, swarmCreateTask, swarmCreateApproval, swarmGetApprovals, swarmClearDb,
} from '@/swarmDb';
import { hydrateWorkspaceSwarm } from '@/lib/swarmHydrate';
import type { SwarmTask } from '@/types';

const task = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
  status: 'queued', branch: 'b', baseBranch: 'main', worktreePath: null,
  createdAt: 1, lastActivityAt: 1, costEstimate: 0, toolCallCount: 0, ...over,
});

beforeEach(async () => {
  await swarmClearDb();
  await swarmInit();
});

describe('hydrateWorkspaceSwarm', () => {
  it('reconciles zombies, prunes orphan approvals, returns live state', async () => {
    await swarmCreateTask(task({ id: 'streaming1', status: 'streaming' }));
    await swarmCreateTask(task({ id: 'awaiting1', status: 'awaiting_approval' }));
    await swarmCreateTask(task({ id: 'queued1', status: 'queued' }));
    await swarmCreateApproval({ id: 'live', taskId: 'queued1', workspaceId: '/p', toolName: 'Bash', toolUseId: 'u1', createdAt: 1 });
    await swarmCreateApproval({ id: 'orphan', taskId: 'gone', workspaceId: '/p', toolName: 'Bash', toolUseId: 'u2', createdAt: 1 });

    const { tasks, liveApprovals } = await hydrateWorkspaceSwarm('/p');

    const byId = Object.fromEntries(tasks.map(t => [t.id, t.status]));
    expect(byId.streaming1).toBe('paused');
    expect(byId.awaiting1).toBe('paused');
    expect(byId.queued1).toBe('queued');

    expect(liveApprovals.map(a => a.id)).toEqual(['live']);
    expect((await swarmGetApprovals('/p')).map(a => a.id)).toEqual(['live']);
  });

  it('returns empty state for a workspace with nothing persisted', async () => {
    const { tasks, liveApprovals } = await hydrateWorkspaceSwarm('/empty');
    expect(tasks).toEqual([]);
    expect(liveApprovals).toEqual([]);
  });

  it('uses injected deps when provided', async () => {
    const calls: string[] = [];
    const result = await hydrateWorkspaceSwarm('/p', {
      init: async () => { calls.push('init'); },
      reconcile: async () => { calls.push('reconcile'); },
      getTasks: async () => { calls.push('getTasks'); return [task({ id: 'x' })]; },
      getApprovals: async () => { calls.push('getApprovals'); return []; },
      resolveApproval: async () => { calls.push('resolveApproval'); },
    });
    expect(calls).toEqual(['init', 'reconcile', 'getTasks', 'getApprovals']);
    expect(result.tasks.map(t => t.id)).toEqual(['x']);
    expect(result.liveApprovals).toEqual([]);
  });
});
