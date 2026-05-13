import { describe, it, expect, vi } from 'vitest';
import {
  dispatchSwarmTool,
  handleSwarmToolRequest,
  buildSyntheticToolUseMessage,
  applySyntheticToolResult,
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

describe('buildSyntheticToolUseMessage', () => {
  it('builds an assistant message with a single mcp__swarm__-prefixed tool_use card', () => {
    const msg = buildSyntheticToolUseMessage(
      { id: 'mcp-1', tool: 'spawn_task', input: { prompt: 'do x' }, workspace: '/ws/a' },
      1234,
    );
    expect(msg.role).toBe('assistant');
    expect(msg.id).toBe('mcp-msg-mcp-1');
    expect(msg.timestamp).toBe(1234);
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls[0].id).toBe('mcp-tooluse-mcp-1');
    expect(msg.toolCalls[0].name).toBe('mcp__swarm__spawn_task');
    expect(JSON.parse(msg.toolCalls[0].input)).toEqual({ prompt: 'do x' });
  });

  it('does not double-prefix names that already start with mcp__swarm__', () => {
    const msg = buildSyntheticToolUseMessage(
      { id: 'mcp-2', tool: 'mcp__swarm__land', input: { taskRef: 't1' }, workspace: '/ws/a' },
    );
    expect(msg.toolCalls[0].name).toBe('mcp__swarm__land');
  });
});

describe('applySyntheticToolResult', () => {
  it('attaches output to the synthetic card matching the request id', () => {
    const msg = buildSyntheticToolUseMessage(
      { id: 'mcp-1', tool: 'spawn_task', input: { prompt: 'do x' }, workspace: '/ws/a' },
      1000,
    );
    const list: any[] = [{ id: 'u1', toolCalls: [] }, msg];
    const next = applySyntheticToolResult(list, 'mcp-1', { ok: true, task: { id: 't1', title: 'do x' } }, 1500);
    expect(next).not.toBe(list);
    const updated = next[1];
    expect(updated.toolCalls[0].output).toContain('"ok": true');
    expect(updated.toolCalls[0].durationMs).toBe(500);
  });

  it('returns the original list when no matching card is found', () => {
    const list: any[] = [{ id: 'u1', toolCalls: [{ id: 'mcp-tooluse-other', type: 'other', name: 'x', input: '{}' }] }];
    const next = applySyntheticToolResult(list, 'missing', { ok: true });
    expect(next).toBe(list);
  });
});
