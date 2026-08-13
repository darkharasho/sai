import { emitChatMessage, getMainWin } from '../claude';
import { notifyCompletion } from '../notify';
import { registerWorkspaceBackendHooks } from '../workspace';
import { fetchBundledCodexModels } from './bundledModels';
import { AppServerBackend } from './appServerBackend';
import { SdkCodexBackend } from './sdkBackend';
import { CODEX_MCP_CONFIG_CONFIRMATION_TOKEN, codexScopeKey, isCodexMcpConfigWriteRequest, type CodexAppServerPreviewStatus, type CodexApprovalDecision, type CodexApprovalResult, type CodexBackend, type CodexBackendMode, type CodexMcpConfigResult, type CodexMcpConfigServer, type CodexMcpElicitationDecision, type CodexMcpRuntimeStatus, type CodexModelResult, type CodexSendArgs, type CodexStartArgs, type CodexUserInputResponse } from './types';

export * from './types';

type BackendFactory = () => CodexBackend;
type BackendByMode = Partial<Record<CodexBackendMode, CodexBackend>>;

const CODEX_MCP_SDK_UNAVAILABLE_REASON = 'Codex MCP runtime status is unavailable on the SDK backend.';
const CODEX_MCP_CONFIG_UNAVAILABLE: CodexMcpConfigResult = { ok: false, code: 'unavailable' };
const CODEX_MCP_CONFIG_RESULT_CODES = new Set(['unavailable', 'invalid', 'conflict', 'host-error']);

function sanitizeCodexMcpConfigResult(value: unknown): CodexMcpConfigResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'host-error' };
  const result = value as Record<string, unknown>;
  if (result.ok === false && Object.keys(result).length === 2 && typeof result.code === 'string' && CODEX_MCP_CONFIG_RESULT_CODES.has(result.code)) {
    return { ok: false, code: result.code as Extract<CodexMcpConfigResult, { ok: false }>['code'] };
  }
  if (result.ok !== true || Object.keys(result).length !== 2 || !result.snapshot || typeof result.snapshot !== 'object' || Array.isArray(result.snapshot)) {
    return { ok: false, code: 'host-error' };
  }
  const snapshot = result.snapshot as Record<string, unknown>;
  if (Object.keys(snapshot).length !== 3 || snapshot.impact !== 'global-user-config'
    || !isCodexMcpConfigWriteRequest({ expectedVersion: snapshot.version, servers: snapshot.servers, confirmationToken: CODEX_MCP_CONFIG_CONFIRMATION_TOKEN })) {
    return { ok: false, code: 'host-error' };
  }
  return { ok: true, snapshot: { version: snapshot.version as string, impact: 'global-user-config', servers: snapshot.servers as CodexMcpConfigServer[] } };
}
const CODEX_MCP_INVALID_DATA_REASON = 'Codex MCP runtime status returned invalid data.';
const CODEX_MCP_LIFECYCLES = new Set(['unknown', 'available', 'starting', 'running', 'failed', 'disabled']);
const CODEX_MCP_AUTHENTICATION = new Set(['authenticated', 'unauthenticated', 'not-required', 'unknown']);

/**
 * App Server status is already normalized at the protocol boundary, but this
 * second, narrow validation prevents a future backend change from leaking
 * arbitrary protocol fields through the preload bridge.
 */
