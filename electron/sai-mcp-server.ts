/**
 * SAI chat-tools MCP Server
 *
 * A standalone Node script (built to dist-electron/sai-mcp-server.js) that
 * speaks the Model Context Protocol over stdio. The Claude CLI backend (via
 * the SAI-managed --mcp-config) and the Codex SDK backend spawn it for every
 * chat so the model gets SAI's `sai_*` tools (render, capture, browser, ...).
 *
 * `tools/call` is forwarded over a Unix socket / Windows named pipe to the
 * SAI host process (services/saiMcpHost). The dispatch is abstracted through
 * SaiCallTransport so tests can inject a mock without a real socket.
 */

import { createInterface } from 'node:readline';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { toolsForToolset } from '../src/lib/saiTools';
import { toMcpSuccessContent, toMcpErrorContent } from './services/mcpToolContent';

const CHAT_TOOLS = toolsForToolset('chat');
const CHAT_TOOL_NAMES = new Set(CHAT_TOOLS.map((t) => t.name));

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

export interface SaiMcpEnv {
  socketPath: string;
  secret: string;
  workspace: string;
}

export interface SaiCallTransport {
  call(tool: string, input: unknown): Promise<unknown>;
}

let envState: SaiMcpEnv | null = null;

export function setEnv(env: SaiMcpEnv | null): void {
  envState = env;
}

export function getEnv(): SaiMcpEnv | null {
  return envState;
}

const PROTOCOL_VERSION = '2024-11-05';

function listTools() {
  return {
    tools: CHAT_TOOLS.map((tool) => ({ name: `sai_${tool.name}`, description: tool.description, inputSchema: tool.input_schema })),
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
  transport: SaiCallTransport,
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
          serverInfo: { name: 'sai', version: '1.0.0' },
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

      // Only dispatch tools advertised in tools/list — a buggy or hostile
      // client must not be able to invoke an unlisted tool.
      const toolName = fullName.startsWith('sai_') && CHAT_TOOL_NAMES.has(fullName.slice(4))
        ? fullName.slice(4)
        : null;
      if (!toolName) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${fullName}` } };
      }

      try {
        const result = await transport.call(toolName, input);
        return { jsonrpc: '2.0', id, result: toMcpSuccessContent(result) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { jsonrpc: '2.0', id, result: toMcpErrorContent(msg) };
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

function readEnvOrExit(): SaiMcpEnv {
  const socketPath = process.env.SAI_MCP_SOCKET_PATH;
  const secret = process.env.SAI_MCP_SECRET;
  const workspace = process.env.SAI_MCP_WORKSPACE;

  if (!socketPath || !secret || !workspace) {
    process.stderr.write('missing SAI_MCP_* env vars\n');
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

export interface SocketTransport extends SaiCallTransport {
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
 * Options default to env vars (SAI_MCP_SOCKET_PATH/SECRET/WORKSPACE) so
 * main() can call this without args. Tests pass explicit overrides.
 */
export function makeSocketTransport(opts: SocketTransportOptions = {}): SocketTransport {
  const socketPath = opts.socketPath ?? process.env.SAI_MCP_SOCKET_PATH ?? '';
  const secret = opts.secret ?? process.env.SAI_MCP_SECRET ?? '';
  const workspace = opts.workspace ?? process.env.SAI_MCP_WORKSPACE ?? '';
  const exitOnClose = opts.exitOnClose ?? true;

  let socket: net.Socket | null = null;
  let buffer = '';
  let closed = false;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const CALL_TIMEOUT_MS = 120_000; // a call with no result/error frame this long is presumed wedged

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
        process.stderr.write('SAI host socket closed unexpectedly\n');
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
        const timer = setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`tool call ${tool} timed out after ${CALL_TIMEOUT_MS}ms`));
        }, CALL_TIMEOUT_MS);
        // handleFrame / rejectAllPending call these, so the timer is always cleared on settle.
        pending.set(id, {
          resolve: (v: unknown) => { clearTimeout(timer); resolve(v); },
          reject: (e: Error) => { clearTimeout(timer); reject(e); },
        });
        try {
          socket?.write(
            JSON.stringify({ type: 'call', id, tool, input }) + '\n',
          );
        } catch (err) {
          clearTimeout(timer);
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
    process.stderr.write(`SAI host rejected handshake: ${msg}\n`);
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
