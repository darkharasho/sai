import { emitChatMessage, getMainWin } from '../claude';
import { notifyCompletion } from '../notify';
import { registerWorkspaceBackendHooks } from '../workspace';
import { fetchBundledCodexModels } from './bundledModels';
import { AppServerBackend } from './appServerBackend';
import { SdkCodexBackend } from './sdkBackend';
import type { CodexAppServerPreviewStatus, CodexBackend, CodexBackendMode } from './types';

export * from './types';

let active: CodexBackend | null = null;
let activeMode: CodexBackendMode | null = null;
let requestedMode: CodexBackendMode = 'sdk';
let fallbackReason: string | undefined;

type BackendFactory = () => CodexBackend;
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

function isAppServerPreviewBackend(backend: CodexBackend): backend is AppServerPreviewBackend {
  return 'previewStatus' in backend;
}

function isAnyWorkspaceBusy(backend: CodexBackend): boolean {
  return (backend as CodexBackend & { isAnyWorkspaceBusy?: () => boolean }).isAnyWorkspaceBusy?.() ?? false;
}

function appServerStatus(): CodexAppServerPreviewStatus {
  if (activeMode === 'app-server' && active && isAppServerPreviewBackend(active)) {
    return active.previewStatus;
  }
  return fallbackReason ? { available: false, reason: fallbackReason } : { available: true };
}

function replaceActiveIfSafe(): void {
  if (!active) return;
  const status = appServerStatus();
  if (activeMode === 'app-server' && !status.available) fallbackReason = status.reason ?? 'Codex App Server preview is unavailable';
  const shouldReplace = activeMode !== requestedMode || (activeMode === 'app-server' && !status.available);
  if (!shouldReplace || isAnyWorkspaceBusy(active)) return;
  const previous = active;
  active = null;
  activeMode = null;
  previous.destroy();
}

/** Select a backend for new work.  Active turns always stay on their current transport. */
export function setCodexBackendMode(mode: CodexBackendMode): CodexBackendMode {
  requestedMode = mode;
  if (mode === 'sdk') fallbackReason = undefined;
  replaceActiveIfSafe();
  return requestedMode;
}

export function getCodexBackendMode(): CodexBackendMode {
  return requestedMode;
}

export function getCodexAppServerPreviewStatus(): CodexAppServerPreviewStatus {
  const status = appServerStatus();
  if (!status.available) fallbackReason = status.reason;
  return status;
}

/** Return the SDK-backed Codex backend, constructing it only on first use. */
export function getCodexBackend(): CodexBackend {
  replaceActiveIfSafe();
  if (active) return active;

  const useAppServer = requestedMode === 'app-server' && !fallbackReason;
  active = useAppServer ? createAppServerBackend() : createSdkBackend();
  activeMode = useAppServer ? 'app-server' : 'sdk';

  registerWorkspaceBackendHooks('codex', {
    suspend: (projectPath) => active?.suspendWorkspace(projectPath),
    isBusy: (projectPath) => active?.isWorkspaceBusy(projectPath) ?? false,
  });
  return active;
}

/** Destroy and forget the active backend, if one has been selected. */
export function destroyCodexBackendIfActive(): void {
  const backend = active;
  active = null;
  activeMode = null;
  backend?.destroy();
}

/** Test seam that replaces the singleton without leaking its lifecycle. */
export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  if (active === backend) return;
  destroyCodexBackendIfActive();
  active = backend;
  activeMode = backend ? requestedMode : null;
}

/** Test seam for backend-selection behavior without starting real CLI processes. */
export function __setCodexBackendFactoriesForTests(factories: { sdk?: BackendFactory; appServer?: BackendFactory } = {}): void {
  createSdkBackend = factories.sdk ?? makeSdkBackend;
  createAppServerBackend = factories.appServer ?? makeAppServerBackend;
  fallbackReason = undefined;
}
