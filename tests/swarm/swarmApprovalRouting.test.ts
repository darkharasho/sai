import { describe, it, expect } from 'vitest';
import { approvalRoutingTarget } from '@/lib/swarmApprovalRouting';
import type { SwarmTask, SwarmApproval } from '@/types';

const task = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'tB', workspaceId: '/wsB', sessionId: 'sessB', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read', status: 'awaiting_approval',
  branch: 'b', baseBranch: 'main', worktreePath: null, createdAt: 1, lastActivityAt: 1,
  costEstimate: 0, toolCallCount: 0, ...over,
});
const appr = (over: Partial<SwarmApproval> = {}): SwarmApproval => ({
  id: 'a1', taskId: 'tB', workspaceId: '/wsB', toolName: 'Bash', toolUseId: 'u1', createdAt: 1, ...over,
});

describe('approvalRoutingTarget', () => {
  it('routes by the approval own workspaceId, not any active workspace', () => {
    const tasksByWs = new Map<string, SwarmTask[]>([
      ['/wsA', [task({ id: 'tA', workspaceId: '/wsA', sessionId: 'sessA' })]],
      ['/wsB', [task()]],
    ]);
    const r = approvalRoutingTarget(appr(), tasksByWs);
    expect(r.workspaceId).toBe('/wsB');
    expect(r.task?.id).toBe('tB');
    expect(r.task?.sessionId).toBe('sessB');
    expect(r.toolUseId).toBe('u1');
  });

  it('returns task undefined when the task is gone (orphan approval)', () => {
    const tasksByWs = new Map<string, SwarmTask[]>([['/wsB', []]]);
    const r = approvalRoutingTarget(appr(), tasksByWs);
    expect(r.workspaceId).toBe('/wsB');
    expect(r.task).toBeUndefined();
    expect(r.toolUseId).toBe('u1');
  });
});
