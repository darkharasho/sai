/**
 * SAI Swarm MCP Server
 *
 * A standalone Node script (built to dist-electron/swarm-mcp-server.js) that
 * speaks the Model Context Protocol over stdio. It is spawned by Claude CLI
 * when SAI launches a Claude orchestrator session with the SAI-managed
 * --mcp-config.
 *
 * Task 3 wires `tools/call` over a Unix socket / Windows named pipe to the
 * SAI host process. The dispatch is abstracted through SwarmCallTransport so
 * tests can inject a mock without spinning up a real socket.
 */

import { createInterface } from 'node:readline';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { SWARM_TOOL_SCHEMA } from '../src/lib/swarmOrchestratorTools';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export interface SwarmMcpEnv {
  socketPath: string;
  secret: string;
  workspace: string;
}

export interface SwarmCallTransport {
  call(tool: string, input: unknown): Promise<unknown>;
}

let envState: SwarmMcpEnv | null = null;

export function setEnv(env: SwarmMcpEnv | null): void {
  envState = env;
}

export function getEnv(): SwarmMcpEnv | null {
  return envState;
}

const PROTOCOL_VERSION = '2024-11-05';
const SWARM_TOOL_NAMES = new Set(SWARM_TOOL_SCHEMA.map((t) => t.name));

function listTools() {
  return {
    tools: SWARM_TOOL_SCHEMA.map((tool) => ({
      name: `swarm_${tool.name}`,
      description: tool.description,
      inputSchema: tool.input_schema,
    })),
  };
}

/**
 * Pure handler for a single JSON-RPC request. Returns null for notifications
 * (no `id` field). Used by the stdio loop and by tests.
 *
 * `transport` is required for `tools/call` dispatch. The other methods
 * ignore it, so passing a no-op transport is fine for read-only tests.
 */
export async function handleRequest(
  req: JsonRpcRequest,
  transport: SwarmCallTransport,
): Promise<JsonRpcResponse | null> {
  const isNotification = req.id === undefined || req.id === null;
  const id = (req.id ?? null) as number | string | null;

  switch (req.method) {
    case 'initialize':
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'sai-swarm', version: '1.0.0' },
        },
      };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        result: listTools(),
      };

    case 'tools/call': {
      if (isNotification) return null;
      const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
      const fullName = typeof params.name === 'string' ? params.name : '';
      const input = (params.arguments ?? {}) as unknown;

      if (!fullName.startsWith('swarm_')) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `unknown tool: ${fullName}` },
        };
      }
      const toolName = fullName.slice('swarm_'.length);
      if (!SWARM_TOOL_NAMES.has(toolName)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `unknown tool: ${fullName}` },
        };
      }

      try {
        const result = await transport.call(toolName, input);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: msg }],
            isError: true,
          },
        };
      }
    }

    default:
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'method not found' },
      };
  }
}

