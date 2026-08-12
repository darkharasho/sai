import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { enrichedEnv } from '../shellEnv';
import { resolveBundledCodex } from './bundledModels';
import type { CodexMcpRuntimeServerStatus, CodexMcpRuntimeStatus } from './types';

export interface AppServerNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface AppServerServerRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface AppServerServerRequestResponder {
  readonly request: AppServerServerRequest;
  respond(result?: unknown): void;
  reject(error: JsonRpcError): void;
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
  onServerRequest(listener: (request: AppServerServerRequest) => void): () => void;
  claimServerRequest(id: string | number): AppServerServerRequestResponder;
  onFailure(listener: (error: AppServerUnavailableError) => void): () => void;
  /** A read-only, sanitized snapshot; it never contains Codex MCP config. */
  getMcpRuntimeStatus(): CodexMcpRuntimeStatus;
  /** Refreshes the snapshot through App Server after its handshake completes. */
  refreshMcpRuntimeStatus(): Promise<CodexMcpRuntimeStatus>;
  destroy(): void;
}

type AppServerSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface AppServerClientDeps {
  spawn?: AppServerSpawn;
  resolveBundledCodex?: typeof resolveBundledCodex;
  getEnv?: () => NodeJS.ProcessEnv;
  clientInfo?: { name: string; version: string };
  initializationTimeoutMs?: number;
  /** Experimental APIs are reserved for the isolated Swarm orchestrator host. */
  experimentalApi?: boolean;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  failOnResponseError: boolean;
}

interface PendingServerRequest {
  request: AppServerServerRequest;
  claimed: boolean;
  resolved: boolean;
  active: boolean;
}

const DEFAULT_INITIALIZATION_TIMEOUT_MS = 10_000;
const MCP_STATUS_MAX_PAGES = 8;
const MCP_STATUS_MAX_SERVERS = 100;
const MCP_STATUS_MAX_CURSOR_LENGTH = 512;
const MCP_STATUS_MAX_TEXT_LENGTH = 512;
const MCP_STATUS_MAX_TOOLS = 10_000;

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

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, MCP_STATUS_MAX_TEXT_LENGTH) : undefined;
}

function lifecycle(value: unknown): CodexMcpRuntimeServerStatus['lifecycle'] | undefined {
  switch (value) {
    case 'starting':
    case 'connecting': return 'starting';
    case 'running':
    case 'connected':
    case 'ready': return 'running';
    case 'failed':
    case 'error': return 'failed';
    case 'disabled': return 'disabled';
    default: return undefined;
  }
}

function authentication(value: unknown): CodexMcpRuntimeServerStatus['authentication'] | undefined {
  switch (value) {
    case 'authenticated': return 'authenticated';
    case 'unauthenticated': return 'unauthenticated';
    case 'not-required':
    case 'notRequired': return 'not-required';
    case 'unknown': return 'unknown';
    default: return undefined;
  }
}

/** Keep App Server's evolving status payload strictly on the main-process side. */
export function normalizeMcpRuntimeServerStatus(value: unknown): CodexMcpRuntimeServerStatus | undefined {
  if (!isRecord(value)) return undefined;
  const name = boundedText(value.name);
  const status = lifecycle(value.status);
  const auth = authentication(value.authStatus ?? value.authentication) ?? 'unknown';
  const toolCount = Array.isArray(value.tools)
    ? value.tools.length
    : typeof value.toolCount === 'number' && Number.isSafeInteger(value.toolCount) && value.toolCount >= 0 && value.toolCount <= MCP_STATUS_MAX_TOOLS
      ? value.toolCount
      : undefined;
  if (!name || !status || toolCount === undefined || toolCount > MCP_STATUS_MAX_TOOLS) return undefined;
  const rawError = typeof value.error === 'string' ? value.error : isRecord(value.error) ? value.error.message : value.failureReason;
  const failureReason = boundedText(rawError);
  return { name, lifecycle: status, authentication: auth, toolCount, ...(failureReason ? { failureReason } : {}) };
}

/**
 * Minimal, lifecycle-safe transport for the Codex App Server preview.
 * Its protocol boundary leaves server-initiated requests inert until the
 * backend synchronously claims them; unclaimed requests fail closed.
 */
