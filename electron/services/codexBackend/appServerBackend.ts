import {
  AppServerClient,
  AppServerUnavailableError,
  type AppServerClientTransport,
  type AppServerNotification,
  type AppServerServerRequest,
  type AppServerServerRequestResponder,
} from './appServerClient';
import { mapAppServerEvent } from './appServerEventMap';
import { SAI_SWARM_CAPABILITY_PROBE, SAI_SWARM_DYNAMIC_TOOLS } from './appServerDynamicTools';
import { dispatchSaiSwarmDynamicTool, dynamicToolResponse, validateSaiSwarmDynamicToolCall } from './dynamicToolBridge';
import { isCodexUserInputResponse, normalizeCodexModelOption, codexScope, codexScopeKey, type CodexAppServerPreviewStatus, type CodexApprovalDecision, type CodexApprovalMetadata, type CodexApprovalResult, type CodexBackend, type CodexMcpElicitationDecision, type CodexMcpElicitationForm, type CodexMcpElicitationUrl, type CodexMcpRuntimeStatus, type CodexModelResult, type CodexSendArgs, type CodexSessionKind, type CodexStartArgs, type CodexUserInputAnswers, type CodexUserInputQuestion, type CodexUserInputResponse } from './types';
import type { SaiEnvelope } from './sdkEventMap';
import { getOrCreate as getOrCreateWorkspace } from '../workspace';
import type { SaiToolDispatch } from '../saiToolBridge';

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
  readonly key: string;
  readonly requestHandle: string;
  readonly client: AppServerClientTransport;
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly kind: CodexApprovalMetadata['kind'];
  /** Raw request is deliberately retained only in main process for validation. */
  readonly params: Record<string, unknown>;
}

interface PendingUserInput {
  readonly key: string;
  readonly requestHandle: string;
  readonly client: AppServerClientTransport;
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly questions: CodexUserInputQuestion[];
  timeout?: ReturnType<typeof setTimeout>;
}

interface PendingMcpElicitation {
  readonly key: string;
  readonly requestHandle: string;
  readonly client: AppServerClientTransport;
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  readonly elicitation: CodexMcpElicitationForm | CodexMcpElicitationUrl;
}

interface PendingDynamicTool {
  readonly key: string;
  readonly client: AppServerClientTransport;
  readonly id: string | number;
  readonly runtime: ScopeRuntime;
  readonly active: ActiveTurn;
  readonly responder: AppServerServerRequestResponder;
  resolved: boolean;
}

interface CapabilityProbe {
  readonly client: AppServerClientTransport;
  readonly threadId: string;
  turnId?: string;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
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
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 15_000;

export class AppServerUnsupportedCapabilityError extends Error {
  constructor(capability: string) {
    super(`Codex App Server preview: ${capability} is not supported`);
    this.name = 'AppServerUnsupportedCapabilityError';
  }
}

export interface AppServerBackendDeps {
  createClient?: (options: { experimentalApi: boolean }) => AppServerClientTransport;
  emit?: (event: SaiEnvelope) => void;
  registerWorkspace?: (projectPath: string) => void;
  /** Main-process owned renderer bridge for fixed App Server Dynamic Tools. */
  dynamicToolDispatch?: SaiToolDispatch | null;
  /** Bounded wait for the isolated no-op Dynamic Tool readiness check. */
  capabilityProbeTimeoutMs?: number;
}

type AppServerClientKind = 'standard' | 'orchestrator';

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

function approvalMetadata(request: AppServerServerRequest, requestHandle = String(request.id)): CodexApprovalMetadata | undefined {
  if (!(request.method in APPROVAL_METHODS)) return undefined;
  const params = record(request.params);
  if (!params) return undefined;
  const kind = APPROVAL_METHODS[request.method as ApprovalMethod];
  const metadata: CodexApprovalMetadata = {
    provider: 'codex',
    requestHandle,
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
    const header = boundedText(question?.header, 256);
    const prompt = boundedText(question?.question ?? question?.prompt);
    if (!id || !header || !prompt || ids.has(id)) return undefined;
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
    normalized.push({ id, header, prompt, ...(options ? { options } : {}), ...(question?.isOther === true ? { allowOther: true } : {}), ...(question?.isSecret === true ? { isSecret: true } : {}) });
  }
  return normalized;
}

function safePrimitiveSchema(value: unknown): Record<string, unknown> | undefined {
  const schema = record(value);
  if (!schema) return undefined;
  const type = schema?.type;
  if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean') return undefined;
  const normalized: Record<string, unknown> = { type };
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 32
    && schema.enum.every((entry) => (type === 'string' && typeof entry === 'string')
      || (type === 'number' && typeof entry === 'number' && Number.isFinite(entry))
      || (type === 'integer' && typeof entry === 'number' && Number.isInteger(entry))
      || (type === 'boolean' && typeof entry === 'boolean'))) {
    normalized.enum = [...schema.enum];
  } else if (schema.enum !== undefined) return undefined;
  return normalized;
}

