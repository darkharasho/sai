import {
  AppServerClient,
  AppServerUnavailableError,
  type AppServerClientTransport,
  type AppServerNotification,
  type AppServerServerRequest,
  type AppServerServerRequestResponder,
} from './appServerClient';
import { mapAppServerEvent } from './appServerEventMap';
import { normalizeCodexModelOption, codexScope, codexScopeKey, type CodexAppServerPreviewStatus, type CodexApprovalDecision, type CodexApprovalMetadata, type CodexApprovalResult, type CodexBackend, type CodexMcpElicitationDecision, type CodexMcpElicitationForm, type CodexMcpElicitationUrl, type CodexModelResult, type CodexSendArgs, type CodexSessionKind, type CodexStartArgs, type CodexUserInputAnswers, type CodexUserInputQuestion } from './types';
import type { SaiEnvelope } from './sdkEventMap';
import { getOrCreate as getOrCreateWorkspace } from '../workspace';

interface ScopeMeta {
  projectPath: string;
  scope: string;
  cwd: string;
  kind: CodexSessionKind;
}

interface ActiveTurn {
  id?: string;
  /** Thread that accepted turn/start; it must not follow later session changes. */
  threadId?: string;
  seq: number;
  done: boolean;
  /** The renderer has moved on, but turn/start may still yield an ID. */
  retired: boolean;
  interruptSent: boolean;
  pendingNotifications: AppServerNotification[];
}

interface ScopeRuntime extends ScopeMeta {
  sessionId?: string;
  threadId?: string;
  turnSeq: number;
  active?: ActiveTurn;
}

interface PendingApproval {
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly kind: CodexApprovalMetadata['kind'];
  /** Raw request is deliberately retained only in main process for validation. */
  readonly params: Record<string, unknown>;
}

interface PendingUserInput {
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly questions: CodexUserInputQuestion[];
  timeout?: ReturnType<typeof setTimeout>;
}

interface PendingMcpElicitation {
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly elicitation: CodexMcpElicitationForm | CodexMcpElicitationUrl;
}

const APPROVAL_METHODS = {
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'file-change',
  'item/permissions/requestApproval': 'permissions',
} as const;

type ApprovalMethod = keyof typeof APPROVAL_METHODS;

const USER_INPUT_METHOD = 'item/tool/requestUserInput';
const MCP_ELICITATION_METHOD = 'mcpServer/elicitation/request';
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 20;
const MAX_TEXT = 2_000;
const MAX_AUTO_RESOLUTION_MS = 5 * 60_000;

export class AppServerUnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`Codex App Server preview: ${capability} is not supported`);
    this.name = 'AppServerUnsupportedCapabilityError';
  }
}

