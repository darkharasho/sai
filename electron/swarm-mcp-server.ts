/**
 * SAI Swarm MCP Server
 *
 * A standalone Node script (built to dist-electron/swarm-mcp-server.js) that
 * speaks the Model Context Protocol over stdio. It is spawned by Claude CLI
 * when SAI launches a Claude orchestrator session with the SAI-managed
 * --mcp-config.
 *
 * For Task 1, this server only implements `initialize`, `tools/list`, and
 * the `notifications/initialized` no-op. Tool calls return JSON-RPC error
 * -32601 ("method not yet implemented; socket transport pending"). Task 3
 * will wire `tools/call` over the Unix socket / Windows named pipe to the
 * SAI host process.
 */

import { createInterface } from 'node:readline';
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

let envState: SwarmMcpEnv | null = null;

export function setEnv(env: SwarmMcpEnv | null): void {
  envState = env;
}

export function getEnv(): SwarmMcpEnv | null {
  return envState;
}

const PROTOCOL_VERSION = '2024-11-05';

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
 */
export function handleRequest(req: JsonRpcRequest): JsonRpcResponse | null {
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

    case 'tools/call':
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: 'method not yet implemented; socket transport pending',
        },
      };

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

export function main(): void {
  const env = readEnvOrExit();
  setEnv(env);

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

    try {
      const res = handleRequest(req);
      if (res !== null) writeResponse(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`handler error: ${message}\n`);
      writeResponse({
        jsonrpc: '2.0',
        id: (req.id ?? null) as number | string | null,
        error: { code: -32603, message: 'internal error' },
      });
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Only auto-run when this file is the Node entry point (not when imported by tests).
// The CJS build sets require.main === module; under tsx/ESM-style imports it won't.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
