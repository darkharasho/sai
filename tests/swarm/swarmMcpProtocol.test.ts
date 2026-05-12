import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { handleRequest, type JsonRpcRequest, type JsonRpcSuccess, type JsonRpcError } from '../../electron/swarm-mcp-server';
import { SWARM_TOOL_SCHEMA } from '../../src/lib/swarmOrchestratorTools';
import * as swarmMcpHost from '../../electron/services/swarmMcpHost';

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

interface TestClient {
  socket: net.Socket;
  frames: any[];
  closed: Promise<void>;
  send: (obj: unknown) => void;
  waitFor: (predicate: (f: any) => boolean, timeoutMs?: number) => Promise<any>;
}

function connectClient(socketPath: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const frames: any[] = [];
    let buffer = '';
    const waiters: Array<{ predicate: (f: any) => boolean; resolve: (f: any) => void }> = [];
    const checkWaiters = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        const idx = frames.findIndex(w.predicate);
        if (idx !== -1) {
          waiters.splice(i, 1);
          w.resolve(frames[idx]);
        }
      }
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          frames.push(JSON.parse(line));
        } catch {
          frames.push({ _raw: line });
        }
        checkWaiters();
      }
    });
    const closed = new Promise<void>((res) => {
      socket.on('close', () => res());
    });
    socket.on('error', () => { /* ignore for tests */ });
    socket.on('connect', () => {
      resolve({
        socket,
        frames,
        closed,
        send: (obj) => socket.write(JSON.stringify(obj) + '\n'),
        waitFor: (predicate, timeoutMs = 1500) => new Promise((res, rej) => {
          const idx = frames.findIndex(predicate);
          if (idx !== -1) return res(frames[idx]);
          const timer = setTimeout(() => {
            const i = waiters.findIndex(w => w.predicate === predicate);
            if (i !== -1) waiters.splice(i, 1);
            rej(new Error(`waitFor timed out; frames=${JSON.stringify(frames)}`));
          }, timeoutMs);
          waiters.push({
            predicate,
            resolve: (f) => { clearTimeout(timer); res(f); },
          });
        }),
      });
    });
    socket.on('error', reject);
  });
}

function tmpSocketPath(label: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\sai-swarm-test-${process.pid}-${label}-${crypto.randomBytes(4).toString('hex')}`;
  }
  return path.join(os.tmpdir(), `sai-swarm-test-${process.pid}-${label}-${crypto.randomBytes(4).toString('hex')}.sock`);
}

describe('swarmMcpHost socket', () => {
  let handle: { socketPath: string; secret: string };

  beforeEach(() => {
    swarmMcpHost._resetForTests();
    handle = swarmMcpHost._test_start({
      socketPath: tmpSocketPath('host'),
      secret: 'a'.repeat(64),
    });
  });

  afterEach(() => {
    swarmMcpHost._resetForTests();
  });

  it('handshake success → call → result', async () => {
    let capturedReq: any = null;
    swarmMcpHost.onToolCall(async (req) => {
      capturedReq = req;
      return { ok: true, echo: req.input };
    });
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws/alpha' });
    await client.waitFor((f) => f.type === 'welcome');

    client.send({ type: 'call', id: 'call-1', tool: 'spawn_task', input: { prompt: 'go' } });
    const result = await client.waitFor((f) => f.type === 'result');
    expect(result).toEqual({ type: 'result', id: 'call-1', result: { ok: true, echo: { prompt: 'go' } } });
    expect(capturedReq).toEqual({
      id: 'call-1',
      tool: 'spawn_task',
      input: { prompt: 'go' },
      workspace: '/ws/alpha',
    });
    client.socket.destroy();
  });

  it('handshake failure (wrong secret) → error + close', async () => {
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: 'wrong', workspace: '/ws/x' });
    const err = await client.waitFor((f) => f.type === 'error');
    expect(err.error).toBe('auth failed');
    await client.closed;
  });

  it('wrong first frame → error + close', async () => {
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'call', id: 'x', tool: 'spawn_task', input: {} });
    const err = await client.waitFor((f) => f.type === 'error');
    expect(err.error).toBe('expected hello first');
    await client.closed;
  });

  it('no handler registered → error frame', async () => {
    // intentionally do not register handler
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws' });
    await client.waitFor((f) => f.type === 'welcome');
    client.send({ type: 'call', id: 'c1', tool: 'list_tasks', input: {} });
    const err = await client.waitFor((f) => f.type === 'error' && f.id === 'c1');
    expect(err.error).toBe('no handler registered');
    client.socket.destroy();
  });

  it('handler throws → error frame with message', async () => {
    swarmMcpHost.onToolCall(async () => {
      throw new Error('boom');
    });
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws' });
    await client.waitFor((f) => f.type === 'welcome');
    client.send({ type: 'call', id: 'c2', tool: 'spawn_task', input: {} });
    const err = await client.waitFor((f) => f.type === 'error' && f.id === 'c2');
    expect(err.error).toBe('boom');
    client.socket.destroy();
  });

  it('multiple connections → each gets its own results', async () => {
    swarmMcpHost.onToolCall(async (req) => ({ workspace: req.workspace, id: req.id }));
    const a = await connectClient(handle.socketPath);
    const b = await connectClient(handle.socketPath);
    a.send({ type: 'hello', secret: handle.secret, workspace: '/ws/a' });
    b.send({ type: 'hello', secret: handle.secret, workspace: '/ws/b' });
    await a.waitFor((f) => f.type === 'welcome');
    await b.waitFor((f) => f.type === 'welcome');

    a.send({ type: 'call', id: 'A1', tool: 'spawn_task', input: {} });
    b.send({ type: 'call', id: 'B1', tool: 'spawn_task', input: {} });

    const ra = await a.waitFor((f) => f.type === 'result' && f.id === 'A1');
    const rb = await b.waitFor((f) => f.type === 'result' && f.id === 'B1');
    expect(ra.result).toEqual({ workspace: '/ws/a', id: 'A1' });
    expect(rb.result).toEqual({ workspace: '/ws/b', id: 'B1' });

    a.socket.destroy();
    b.socket.destroy();
  });
});
