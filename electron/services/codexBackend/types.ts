export type CodexSessionKind = 'chat' | 'task' | 'orchestrator';
export type CodexBackendMode = 'sdk' | 'app-server';

/** The App Server preview is opt-in and may become unavailable at runtime. */
export interface CodexAppServerPreviewStatus {
  available: boolean;
  reason?: string;
}
export type CodexPermission = 'auto' | 'read-only' | 'full-access';
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/** Sanitized metadata for an App Server approval; raw protocol params stay main-process only. */
export interface CodexApprovalMetadata {
  provider: 'codex';
  requestHandle: string;
  kind: 'command' | 'file-change' | 'permissions';
  availableDecisions: string[];
  reason?: string;
  command?: string;
  cwd?: string;
  network?: { host?: string; protocol?: string };
  grantRoot?: string;
  permissionsSummary?: string[];
  /** JSON-safe opaque copies of the permission objects that the UI may grant. */
  requestedPermissions?: unknown[];
}

/**
 * Renderer-to-main approval input. The App Server backend validates this
 * against the exact pending request before it ever reaches the protocol.
 */
export type CodexApprovalDecision =
  | { type: 'decision'; value: 'accept' | 'acceptForSession' | 'decline' | 'cancel' }
  | { type: 'command-amendment'; execpolicyAmendment: string[] }
  | { type: 'permissions'; permissions: unknown[]; scope: 'turn' | 'session' };

export type CodexApprovalResult =
  | { ok: true }
  | { ok: false; code: 'unsupported' | 'not-pending' | 'invalid-decision' };

export function isCodexApprovalDecision(value: unknown): value is CodexApprovalDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type === 'decision') {
    return Object.keys(input).every((key) => key === 'type' || key === 'value')
      && (input.value === 'accept' || input.value === 'acceptForSession' || input.value === 'decline' || input.value === 'cancel');
  }
  if (input.type === 'command-amendment') {
    return Object.keys(input).every((key) => key === 'type' || key === 'execpolicyAmendment')
      && Array.isArray(input.execpolicyAmendment) && input.execpolicyAmendment.length > 0
      && input.execpolicyAmendment.every((entry) => typeof entry === 'string' && entry.length > 0);
  }
  return input.type === 'permissions' && Object.keys(input).every((key) => key === 'type' || key === 'permissions' || key === 'scope')
    && (input.scope === 'turn' || input.scope === 'session')
    && Array.isArray(input.permissions);
}

export interface CodexStartArgs {
  projectPath: string;
  scope?: string;
  kind?: CodexSessionKind;
  orchestratorContext?: Record<string, unknown> | null;
  scopeCwd?: string;
  metaPreamble?: string;
  additionalDirectories?: string[];
}

export interface CodexSendArgs {
  projectPath: string;
  message: string;
  imagePaths?: string[];
  permission?: CodexPermission;
  effort?: CodexReasoningEffort;
  model?: string;
  scope?: string;
  origin?: 'desktop' | 'remote';
}

export interface CodexModelOption {
  id: string;
  name: string;
  supportedReasoningEfforts?: CodexReasoningEffort[];
  defaultReasoningEffort?: CodexReasoningEffort;
  effectiveContextWindow?: number;
}

const CODEX_REASONING_EFFORTS = new Set<CodexReasoningEffort>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const isCodexReasoningEffort = (value: unknown): value is CodexReasoningEffort => CODEX_REASONING_EFFORTS.has(value as CodexReasoningEffort);

export function normalizeCodexModelOption(model: any): CodexModelOption {
  const supported: CodexReasoningEffort[] | undefined = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((entry: unknown) => typeof entry === 'string' ? entry : (entry as any)?.reasoningEffort)
      .filter((entry: unknown): entry is CodexReasoningEffort => isCodexReasoningEffort(entry))
    : undefined;
  const defaultReasoningEffort = isCodexReasoningEffort(model.defaultReasoningEffort) ? model.defaultReasoningEffort : undefined;
  return {
    id: model.model,
    name: model.displayName || model.model,
    ...(supported ? { supportedReasoningEfforts: [...new Set(supported)] } : {}),
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
  };
}

export interface CodexModelResult {
  models: CodexModelOption[];
  defaultModel: string;
}

export interface CodexBackend {
  start(args: CodexStartArgs): Promise<void> | void;
  send(args: CodexSendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  reconcileScope(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  getModels(forceRefresh?: boolean): Promise<CodexModelResult>;
  approve(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexApprovalDecision): CodexApprovalResult;
  suspendWorkspace(projectPath: string): void;
  isWorkspaceBusy(projectPath: string): boolean;
  /** Optional finer-grained busy check used when routing concurrent scopes. */
  isScopeBusy?(projectPath: string, scope?: string): boolean;
  destroy(): void;
}

export const codexScope = (scope?: string): string => scope || 'chat';
export const codexScopeKey = (projectPath: string, scope?: string): string =>
  `${projectPath}\u0000${codexScope(scope)}`;
