import { describe, expect, it } from 'vitest';
import { handleRequest, type JsonRpcRequest, type JsonRpcSuccess, type JsonRpcError } from '../../electron/swarm-mcp-server';
import { SWARM_TOOL_SCHEMA } from '../../src/lib/swarmOrchestratorTools';

function asSuccess(res: unknown): JsonRpcSuccess {
  if (!res || typeof res !== 'object' || !('result' in res)) {
    throw new Error(`expected success response, got ${JSON.stringify(res)}`);
  }
  return res as JsonRpcSuccess;
}

function asError(res: unknown): JsonRpcError {
  if (!res || typeof res !== 'object' || !('error' in res)) {
    throw new Error(`expected error response, got ${JSON.stringify(res)}`);
  }
  return res as JsonRpcError;
}

describe('swarm MCP server protocol', () => {
  it('responds to initialize with protocol version and server info', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const res = asSuccess(handleRequest(req));
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sai-swarm', version: '1.0.0' },
      },
    });
  });

  it('lists all 9 swarm tools with swarm_ prefix and matching schemas', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const res = asSuccess(handleRequest(req));
    const result = res.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    expect(result.tools).toHaveLength(9);
    for (const [i, tool] of result.tools.entries()) {
      const original = SWARM_TOOL_SCHEMA[i];
      expect(tool.name).toBe(`swarm_${original.name}`);
      expect(tool.description).toBe(original.description);
      expect(tool.inputSchema).toEqual(original.input_schema);
    }
  });

  it('returns -32601 for tools/call until socket transport is wired', () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'swarm_spawn_task', arguments: { prompt: 'do a thing' } },
    };
    const res = asError(handleRequest(req));
    expect(res.id).toBe(3);
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toMatch(/not yet implemented/i);
  });

  it('treats notifications/initialized as a no-op', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method: 'notifications/initialized' };
    expect(handleRequest(req)).toBeNull();
  });

  it('returns -32601 method-not-found for unknown methods', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 4, method: 'definitely/not/a/method' };
    const res = asError(handleRequest(req));
    expect(res.id).toBe(4);
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toBe('method not found');
  });
});