export class AppServerClient implements AppServerClientTransport {
  private readonly spawnImpl: AppServerSpawn;
  private readonly resolveExecutable: typeof resolveBundledCodex;
  private readonly getEnv: () => NodeJS.ProcessEnv;
  private readonly clientInfo: { name: string; version: string };
  private readonly initializationTimeoutMs: number;
  private readonly experimentalApi: boolean;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(message: AppServerNotification) => void>();
  private readonly serverRequestListeners = new Set<(request: AppServerServerRequest) => void>();
  private readonly pendingServerRequests = new Map<string | number, PendingServerRequest>();
  private readonly failureListeners = new Set<(error: AppServerUnavailableError) => void>();
  private readonly mcpRuntimeStatuses = new Map<string, CodexMcpRuntimeServerStatus>();
  private child: ChildProcess | undefined;
  private startPromise: Promise<void> | undefined;
  private nextId = 0;
  private buffer = '';
  private initialized = false;
  private destroyed = false;
  private failure: AppServerUnavailableError | undefined;
  private initializationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: AppServerClientDeps = {}) {
    this.spawnImpl = deps.spawn ?? spawn;
    this.resolveExecutable = deps.resolveBundledCodex ?? resolveBundledCodex;
    this.getEnv = deps.getEnv ?? enrichedEnv;
    this.clientInfo = deps.clientInfo ?? { name: 'sai', version: '1.0' };
    this.initializationTimeoutMs = deps.initializationTimeoutMs && deps.initializationTimeoutMs > 0
      ? deps.initializationTimeoutMs
      : DEFAULT_INITIALIZATION_TIMEOUT_MS;
    this.experimentalApi = deps.experimentalApi === true;
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
      const initialization = this.sendRequest('initialize', {
        clientInfo: this.clientInfo,
        ...(this.experimentalApi ? { capabilities: { experimentalApi: true } } : {}),
      }, {
        allowBeforeInitialized: true,
        failOnResponseError: true,
      });
      this.initializationTimer = setTimeout(() => {
        this.fail(new AppServerUnavailableError(`Codex App Server initialization timed out after ${this.initializationTimeoutMs}ms`));
      }, this.initializationTimeoutMs);
      this.startPromise = initialization
        .then(() => {
          this.write({ method: 'initialized' });
          this.initialized = true;
        })
        .finally(() => this.clearInitializationTimeout());
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
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  onNotification(listener: (message: AppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onServerRequest(listener: (request: AppServerServerRequest) => void): () => void {
    this.serverRequestListeners.add(listener);
    return () => this.serverRequestListeners.delete(listener);
  }

  claimServerRequest(id: string | number): AppServerServerRequestResponder {
    const pending = this.pendingServerRequests.get(id);
    if (!pending || pending.claimed || pending.resolved || !pending.active) {
      throw new AppServerProtocolError(`App Server request is unknown or already claimed: ${String(id)}`);
    }
    pending.claimed = true;
    return {
      request: pending.request,
      respond: (result?: unknown) => this.settleServerRequest(pending, { result: result === undefined ? null : result }),
      reject: (error: JsonRpcError) => this.settleServerRequest(pending, { error }),
    };
  }

  onFailure(listener: (error: AppServerUnavailableError) => void): () => void {
    this.failureListeners.add(listener);
    if (this.failure) listener(this.failure);
    return () => this.failureListeners.delete(listener);
  }

  getMcpRuntimeStatus(): CodexMcpRuntimeStatus {
    if (this.failure) return { available: false, reason: this.failure.message, servers: [] };
    if (!this.initialized) return { available: false, reason: 'Codex App Server transport is not initialized', servers: [] };
    return { available: true, servers: [...this.mcpRuntimeStatuses.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async refreshMcpRuntimeStatus(): Promise<CodexMcpRuntimeStatus> {
    if (this.failure) throw this.failure;
    if (!this.initialized) throw new AppServerUnavailableError('Codex App Server transport is not initialized');
    const statuses = new Map<string, CodexMcpRuntimeServerStatus>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MCP_STATUS_MAX_PAGES && statuses.size < MCP_STATUS_MAX_SERVERS; page += 1) {
      const result = await this.request<unknown>('mcpServerStatus/list', {
        detail: 'toolsAndAuthOnly',
        limit: MCP_STATUS_MAX_SERVERS,
        ...(cursor ? { cursor } : {}),
      });
      const body = isRecord(result) ? result : undefined;
      const data = Array.isArray(body?.data) ? body.data : [];
      for (const entry of data) {
        const normalized = normalizeMcpRuntimeServerStatus(entry);
        if (normalized) statuses.set(normalized.name, normalized);
        if (statuses.size >= MCP_STATUS_MAX_SERVERS) break;
      }
      const nextCursor = typeof body?.nextCursor === 'string' && body.nextCursor.length > 0 && body.nextCursor.length <= MCP_STATUS_MAX_CURSOR_LENGTH
        ? body.nextCursor
        : undefined;
      if (!nextCursor || cursors.has(nextCursor)) break;
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    this.mcpRuntimeStatuses.clear();
    for (const [name, status] of statuses) this.mcpRuntimeStatuses.set(name, status);
    return this.getMcpRuntimeStatus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fail(new AppServerUnavailableError('Codex App Server transport was destroyed'));
  }

  private attach(child: ChildProcess): void {
    if (!child.stdin || !child.stdout) throw new AppServerUnavailableError('Codex App Server did not expose piped stdio');
    child.stdout.on('data', (chunk: Buffer | string) => this.accept(chunk.toString()));
    child.stdin.on('error', (error) => this.fail(new AppServerUnavailableError(`Codex App Server stdin error: ${errorText(error)}`)));
    child.stdout.on('error', (error) => this.fail(new AppServerUnavailableError(`Codex App Server stdout error: ${errorText(error)}`)));
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
      const request: AppServerServerRequest = {
        id: message.id,
        method: message.method,
        ...(Object.prototype.hasOwnProperty.call(message, 'params') ? { params: message.params } : {}),
      };
      if (this.pendingServerRequests.has(request.id)) {
        this.fail(new AppServerProtocolError(`Codex App Server sent a duplicate server request ID: ${String(request.id)}`));
        return;
      }
      const pending: PendingServerRequest = { request, claimed: false, resolved: false, active: true };
      this.pendingServerRequests.set(request.id, pending);
      for (const listener of this.serverRequestListeners) {
        try {
          listener(request);
        } catch (error) {
          this.rejectUnclaimedServerRequest(pending, `App Server server request handler failed: ${errorText(error)}`);
          return;
        }
      }
      if (!pending.claimed) this.rejectUnclaimedServerRequest(pending);
      return;
    }
    const notification: AppServerNotification = {
      jsonrpc: '2.0', method: message.method,
      ...(Object.prototype.hasOwnProperty.call(message, 'params') ? { params: message.params } : {}),
    };
    this.applyMcpRuntimeStatusUpdate(notification);
    for (const listener of this.listeners) listener(notification);
  }

  private applyMcpRuntimeStatusUpdate(notification: AppServerNotification): void {
    if (notification.method !== 'mcpServer/startupStatus/updated') return;
    const params = isRecord(notification.params) ? notification.params : undefined;
    const raw = params?.server ?? params;
    const normalized = normalizeMcpRuntimeServerStatus(raw);
    if (normalized) {
      this.mcpRuntimeStatuses.set(normalized.name, normalized);
      return;
    }
    // The documented notification only carries startup fields. Merge those
    // into an existing, already-sanitized list entry; never synthesize a new
    // server from partial protocol data.
    if (!isRecord(raw)) return;
    const name = boundedText(raw.name);
    const status = lifecycle(raw.status);
    const previous = name ? this.mcpRuntimeStatuses.get(name) : undefined;
    if (!name || !status || !previous) return;
    const rawError = typeof raw.error === 'string' ? raw.error : isRecord(raw.error) ? raw.error.message : raw.failureReason;
    const failureReason = boundedText(rawError);
    this.mcpRuntimeStatuses.set(name, {
      ...previous,
      lifecycle: status,
      ...(failureReason ? { failureReason } : {}),
    });
  }

  private rejectUnclaimedServerRequest(pending: PendingServerRequest, failureReason = 'Unsupported App Server request in preview'): void {
    if (!pending.active || pending.claimed) return;
    pending.active = false;
    pending.resolved = true;
    this.pendingServerRequests.delete(pending.request.id);
    try {
      this.write({
        id: pending.request.id,
        error: { code: -32601, message: 'Unsupported App Server request in preview' },
      });
    } catch {
      return;
    }
    this.fail(new AppServerUnavailableError(failureReason));
  }

  private settleServerRequest(
    pending: PendingServerRequest,
    response: { result: unknown } | { error: JsonRpcError },
  ): void {
    if (pending.resolved) throw new AppServerProtocolError(`App Server request is already resolved: ${String(pending.request.id)}`);
    if (!pending.active || this.pendingServerRequests.get(pending.request.id) !== pending) {
      throw new AppServerUnavailableError(`App Server request is no longer active: ${String(pending.request.id)}`);
    }
    pending.active = false;
    pending.resolved = true;
    this.pendingServerRequests.delete(pending.request.id);
    this.write({ id: pending.request.id, ...response });
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
      try { this.write({ id, method, ...(params === undefined ? {} : { params }) }); }
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
    this.mcpRuntimeStatuses.clear();
    this.initialized = false;
    this.clearInitializationTimeout();
    for (const pending of this.pending.values()) pending.reject(unavailable);
    this.pending.clear();
    for (const pending of this.pendingServerRequests.values()) pending.active = false;
    this.pendingServerRequests.clear();
    for (const listener of this.failureListeners) listener(unavailable);
    const child = this.child;
    this.child = undefined;
    try { child?.kill(); } catch { /* process already exited */ }
  }

  private clearInitializationTimeout(): void {
    if (!this.initializationTimer) return;
    clearTimeout(this.initializationTimer);
    this.initializationTimer = undefined;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
