import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import path from 'node:path';
import { enrichedEnv } from '../shellEnv';
import { resolveBundledCodex } from './bundledModels';

export interface AppServerNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcRequest extends AppServerNotification {
  id: number | string;
}

export class AppServerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppServerProtocolError';
  }
}

export class AppServerUnavailableError extends AppServerProtocolError {
  constructor(message: string) {
    super(message);
    this.name = 'AppServerUnavailableError';
  }
}

export interface AppServerClient {
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (message: AppServerNotification) => void): () => void;
  destroy(): void;
}

type AppServerSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcess;

export interface AppServerClientDeps {
  spawn?: AppServerSpawn;
  resolveBundledCodex?: typeof resolveBundledCodex;
  getEnv?: () => NodeJS.ProcessEnv;
  clientInfo?: { name: string; version: string };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function messageText(error: JsonRpcError): string {
  return `${error.message} (${error.code})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Minimal, lifecycle-safe transport for the Codex App Server preview.
 * Its protocol boundary is deliberately limited: server initiated requests are
 * rejected until a UI is available to handle them safely.
 */
export class AppServerClient implements AppServerClient {
  private readonly spawnImpl: AppServerSpawn;
  private readonly resolveExecutable: typeof resolveBundledCodex;
  private readonly getEnv: () => NodeJS.ProcessEnv;
  private readonly clientInfo: { name: string; version: string };
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(message: AppServerNotification) => void>();
  private child: ChildProcess | undefined;
  private startPromise: Promise<void> | undefined;
  private nextId = 0;
  private buffer = '';
  private initialized = false;
  private destroyed = false;
  private failure: AppServerUnavailableError | undefined;

  constructor(deps: AppServerClientDeps = {}) {
    this.spawnImpl = deps.spawn ?? spawn;
    this.resolveExecutable = deps.resolveBundledCodex ?? resolveBundledCodex;
    this.getEnv = deps.getEnv ?? enrichedEnv;
    this.clientInfo = deps.clientInfo ?? { name: 'sai', version: '1.0' };
  }

  start(): Promise<void> {
    if (this.destroyed) return Promise.reject(new AppServerUnavailableError('Codex App Server transport was destroyed'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.startPromise) return this.startPromise;

    try {
      const bundled = this.resolveExecutable();
      const env = { ...this.getEnv() };
      const pathKey = process.platform === 'win32'
        ? Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
        : 'PATH';
      env[pathKey] = [...bundled.pathDirs, env[pathKey]].filter(Boolean).join(path.delimiter);
      this.child = this.spawnImpl(bundled.executablePath, ['app-server'], {
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.attach(this.child);
      this.startPromise = this.sendRequest('initialize', { clientInfo: this.clientInfo }, true)
        .then(() => {
          this.write({ jsonrpc: '2.0', method: 'initialized' });
          this.initialized = true;
        });
    } catch (error) {
      this.fail(new AppServerUnavailableError(`Unable to start Codex App Server: ${errorText(error)}`));
      this.startPromise = Promise.reject(this.failure);
    }
    return this.startPromise;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.initialized) throw new AppServerUnavailableError('Codex App Server transport is not initialized');
    return this.sendRequest(method, params) as Promise<T>;
  }

  notify(method: string, params?: unknown): void {
    if (!this.initialized) throw new AppServerUnavailableError('Codex App Server transport is not initialized');
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(listener: (message: AppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fail(new AppServerUnavailableError('Codex App Server transport was destroyed'));
    try { this.child?.kill(); } catch { /* process already exited */ }
    this.child = undefined;
  }

  private attach(child: ChildProcess): void {
    if (!child.stdin || !child.stdout) throw new AppServerUnavailableError('Codex App Server did not expose piped stdio');
    child.stdout.on('data', (chunk: Buffer | string) => this.accept(chunk.toString()));
    child.on('error', (error) => this.fail(new AppServerUnavailableError(`Codex App Server transport error: ${errorText(error)}`)));
    child.on('exit', (code, signal) => {
      if (!this.destroyed) this.fail(new AppServerUnavailableError(`Codex App Server transport exited${code === null || code === undefined ? '' : ` (${code})`}${signal ? ` (${signal})` : ''}`));
    });
  }

  private accept(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let message: unknown;
      try { message = JSON.parse(raw); }
      catch { this.fail(new AppServerProtocolError('Codex App Server sent malformed JSON')); return; }
      this.handle(message);
      if (this.failure) return;
    }
  }

  private handle(message: unknown): void {
    if (!isRecord(message)) {
      this.fail(new AppServerProtocolError('Codex App Server sent an invalid JSON-RPC message'));
      return;
    }
    if ('id' in message && !('method' in message)) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }
    if (typeof message.method !== 'string') {
      this.fail(new AppServerProtocolError('Codex App Server sent an invalid JSON-RPC message'));
      return;
    }
    if ('id' in message) {
      const request = message as JsonRpcRequest;
      this.write({
        jsonrpc: '2.0', id: request.id,
        error: { code: -32601, message: 'Unsupported App Server request in preview' },
      });
      return;
    }
    const notification: AppServerNotification = {
      jsonrpc: '2.0', method: message.method,
      ...(Object.prototype.hasOwnProperty.call(message, 'params') ? { params: message.params } : {}),
    };
    for (const listener of this.listeners) listener(notification);
  }

  private handleResponse(message: JsonRpcResponse): void {
    if (typeof message.id !== 'number') {
      this.fail(new AppServerProtocolError('Codex App Server returned an unexpected response ID'));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.fail(new AppServerProtocolError(`Codex App Server returned an unexpected response ID: ${message.id}`));
      return;
    }
    this.pending.delete(message.id);
    if (message.error) pending.reject(new AppServerProtocolError(messageText(message.error)));
    else pending.resolve(message.result);
  }

  private sendRequest(method: string, params?: unknown, allowBeforeInitialized = false): Promise<unknown> {
    if (!allowBeforeInitialized && !this.initialized) return Promise.reject(new AppServerUnavailableError('Codex App Server transport is not initialized'));
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new AppServerUnavailableError(errorText(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin || this.destroyed) throw this.failure ?? new AppServerUnavailableError('Codex App Server transport is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: AppServerProtocolError): void {
    if (this.failure) return;
    const unavailable = error instanceof AppServerUnavailableError
      ? error
      : new AppServerUnavailableError(error.message);
    this.failure = unavailable;
    this.initialized = false;
    for (const pending of this.pending.values()) pending.reject(unavailable);
    this.pending.clear();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