export interface AppServerBackendDeps {
  createClient?: () => AppServerClientTransport;
  emit?: (event: SaiEnvelope) => void;
  registerWorkspace?: (projectPath: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function idFrom(result: unknown, property: 'thread' | 'turn'): string | undefined {
  const body = record(result);
  const nested = record(body?.[property]);
  const id = nested?.id ?? body?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function eventIds(event: Pick<AppServerNotification, 'params'>): { threadId?: string; turnId?: string } {
  const params = record(event.params);
  const thread = record(params?.thread);
  const turn = record(params?.turn);
  return {
    threadId: typeof params?.threadId === 'string' ? params.threadId : typeof thread?.id === 'string' ? thread.id : undefined,
    turnId: typeof params?.turnId === 'string' ? params.turnId : typeof turn?.id === 'string' ? turn.id : undefined,
  };
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

/** Canonical JSON identity for checking a granted permission is requested. */
function jsonIdentity(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean' || typeof current === 'number') return current;
    if (!current || typeof current !== 'object' || seen.has(current)) return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      const result = current.map(normalize);
      seen.delete(current);
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(current as Record<string, unknown>).sort()) result[key] = normalize((current as Record<string, unknown>)[key]);
    seen.delete(current);
    return result;
  };
  try { return JSON.stringify(normalize(value)); } catch { return undefined; }
}

/** Copy only JSON-safe protocol values across the renderer boundary. */
function jsonSafeCopy(value: unknown): unknown | undefined {
  const identity = jsonIdentity(value);
  if (!identity) return undefined;
  try { return JSON.parse(identity); } catch { return undefined; }
}

function approvalMetadata(request: AppServerServerRequest): CodexApprovalMetadata | undefined {
  if (!(request.method in APPROVAL_METHODS)) return undefined;
  const params = record(request.params);
  if (!params) return undefined;
  const kind = APPROVAL_METHODS[request.method as ApprovalMethod];
  const metadata: CodexApprovalMetadata = {
    provider: 'codex',
    requestHandle: String(request.id),
    kind,
    availableDecisions: stringList(params.availableDecisions),
    reason: asText(params.reason),
  };
  if (kind === 'command') {
    metadata.command = asText(params.command);
    metadata.cwd = asText(params.cwd);
    const network = record(params.networkApprovalContext);
    if (network) metadata.network = { host: asText(network.host), protocol: asText(network.protocol) };
  }
  if (kind === 'file-change') metadata.grantRoot = asText(params.grantRoot);
  if (kind === 'permissions') {
    const permissions = Array.isArray(params.permissions) ? params.permissions : [];
    metadata.requestedPermissions = permissions.flatMap((permission) => {
      const copy = jsonSafeCopy(permission);
      return copy === undefined ? [] : [copy];
    });
    metadata.permissionsSummary = permissions.map((permission) => {
      if (typeof permission === 'string') return permission;
      const item = record(permission);
      return asText(item?.description) ?? asText(item?.kind) ?? 'Requested permission';
    });
    const networkPermission = permissions.map(record).find((permission) => asText(permission?.kind) === 'network');
    if (networkPermission) {
      const network = record(networkPermission.network);
      metadata.network = {
        host: asText(networkPermission.host) ?? asText(network?.host),
        protocol: asText(networkPermission.protocol) ?? asText(network?.protocol),
      };
    }
  }
  return metadata;
}

function boundedText(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : undefined;
}

function safeAutoResolution(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_AUTO_RESOLUTION_MS
    ? value
    : undefined;
}

function userInputQuestions(params: Record<string, unknown>): CodexUserInputQuestion[] | undefined {
  if (!Array.isArray(params.questions) || params.questions.length < 1 || params.questions.length > MAX_QUESTIONS) return undefined;
  const ids = new Set<string>();
  const normalized: CodexUserInputQuestion[] = [];
  for (const value of params.questions) {
    const question = record(value);
    const id = boundedText(question?.id, 128);
    const prompt = boundedText(question?.question ?? question?.prompt);
    if (!id || !prompt || ids.has(id)) return undefined;
    ids.add(id);
    let options: CodexUserInputQuestion['options'];
    if (question?.options !== undefined) {
      if (!Array.isArray(question.options) || question.options.length < 1 || question.options.length > MAX_OPTIONS) return undefined;
      const optionIds = new Set<string>();
      options = [];
      for (const optionValue of question.options) {
        const option = record(optionValue);
        // App Server's user-input response identifies selected options by
        // label. Expose that as the renderer's opaque option ID as well so a
        // selected value can be sent back without retaining raw request data.
        const optionId = boundedText(option?.label, 128);
        const label = boundedText(option?.label, 256);
        const description = option?.description === undefined ? undefined : boundedText(option.description, 512);
        if (!optionId || !label || optionIds.has(optionId) || (option?.description !== undefined && !description)) return undefined;
        optionIds.add(optionId);
        options.push({ id: optionId, label, ...(description ? { description } : {}) });
      }
    }
    normalized.push({ id, prompt, ...(options ? { options } : {}), ...(question?.isOther === true ? { allowOther: true } : {}) });
  }
  return normalized;
}

function safeSchema(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 4) return undefined;
  const schema = record(value);
  if (!schema) return undefined;
  const type = schema?.type;
  if (type !== 'object' && type !== 'array' && type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean') return undefined;
  const normalized: Record<string, unknown> = { type };
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 32
    && schema.enum.every((entry) => entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')) {
    normalized.enum = [...schema.enum];
  } else if (schema.enum !== undefined) return undefined;
  if (type === 'object') {
    const properties = record(schema.properties) ?? {};
    const keys = Object.keys(properties);
    if (keys.length > 20 || keys.some((key) => key.length === 0 || key.length > 128)) return undefined;
    const safeProperties: Record<string, unknown> = {};
    for (const key of keys) {
      const child = safeSchema(properties[key], depth + 1);
      if (!child) return undefined;
      safeProperties[key] = child;
    }
    normalized.properties = safeProperties;
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(safeProperties, key))) return undefined;
      normalized.required = [...schema.required];
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return undefined;
    // SAI intentionally supports a closed schema subset. Even when an MCP
    // server permits arbitrary properties, unknown content is not safe to
    // accept from a renderer boundary.
    normalized.additionalProperties = false;
  }
  if (type === 'array') {
    const items = safeSchema(schema.items, depth + 1);
    if (!items) return undefined;
    normalized.items = items;
  }
  return normalized;
}

function mcpElicitation(params: Record<string, unknown>): CodexMcpElicitationForm | CodexMcpElicitationUrl | undefined {
  const serverName = boundedText(params.serverName, 128);
  const message = boundedText(params.message);
  if (!serverName || !message) return undefined;
  if (params.mode === 'form' || params.mode === 'openai/form') {
    const requestedSchema = safeSchema(params.requestedSchema);
    return requestedSchema ? { mode: 'form', serverName, message, requestedSchema } : undefined;
  }
  if (params.mode !== 'url') return undefined;
  const url = boundedText(params.url, 2_048);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  } catch { return undefined; }
  const elicitationId = boundedText(params.elicitationId, 256);
  if (!elicitationId) return undefined;
  return { mode: 'url', serverName, message, url, elicitationId };
}

