import { emitChatMessage, getMainWin } from '../claude';
import { notifyCompletion } from '../notify';
import { registerWorkspaceBackendHooks } from '../workspace';
import { fetchBundledCodexModels } from './bundledModels';
import { AppServerBackend } from './appServerBackend';
import { SdkCodexBackend } from './sdkBackend';
import { codexScopeKey, type CodexAppServerPreviewStatus, type CodexBackend, type CodexBackendMode, type CodexModelResult, type CodexSendArgs, type CodexStartArgs } from './types';

export * from './types';

type BackendFactory = () => CodexBackend;
type BackendByMode = Partial<Record<CodexBackendMode, CodexBackend>>;

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

function isAppServerPreviewBackend(backend: CodexBackend | undefined): backend is AppServerPreviewBackend {
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
