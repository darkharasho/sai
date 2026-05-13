import { describe, it, expect, vi } from 'vitest';
import { routeOrchestratorToolUse, isSwarmTool } from '../../src/lib/swarmOrchestratorRouter';

const host: any = {
  spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'foo' }),
  snapshot: vi.fn().mockResolvedValue({ active: 0, approvals: 0, ready: 0, tasks: [] }),
};

describe('swarmOrchestratorRouter', () => {
  it('isSwarmTool recognizes orchestrator tools', () => {
    expect(isSwarmTool('spawn_task')).toBe(true);
    expect(isSwarmTool('Bash')).toBe(false);
  });

  it('routes orchestrator tool_use to dispatcher', async () => {
    const r = await routeOrchestratorToolUse(
      { sessionId: 'o1', toolUseId: 'u1', toolName: 'spawn_task', input: { prompt: 'foo' } },
      { isOrchestratorSession: () => true, host },
    );
    expect(r).toEqual({ toolUseId: 'u1', result: { ok: true, task: { id: 't1', title: 'foo' } } });
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'foo' });
  });

  it('returns null for non-orchestrator session', async () => {
    const r = await routeOrchestratorToolUse(
      { sessionId: 'chat-1', toolUseId: 'u1', toolName: 'spawn_task', input: {} },
      { isOrchestratorSession: () => false, host },
    );
    expect(r).toBeNull();
  });

  it('returns null for non-swarm tool name', async () => {
    const r = await routeOrchestratorToolUse(
      { sessionId: 'o1', toolUseId: 'u1', toolName: 'Bash', input: {} },
      { isOrchestratorSession: () => true, host },
    );
    expect(r).toBeNull();
  });
});