function sanitizeCodexMcpRuntimeStatus(value: unknown): CodexMcpRuntimeStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { available: false, reason: CODEX_MCP_INVALID_DATA_REASON, servers: [] };
  }
  const status = value as Record<string, unknown>;
  if (typeof status.available !== 'boolean' || !Array.isArray(status.servers)
    || (status.reason !== undefined && (typeof status.reason !== 'string' || status.reason.length > 1_000))
    || status.servers.length > 100) {
    return { available: false, reason: CODEX_MCP_INVALID_DATA_REASON, servers: [] };
  }
  const servers = [] as CodexMcpRuntimeStatus['servers'];
  for (const entry of status.servers) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { available: false, reason: CODEX_MCP_INVALID_DATA_REASON, servers: [] };
    }
    const server = entry as Record<string, unknown>;
    if (typeof server.name !== 'string' || server.name.length === 0 || server.name.length > 200
      || typeof server.lifecycle !== 'string' || !CODEX_MCP_LIFECYCLES.has(server.lifecycle)
      || typeof server.authentication !== 'string' || !CODEX_MCP_AUTHENTICATION.has(server.authentication)
      || typeof server.toolCount !== 'number' || !Number.isSafeInteger(server.toolCount) || server.toolCount < 0 || server.toolCount > 10_000
      || (server.failureReason !== undefined && (typeof server.failureReason !== 'string' || server.failureReason.length > 1_000))) {
      return { available: false, reason: CODEX_MCP_INVALID_DATA_REASON, servers: [] };
    }
    servers.push({
      name: server.name,
      lifecycle: server.lifecycle as CodexMcpRuntimeStatus['servers'][number]['lifecycle'],
      authentication: server.authentication as CodexMcpRuntimeStatus['servers'][number]['authentication'],
      toolCount: server.toolCount,
      ...(typeof server.failureReason === 'string' ? { failureReason: server.failureReason } : {}),
    });
  }
  return {
    available: status.available,
    ...(typeof status.reason === 'string' ? { reason: status.reason } : {}),
    servers,
  };
}

let active: CodexBackend | null = null;
let requestedMode: CodexBackendMode = 'sdk';
let createSdkBackend: BackendFactory = makeSdkBackend;
let createAppServerBackend: BackendFactory = makeAppServerBackend;

interface AppServerPreviewBackend extends CodexBackend {
  readonly previewStatus: CodexAppServerPreviewStatus;
}

function makeSdkBackend(): CodexBackend {
  return new SdkCodexBackend({
    emit: emitChatMessage,
    getModels: fetchBundledCodexModels,
    notifyCompletion: (projectPath, info) => {
      const win = getMainWin();
      if (win) notifyCompletion(win, projectPath, info);
    },
  });
}

function makeAppServerBackend(): CodexBackend {
  return new AppServerBackend({ emit: emitChatMessage });
}

function isAppServerPreviewBackend(backend: CodexBackend | null | undefined): backend is AppServerPreviewBackend {
  return Boolean(backend && 'previewStatus' in backend);
}

function isScopeBusy(backend: CodexBackend, projectPath: string, scope?: string): boolean {
  return backend.isScopeBusy?.(projectPath, scope) ?? backend.isWorkspaceBusy(projectPath);
}

/**
 * Keeps transport ownership at the same granularity as a Codex conversation.
 * A settings change may select a different transport for new scopes, but an
 * assigned scope remains with the backend that owns its conversation until it
 * is explicitly reset or its workspace is suspended.
 */
class ScopedCodexBackend implements CodexBackend {
  private readonly backends: BackendByMode = {};
  private readonly assignments = new Map<string, CodexBackendMode>();
  private fallbackReason: string | undefined;

  constructor() {
    // Preserve SDK's inexpensive, stable default and model catalogue behavior.
    this.backends.sdk = createSdkBackend();
  }

  get previewStatus(): CodexAppServerPreviewStatus {
    const preview = this.backends['app-server'];
    if (isAppServerPreviewBackend(preview)) return preview.previewStatus;
    return this.fallbackReason ? { available: false, reason: this.fallbackReason } : { available: true };
  }

  retryAppServer(): void {
    this.fallbackReason = undefined;
    const preview = this.backends['app-server'];
    if (!preview || !isAppServerPreviewBackend(preview) || preview.previewStatus.available) return;
    if ([...this.assignments.entries()].some(([key, mode]) => mode === 'app-server' && this.scopeKeyBusy(preview, key))) return;
    preview.destroy();
    delete this.backends['app-server'];
  }

