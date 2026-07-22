import { emitChatMessage } from '../claude';
import { registerWorkspaceBackendHooks } from '../workspace';
import { fetchBundledCodexModels } from './bundledModels';
import { SdkCodexBackend } from './sdkBackend';
import type { CodexBackend } from './types';

export * from './types';

let active: CodexBackend | null = null;

/** Return the SDK-backed Codex backend, constructing it only on first use. */
export function getCodexBackend(): CodexBackend {
  if (active) return active;

  active = new SdkCodexBackend({
    emit: emitChatMessage,
    getModels: fetchBundledCodexModels,
  });

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
  backend?.destroy();
}

/** Test seam that replaces the singleton without leaking its lifecycle. */
export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  if (active === backend) return;
  destroyCodexBackendIfActive();
  active = backend;
}
