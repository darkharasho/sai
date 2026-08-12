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

/** A bounded, renderer-safe question shape from App Server. */
export interface CodexUserInputQuestion {
  id: string;
  /** Short protocol section label, bounded before renderer exposure. */
  header: string;
  prompt: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  allowOther?: boolean;
  /** Render free-form answers as a masked password control. */
  isSecret?: boolean;
}

/** App Server requires one or more selected option labels for each question. */
export interface CodexUserInputAnswer {
  answers: string[];
}

/** Exact `ToolRequestUserInputResponse.answers` wire shape. */
export type CodexUserInputAnswers = Record<string, CodexUserInputAnswer>;

/**
 * A renderer response to an App Server `tool/requestUserInput` request.
 * Cancellation deliberately carries no answer data; the backend converts it
 * to the protocol's valid empty answer map.
 */
export type CodexUserInputResponse =
  | { type: 'answers'; answers: CodexUserInputAnswers }
  | { type: 'cancel' };

export interface CodexMcpElicitationForm {
  mode: 'form';
  serverName: string;
  message: string;
  requestedSchema: Record<string, unknown>;
}

export interface CodexMcpElicitationUrl {
  mode: 'url';
  serverName: string;
  message: string;
  url: string;
  elicitationId?: string;
}

export type CodexMcpElicitationDecision =
  | { action: 'accept'; content: Record<string, unknown> | null }
  | { action: 'decline' | 'cancel'; content?: null };

const CODEX_INPUT_MAX_FIELDS = 20;
const CODEX_INPUT_MAX_OPTIONS = 20;
const CODEX_INPUT_MAX_TEXT = 2_000;

/**
 * Narrow the renderer payload before it crosses into a pending App Server
 * request. The backend then validates selected option IDs against the exact
 * question and form content against the exact, server-provided safe schema.
 */
export function isCodexUserInputAnswers(value: unknown): value is CodexUserInputAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= CODEX_INPUT_MAX_FIELDS && entries.every(([id, answer]) => {
    if (id.length === 0 || id.length > 128 || !answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
    const fields = Object.entries(answer as Record<string, unknown>);
    const selections = (answer as CodexUserInputAnswer).answers;
    return fields.length === 1 && fields[0][0] === 'answers' && Array.isArray(selections)
      && selections.length > 0 && selections.length <= CODEX_INPUT_MAX_OPTIONS
      && selections.every((selection) => typeof selection === 'string' && selection.length > 0 && selection.length <= CODEX_INPUT_MAX_TEXT);
  });
}

export function isCodexUserInputResponse(value: unknown): value is CodexUserInputResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type === 'cancel') return Object.keys(input).length === 1;
  return input.type === 'answers' && Object.keys(input).length === 2 && isCodexUserInputAnswers(input.answers);
}

function isSafeMcpContent(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === null || typeof value === 'boolean' || (typeof value === 'string' && value.length <= CODEX_INPUT_MAX_TEXT);
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= CODEX_INPUT_MAX_OPTIONS && value.every((entry) => isSafeMcpContent(entry, depth + 1));
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= CODEX_INPUT_MAX_FIELDS
    && entries.every(([key, entry]) => key.length > 0 && key.length <= 128 && isSafeMcpContent(entry, depth + 1));
}

/** Does not authorize a URL action; the pending elicitation mode does that. */
export function isCodexMcpElicitationDecision(value: unknown): value is CodexMcpElicitationDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.action === 'decline' || input.action === 'cancel') {
    return Object.keys(input).every((key) => key === 'action' || key === 'content')
      && (input.content === undefined || input.content === null);
  }
  return input.action === 'accept'
    && Object.keys(input).every((key) => key === 'action' || key === 'content')
    && Object.prototype.hasOwnProperty.call(input, 'content')
    && (input.content === null || isSafeMcpContent(input.content));
}

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
  /** SDK returns a typed unsupported result; App Server validates a pending request. */
  answerUserInput(projectPath: string, scope: string | undefined, requestHandle: string, response: CodexUserInputResponse): CodexApprovalResult;
  /** SDK returns a typed unsupported result; App Server validates a pending request. */
  resolveMcpElicitation(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexMcpElicitationDecision): CodexApprovalResult;
  suspendWorkspace(projectPath: string): void;
  isWorkspaceBusy(projectPath: string): boolean;
  /** Optional finer-grained busy check used when routing concurrent scopes. */
  isScopeBusy?(projectPath: string, scope?: string): boolean;
  destroy(): void;
}

export const codexScope = (scope?: string): string => scope || 'chat';
export const codexScopeKey = (projectPath: string, scope?: string): string =>
  `${projectPath}\u0000${codexScope(scope)}`;