  start(args: CodexStartArgs): Promise<void> | void {
    return this.route(args.projectPath, args.scope, true).start(args);
  }

  send(args: CodexSendArgs): void {
    this.route(args.projectPath, args.scope, true).send(args);
  }

  interrupt(projectPath: string, scope?: string): void {
    this.route(projectPath, scope, false).interrupt(projectPath, scope);
  }

  reconcileScope(projectPath: string, scope?: string): void {
    this.route(projectPath, scope, false).reconcileScope(projectPath, scope);
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const key = codexScopeKey(projectPath, scope);
    const backend = this.route(projectPath, scope, sessionId !== undefined);
    backend.setSessionId(projectPath, sessionId, scope);

    // An explicit session clear is the renderer's new-chat/delete lifecycle.
    // Once the old scope is settled, release its transport ownership so the
    // next conversation in that scope may use the newly selected backend.
    if (sessionId === undefined && !isScopeBusy(backend, projectPath, scope)) {
      this.assignments.delete(key);
    }
  }

  getModels(forceRefresh?: boolean): Promise<CodexModelResult> {
    return this.backendFor(requestedMode).getModels(forceRefresh);
  }

  async getMcpRuntimeStatus(projectPath?: string, scope?: string): Promise<CodexMcpRuntimeStatus> {
    if (!projectPath) return { available: false, reason: 'Codex MCP runtime status requires a project path.', servers: [] };
    const key = codexScopeKey(projectPath, scope);
    const assignedMode = this.assignments.get(key);

    // A running or settled SDK conversation never obtains App Server state:
    // the two transports do not share an MCP connection or configuration.
    if (assignedMode === 'sdk' || (!assignedMode && requestedMode === 'sdk')) {
      return { available: false, reason: CODEX_MCP_SDK_UNAVAILABLE_REASON, servers: [] };
    }

    const backend = this.backendFor('app-server');
    if (backend === this.backends.sdk) {
      return {
        available: false,
        reason: this.fallbackReason
          ? `Codex MCP runtime status is unavailable because App Server preview fell back to the SDK backend: ${this.fallbackReason}`
          : CODEX_MCP_SDK_UNAVAILABLE_REASON,
        servers: [],
      };
    }
    if (!backend.getMcpRuntimeStatus) {
      return { available: false, reason: 'Codex App Server MCP status is unavailable.', servers: [] };
    }
    return backend.getMcpRuntimeStatus(projectPath, scope);
  }

  async getMcpConfig(): Promise<CodexMcpConfigResult> {
    if (requestedMode !== 'app-server') return CODEX_MCP_CONFIG_UNAVAILABLE;
    const backend = this.backendFor('app-server');
    if (backend === this.backends.sdk || !backend.getMcpConfig) return CODEX_MCP_CONFIG_UNAVAILABLE;
    return backend.getMcpConfig();
  }

  async replaceMcpConfig(expectedVersion: string, servers: CodexMcpConfigServer[]): Promise<CodexMcpConfigResult> {
    if (requestedMode !== 'app-server') return CODEX_MCP_CONFIG_UNAVAILABLE;
    const backend = this.backendFor('app-server');
    if (backend === this.backends.sdk || !backend.replaceMcpConfig) return CODEX_MCP_CONFIG_UNAVAILABLE;
    return backend.replaceMcpConfig(expectedVersion, servers);
  }

  async getSwarmStatus(): Promise<CodexAppServerPreviewStatus> {
    if (requestedMode !== 'app-server') {
      return { available: false, reason: 'Codex Swarm requires the App Server preview backend; the SDK backend is selected.' };
    }
    const preview = this.backends['app-server'] ?? (this.backends['app-server'] = createAppServerBackend());
    if (!isAppServerPreviewBackend(preview)) {
      return { available: false, reason: 'Codex Swarm requires an App Server backend with Dynamic Tools support.' };
    }
    if (!preview.previewStatus.available) return preview.previewStatus;
    if (!preview.getSwarmStatus) {
      return { available: false, reason: 'Codex App Server Swarm bridge is unavailable.' };
    }
    return preview.getSwarmStatus();
  }

