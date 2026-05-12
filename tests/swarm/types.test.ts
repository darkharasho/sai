import { describe, it, expect } from 'vitest';
import type { SwarmTask, SwarmTaskStatus } from '@/types';

describe('SwarmTask type', () => {
  it('accepts the canonical status set', () => {
    const statuses: SwarmTaskStatus[] = [
      'queued','streaming','awaiting_approval','paused',
      'done','failed','landed','discarded',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('compiles a complete SwarmTask record', () => {
    const t: SwarmTask = {
      id: 't1', workspaceId: '/p', sessionId: 's1',
      title: 'foo', prompt: 'do foo',
      provider: 'claude', model: 'opus',
      approvalPolicy: 'auto-read', status: 'queued',
      branch: 'swarm/foo-abc', baseBranch: 'main',
      worktreePath: null,
      createdAt: 0, lastActivityAt: 0, costEstimate: 0, toolCallCount: 0,
    };
    expect(t.status).toBe('queued');
  });
});
