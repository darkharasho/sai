import { describe, it, expect, vi } from 'vitest';
import {
  dispatchSwarmTool,
  handleSwarmToolRequest,
} from '../../src/lib/swarmOrchestratorDispatcher';

describe('dispatchSwarmTool', () => {
  it('spawn_task creates a task via the host', async () => {
    const host = { spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'foo' }) } as any;
    const r: any = await dispatchSwarmTool('spawn_task', { prompt: 'foo' }, host);
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'foo' });
    expect(r).toEqual({ ok: true, task: { id: 't1', title: 'foo' } });
  });

  it('query_status returns the snapshot', async () => {
    const host = { snapshot: vi.fn().mockResolvedValue({ active: 2, approvals: 0, ready: 1, tasks: [] }) } as any;
    const r: any = await dispatchSwarmTool('query_status', {}, host);
    expect(r.snapshot.active).toBe(2);
  });

  it('spawn_tasks with missing prompts returns a structured error (no throw)', async () => {
    const host = { spawnTasks: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prompts/);
    expect(host.spawnTasks).not.toHaveBeenCalled();
  });

  it('spawn_tasks with non-array prompts returns a structured error', async () => {
    const host = { spawnTasks: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', { prompts: 'nope' }, host);
    expect(r.ok).toBe(false);
    expect(host.spawnTasks).not.toHaveBeenCalled();
  });

  it('pause_task without a taskRef returns a structured error', async () => {
    const host = { pause: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('pause_task', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/taskRef/);
    expect(host.pause).not.toHaveBeenCalled();
  });

  it('approve_tool_call without an approvalId returns a structured error', async () => {
    const host = { approve: vi.fn() } as any;
    const r: any = await dispatchSwarmTool('approve_tool_call', {}, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/approvalId/);
    expect(host.approve).not.toHaveBeenCalled();
  });

  it('handles null input without throwing', async () => {
    const host = {} as any;
    const r: any = await dispatchSwarmTool('spawn_tasks', null, host);
    expect(r.ok).toBe(false);
  });
});

describe('handleSwarmToolRequest', () => {
  it('responds with dispatch result when workspace matches', async () => {
    const host = { spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'foo' }) } as any;
    const respond = vi.fn();
    const respondError = vi.fn();
    await handleSwarmToolRequest(
      { id: 'x1', tool: 'spawn_task', input: { prompt: 'hello' }, workspace: '/ws/a' },
      { activeWorkspace: '/ws/a', host, responder: { respond, respondError } },
    );
    expect(respondError).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith('x1', { ok: true, task: { id: 't1', title: 'foo' } });
  });

  it('rejects with workspace mismatch error when workspaces differ', async () => {
    const host = { spawnTask: vi.fn() } as any;
    const respond = vi.fn();
    const respondError = vi.fn();
    await handleSwarmToolRequest(
      { id: 'x2', tool: 'spawn_task', input: { prompt: 'hello' }, workspace: '/ws/other' },
      { activeWorkspace: '/ws/a', host, responder: { respond, respondError } },
    );
    expect(respond).not.toHaveBeenCalled();
    expect(respondError).toHaveBeenCalledTimes(1);
    expect(respondError.mock.calls[0][0]).toBe('x2');
    expect(respondError.mock.calls[0][1]).toMatch(/workspace mismatch/);
    expect(host.spawnTask).not.toHaveBeenCalled();
  });

  it('routes responder.respondError when host throws', async () => {
    const host = { spawnTask: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    const respond = vi.fn();
    const respondError = vi.fn();
    await handleSwarmToolRequest(
      { id: 'x3', tool: 'spawn_task', input: { prompt: 'hi' }, workspace: '/ws/a' },
      { activeWorkspace: '/ws/a', host, responder: { respond, respondError } },
    );
    expect(respond).not.toHaveBeenCalled();
    expect(respondError).toHaveBeenCalledWith('x3', 'boom');
  });
});

