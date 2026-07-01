import { describe, it, expect, vi } from 'vitest';
import { buildSwarmMcpServer, SWARM_MCP_SERVER_NAME } from '../../../electron/services/claudeBackend/swarmMcpServer';
import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';

describe('buildSwarmMcpServer', () => {
  it('builds an sdk-type server named "swarm"', () => {
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    expect(server.type).toBe('sdk');
    expect(server.name).toBe(SWARM_MCP_SERVER_NAME);
    expect(SWARM_MCP_SERVER_NAME).toBe('swarm');
    expect(server.instance).toBeDefined();
  });

  it('registers every swarm tool under its BARE name', () => {
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    const handlers = (server as any).__handlersForTest as Map<string, unknown>;
    expect(handlers.size).toBe(SWARM_TOOL_SCHEMA.length);
    for (const def of SWARM_TOOL_SCHEMA) {
      expect(handlers.has(def.name)).toBe(true); // bare name, e.g. 'spawn_task' (NOT 'swarm_spawn_task')
    }
  });

  it('handler routes to dispatch with the bare tool name + workspace, wraps success', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('spawn_task');
    const result = await handler({ prompt: 'do it' });
    expect(dispatch).toHaveBeenCalledWith({ tool: 'spawn_task', input: { prompt: 'do it' }, workspace: '/ws' });
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify({ ok: true }) });
  });

  it('handler wraps a dispatch error with isError', async () => {
    const dispatch = vi.fn(async () => { throw new Error('boom'); });
    const server = buildSwarmMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('land');
    const result = await handler({ taskRef: 't1' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });
});