function schemaAccepts(schema: Record<string, unknown>, value: unknown, depth = 0): boolean {
  if (depth > 4 || value === undefined) return false;
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((entry) => jsonIdentity(entry) === jsonIdentity(value))) return false;
  switch (schema.type) {
    case 'string': return typeof value === 'string' && value.length <= MAX_TEXT;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value) && value.length <= MAX_OPTIONS && record(schema.items) !== undefined
      && value.every((entry) => schemaAccepts(schema.items as Record<string, unknown>, entry, depth + 1));
    case 'object': {
      const object = record(value);
      const properties = record(schema.properties) ?? {};
      if (!object) return false;
      if (Object.keys(object).length > 20 || Object.keys(object).some((key) => !(key in properties))) return false;
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (required.some((key) => typeof key !== 'string' || !(key in object))) return false;
      return Object.entries(object).every(([key, entry]) => schemaAccepts(properties[key] as Record<string, unknown>, entry, depth + 1));
    }
    default: return false;
  }
}

/**
 * App Server implementation with separate thread and active-turn identity per
 * SAI scope. The transport is intentionally a preview boundary: callers can
 * inspect previewStatus and select the SDK when its long-lived process fails.
 */
export class AppServerBackend implements CodexBackend {
  private readonly runtimes = new Map<string, ScopeRuntime>();
  private readonly metadata = new Map<string, ScopeMeta>();
  private readonly createClient: () => AppServerClientTransport;
  private readonly emit: (event: SaiEnvelope) => void;
  private readonly registerWorkspace: (projectPath: string) => void;
  private client: AppServerClientTransport | undefined;
  private clientStart: Promise<void> | undefined;
  private unavailableReason: string | undefined;
  private unsubscribeNotifications: (() => void) | undefined;
  private unsubscribeServerRequests: (() => void) | undefined;
  private unsubscribeFailure: (() => void) | undefined;
  private readonly pendingApprovals = new Map<string | number, PendingApproval>();
  private readonly pendingUserInputs = new Map<string | number, PendingUserInput>();
  private readonly pendingMcpElicitations = new Map<string | number, PendingMcpElicitation>();

  constructor(deps: AppServerBackendDeps = {}) {
    this.createClient = deps.createClient ?? (() => new AppServerClient());
    this.emit = deps.emit ?? (() => undefined);
    this.registerWorkspace = deps.registerWorkspace ?? ((projectPath) => {
      try { getOrCreateWorkspace(projectPath); } catch { /* isolated tests or shutdown */ }
    });
  }

  get previewStatus(): CodexAppServerPreviewStatus {
    return this.unavailableReason
      ? { available: false, reason: this.unavailableReason }
      : { available: true };
  }

  async start(args: CodexStartArgs): Promise<void> {
    this.registerWorkspace(args.projectPath);
    const scope = codexScope(args.scope);
    const key = codexScopeKey(args.projectPath, scope);
    const meta: ScopeMeta = {
      projectPath: args.projectPath,
      scope,
      cwd: args.scopeCwd || args.projectPath,
      kind: args.kind ?? 'chat',
    };
    this.metadata.set(key, meta);
    const runtime = this.runtimeFor(args.projectPath, scope);
    Object.assign(runtime, meta);

    try {
      await this.ensureThread(runtime);
      this.emit({ type: 'ready', projectPath: args.projectPath, scope });
    } catch (error) {
      this.settleUnavailable(runtime, errorText(error));
      throw error;
    }
  }

  send(args: CodexSendArgs): void {
    this.registerWorkspace(args.projectPath);
    const scope = codexScope(args.scope);
    const runtime = this.runtimeFor(args.projectPath, scope);
    if (args.imagePaths?.length) {
      const active: ActiveTurn = this.newTurn(runtime);
      runtime.active = active;
      this.emit({ type: 'streaming_start', projectPath: args.projectPath, scope, turnSeq: active.seq, sessionId: runtime.sessionId ?? null });
      this.emit({ type: 'error', text: new AppServerUnsupportedCapabilityError('image input').message, projectPath: args.projectPath, scope, turnSeq: active.seq });
      this.finishTurn(runtime, active, { subagentsAborted: true });
      return;
    }
    void this.startTurn(runtime, args);
  }

  interrupt(projectPath: string, scope?: string): void {
    const runtime = this.runtimes.get(codexScopeKey(projectPath, codexScope(scope)));
    if (!runtime?.active) {
      this.emit({ type: 'done', projectPath, scope: codexScope(scope), turnSeq: null });
      return;
    }
    const active = runtime.active;
    this.retireTurn(runtime, active);
  }

