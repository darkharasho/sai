import { describe, expect, it, vi } from 'vitest';
import {
  codexAppServerSwarmDecision,
  resolveCodexAppServerSwarmApproval,
} from '@/lib/codexAppServerSwarmApproval';
import type { SwarmApproval } from '@/types';

const approval = (overrides: Partial<SwarmApproval> = {}): SwarmApproval => ({
  id: 'approval-1', taskId: 'task-1', workspaceId: '/repo', toolName: 'Command approval',
  toolUseId: 'legacy-id', createdAt: 1,
  provider: 'codex', requestHandle: 'codex-app-server-1', kind: 'command',
  availableDecisions: ['accept', 'decline'],
  ...overrides,
});

describe('Codex App Server Swarm approvals', () => {
  it('sends the scoped opaque handle through the typed App Server bridge', async () => {
    const codexAppServerApprove = vi.fn().mockResolvedValue({ ok: true });

    await expect(resolveCodexAppServerSwarmApproval(
      { codexAppServerApprove }, approval(), 'task-session', true,
    )).resolves.toBe(true);

    expect(codexAppServerApprove).toHaveBeenCalledWith('/repo', 'task-session', 'codex-app-server-1', {
      type: 'decision', value: 'accept',
    });
  });

  it('does not resolve UI persistence when the pending App Server request is stale', async () => {
    const codexAppServerApprove = vi.fn().mockResolvedValue({ ok: false, code: 'not-pending' });

    await expect(resolveCodexAppServerSwarmApproval(
      { codexAppServerApprove }, approval(), 'task-session', false,
    )).resolves.toBe(false);
    expect(codexAppServerApprove).toHaveBeenCalledWith('/repo', 'task-session', 'codex-app-server-1', {
      type: 'decision', value: 'decline',
    });
  });

  it('grants exactly the requested permissions for an approved permission prompt', () => {
    const requestedPermissions = [{ kind: 'network', host: 'api.openai.com' }];
    expect(codexAppServerSwarmDecision(approval({
      kind: 'permissions', requestedPermissions,
    }), true)).toEqual({ type: 'permissions', permissions: requestedPermissions, scope: 'turn' });
    expect(codexAppServerSwarmDecision(approval({
      kind: 'permissions', requestedPermissions,
    }), false)).toEqual({ type: 'permissions', permissions: [], scope: 'turn' });
  });

  it('never falls back to the obsolete untyped Codex approval API', async () => {
    const bridge = {
      codexAppServerApprove: vi.fn().mockResolvedValue({ ok: true }),
      codexApprove: vi.fn(),
    };
    await resolveCodexAppServerSwarmApproval(bridge, approval(), 'task-session', true);
    expect(bridge.codexApprove).not.toHaveBeenCalled();
  });
});
