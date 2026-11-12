// SAI's chat-tools MCP stdio server + socket host. The Claude CLI and Codex
// SDK backends spawn it for every chat to expose the sai_* tools.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  handleRequest,
  makeSocketTransport,
  type JsonRpcRequest,
  type JsonRpcSuccess,
  type JsonRpcError,
  type SaiCallTransport,
} from '../../../electron/sai-mcp-server';
import * as saiMcpHost from '../../../electron/services/saiMcpHost';

const noopTransport: SaiCallTransport = {
  call: () => Promise.reject(new Error('transport not used in this test')),
};

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

describe('SAI MCP server protocol', () => {
  it('responds to initialize with protocol version and server info', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const res = asSuccess(await handleRequest(req, noopTransport));
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sai', version: '1.0.0' },
      },
    });
  });

  it('treats notifications/initialized as a no-op', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method: 'notifications/initialized' };
    expect(await handleRequest(req, noopTransport)).toBeNull();
  });

  it('returns -32601 method-not-found for unknown methods', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 4, method: 'definitely/not/a/method' };
    const res = asError(await handleRequest(req, noopTransport));
    expect(res.id).toBe(4);
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toBe('method not found');
  });
});

describe('tools/call dispatch', () => {
  function makeMockTransport(impl: (tool: string, input: unknown) => Promise<unknown>) {
    const calls: Array<{ tool: string; input: unknown }> = [];
    const transport: SaiCallTransport = {
      call: (tool, input) => {
        calls.push({ tool, input });
        return impl(tool, input);
      },
    };
    return { transport, calls };
  }

  it('returns -32602 for non-sai_ prefixed tools', async () => {
    const { transport, calls } = makeMockTransport(async () => ({}));
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'edit_file', arguments: {} },
    };
    const res = asError(await handleRequest(req, transport));
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toMatch(/unknown tool: edit_file/);
    expect(calls).toEqual([]);
  });

  it('returns isError content block when transport rejects', async () => {
    const { transport } = makeMockTransport(async () => {
      throw new Error('host blew up');
    });
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'sai_render_html', arguments: { html: '<b>x</b>' } },
    };
    const res = asSuccess(await handleRequest(req, transport));
    const result = res.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('host blew up');
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
    return `\\\\.\\pipe\\sai-mcp-test-${process.pid}-${label}-${crypto.randomBytes(4).toString('hex')}`;
  }
  return path.join(os.tmpdir(), `sai-mcp-test-${process.pid}-${label}-${crypto.randomBytes(4).toString('hex')}.sock`);
}