  approve(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexApprovalDecision): CodexApprovalResult {
    const mode = this.assignments.get(codexScopeKey(projectPath, scope));
    // Never route a decision to a newly selected backend: a request is valid
    // only for the transport that owns the already-started scope.
    if (!mode) return { ok: false, code: 'not-pending' };
    return this.backendFor(mode).approve(projectPath, scope, requestHandle, decision);
  }

  answerUserInput(projectPath: string, scope: string | undefined, requestHandle: string, response: CodexUserInputResponse): CodexApprovalResult {
    const mode = this.assignments.get(codexScopeKey(projectPath, scope));
    if (!mode) return { ok: false, code: 'not-pending' };
    return this.backendFor(mode).answerUserInput(projectPath, scope, requestHandle, response);
  }

  resolveMcpElicitation(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexMcpElicitationDecision): CodexApprovalResult {
    const mode = this.assignments.get(codexScopeKey(projectPath, scope));
    if (!mode) return { ok: false, code: 'not-pending' };
    return this.backendFor(mode).resolveMcpElicitation(projectPath, scope, requestHandle, decision);
  }

  suspendWorkspace(projectPath: string): void {
    for (const backend of Object.values(this.backends)) backend?.suspendWorkspace(projectPath);
    for (const key of this.assignments.keys()) {
      if (!key.startsWith(`${projectPath}\u0000`)) continue;
      this.assignments.delete(key);
    }
  }

  isWorkspaceBusy(projectPath: string): boolean {
    return Object.values(this.backends).some((backend) => backend?.isWorkspaceBusy(projectPath));
  }

  isScopeBusy(projectPath: string, scope?: string): boolean {
    const key = codexScopeKey(projectPath, scope);
    const mode = this.assignments.get(key);
    return mode ? isScopeBusy(this.backendFor(mode), projectPath, scope) : false;
  }

  destroy(): void {
    for (const backend of Object.values(this.backends)) backend?.destroy();
    this.assignments.clear();
    this.backends.sdk = undefined;
    this.backends['app-server'] = undefined;
  }

  private route(projectPath: string, scope: string | undefined, assign: boolean): CodexBackend {
    const key = codexScopeKey(projectPath, scope);
    const assigned = this.assignments.get(key);
    if (assigned) {
      const backend = this.backendFor(assigned);
      // A settled preview scope that falls back to SDK must take ownership of
      // that fallback. Otherwise a later status recovery can silently move the
      // same conversation back to App Server. An active preview turn remains
      // pinned to its original transport until it settles.
      if (assigned === 'app-server' && backend !== this.backends['app-server']) {
        const preview = this.backends['app-server'];
        if (preview && isScopeBusy(preview, projectPath, scope)) return preview;
        this.assignments.set(key, 'sdk');
        return backend;
      }
      // A scope owns one transport for its entire conversation, including
      // between settled turns. The only ordinary release points are an
      // explicit session reset and workspace suspension (above).
      return backend;
    }
    const backend = this.backendFor(requestedMode);
    if (assign) this.assignments.set(key, backend === this.backends['app-server'] ? 'app-server' : 'sdk');
    return backend;
  }

  private backendFor(mode: CodexBackendMode): CodexBackend {
    if (mode === 'sdk') return this.backends.sdk ?? (this.backends.sdk = createSdkBackend());
    const preview = this.backends['app-server'] ?? (this.backends['app-server'] = createAppServerBackend());
    if (!isAppServerPreviewBackend(preview) || preview.previewStatus.available) return preview;
    this.fallbackReason = preview.previewStatus.reason ?? 'Codex App Server preview is unavailable';
    return this.backends.sdk ?? (this.backends.sdk = createSdkBackend());
  }

  private scopeKeyBusy(backend: CodexBackend, key: string): boolean {
    const [projectPath, scope] = key.split('\u0000');
    return isScopeBusy(backend, projectPath, scope);
  }
}