  reconcileScope(projectPath: string, scope?: string): void {
    const normalizedScope = codexScope(scope);
    const runtime = this.runtimes.get(codexScopeKey(projectPath, normalizedScope));
    if (!runtime?.active) this.emit({ type: 'done', projectPath, scope: normalizedScope, turnSeq: null });
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const runtime = this.runtimeFor(projectPath, codexScope(scope));
    if (runtime.active) return;
    this.clearPending(runtime);
    runtime.sessionId = sessionId;
    runtime.threadId = undefined;
  }

  async getModels(_forceRefresh?: boolean): Promise<CodexModelResult> {
    try {
      const client = await this.ensureClient();
      const result = record(await client.request('model/list', {}));
      const data = Array.isArray(result?.data) ? result.data : [];
      const models = data.filter((entry) => !record(entry)?.hidden).map(normalizeCodexModelOption);
      const defaultModel = data.map(record).find((entry) => entry?.isDefault)?.model;
      return { models, defaultModel: typeof defaultModel === 'string' ? defaultModel : models[0]?.id ?? '' };
    } catch (error) {
      this.markUnavailable(errorText(error));
      return { models: [], defaultModel: '' };
    }
  }

  approve(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexApprovalDecision): CodexApprovalResult {
    const normalizedScope = codexScope(scope);
    const matches = [...this.pendingApprovals.values()].filter((pending) => String(pending.id) === requestHandle);
    // Treat a string/number request-id collision as invalid rather than
    // guessing which wire request a renderer intended to answer.
    if (matches.length !== 1) return { ok: false, code: 'not-pending' };
    const pending = matches[0];
    if (pending.runtime.projectPath !== projectPath || pending.runtime.scope !== normalizedScope
      || pending.runtime.active !== pending.active || pending.active.retired || pending.active.done) {
      return { ok: false, code: 'not-pending' };
    }
    const response = this.approvalResponse(pending, decision);
    if (!response) return { ok: false, code: 'invalid-decision' };
    this.pendingApprovals.delete(pending.id);
    try {
      pending.responder.respond(response);
      return { ok: true };
    } catch {
      return { ok: false, code: 'not-pending' };
    }
  }