describe('saiMcpHost socket', () => {
  let handle: { socketPath: string; secret: string };

  beforeEach(() => {
    saiMcpHost._resetForTests();
    handle = saiMcpHost._test_start({
      socketPath: tmpSocketPath('host'),
      secret: 'a'.repeat(64),
    });
  });

  afterEach(() => {
    saiMcpHost._resetForTests();
  });

  it('handshake success → call → result', async () => {
    let capturedReq: any = null;
    saiMcpHost.onToolCall(async (req) => {
      capturedReq = req;
      return { ok: true, echo: req.input };
    });
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws/alpha' });
    await client.waitFor((f) => f.type === 'welcome');

    client.send({ type: 'call', id: 'call-1', tool: 'render_html', input: { html: 'go' } });
    const result = await client.waitFor((f) => f.type === 'result');
    expect(result).toEqual({ type: 'result', id: 'call-1', result: { ok: true, echo: { html: 'go' } } });
    expect(capturedReq).toEqual({
      id: 'call-1',
      tool: 'render_html',
      input: { html: 'go' },
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
    client.send({ type: 'call', id: 'x', tool: 'render_html', input: {} });
    const err = await client.waitFor((f) => f.type === 'error');
    expect(err.error).toBe('expected hello first');
    await client.closed;
  });

  it('no handler registered → error frame', async () => {
    // intentionally do not register handler
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws' });
    await client.waitFor((f) => f.type === 'welcome');
    client.send({ type: 'call', id: 'c1', tool: 'render_chart', input: {} });
    const err = await client.waitFor((f) => f.type === 'error' && f.id === 'c1');
    expect(err.error).toBe('no handler registered');
    client.socket.destroy();
  });

  it('handler throws → error frame with message', async () => {
    saiMcpHost.onToolCall(async () => {
      throw new Error('boom');
    });
    const client = await connectClient(handle.socketPath);
    client.send({ type: 'hello', secret: handle.secret, workspace: '/ws' });
    await client.waitFor((f) => f.type === 'welcome');
    client.send({ type: 'call', id: 'c2', tool: 'render_html', input: {} });
    const err = await client.waitFor((f) => f.type === 'error' && f.id === 'c2');
    expect(err.error).toBe('boom');
    client.socket.destroy();
  });

  it('multiple connections → each gets its own results', async () => {
    saiMcpHost.onToolCall(async (req) => ({ workspace: req.workspace, id: req.id }));
    const a = await connectClient(handle.socketPath);
    const b = await connectClient(handle.socketPath);
    a.send({ type: 'hello', secret: handle.secret, workspace: '/ws/a' });
    b.send({ type: 'hello', secret: handle.secret, workspace: '/ws/b' });
    await a.waitFor((f) => f.type === 'welcome');
    await b.waitFor((f) => f.type === 'welcome');

    a.send({ type: 'call', id: 'A1', tool: 'render_html', input: {} });
    b.send({ type: 'call', id: 'B1', tool: 'render_html', input: {} });

    const ra = await a.waitFor((f) => f.type === 'result' && f.id === 'A1');
    const rb = await b.waitFor((f) => f.type === 'result' && f.id === 'B1');
    expect(ra.result).toEqual({ workspace: '/ws/a', id: 'A1' });
    expect(rb.result).toEqual({ workspace: '/ws/b', id: 'B1' });

    a.socket.destroy();
    b.socket.destroy();
  });
});

describe('sai tools over MCP', () => {
  const noopTransport: SaiCallTransport = { call: async () => ({ ok: true }) };

  it('lists only the sai_ chat tools', async () => {
    const res: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, noopTransport);
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('sai_render_html');
    expect(names).toContain('sai_render_chart');
    expect(names).toContain('sai_render_diff');
    expect(names.every((n: string) => n.startsWith('sai_'))).toBe(true);
  });

  it('dispatches a sai_ tool call through the transport', async () => {
    const calls: Array<{ tool: string; input: unknown }> = [];
    const transport: SaiCallTransport = {
      call: async (tool: string, input: unknown) => { calls.push({ tool, input }); return { ok: true }; },
    };
    const res: any = await handleRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sai_render_html', arguments: { html: '<b>x</b>' } } },
      transport,
    );
    expect(calls).toEqual([{ tool: 'render_html', input: { html: '<b>x</b>' } }]);
    expect(res.result.content[0].type).toBe('text');
    expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true });
  });

  it('refuses to dispatch an unlisted sai_ tool', async () => {
    const calls: string[] = [];
    const transport: SaiCallTransport = {
      call: async (tool: string) => { calls.push(tool); return { ok: true }; },
    };
    const res: any = await handleRequest(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'sai_not_a_real_tool', arguments: { prompt: 'x' } } },
      transport,
    );
    expect(calls).toEqual([]);
    expect(res.error).toEqual({ code: -32602, message: 'unknown tool: sai_not_a_real_tool' });
  });

  it('appends an image content block when the result carries __mcpImage', async () => {
    const transport: SaiCallTransport = {
      call: async () => ({ renderId: 'r', __mcpImage: { base64: 'AAAA', mimeType: 'image/png' } }),
    };
    const res: any = await handleRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sai_render_component', arguments: { component: 'WorkspaceSquircle' } } },
      transport,
    );
    const img = res.result.content.find((c: any) => c.type === 'image');
    expect(img).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });
});

describe('makeSocketTransport ↔ saiMcpHost end-to-end', () => {
  let handle: { socketPath: string; secret: string };

  beforeEach(() => {
    saiMcpHost._resetForTests();
    handle = saiMcpHost._test_start({
      socketPath: tmpSocketPath('e2e'),
      secret: 'b'.repeat(64),
    });
  });

  afterEach(() => {
    saiMcpHost._resetForTests();
  });

  it('connects, handshakes, dispatches a tool call, and returns the result', async () => {
    let capturedReq: any = null;
    saiMcpHost.onToolCall(async (req) => {
      capturedReq = req;
      return { ok: true, echo: req.input };
    });

    const transport = makeSocketTransport({
      socketPath: handle.socketPath,
      secret: handle.secret,
      workspace: '/ws/e2e',
      exitOnClose: false,
    });
    try {
      await transport.ready();
      const result = await transport.call('render_html', { html: 'hello' });
      expect(result).toEqual({ ok: true, echo: { html: 'hello' } });
      expect(capturedReq).toMatchObject({
        tool: 'render_html',
        input: { html: 'hello' },
        workspace: '/ws/e2e',
      });
      expect(typeof capturedReq.id).toBe('string');
      expect(capturedReq.id.length).toBeGreaterThan(0);
    } finally {
      transport.close();
    }
  });

  it('ready() rejects when handshake secret is wrong', async () => {
    const transport = makeSocketTransport({
      socketPath: handle.socketPath,
      secret: 'definitely-wrong',
      workspace: '/ws/x',
      exitOnClose: false,
    });
    try {
      await expect(transport.ready()).rejects.toThrow(/auth failed/);
    } finally {
      transport.close();
    }
  });
});
