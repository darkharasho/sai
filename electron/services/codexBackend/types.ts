import type { ModelReasoningEffort } from '@openai/codex-sdk';

export type CodexBackendKind = 'cli' | 'sdk';
export type CodexSessionKind = 'chat' | 'task' | 'orchestrator';
export type CodexPermission = 'auto' | 'read-only' | 'full-access';

export interface CodexStartArgs {
  projectPath: string;
  scope?: string;
  kind?: CodexSessionKind;
  orchestratorContext?: Record<string, unknown> | null;
  scopeCwd?: string;
  metaPreamble?: string;
}

export interface CodexSendArgs {
  projectPath: string;
  message: string;
  imagePaths?: string[];
  permission?: CodexPermission;
  effort?: ModelReasoningEffort;
  model?: string;
  scope?: string;
  origin?: 'desktop' | 'remote';
}

export interface CodexModelOption {
  id: string;
  name: string;
}

export interface CodexModelResult {
  models: CodexModelOption[];
  defaultModel: string;
}

export type CodexCapability =
  | 'compact'
  | 'interactive-approval'
  | 'answer-question'
  | 'answer-plan-review';

export class CodexCapabilityError extends Error {
  readonly code = 'CODEX_CAPABILITY_UNAVAILABLE';

  constructor(
    readonly capability: CodexCapability,
    readonly requiredBackend: CodexBackendKind | null,
    message: string,
  ) {
    super(message);
    this.name = 'CodexCapabilityError';
  }
}

export interface CodexBackend {
  start(args: CodexStartArgs): Promise<void> | void;
  send(args: CodexSendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  reconcileScope(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  getModels(forceRefresh?: boolean): Promise<CodexModelResult>;
  suspendWorkspace(projectPath: string): void;
  isWorkspaceBusy(projectPath: string): boolean;
  destroy(): void;
}

export const codexScope = (scope?: string): string => scope || 'chat';
export const codexScopeKey = (projectPath: string, scope?: string): string =>
  `${projectPath}\u0000${codexScope(scope)}`;
