import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

export interface SwarmToolCallRequest {
  id: string;
  tool: string;
  input: any;
  workspace: string;
}

export interface SwarmToolCallResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export interface SwarmMcpHostHandle {
  socketPath: string;
  secret: string;
}

type ToolCallHandler = (req: SwarmToolCallRequest) => Promise<unknown>;

interface ConnState {
  workspace: string | null;
  authed: boolean;
  buffer: string;
}

interface HostInstance {
  server: net.Server;
  handle: SwarmMcpHostHandle;
  connections: Map<net.Socket, ConnState>;
}

let instance: HostInstance | null = null;
let handler: ToolCallHandler | null = null;

function defaultSocketPath(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\sai-swarm-${process.pid}`
    : path.join(os.tmpdir(), `sai-swarm-${process.pid}.sock`);
}

function defaultSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function safeWrite(socket: net.Socket, obj: unknown): void {
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch {
    // socket might be closed; ignore
  }
}

function closeWith(socket: net.Socket, err: string): void {
  safeWrite(socket, { type: 'error', error: err });
  try { socket.end(); } catch { /* noop */ }
}

async function processFrame(
  socket: net.Socket,
  state: ConnState,
  raw: string,
): Promise<void> {
  let frame: any;
  try {
    frame = JSON.parse(raw);
  } catch {
    closeWith(socket, 'invalid json');
    return;
  }

  if (!state.authed) {
    if (!frame || frame.type !== 'hello') {
      closeWith(socket, 'expected hello first');
      return;
    }
    if (typeof frame.secret !== 'string' || !instance || frame.secret !== instance.handle.secret) {
      closeWith(socket, 'auth failed');
      return;
    }
    state.workspace = typeof frame.workspace === 'string' ? frame.workspace : '';
    state.authed = true;
    safeWrite(socket, { type: 'welcome' });
    return;
  }

  if (!frame || frame.type !== 'call') {
    safeWrite(socket, { type: 'error', id: frame?.id, error: 'expected call frame' });
    return;
  }

  const id = typeof frame.id === 'string' ? frame.id : '';
  const tool = typeof frame.tool === 'string' ? frame.tool : '';
  const input = frame.input ?? {};

  if (!handler) {
    safeWrite(socket, { type: 'error', id, error: 'no handler registered' });
    return;
  }

  try {
    const result = await handler({
      id,
      tool,
      input,
      workspace: state.workspace ?? '',
    });
    if (socket.destroyed) return;
    safeWrite(socket, { type: 'result', id, result });
  } catch (err) {
    if (socket.destroyed) return;
    const msg = err instanceof Error ? err.message : String(err);
    safeWrite(socket, { type: 'error', id, error: msg });
  }
}

function attachConnection(socket: net.Socket): void {
  if (!instance) {
    socket.destroy();
    return;
  }
  const state: ConnState = { workspace: null, authed: false, buffer: '' };
  instance.connections.set(socket, state);

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    state.buffer += chunk;
    let idx: number;
    while ((idx = state.buffer.indexOf('\n')) !== -1) {
      const line = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (!line) continue;
      // fire and forget; processFrame handles its own errors
      void processFrame(socket, state, line);
    }
  });

  const cleanup = () => {
    instance?.connections.delete(socket);
  };
  socket.on('close', cleanup);
  socket.on('error', () => {
    cleanup();
    try { socket.destroy(); } catch { /* noop */ }
  });
}

interface StartOptions {
  socketPath?: string;
  secret?: string;
}

function startInternal(opts: StartOptions = {}): SwarmMcpHostHandle {
  if (instance) return instance.handle;

  const socketPath = opts.socketPath ?? defaultSocketPath();
  const secret = opts.secret ?? defaultSecret();

  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch { /* stale socket may not exist */ }
  }

  const server = net.createServer((socket) => attachConnection(socket));
  server.on('error', (err) => {
    // Avoid crashing main on listen errors; log only
    console.error('[swarm-mcp-host] server error:', err);
  });
  server.listen(socketPath);

  instance = {
    server,
    handle: { socketPath, secret },
    connections: new Map(),
  };
  return instance.handle;
}

export function start(): SwarmMcpHostHandle {
  return startInternal();
}

/** @internal */
export function _test_start(opts: StartOptions = {}): SwarmMcpHostHandle {
  return startInternal(opts);
}

export function stop(): void {
  if (!instance) return;
  const inst = instance;
  instance = null;
  for (const sock of inst.connections.keys()) {
    try { sock.destroy(); } catch { /* noop */ }
  }
  inst.connections.clear();
  try { inst.server.close(); } catch { /* noop */ }
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(inst.handle.socketPath); } catch { /* noop */ }
  }
}

export function onToolCall(h: (req: SwarmToolCallRequest) => Promise<unknown>): void {
  handler = h;
}

/** @internal */
export function _resetForTests(): void {
  stop();
  handler = null;
}