/** The renderer intentionally offers scalar controls only. */
function safeSchema(value: unknown): Record<string, unknown> | undefined {
  const schema = record(value);
  if (!schema || schema.type !== 'object') return undefined;
  const properties = record(schema.properties) ?? {};
  const keys = Object.keys(properties);
  if (keys.length > 20 || keys.some((key) => key.length === 0 || key.length > 128)) return undefined;
  const safeProperties: Record<string, unknown> = {};
  for (const key of keys) {
    const child = safePrimitiveSchema(properties[key]);
    if (!child) return undefined;
    safeProperties[key] = child;
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required)
    || schema.required.some((key) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(safeProperties, key)))) return undefined;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return undefined;
  return { type: 'object', properties: safeProperties, ...(schema.required ? { required: [...schema.required] } : {}), additionalProperties: false };
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
  private readonly createClient: (options: { experimentalApi: boolean }) => AppServerClientTransport;
  private readonly emit: (event: SaiEnvelope) => void;
  private readonly registerWorkspace: (projectPath: string) => void;
  private readonly clients = new Map<AppServerClientKind, AppServerClientTransport>();
  private readonly clientStarts = new Map<AppServerClientKind, Promise<void>>();
  /**
   * mcpServerStatus/list is aggregate connection state and contains no
   * thread ID. A connection may expose it only while it has served exactly
   * one SAI scope; after another scope uses it, status is permanently hidden
   * rather than leaking one workspace's server information into another.
   */
  private readonly mcpStatusScopeOwners = new Map<AppServerClientTransport, string | null>();
  private unavailableReason: string | undefined;
  private orchestratorUnavailableReason: string | undefined;
  private readonly clientUnsubscribers: Array<() => void> = [];
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly pendingUserInputs = new Map<string, PendingUserInput>();
  private readonly pendingMcpElicitations = new Map<string, PendingMcpElicitation>();
  private readonly pendingDynamicTools = new Map<string, PendingDynamicTool>();
  private readonly clientRequestTokens = new Map<AppServerClientTransport, number>();
  private nextClientRequestToken = 0;
  private nextRendererRequestHandle = 0;
  private readonly dynamicToolDispatch: SaiToolDispatch | null | undefined;
  private readonly capabilityProbeTimeoutMs: number;
  private capabilityProbe: CapabilityProbe | undefined;

  constructor(deps: AppServerBackendDeps = {}) {
    this.createClient = deps.createClient ?? ((options) => new AppServerClient(options));
    this.emit = deps.emit ?? (() => undefined);
    this.registerWorkspace = deps.registerWorkspace ?? ((projectPath) => {
      try { getOrCreateWorkspace(projectPath); } catch { /* isolated tests or shutdown */ }
    });
    this.dynamicToolDispatch = deps.dynamicToolDispatch;
    this.capabilityProbeTimeoutMs = deps.capabilityProbeTimeoutMs && deps.capabilityProbeTimeoutMs > 0
      ? deps.capabilityProbeTimeoutMs
      : DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS;
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
      const failure = this.startupFailure(runtime, error);
      if (runtime.kind === 'orchestrator') this.orchestratorUnavailableReason ??= failure.message;
      this.settleUnavailable(runtime, failure.message, runtime.kind !== 'orchestrator');
      throw failure;
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

  /**
   * MCP runtime state belongs to the physical App Server connection, not a
   * shared workspace cache. This preserves isolation between standard chat
   * and the experimental orchestrator client even when their thread IDs match.
   */
  async getMcpRuntimeStatus(projectPath?: string, scope?: string): Promise<CodexMcpRuntimeStatus> {
    const runtime = projectPath === undefined
      ? undefined
      : this.runtimes.get(codexScopeKey(projectPath, codexScope(scope)));
    if (!runtime?.threadId) {
      return { available: false, reason: 'Codex App Server MCP status is unavailable for this scope', servers: [] };
    }
    try {
      const client = await this.ensureClient(runtime);
      const owner = this.mcpStatusScopeOwners.get(client);
      const key = codexScopeKey(runtime.projectPath, runtime.scope);
      if (owner !== key) {
        return {
          available: false,
          reason: 'Codex App Server MCP status is unavailable because this connection is shared across scopes',
          servers: [],
        };
      }
      return await client.refreshMcpRuntimeStatus();
    } catch (error) {
      const reason = errorText(error);
      if (this.clientKind(runtime) === 'standard') this.markUnavailable(reason);
      return { available: false, reason, servers: [] };
    }
  }

  /**
   * Swarm is only safe to advertise after an isolated experimental client has
   * accepted SAI's exact Dynamic Tool catalogue. A handshake/model list alone
   * does not establish that `dynamicTools` is supported by this App Server.
   */
  async getSwarmStatus(): Promise<CodexAppServerPreviewStatus> {
    if (this.unavailableReason) return { available: false, reason: this.unavailableReason };
    if (this.orchestratorUnavailableReason) return { available: false, reason: this.orchestratorUnavailableReason };
    try {
      const client = await this.ensureClient({ kind: 'orchestrator' } as ScopeRuntime);
      // First validate the exact fixed Swarm catalogue the real orchestrator
      // receives. This thread never starts a turn and is immediately archived.
      const catalogueResult = await client.request('thread/start', {
        cwd: process.cwd(),
        dynamicTools: SAI_SWARM_DYNAMIC_TOOLS,
      });
      const catalogueThreadId = idFrom(catalogueResult, 'thread');
      if (!catalogueThreadId) throw new AppServerUnavailableError('Codex App Server did not return a Swarm catalogue probe thread ID');
      await client.request('thread/archive', { threadId: catalogueThreadId });

      // A second isolated thread exposes only the inert diagnostic. Even if
      // the model ignores its instruction, no real Swarm Dynamic Tool exists
      // in this catalogue and no renderer action can be reached.
      const probeResult = await client.request('thread/start', {
        cwd: process.cwd(),
        dynamicTools: [SAI_SWARM_CAPABILITY_PROBE],
      });
      const threadId = idFrom(probeResult, 'thread');
      if (!threadId) throw new AppServerUnavailableError('Codex App Server did not return a Dynamic Tool probe thread ID');
      const probe = this.createCapabilityProbe(client, threadId);
      try {
        const turnResult = await client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: 'SAI transport capability check: call sai_swarm_capability_probe exactly once with {}. Do not call any other tool or take any other action.' }],
        });
        const turnId = idFrom(turnResult, 'turn');
        if (!turnId) throw new AppServerUnavailableError('Codex App Server did not return a Dynamic Tool probe turn ID');
        probe.turnId = turnId;
        await probe.promise;
      } finally {
        this.clearCapabilityProbe(probe);
        if (probe.turnId) await client.request('turn/interrupt', { threadId, turnId: probe.turnId }).catch(() => undefined);
        // Dynamic tools persist with a thread; always archive the probe even
        // after timeout or rejection so it can never be resumed by a user.
        await client.request('thread/archive', { threadId });
      }
      return { available: true };
    } catch (error) {
      const reason = errorText(error);
      this.handleFailure('orchestrator', new AppServerUnavailableError(reason));
      return { available: false, reason };
    }
  }

  approve(projectPath: string, scope: string | undefined, requestHandle: string, decision: CodexApprovalDecision): CodexApprovalResult {
    const normalizedScope = codexScope(scope);
    // Accept the raw ID only as a backwards-compatible main-process caller
    // path when it identifies exactly one outstanding request. Renderer events
    // always receive the opaque, client-unique handle above.
    const matches = [...this.pendingApprovals.values()].filter((pending) => pending.requestHandle === requestHandle || String(pending.id) === requestHandle);
    if (matches.length !== 1) return { ok: false, code: 'not-pending' };
    const pending = matches[0];
    if (pending.runtime.projectPath !== projectPath || pending.runtime.scope !== normalizedScope
      || pending.runtime.active !== pending.active || pending.active.retired || pending.active.done) {
      return { ok: false, code: 'not-pending' };
    }
    const response = this.approvalResponse(pending, decision);
    if (!response) return { ok: false, code: 'invalid-decision' };
    this.pendingApprovals.delete(pending.key);
    try {
      pending.responder.respond(response);
      this.emitApprovalResolved(pending);
      return { ok: true };
    } catch {
      return { ok: false, code: 'not-pending' };
    }
  }

  answerUserInput(projectPath: string, scope: string | undefined, requestHandle: string, response: CodexUserInputResponse): CodexApprovalResult {
    const pending = this.pendingFor(this.pendingUserInputs, projectPath, scope, requestHandle);
    if (!pending) return { ok: false, code: 'not-pending' };
    if (!isCodexUserInputResponse(response)) return { ok: false, code: 'invalid-decision' };
    const protocolResponse = this.userInputResponse(pending.questions, response);
    if (!protocolResponse) return { ok: false, code: 'invalid-decision' };
    try {
      pending.responder.respond(protocolResponse);
      this.pendingUserInputs.delete(pending.key);
      if (pending.timeout) clearTimeout(pending.timeout);
      this.emitUserInputResolved(pending);
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
      this.pendingMcpElicitations.delete(pending.key);
      this.emitMcpElicitationResolved(pending);
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
    for (const unsubscribe of this.clientUnsubscribers.splice(0)) unsubscribe();
    for (const client of this.clients.values()) client.destroy();
    this.clients.clear();
    this.clientStarts.clear();
    this.mcpStatusScopeOwners.clear();
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

  private startupFailure(runtime: ScopeRuntime, error: unknown): Error {
    const reason = errorText(error);
    if (runtime.kind === 'orchestrator' && /dynamicTools|experimentalApi/i.test(reason)) {
      return new AppServerUnavailableError(
        `Codex App Server Swarm tools require a newer Codex App Server host with experimental API support: ${reason}`,
      );
    }
    return error instanceof Error ? error : new AppServerUnavailableError(reason);
  }

  private clientKind(runtime?: ScopeRuntime): AppServerClientKind {
    return runtime?.kind === 'orchestrator' ? 'orchestrator' : 'standard';
  }

  private async ensureClient(runtime?: ScopeRuntime): Promise<AppServerClientTransport> {
    if (this.unavailableReason) throw new AppServerUnavailableError(this.unavailableReason);
    const kind = this.clientKind(runtime);
    if (kind === 'orchestrator' && this.orchestratorUnavailableReason) {
      throw new AppServerUnavailableError(this.orchestratorUnavailableReason);
    }
    let client = this.clients.get(kind);
    if (!client) {
      client = this.createClient({ experimentalApi: kind === 'orchestrator' });
      this.clients.set(kind, client);
      // Thread and turn IDs are only unique within one App Server connection.
      // Keep the source client attached to every inbound event before routing it
      // to a scoped runtime.
      const owningClient = client;
      this.clientUnsubscribers.push(owningClient.onNotification((event) => this.handleNotification(owningClient, event)));
      this.clientUnsubscribers.push(owningClient.onServerRequest((request) => this.handleServerRequest(owningClient, request)));
      this.clientUnsubscribers.push(client.onFailure((error) => this.handleFailure(kind, error)));
      this.clientStarts.set(kind, client.start().catch((error) => {
        this.handleFailure(kind, error instanceof AppServerUnavailableError ? error : new AppServerUnavailableError(errorText(error)));
        throw error;
      }));
    }
    await this.clientStarts.get(kind)!;
    return client;
  }

  private async ensureThread(runtime: ScopeRuntime): Promise<void> {
    if (runtime.threadId) return;
    const client = await this.ensureClient(runtime);
    const isNewThread = !runtime.sessionId;
    const result = runtime.sessionId
      ? await client.request('thread/resume', { threadId: runtime.sessionId })
      : await client.request('thread/start', {
        cwd: runtime.cwd,
        ...(runtime.kind === 'orchestrator' ? { dynamicTools: SAI_SWARM_DYNAMIC_TOOLS } : {}),
      });
    const threadId = idFrom(result, 'thread');
    if (!threadId) throw new AppServerUnavailableError('Codex App Server returned a thread without an ID');
    runtime.threadId = threadId;
    runtime.sessionId = threadId;
    this.claimMcpStatusScope(client, runtime);
    if (isNewThread) this.emit({ type: 'session_id', sessionId: threadId, projectPath: runtime.projectPath, scope: runtime.scope });
  }

  private claimMcpStatusScope(client: AppServerClientTransport, runtime: ScopeRuntime): void {
    const key = codexScopeKey(runtime.projectPath, runtime.scope);
    const owner = this.mcpStatusScopeOwners.get(client);
    if (owner === undefined) {
      this.mcpStatusScopeOwners.set(client, key);
    } else if (owner !== key) {
      this.mcpStatusScopeOwners.set(client, null);
    }
  }

  private async startTurn(runtime: ScopeRuntime, args: Pick<CodexSendArgs, 'message' | 'model' | 'effort' | 'permission'>): Promise<void> {
    if (runtime.active) this.retireTurn(runtime, runtime.active);
    const active = this.newTurn(runtime);
    runtime.active = active;
    this.emit({ type: 'streaming_start', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, sessionId: runtime.sessionId ?? null });
    try {
      await this.ensureThread(runtime);
      active.threadId ??= runtime.threadId;
      const client = await this.ensureClient(runtime);
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
      if (runtime.active === active) this.settleUnavailable(runtime, errorText(error), runtime.kind !== 'orchestrator');
    }
  }

  private async requestInterrupt(runtime: ScopeRuntime, active: ActiveTurn): Promise<void> {
    if (active.interruptSent || !active.id || !active.threadId) return;
    active.interruptSent = true;
    try {
      const client = await this.ensureClient(runtime);
      await client.request('turn/interrupt', { threadId: active.threadId, turnId: active.id });
    } catch (error) {
      this.handleRuntimeFailure(runtime, errorText(error));
    }
  }

  private retireTurn(runtime: ScopeRuntime, active: ActiveTurn): void {
    if (active.retired) return;
    active.retired = true;
    void this.requestInterrupt(runtime, active);
    this.finishTurn(runtime, active, { subagentsAborted: true });
  }

  private ownsRuntime(client: AppServerClientTransport, runtime: ScopeRuntime): boolean {
    return this.clients.get(this.clientKind(runtime)) === client;
  }

  /** JSON-RPC request IDs are only unique within one App Server connection. */
  private requestKey(client: AppServerClientTransport, id: string | number): string {
    let token = this.clientRequestTokens.get(client);
    if (!token) {
      token = ++this.nextClientRequestToken;
      this.clientRequestTokens.set(client, token);
    }
    return JSON.stringify([token, typeof id, id]);
  }

  /** Never expose a wire request ID as the renderer's capability handle. */
  private rendererRequestHandle(client: AppServerClientTransport): string {
    let token = this.clientRequestTokens.get(client);
    if (!token) {
      token = ++this.nextClientRequestToken;
      this.clientRequestTokens.set(client, token);
    }
    return `codex-app-server-${token}-${++this.nextRendererRequestHandle}`;
  }

  private handleNotification(client: AppServerClientTransport, event: AppServerNotification): void {
    if (event.method === 'serverRequest/resolved') {
      this.resolveServerRequest(client, event);
      return;
    }
    const ids = eventIds(event);
    if (!ids.threadId) {
      if (!ids.turnId) return;
      const candidates = [...this.runtimes.values()].filter((runtime) => {
        const active = runtime.active;
        return Boolean(this.ownsRuntime(client, runtime) && active && !active.retired && active.id === ids.turnId);
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
      if (!this.ownsRuntime(client, runtime) || runtime.threadId !== ids.threadId || this.runtimes.get(key) !== runtime) continue;
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

  private handleServerRequest(client: AppServerClientTransport, request: AppServerServerRequest): void {
    if (request.method === 'item/tool/call') {
      if (this.handleCapabilityProbeRequest(client, request)) return;
      this.handleDynamicToolRequest(client, request);
      return;
    }
    if (request.method === USER_INPUT_METHOD) {
      this.handleUserInputRequest(client, request);
      return;
    }
    if (request.method === MCP_ELICITATION_METHOD) {
      this.handleMcpElicitationRequest(client, request);
      return;
    }
    const metadata = approvalMetadata(request, this.rendererRequestHandle(client));
    // Leave unsupported methods unclaimed so the transport sends its fail-closed
    // JSON-RPC error and retires the preview process.
    if (!metadata) return;
    const params = record(request.params);
    if (!params) return;
    let responder: AppServerServerRequestResponder;
    try {
      responder = client.claimServerRequest(request.id);
    } catch {
      return;
    }
    const ids = eventIds(request);
    const runtime = ids.threadId
      ? [...this.runtimes.values()].find((candidate) => this.ownsRuntime(client, candidate) && candidate.threadId === ids.threadId)
      : undefined;
    const active = runtime?.active;
    if (!runtime || !active || active.retired || !active.id || active.id !== ids.turnId || active.threadId !== ids.threadId) {
      this.declineResponder(responder, metadata.kind);
      return;
    }
    const key = this.requestKey(client, request.id);
    const pending: PendingApproval = { key, requestHandle: metadata.requestHandle, client, id: request.id, runtime, active, responder, kind: metadata.kind, params };
    this.pendingApprovals.set(key, pending);
    this.emit({
      type: 'approval_needed',
      projectPath: runtime.projectPath,
      scope: runtime.scope,
      turnSeq: active.seq,
      toolUseId: pending.requestHandle,
      toolName: metadata.kind === 'command' ? 'Command approval' : metadata.kind === 'file-change' ? 'File change approval' : 'Permission approval',
      ...metadata,
    });
  }

  private claimScopedRequest(client: AppServerClientTransport, request: AppServerServerRequest): { responder: AppServerServerRequestResponder; runtime?: ScopeRuntime; active?: ActiveTurn } | undefined {
    let responder: AppServerServerRequestResponder;
    try { responder = client.claimServerRequest(request.id); } catch { return undefined; }
    const ids = eventIds(request);
    const candidates = ids.threadId
      ? [...this.runtimes.values()].filter((candidate) => this.ownsRuntime(client, candidate) && candidate.threadId === ids.threadId)
      : [];
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

  private handleUserInputRequest(client: AppServerClientTransport, request: AppServerServerRequest): void {
    const params = record(request.params);
    const questions = params && userInputQuestions(params);
    const claimed = this.claimScopedRequest(client, request);
    if (!claimed) return;
    const { responder, runtime, active } = claimed;
    if (!params || !questions || !this.isActiveOwner(runtime, active, request)) {
      this.respondEmptyUserInput(responder);
      return;
    }
    const timeoutMs = safeAutoResolution(params.autoResolutionMs);
    const key = this.requestKey(client, request.id);
    const pending: PendingUserInput = {
      key, requestHandle: this.rendererRequestHandle(client), client, id: request.id, runtime, active: active!, responder, questions,
    };
    if (timeoutMs) {
      const timeout = setTimeout(() => {
        if (this.pendingUserInputs.get(key) !== pending) return;
        this.pendingUserInputs.delete(key);
        this.emitUserInputResolved(pending);
        this.respondEmptyUserInput(responder);
      }, timeoutMs);
      pending.timeout = timeout;
    }
    this.pendingUserInputs.set(key, pending);
    this.emit({
      type: 'user_input_needed', provider: 'codex', requestHandle: pending.requestHandle,
      projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active!.seq,
      questions, ...(timeoutMs ? { autoResolutionMs: timeoutMs } : {}),
    });
  }

  private handleMcpElicitationRequest(client: AppServerClientTransport, request: AppServerServerRequest): void {
    const params = record(request.params);
    const elicitation = params && mcpElicitation(params);
    const claimed = this.claimScopedRequest(client, request);
    if (!claimed) return;
    const { responder, runtime, active } = claimed;
    if (!params || !elicitation || !this.isActiveOwner(runtime, active, request)) {
      this.cancelMcpElicitation(responder);
      return;
    }
    const key = this.requestKey(client, request.id);
    const pending: PendingMcpElicitation = {
      key, requestHandle: this.rendererRequestHandle(client), client, id: request.id, runtime, active: active!, responder, elicitation,
    };
    this.pendingMcpElicitations.set(key, pending);
    this.emit({
      type: 'mcp_elicitation_needed', provider: 'codex', requestHandle: pending.requestHandle,
      projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active!.seq,
      ...elicitation,
    });
  }

  private handleDynamicToolRequest(client: AppServerClientTransport, request: AppServerServerRequest): void {
    const claimed = this.claimScopedRequest(client, request);
    if (!claimed) return;
    const { responder, runtime, active } = claimed;
    const ids = eventIds(request);
    const call = validateSaiSwarmDynamicToolCall(request.params);
    // Dynamic tools are an orchestrator-only protocol. Require both wire IDs:
    // accepting a thread-only request could route a previous turn's action.
    if (!runtime || !active || runtime.kind !== 'orchestrator' || !ids.threadId || !ids.turnId
      || !this.isActiveOwner(runtime, active, request) || !call || this.pendingDynamicTools.has(this.requestKey(client, request.id))) {
      try { responder.respond(dynamicToolResponse(undefined, true)); } catch { /* resolved */ }
      return;
    }
    const key = this.requestKey(client, request.id);
    const pending: PendingDynamicTool = { key, client, id: request.id, runtime, active, responder, resolved: false };
    this.pendingDynamicTools.set(key, pending);
    void dispatchSaiSwarmDynamicTool(call, { workspace: runtime.projectPath, scope: runtime.scope }, this.dynamicToolDispatch)
      .then((response) => this.resolveDynamicTool(pending, response));
  }

  private createCapabilityProbe(client: AppServerClientTransport, threadId: string): CapabilityProbe {
    if (this.capabilityProbe) throw new AppServerUnavailableError('Codex App Server Dynamic Tool probe is already running');
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
    const probe = {
      client, threadId, promise, resolve, reject,
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
    } satisfies CapabilityProbe;
    probe.timeout = setTimeout(() => {
      if (this.capabilityProbe !== probe) return;
      probe.reject(new AppServerUnavailableError('Codex App Server did not invoke SAI\'s Dynamic Tool capability probe'));
    }, this.capabilityProbeTimeoutMs);
    this.capabilityProbe = probe;
    return probe;
  }

  private clearCapabilityProbe(probe: CapabilityProbe): void {
    clearTimeout(probe.timeout);
    if (this.capabilityProbe === probe) this.capabilityProbe = undefined;
  }

  /** Readiness-only request. It is never forwarded to the Swarm dispatcher. */
  private handleCapabilityProbeRequest(client: AppServerClientTransport, request: AppServerServerRequest): boolean {
    const params = record(request.params);
    if (params?.tool !== SAI_SWARM_CAPABILITY_PROBE.name) return false;
    const probe = this.capabilityProbe;
    if (!probe || probe.client !== client) return false;
    let responder: AppServerServerRequestResponder;
    try { responder = client.claimServerRequest(request.id); } catch { return true; }
    const ids = eventIds(request);
    const argumentsValue = record(params.arguments);
    if (!probe.turnId || ids.threadId !== probe.threadId || ids.turnId !== probe.turnId || !argumentsValue || Object.keys(argumentsValue).length > 0) {
      try { responder.respond(dynamicToolResponse(undefined, true)); } catch { /* already resolved */ }
      probe.reject(new AppServerUnavailableError('Codex App Server returned an invalid Dynamic Tool capability probe request'));
      return true;
    }
    try {
      responder.respond(dynamicToolResponse({ ok: true, capability: 'dynamic-tools' }));
      probe.resolve();
    } catch {
      probe.reject(new AppServerUnavailableError('Codex App Server Dynamic Tool capability probe could not be acknowledged'));
    }
    return true;
  }

  private resolveDynamicTool(pending: PendingDynamicTool, response: ReturnType<typeof dynamicToolResponse>): void {
    if (this.pendingDynamicTools.get(pending.key) !== pending || pending.resolved) return;
    pending.resolved = true;
    this.pendingDynamicTools.delete(pending.key);
    try { pending.responder.respond(response); } catch { /* resolved */ }
  }

  private resolveServerRequest(client: AppServerClientTransport, event: AppServerNotification): void {
    const params = record(event.params);
    const id = params?.requestId ?? params?.id;
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const key = this.requestKey(client, id);
    const pending = this.pendingApprovals.get(key) ?? this.pendingUserInputs.get(key) ?? this.pendingMcpElicitations.get(key) ?? this.pendingDynamicTools.get(key);
    if (!pending) return;
    if (pending.client !== client || !this.ownsRuntime(client, pending.runtime)) return;
    const ids = eventIds(event);
    if ((ids.threadId && ids.threadId !== pending.active.threadId) || (ids.turnId && ids.turnId !== pending.active.id)) return;
    const input = this.pendingUserInputs.get(key);
    if (input?.timeout) clearTimeout(input.timeout);
    const elicitation = this.pendingMcpElicitations.get(key);
    const dynamic = this.pendingDynamicTools.get(key);
    this.pendingApprovals.delete(key);
    this.pendingUserInputs.delete(key);
    this.pendingMcpElicitations.delete(key);
    if (dynamic) {
      dynamic.resolved = true;
      this.pendingDynamicTools.delete(key);
    }
    if (input) this.emitUserInputResolved(input);
    if (elicitation) this.emitMcpElicitationResolved(elicitation);
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
    for (const [key, pending] of this.pendingApprovals) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingApprovals.delete(key);
      if (respond) this.declineResponder(pending.responder, pending.kind);
    }
  }

  private clearPending(runtime: ScopeRuntime, active?: ActiveTurn, respond = true): void {
    this.clearPendingApprovals(runtime, active, respond);
    for (const [key, pending] of this.pendingUserInputs) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingUserInputs.delete(key);
      if (pending.timeout) clearTimeout(pending.timeout);
      this.emitUserInputResolved(pending);
      if (respond) this.respondEmptyUserInput(pending.responder);
    }
    for (const [key, pending] of this.pendingMcpElicitations) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingMcpElicitations.delete(key);
      this.emitMcpElicitationResolved(pending);
      if (respond) this.cancelMcpElicitation(pending.responder);
    }
    for (const [key, pending] of this.pendingDynamicTools) {
      if (pending.runtime !== runtime || (active && pending.active !== active)) continue;
      this.pendingDynamicTools.delete(key);
      if (!pending.resolved) {
        pending.resolved = true;
        if (respond) {
          try { pending.responder.respond(dynamicToolResponse(undefined, true)); } catch { /* resolved */ }
        }
      }
    }
  }

  private clearAllPending(respond = true): void {
    for (const runtime of this.runtimes.values()) this.clearPending(runtime, undefined, respond);
  }

  private emitUserInputResolved(pending: PendingUserInput): void {
    this.emit({ type: 'user_input_resolved', provider: 'codex', requestHandle: pending.requestHandle,
      projectPath: pending.runtime.projectPath, scope: pending.runtime.scope, turnSeq: pending.active.seq });
  }

  private emitApprovalResolved(pending: PendingApproval): void {
    this.emit({ type: 'approval_resolved', provider: 'codex', requestHandle: pending.requestHandle,
      toolUseId: pending.requestHandle, projectPath: pending.runtime.projectPath,
      scope: pending.runtime.scope, turnSeq: pending.active.seq });
  }

  private emitMcpElicitationResolved(pending: PendingMcpElicitation): void {
    this.emit({ type: 'mcp_elicitation_resolved', provider: 'codex', requestHandle: pending.requestHandle,
      projectPath: pending.runtime.projectPath, scope: pending.runtime.scope, turnSeq: pending.active.seq });
  }

  private pendingFor<T extends { id: string | number; requestHandle: string; runtime: ScopeRuntime; active: ActiveTurn }>(
    pending: Map<string, T>, projectPath: string, scope: string | undefined, requestHandle: string,
  ): T | undefined {
    const matches = [...pending.values()].filter((value) => value.requestHandle === requestHandle || String(value.id) === requestHandle);
    if (matches.length !== 1) return undefined;
    const value = matches[0];
    return value.runtime.projectPath === projectPath && value.runtime.scope === codexScope(scope)
      && value.runtime.active === value.active && !value.active.retired && !value.active.done
      ? value
      : undefined;
  }

  private userInputResponse(questions: CodexUserInputQuestion[], response: CodexUserInputResponse): { answers: CodexUserInputAnswers } | undefined {
    if (response.type === 'cancel') return { answers: {} };
    const { answers } = response;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return undefined;
    const ids = questions.map((question) => question.id);
    if (Object.keys(answers).length !== ids.length || Object.keys(answers).some((id) => !ids.includes(id))) return undefined;
    const valid = questions.every((question) => {
      const values = answers[question.id]?.answers;
      if (!Array.isArray(values)) return false;
      if (values.length < 1 || values.length > MAX_OPTIONS || values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > MAX_TEXT)) return false;
      if (!question.options) return values.length === 1;
      const offered = new Set(question.options.map((option) => option.id));
      return values.every((value) => offered.has(value) || question.allowOther === true);
    });
    return valid ? { answers } : undefined;
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

  private handleFailure(kind: AppServerClientKind, error: AppServerUnavailableError): void {
    if (kind === 'standard') {
      this.markUnavailable(error.message);
      return;
    }
    this.orchestratorUnavailableReason ??= error.message;
    for (const runtime of this.runtimes.values()) {
      if (this.clientKind(runtime) !== 'orchestrator') continue;
      this.clearPending(runtime, undefined, false);
      if (runtime.active) this.settleUnavailable(runtime, error.message, false);
    }
  }

  private handleRuntimeFailure(runtime: ScopeRuntime, reason: string): void {
    if (this.clientKind(runtime) === 'orchestrator') {
      this.handleFailure('orchestrator', new AppServerUnavailableError(reason));
      return;
    }
    this.markUnavailable(reason);
  }

  private markUnavailable(reason: string): void {
    if (this.unavailableReason) return;
    this.unavailableReason = reason;
    for (const runtime of this.runtimes.values()) {
      this.clearPending(runtime, undefined, false);
      if (runtime.active) this.settleUnavailable(runtime, reason);
    }
  }

  private settleUnavailable(runtime: ScopeRuntime, reason: string, global = true): void {
    if (global) this.unavailableReason ??= reason;
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
