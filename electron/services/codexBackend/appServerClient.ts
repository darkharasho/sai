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

export interface AppServerClientTransport {
  readonly failureReason: string | undefined;
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (message: AppServerNotification) => void): () => void;
  onFailure(listener: (error: AppServerUnavailableError) => void): () => void;
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
  failOnResponseError: boolean;
}

function messageText(error: JsonRpcError): string {
  return `${error.message} (${error.code})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string';
}

function isRequestId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

/**
 * Minimal, lifecycle-safe transport for the Codex App Server preview.
 * Its protocol boundary is deliberately limited: server initiated requests are
 * rejected until a UI is available to handle them safely.
 */
export class AppServerClient implements AppServerClientTransport {
  private readonly spawnImpl: AppServerSpawn;
  private readonly resolveExecutable: typeof resolveBundledCodex;
  private readonly getEnv: () => NodeJS.ProcessEnv;
  private readonly clientInfo: { name: string; version: string };
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(message: AppServerNotification) => void>();
  private readonly failureListeners = new Set<(error: AppServerUnavailableError) => void>();
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

  get failureReason(): string | undefined {
    return this.failure?.message;
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
        // Diagnostics are intentionally ignored. A piped-but-unread stderr can
        // fill its OS buffer and block this long-lived child process.
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      this.attach(this.child);
      this.startPromise = this.sendRequest('initialize', { clientInfo: this.clientInfo }, {
        allowBeforeInitialized: true,
        failOnResponseError: true,
      })
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
    if (this.failure) throw this.failure;
    if (!this.initialized) throw new AppServerUnavailableError('Codex App Server transport is not initialized');
    return this.sendRequest(method, params) as Promise<T>;
  }

  notify(method: string, params?: unknown): void {
    if (this.failure) throw this.failure;
    if (!this.initialized) throw new AppServerUnavailableError('Codex App Server transport is not initialized');
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(listener: (message: AppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFailure(listener: (error: AppServerUnavailableError) => void): () => void {
    this.failureListeners.add(listener);
    if (this.failure) listener(this.failure);
    return () => this.failureListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fail(new AppServerUnavailableError('Codex App Server transport was destroyed'));
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
      this.handleResponse(message);
      return;
    }
    if (typeof message.method !== 'string') {
      this.fail(new AppServerProtocolError('Codex App Server sent an invalid JSON-RPC message'));
      return;
    }
    if ('id' in message) {
      if (!isRequestId(message.id)) {
        this.fail(new AppServerProtocolError('Codex App Server sent an invalid JSON-RPC request ID'));
        return;
      }
      try {
        this.write({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32601, message: 'Unsupported App Server request in preview' },
        });
      } catch {
        return;
      }
      this.fail(new AppServerUnavailableError('Unsupported App Server request in preview'));
      return;
    }
    const notification: AppServerNotification = {
      jsonrpc: '2.0', method: message.method,
      ...(Object.prototype.hasOwnProperty.call(message, 'params') ? { params: message.params } : {}),
    };
    for (const listener of this.listeners) listener(notification);
  }

  private handleResponse(message: Record<string, unknown>): void {
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
    if (message.error !== undefined) {
      if (!isJsonRpcError(message.error)) {
        const error = new AppServerProtocolError('Codex App Server returned an invalid JSON-RPC error');
        if (pending.failOnResponseError) this.fail(error);
        pending.reject(this.failure ?? error);
        return;
      }
      const error = new AppServerProtocolError(messageText(message.error));
      if (pending.failOnResponseError) this.fail(error);
      pending.reject(this.failure ?? error);
      return;
    }
    pending.resolve(message.result);
  }

  private sendRequest(
    method: string,
    params?: unknown,
    options: { allowBeforeInitialized?: boolean; failOnResponseError?: boolean } = {},
  ): Promise<unknown> {
    if (!options.allowBeforeInitialized && !this.initialized) return Promise.reject(new AppServerUnavailableError('Codex App Server transport is not initialized'));
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, failOnResponseError: options.failOnResponseError ?? false });
      try { this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new AppServerUnavailableError(errorText(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin || this.destroyed) throw this.failure ?? new AppServerUnavailableError('Codex App Server transport is unavailable');
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.fail(new AppServerUnavailableError(`Codex App Server transport write failed: ${errorText(error)}`));
      throw this.failure;
    }
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
    for (const listener of this.failureListeners) listener(unavailable);
    const child = this.child;
    this.child = undefined;
    try { child?.kill(); } catch { /* process already exited */ }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
