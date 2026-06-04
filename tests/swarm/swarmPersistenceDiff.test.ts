import { describe, it, expect } from 'vitest';
import { diffSwarmTasks } from '@/lib/swarmPersistenceDiff';
import type { SwarmTask } from '@/types';

const t = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
  status: 'queued', branch: 'b', baseBranch: 'main', worktreePath: null,
  createdAt: 1, lastActivityAt: 1, costEstimate: 0, toolCallCount: 0, ...over,
});

describe('diffSwarmTasks', () => {
  it('upserts brand-new tasks', () => {
    const { upserts, deletes } = diffSwarmTasks([], [t({ id: 'a' }), t({ id: 'b' })]);
    expect(upserts.map(u => u.id).sort()).toEqual(['a', 'b']);
    expect(deletes).toEqual([]);
  });

  it('deletes tasks no longer present', () => {
    const { upserts, deletes } = diffSwarmTasks([t({ id: 'a' }), t({ id: 'b' })], [t({ id: 'a' })]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual(['b']);
  });

  it('upserts tasks whose fields changed', () => {
    const prev = [t({ id: 'a', status: 'queued' })];
    const next = [t({ id: 'a', status: 'streaming' })];
    const { upserts, deletes } = diffSwarmTasks(prev, next);
    expect(upserts.map(u => u.id)).toEqual(['a']);
    expect(deletes).toEqual([]);
  });

  it('emits nothing when nothing changed', () => {
    const prev = [t({ id: 'a' })];
    const next = [t({ id: 'a' })];
    const { upserts, deletes } = diffSwarmTasks(prev, next);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });
});