/** Select a backend for new work; existing active scopes retain their transport. */
export function setCodexBackendMode(mode: CodexBackendMode): CodexBackendMode {
  requestedMode = mode;
  if (mode === 'app-server' && active instanceof ScopedCodexBackend) active.retryAppServer();
  return requestedMode;
}

export function getCodexBackendMode(): CodexBackendMode {
  return requestedMode;
}

export function getCodexAppServerPreviewStatus(): CodexAppServerPreviewStatus {
  if (active instanceof ScopedCodexBackend) return active.previewStatus;
  if (isAppServerPreviewBackend(active)) return active.previewStatus;
  return { available: true };
}

/** Runtime capability check for the isolated App Server Dynamic Tools bridge. */
export async function getCodexSwarmStatus(): Promise<CodexAppServerPreviewStatus> {
  const backend = getCodexBackend();
  if (backend instanceof ScopedCodexBackend) return backend.getSwarmStatus();
  return { available: false, reason: 'Codex Swarm requires the App Server preview backend.' };
}

/** Read-only MCP runtime state is intentionally separate from Claude's MCP IPC. */
export async function getCodexMcpRuntimeStatus(projectPath: string, scope?: string): Promise<CodexMcpRuntimeStatus> {
  const backend = getCodexBackend();
  if (!backend.getMcpRuntimeStatus) {
    return { available: false, reason: CODEX_MCP_SDK_UNAVAILABLE_REASON, servers: [] };
  }
  try {
    return sanitizeCodexMcpRuntimeStatus(await backend.getMcpRuntimeStatus(projectPath, scope));
  } catch {
    // Never pass a protocol/process error (which may contain connection or
    // filesystem details) over Electron IPC.
    return { available: false, reason: 'Codex MCP runtime status is unavailable.', servers: [] };
  }
}

/** Global User config is App Server-only and deliberately never touches Claude MCP IPC. */
export async function getCodexMcpConfig(): Promise<CodexMcpConfigResult> {
  if (requestedMode !== 'app-server') return CODEX_MCP_CONFIG_UNAVAILABLE;
  const backend = getCodexBackend();
  if (!backend.getMcpConfig) return CODEX_MCP_CONFIG_UNAVAILABLE;
  try { return sanitizeCodexMcpConfigResult(await backend.getMcpConfig()); } catch { return { ok: false, code: 'host-error' }; }
}

export async function replaceCodexMcpConfig(expectedVersion: string, servers: CodexMcpConfigServer[]): Promise<CodexMcpConfigResult> {
  if (requestedMode !== 'app-server') return CODEX_MCP_CONFIG_UNAVAILABLE;
  const backend = getCodexBackend();
  if (!backend.replaceMcpConfig) return CODEX_MCP_CONFIG_UNAVAILABLE;
  try { return sanitizeCodexMcpConfigResult(await backend.replaceMcpConfig(expectedVersion, servers)); } catch { return { ok: false, code: 'host-error' }; }
}

/** Return the scoped dispatcher, constructing the stable SDK transport first. */
export function getCodexBackend(): CodexBackend {
  if (!active) {
    active = new ScopedCodexBackend();
    registerWorkspaceBackendHooks('codex', {
      suspend: (projectPath) => active?.suspendWorkspace(projectPath),
      isBusy: (projectPath) => active?.isWorkspaceBusy(projectPath) ?? false,
    });
  }
  return active;
}

export function destroyCodexBackendIfActive(): void {
  const backend = active;
  active = null;
  backend?.destroy();
}

export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  if (active === backend) return;
  destroyCodexBackendIfActive();
  active = backend;
}

export function __setCodexBackendFactoriesForTests(factories: { sdk?: BackendFactory; appServer?: BackendFactory } = {}): void {
  createSdkBackend = factories.sdk ?? makeSdkBackend;
  createAppServerBackend = factories.appServer ?? makeAppServerBackend;
}