  answerUserInput(projectPath: string, scope: string | undefined, requestHandle: string, answers: CodexUserInputAnswers): CodexApprovalResult {
    const pending = this.pendingFor(this.pendingUserInputs, projectPath, scope, requestHandle);
    if (!pending) return { ok: false, code: 'not-pending' };
    if (!this.userInputResponse(pending.questions, answers)) return { ok: false, code: 'invalid-decision' };
    try {
      pending.responder.respond({ answers });
      this.pendingUserInputs.delete(pending.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      return { ok: true };
    } catch { return { ok: false, code: 'not-pending' }; }
  }

  resolveMcpElicitation(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexMcpElicitationDecision): CodexApprovalResult {
    const pending = this.pendingFor(this.pendingMcpElicitations, projectPath, scope, requestHandle);
    if (!pending) return { ok: false, code: 'not-pending' };
    const response = this.mcpElicitationResponse(pending.elicitation, decision);
    if (!response) return { ok: false, code: 'invalid-decision' };
    try {
      pending.responder.respond(response);
      this.pendingMcpElicitations.delete(pending.id);
      return { ok: true };
    } catch { return { ok: false, code: 'not-pending' }; }
  }

  suspendWorkspace(projectPath: string): void {
    for (const [key, runtime] of this.runtimes) {
      if (runtime.projectPath !== projectPath) continue;
      if (runtime.active) this.retireTurn(runtime, runtime.active);
      this.runtimes.delete(key);
    }
    for (const [key, meta] of this.metadata) if (meta.projectPath === projectPath) this.metadata.delete(key);
  }

  isWorkspaceBusy(projectPath: string): boolean {
    return [...this.runtimes.values()].some((runtime) => runtime.projectPath === projectPath && Boolean(runtime.active));
  }

  isScopeBusy(projectPath: string, scope?: string): boolean {
    return Boolean(this.runtimes.get(codexScopeKey(projectPath, codexScope(scope)))?.active);
  }

  /** Selector-only aggregate used to avoid replacing an active transport. */
  isAnyWorkspaceBusy(): boolean {
    return [...this.runtimes.values()].some((runtime) => Boolean(runtime.active));
  }

  destroy(): void {
    for (const runtime of this.runtimes.values()) if (runtime.active) this.retireTurn(runtime, runtime.active);
    this.clearAllPending(false);
    this.runtimes.clear();
    this.metadata.clear();
    this.unsubscribeNotifications?.();
    this.unsubscribeServerRequests?.();
    this.unsubscribeFailure?.();
    this.unsubscribeNotifications = undefined;
    this.unsubscribeServerRequests = undefined;
    this.unsubscribeFailure = undefined;
    this.client?.destroy();
    this.client = undefined;
    this.clientStart = undefined;
  }

  private runtimeFor(projectPath: string, scope: string): ScopeRuntime {
    const key = codexScopeKey(projectPath, scope);
    const found = this.runtimes.get(key);
    if (found) return found;
    const meta = this.metadata.get(key) ?? { projectPath, scope, cwd: projectPath, kind: 'chat' as const };
    const runtime: ScopeRuntime = { ...meta, turnSeq: 0 };
    this.runtimes.set(key, runtime);
    return runtime;
  }

  private async ensureClient(): Promise<AppServerClientTransport> {
    if (this.unavailableReason) throw new AppServerUnavailableError(this.unavailableReason);
    if (!this.client) {
      this.client = this.createClient();
      this.unsubscribeNotifications = this.client.onNotification((event) => this.handleNotification(event));
      this.unsubscribeServerRequests = this.client.onServerRequest((request) => this.handleServerRequest(request));
      this.unsubscribeFailure = this.client.onFailure((error) => this.handleFailure(error));
      this.clientStart = this.client.start().catch((error) => {
        this.markUnavailable(errorText(error));
        throw error;
      });
    }
    await this.clientStart;
    return this.client;
  }

  private async ensureThread(runtime: ScopeRuntime): Promise<void> {
    if (runtime.threadId) return;
    const client = await this.ensureClient();
    const isNewThread = !runtime.sessionId;
    const result = runtime.sessionId
      ? await client.request('thread/resume', { threadId: runtime.sessionId })
      : await client.request('thread/start', { cwd: runtime.cwd });
    const threadId = idFrom(result, 'thread');
    if (!threadId) throw new AppServerUnavailableError('Codex App Server returned a thread without an ID');
    runtime.threadId = threadId;
    runtime.sessionId = threadId;
    if (isNewThread) this.emit({ type: 'session_id', sessionId: threadId, projectPath: runtime.projectPath, scope: runtime.scope });
  }

  private async startTurn(runtime: ScopeRuntime, args: Pick<CodexSendArgs, 'message' | 'model' | 'effort' | 'permission'>): Promise<void> {
    if (runtime.active) this.retireTurn(runtime, runtime.active);
    const active = this.newTurn(runtime);
    runtime.active = active;
    this.emit({ type: 'streaming_start', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, sessionId: runtime.sessionId ?? null });
    try {
      await this.ensureThread(runtime);
      active.threadId ??= runtime.threadId;
      const client = await this.ensureClient();
      const result = await client.request('turn/start', this.turnStartParams(runtime, args));
      const turnId = idFrom(result, 'turn');
      if (!turnId) throw new AppServerUnavailableError('Codex App Server returned a turn without an ID');
      active.id = turnId;
      if (active.retired) {
        void this.requestInterrupt(runtime, active);
        return;
      }
      if (runtime.active !== active) return;
      this.flushPendingNotifications(runtime, active);
    } catch (error) {
      if (runtime.active === active) this.settleUnavailable(runtime, errorText(error));
    }
  }

  private async requestInterrupt(runtime: ScopeRuntime, active: ActiveTurn): Promise<void> {
    if (active.interruptSent || !active.id || !active.threadId) return;
    active.interruptSent = true;
    try {
      const client = await this.ensureClient();
      await client.request('turn/interrupt', { threadId: active.threadId, turnId: active.id });
    } catch (error) {
      this.markUnavailable(errorText(error));
    }
  }

  private retireTurn(runtime: ScopeRuntime, active: ActiveTurn): void {
    if (active.retired) return;
    active.retired = true;
    void this.requestInterrupt(runtime, active);
    this.finishTurn(runtime, active, { subagentsAborted: true });
  }

  private handleNotification(event: AppServerNotification): void {
    if (event.method === 'serverRequest/resolved') {
      this.resolveServerRequest(event);
      return;
    }
    const ids = eventIds(event);
    if (!ids.threadId) {
      if (!ids.turnId) return;
      const candidates = [...this.runtimes.values()].filter((runtime) => {
        const active = runtime.active;
        return Boolean(active && !active.retired && active.id === ids.turnId);
      });
      // App Server's documented turn/completed shape omits threadId. Route it
      // only when a bound active turn identifies one scope unambiguously.
      if (candidates.length !== 1) return;
      const runtime = candidates[0];
      const active = runtime.active;
      if (active) this.emitNotification(runtime, active, event);
      return;
    }
    for (const [key, runtime] of this.runtimes) {
      if (runtime.threadId !== ids.threadId || this.runtimes.get(key) !== runtime) continue;
      const active = runtime.active;
      if (!active || active.retired) continue;
      if (!active.id) {
        // App Server can notify before its turn/start response arrives. A
        // single pending turn is safe to stage; bind and validate it once the
        // authoritative response supplies its turn ID.
        if (ids.turnId) active.pendingNotifications.push(event);
        continue;
      }
      if (ids.turnId !== active.id) continue;
      this.emitNotification(runtime, active, event);
    }
  }

  private handleServerRequest(request: AppServerServerRequest): void {
    if (request.method === USER_INPUT_METHOD) {
      this.handleUserInputRequest(request);
      return;
    }
    if (request.method === MCP_ELICITATION_METHOD) {
      this.handleMcpElicitationRequest(request);
      return;
    }
    const metadata = approvalMetadata(request);
    // Leave unsupported methods unclaimed so the transport sends its fail-closed
    // JSON-RPC error and retires the preview process.
    if (!metadata) return;
    const params = record(request.params);
    if (!params) return;
    let responder: AppServerServerRequestResponder;
    try {
      responder = this.client?.claimServerRequest(request.id)!;
    } catch {
      return;
    }
    const ids = eventIds(request);
    const runtime = ids.threadId
      ? [...this.runtimes.values()].find((candidate) => candidate.threadId === ids.threadId)
      : undefined;
    const active = runtime?.active;
    if (!runtime || !active || active.retired || !active.id || active.id !== ids.turnId || active.threadId !== ids.threadId) {
      this.declineResponder(responder, metadata.kind);
      return;
    }
    const pending: PendingApproval = { id: request.id, runtime, active, responder, kind: metadata.kind, params };
    this.pendingApprovals.set(request.id, pending);
    this.emit({
      type: 'approval_needed',
      projectPath: runtime.projectPath,
      scope: runtime.scope,
      turnSeq: active.seq,
      toolUseId: metadata.requestHandle,
      toolName: metadata.kind === 'command' ? 'Command approval' : metadata.kind === 'file-change' ? 'File change approval' : 'Permission approval',
      ...metadata,
    });
  }

  private claimScopedRequest(request: AppServerServerRequest): { responder: AppServerServerRequestResponder; runtime?: ScopeRuntime; active?: ActiveTurn } | undefined {
    let responder: AppServerServerRequestResponder;
    try { responder = this.client?.claimServerRequest(request.id)!; } catch { return undefined; }
    const ids = eventIds(request);
    const candidates = ids.threadId ? [...this.runtimes.values()].filter((candidate) => candidate.threadId === ids.threadId) : [];
    // A request without turnId can only be scoped by thread. Never guess when
    // a stale/reused App Server thread is owned by more than one SAI scope.
    const runtime = candidates.length === 1 ? candidates[0] : undefined;
    const active = runtime?.active;
    return { responder, runtime, active };
  }

  private isActiveOwner(runtime: ScopeRuntime | undefined, active: ActiveTurn | undefined, request: AppServerServerRequest): runtime is ScopeRuntime {
    const ids = eventIds(request);
    return Boolean(runtime && active && !active.retired && !active.done && active.id
      && active.threadId === ids.threadId && (!ids.turnId || active.id === ids.turnId));
  }

  private handleUserInputRequest(request: AppServerServerRequest): void {
    const params = record(request.params);
    const questions = params && userInputQuestions(params);
    const claimed = this.claimScopedRequest(request);
    if (!claimed) return;
    const { responder, runtime, active } = claimed;
    if (!params || !questions || !this.isActiveOwner(runtime, active, request)) {
      this.respondEmptyUserInput(responder);
      return;
    }
    const timeoutMs = safeAutoResolution(params.autoResolutionMs);
    const pending: PendingUserInput = { id: request.id, runtime, active: active!, responder, questions };
    if (timeoutMs) {
      const timeout = setTimeout(() => {
        if (this.pendingUserInputs.get(request.id) !== pending) return;
        this.pendingUserInputs.delete(request.id);
        this.respondEmptyUserInput(responder);
      }, timeoutMs);
      pending.timeout = timeout;
    }
    this.pendingUserInputs.set(request.id, pending);
    this.emit({
      type: 'user_input_needed', provider: 'codex', requestHandle: String(request.id),
      projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active!.seq,
      questions, ...(timeoutMs ? { autoResolutionMs: timeoutMs } : {}),
    });
  }

  private handleMcpElicitationRequest(request: AppServerServerRequest): void {
    const params = record(request.params);
    const elicitation = params && mcpElicitation(params);
    const claimed = this.claimScopedRequest(request);
    if (!claimed) return;
    const { responder, runtime, active } = claimed;
    if (!params || !elicitation || !this.isActiveOwner(runtime, active, request)) {
      this.cancelMcpElicitation(responder);
      return;
    }
    this.pendingMcpElicitations.set(request.id, { id: request.id, runtime, active: active!, responder, elicitation });
    this.emit({
      type: 'mcp_elicitation_needed', provider: 'codex', requestHandle: String(request.id),
      projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active!.seq,
      ...elicitation,
    });
  }

  private resolveServerRequest(event: AppServerNotification): void {
    const params = record(event.params);
    const id = params?.requestId ?? params?.id;
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const pending = this.pendingApprovals.get(id) ?? this.pendingUserInputs.get(id) ?? this.pendingMcpElicitations.get(id);
    if (!pending) return;
    const ids = eventIds(event);
    if ((ids.threadId && ids.threadId !== pending.active.threadId) || (ids.turnId && ids.turnId !== pending.active.id)) return;
    this.pendingApprovals.delete(id);
    const input = this.pendingUserInputs.get(id);
    if (input?.timeout) clearTimeout(input.timeout);
    this.pendingUserInputs.delete(id);
    this.pendingMcpElicitations.delete(id);
  }

  private declineResponder(responder: AppServerServerRequestResponder, kind: CodexApprovalMetadata['kind']): void {
    try {
      responder.respond(kind === 'permissions' ? { permissions: [] } : { decision: 'decline' });
    } catch { /* already resolved or unavailable */ }
  }

  private approvalResponse(pending: PendingApproval, decision: CodexApprovalDecision): Record<string, unknown> | undefined {
    if (decision.type === 'decision') {
      if (pending.kind === 'permissions' || !stringList(pending.params.availableDecisions).includes(decision.value)) return undefined;
      return { decision: decision.value };
    }
    if (decision.type === 'command-amendment') {
      if (pending.kind !== 'command' || !stringList(pending.params.availableDecisions).includes('acceptWithExecpolicyAmendment')) return undefined;
      const proposed = pending.params.proposedExecpolicyAmendment;
      if (!Array.isArray(proposed) || proposed.length === 0 || proposed.some((entry) => typeof entry !== 'string')
        || jsonIdentity(proposed) !== jsonIdentity(decision.execpolicyAmendment)) return undefined;
      return { acceptWithExecpolicyAmendment: { execpolicy_amendment: decision.execpolicyAmendment } };
    }
    if (pending.kind !== 'permissions') return undefined;
    const requested = Array.isArray(pending.params.permissions) ? pending.params.permissions : [];
    const counts = new Map<string, number>();
    for (const permission of requested) {
      const identity = jsonIdentity(permission);
      if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    for (const permission of decision.permissions) {
      const identity = jsonIdentity(permission);
      const count = identity ? counts.get(identity) ?? 0 : 0;
      if (!identity || count < 1) return undefined;
      counts.set(identity, count - 1);
    }
    return { permissions: decision.permissions, scope: decision.scope };
  }

  private clearPendingApprovals(runtime: ScopeRuntime, active?: ActiveTurn, respond = true): void {
    for (const [id, pending] of this.pendingApprovals) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingApprovals.delete(id);
      if (respond) this.declineResponder(pending.responder, pending.kind);
    }
  }

  private clearPending(runtime: ScopeRuntime, active?: ActiveTurn, respond = true): void {
    this.clearPendingApprovals(runtime, active, respond);
    for (const [id, pending] of this.pendingUserInputs) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingUserInputs.delete(id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (respond) this.respondEmptyUserInput(pending.responder);
    }
    for (const [id, pending] of this.pendingMcpElicitations) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingMcpElicitations.delete(id);
      if (respond) this.cancelMcpElicitation(pending.responder);
    }
  }

