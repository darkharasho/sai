import { ipcMain } from 'electron';
import {
  getCodexBackend,
  getCodexAppServerPreviewStatus,
  getCodexBackendMode,
  setCodexBackendMode,
  type CodexBackendMode,
  type CodexApprovalResult,
  type CodexPermission,
  type CodexReasoningEffort,
  type CodexSessionKind,
  isCodexReasoningEffort,
  isCodexApprovalDecision,
} from './codexBackend';
import { CodexTelemetryService } from './codexTelemetry';

type StartIpcTail = [
  scope?: string,
  kind?: CodexSessionKind,
  orchestratorContext?: Record<string, unknown> | null,
  scopeCwd?: string,
  metaPreamble?: string,
  additionalDirectories?: string[],
];

type SendIpcTail = [
  imagePaths?: string[],
  permission?: CodexPermission,
  effortOrLegacyModel?: string,
  model?: string,
  scope?: string,
  origin?: 'desktop' | 'remote',
];

const normalizeDirectories = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const directories = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))];
  return directories.length ? directories : undefined;
};

/** Module-owned singleton — renderer polling shares one cache/backoff instance. */
let codexTelemetry: CodexTelemetryService = new CodexTelemetryService();

/** Kill any active telemetry child process and drop cached state. Safe to call repeatedly. */
export function destroyCodexTelemetry(): void {
  codexTelemetry.destroy();
}

/** Test seam that replaces the singleton without leaking its lifecycle. */
export function __setCodexTelemetryForTests(service: CodexTelemetryService): void {
  if (codexTelemetry === service) return;
  codexTelemetry.destroy();
  codexTelemetry = service;
}

/** Register the Codex IPC surface. Transport behavior lives in codexBackend. */
export function registerCodexHandlers(): void {
  ipcMain.handle('codex:backendMode:get', () => getCodexBackendMode());
  ipcMain.handle('codex:backendMode:set', (_event, mode: unknown) => {
    const normalized: CodexBackendMode = mode === 'app-server' ? 'app-server' : 'sdk';
    return setCodexBackendMode(normalized);
  });
  ipcMain.handle('codex:appServerPreviewStatus', () => getCodexAppServerPreviewStatus());

  ipcMain.handle(
    'codex:approve',
    (_event, projectPath: unknown, scope: unknown, requestHandle: unknown, decision: unknown): CodexApprovalResult => {
      if (typeof projectPath !== 'string' || projectPath.length === 0
        || (scope !== undefined && typeof scope !== 'string')
        || typeof requestHandle !== 'string' || requestHandle.length === 0
        || !isCodexApprovalDecision(decision)) {
        return { ok: false, code: 'invalid-decision' };
      }
      return getCodexBackend().approve(projectPath, scope, requestHandle, decision);
    },
  );

  ipcMain.handle('codex:models', (_event, forceRefresh?: boolean) =>
    getCodexBackend().getModels(Boolean(forceRefresh)));

  ipcMain.handle(
    'codex:start',
    (
      _event,
      projectPath: string,
      ...tail: StartIpcTail
    ) => {
      // Temporary bridge for the pre-Task-8 preload shape:
      // codex:start(projectPath, metaPreamble).
      const legacy = tail.length === 1;
      return getCodexBackend().start({
        projectPath,
        scope: legacy ? undefined : tail[0],
        kind: legacy ? undefined : tail[1],
        orchestratorContext: legacy ? undefined : tail[2],
        scopeCwd: legacy ? undefined : tail[3],
        metaPreamble: legacy ? tail[0] : tail[4],
        additionalDirectories: legacy ? undefined : normalizeDirectories(tail[5]),
      });
    },
  );

  ipcMain.on(
    'codex:send',
    (
      _event,
      projectPath: string,
      message: string,
      ...tail: SendIpcTail
    ) => {
      // Temporary bridge for the pre-Task-8 preload shape:
      // codex:send(projectPath, message, images, permission, model).
      const legacy = tail.length === 3;
      return getCodexBackend().send({
        projectPath,
        message,
        imagePaths: tail[0],
        permission: tail[1],
        effort: legacy || !isCodexReasoningEffort(tail[2]) ? undefined : tail[2] as CodexReasoningEffort,
        model: legacy ? tail[2] : tail[3],
        scope: legacy ? undefined : tail[4],
        origin: legacy ? undefined : tail[5],
      });
    },
  );

  ipcMain.on('codex:stop', (_event, projectPath: string, scope?: string) =>
    getCodexBackend().interrupt(projectPath, scope));

  ipcMain.on(
    'codex:setSessionId',
    (_event, projectPath: string, sessionId: string | undefined, scope?: string) =>
      getCodexBackend().setSessionId(projectPath, sessionId, scope),
  );

  ipcMain.on('codex:reconcileScope', (_event, projectPath: string, scope?: string) =>
    getCodexBackend().reconcileScope(projectPath, scope));

  ipcMain.handle('codex:usage', (_event, options?: { force?: boolean }) =>
    codexTelemetry.readRateLimits({ force: options?.force === true }));
}