function writeResponse(res: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(res)}\n`);
}

function writeParseError(id: number | string | null = null): void {
  writeResponse({
    jsonrpc: '2.0',
    id,
    error: { code: -32700, message: 'parse error' },
  });
}

function readEnvOrExit(): SwarmMcpEnv {
  const socketPath = process.env.SAI_SWARM_SOCKET_PATH;
  const secret = process.env.SAI_SWARM_SECRET;
  const workspace = process.env.SAI_SWARM_WORKSPACE;

  if (!socketPath || !secret || !workspace) {
    process.stderr.write('missing SAI_SWARM_* env vars\n');
    process.exit(2);
  }

  return { socketPath, secret, workspace };
}

export interface SocketTransportOptions {
  socketPath?: string;
  secret?: string;
  workspace?: string;
  /** When true, the transport will not call process.exit on socket close. Tests use this. */
  exitOnClose?: boolean;
}

export interface SocketTransport extends SwarmCallTransport {
  ready(): Promise<void>;
  close(): void;
}

/**
 * Production socket transport.
 *
 * On first use, connects to socketPath, sends a hello frame with secret +
 * workspace, awaits a welcome frame. Subsequent .call() invocations send
 * NDJSON `call` frames and resolve when the matching `result` frame arrives
 * (or reject on `error`).
 *
 * Options default to env vars (SAI_SWARM_SOCKET_PATH/SECRET/WORKSPACE) so
 * main() can call this without args. Tests pass explicit overrides.
 */
export function makeSocketTransport(opts: SocketTransportOptions = {}): SocketTransport {
  const socketPath = opts.socketPath ?? process.env.SAI_SWARM_SOCKET_PATH ?? '';
  const secret = opts.secret ?? process.env.SAI_SWARM_SECRET ?? '';
  const workspace = opts.workspace ?? process.env.SAI_SWARM_WORKSPACE ?? '';
  const exitOnClose = opts.exitOnClose ?? true;

  let socket: net.Socket | null = null;
  let buffer = '';
  let closed = false;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  let readyResolve!: () => void;
  let readyReject!: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  function rejectAllPending(msg: string): void {
    const err = new Error(msg);
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  }

  function handleFrame(line: string): void {
    let frame: any;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame?.type === 'welcome') {
      readyResolve();
      return;
    }
    if (frame?.type === 'result' && typeof frame.id === 'string') {
      const p = pending.get(frame.id);
      if (p) {
        pending.delete(frame.id);
        p.resolve(frame.result);
      }
      return;
    }
    if (frame?.type === 'error') {
      const id: string | undefined = typeof frame.id === 'string' ? frame.id : undefined;
      const msg: string = typeof frame.error === 'string' ? frame.error : 'transport error';
      if (id !== undefined) {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          p.reject(new Error(msg));
        }
        return;
      }
      // Pre-welcome error → handshake failure.
      readyReject(new Error(msg));
      return;
    }
  }

  function ensureConnected(): void {
    if (socket) return;
    socket = net.connect(socketPath);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket?.write(
        JSON.stringify({ type: 'hello', secret, workspace }) + '\n',
      );
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handleFrame(line);
      }
    });
    socket.on('error', (err) => {
      readyReject(err);
      rejectAllPending(`socket error: ${err.message}`);
    });
    socket.on('close', () => {
      if (closed) return;
      closed = true;
      readyReject(new Error('socket closed before welcome'));
      rejectAllPending('socket closed');
      if (exitOnClose) {
        process.stderr.write('swarm host socket closed unexpectedly\n');
        process.exit(4);
      }
    });
  }

  ensureConnected();

  return {
    ready: () => readyPromise,
    call(tool: string, input: unknown): Promise<unknown> {
      if (closed) return Promise.reject(new Error('socket closed'));
      const id = crypto.randomBytes(8).toString('hex');
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          socket?.write(
            JSON.stringify({ type: 'call', id, tool, input }) + '\n',
          );
        } catch (err) {
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    close() {
      closed = true;
      try { socket?.end(); } catch { /* noop */ }
      try { socket?.destroy(); } catch { /* noop */ }
      socket = null;
    },
  };
}

export function startStdioLoop(
  dispatch: (req: JsonRpcRequest) => Promise<JsonRpcResponse | null>,
): void {
  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      writeParseError();
      return;
    }

    dispatch(req)
      .then((res) => {
        if (res !== null) writeResponse(res);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`handler error: ${message}\n`);
        writeResponse({
          jsonrpc: '2.0',
          id: (req.id ?? null) as number | string | null,
          error: { code: -32603, message: 'internal error' },
        });
      });
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

export async function main(): Promise<void> {
  const env = readEnvOrExit();
  setEnv(env);

  const transport = makeSocketTransport();
  try {
    await transport.ready();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`swarm host rejected handshake: ${msg}\n`);
    process.exit(3);
  }

  startStdioLoop((req) => handleRequest(req, transport));
}

// Only auto-run when this file is the Node entry point (not when imported by tests).
// The CJS build sets require.main === module; under tsx/ESM-style imports it won't.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void main();
}