  private clearAllPending(respond = true): void {
    for (const runtime of this.runtimes.values()) this.clearPending(runtime, undefined, respond);
  }

  private pendingFor<T extends { id: string | number; runtime: ScopeRuntime; active: ActiveTurn }>(
    pending: Map<string | number, T>, projectPath: string, scope: string | undefined, requestHandle: string,
  ): T | undefined {
    const matches = [...pending.values()].filter((value) => String(value.id) === requestHandle);
    if (matches.length !== 1) return undefined;
    const value = matches[0];
    return value.runtime.projectPath === projectPath && value.runtime.scope === codexScope(scope)
      && value.runtime.active === value.active && !value.active.retired && !value.active.done
      ? value
      : undefined;
  }

  private userInputResponse(questions: CodexUserInputQuestion[], answers: CodexUserInputAnswers): boolean {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return false;
    const ids = questions.map((question) => question.id);
    if (Object.keys(answers).length !== ids.length || Object.keys(answers).some((id) => !ids.includes(id))) return false;
    return questions.every((question) => {
      const values = answers[question.id];
      if (!Array.isArray(values)) return false;
      if (values.length < 1 || values.length > MAX_OPTIONS || values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > MAX_TEXT)) return false;
      if (!question.options) return values.length === 1;
      const offered = new Set(question.options.map((option) => option.id));
      return values.every((value) => offered.has(value) || question.allowOther === true);
    });
  }

  private mcpElicitationResponse(
    elicitation: CodexMcpElicitationForm | CodexMcpElicitationUrl,
    decision: CodexMcpElicitationDecision,
  ): Record<string, unknown> | undefined {
    if (!decision || typeof decision !== 'object') return undefined;
    if (decision.action === 'decline' || decision.action === 'cancel') return decision.content === undefined || decision.content === null
      ? { action: decision.action, content: null }
      : undefined;
    if (decision.action !== 'accept') return undefined;
    if (elicitation.mode === 'url') return decision.content === null ? { action: 'accept', content: null } : undefined;
    return decision.content !== null && schemaAccepts(elicitation.requestedSchema, decision.content)
      ? { action: 'accept', content: decision.content }
      : undefined;
  }

  private respondEmptyUserInput(responder: AppServerServerRequestResponder): void {
    try { responder.respond({ answers: {} }); } catch { /* already resolved */ }
  }

  private cancelMcpElicitation(responder: AppServerServerRequestResponder): void {
    try { responder.respond({ action: 'cancel', content: null }); } catch { /* already resolved */ }
  }

  private handleFailure(error: AppServerUnavailableError): void {
    this.markUnavailable(error.message);
  }

  private markUnavailable(reason: string): void {
    if (this.unavailableReason) return;
    this.unavailableReason = reason;
    for (const runtime of this.runtimes.values()) {
      this.clearPending(runtime, undefined, false);
      if (runtime.active) this.settleUnavailable(runtime, reason);
    }
  }

  private settleUnavailable(runtime: ScopeRuntime, reason: string): void {
    this.unavailableReason ??= reason;
    if (!runtime.active) {
      this.emit({ type: 'error', text: reason, projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: null });
      this.emit({ type: 'done', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: null, subagentsAborted: true });
      return;
    }
    const active = runtime.active;
    this.emit({ type: 'error', text: reason, projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq });
    this.finishTurn(runtime, active, { subagentsAborted: true });
  }

  private finishTurn(runtime: ScopeRuntime, active: ActiveTurn, flags: { subagentsAborted?: boolean; subagentsSettled?: boolean } = {}): void {
    if (runtime.active !== active || active.done) return;
    active.done = true;
    this.clearPending(runtime, active);
    this.emit({ type: 'done', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, ...flags });
    runtime.active = undefined;
  }

  private newTurn(runtime: ScopeRuntime): ActiveTurn {
    return {
      seq: ++runtime.turnSeq,
      threadId: runtime.threadId,
      done: false,
      retired: false,
      interruptSent: false,
      pendingNotifications: [],
    };
  }

  private turnStartParams(runtime: ScopeRuntime, args: Pick<CodexSendArgs, 'message' | 'model' | 'effort' | 'permission'>): Record<string, unknown> {
    const params: Record<string, unknown> = {
      threadId: runtime.threadId,
      input: [{ type: 'text', text: args.message }],
      cwd: runtime.cwd,
    };
    if (args.model) params.model = args.model;
    if (args.effort) params.effort = args.effort;
    switch (args.permission ?? 'auto') {
      case 'auto':
        params.approvalPolicy = 'onRequest';
        params.sandboxPolicy = { type: 'workspaceWrite', writableRoots: [runtime.cwd], networkAccess: true };
        break;
      case 'read-only':
        params.approvalPolicy = 'never';
        params.sandboxPolicy = { type: 'readOnly' };
        break;
      case 'full-access':
        params.approvalPolicy = 'never';
        params.sandboxPolicy = { type: 'dangerFullAccess' };
        break;
    }
    return params;
  }

  private flushPendingNotifications(runtime: ScopeRuntime, active: ActiveTurn): void {
    const pending = active.pendingNotifications;
    active.pendingNotifications = [];
    for (const event of pending) {
      if (runtime.active !== active || active.done || active.retired) break;
      if (eventIds(event).turnId !== active.id) continue;
      this.emitNotification(runtime, active, event);
    }
  }

  private emitNotification(runtime: ScopeRuntime, active: ActiveTurn, event: AppServerNotification): void {
    const context = { projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, threadId: active.threadId, turnId: active.id };
    const envelopes = mapAppServerEvent(event, context);
    const terminal = envelopes.some((envelope) => envelope.type === 'done');
    // The mapper exposes `done` for standalone consumers, while this backend
    // owns scope cleanup and emits its lifecycle flags exactly once.
    for (const envelope of envelopes) if (envelope.type !== 'done') this.emit(envelope);
    if (terminal) this.finishTurn(runtime, active, { subagentsSettled: true });
  }
}
