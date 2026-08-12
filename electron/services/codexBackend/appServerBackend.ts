import {
  AppServerClient,
  AppServerUnavailableError,
  type AppServerClientTransport,
  type AppServerNotification,
  type AppServerServerRequest,
  type AppServerServerRequestResponder,
} from './appServerClient';
import { mapAppServerEvent } from './appServerEventMap';
import { normalizeCodexModelOption, codexScope, codexScopeKey, type CodexAppServerPreviewStatus, type CodexApprovalDecision, type CodexApprovalMetadata, type CodexApprovalResult, type CodexBackend, type CodexModelResult, type CodexSendArgs, type CodexSessionKind, type CodexStartArgs } from './types';
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

const APPROVAL_METHODS = {
  'item/commandExecution/requestApproval': 'command',
  'item/fileChange/requestApproval': 'file-change',
  'item/permissions/requestApproval': 'permissions',
} as const;

type ApprovalMethod = keyof typeof APPROVAL_METHODS;

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
    this.clearPendingApprovals(runtime);
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
    this.runtimes.clear();
    this.metadata.clear();
    this.pendingApprovals.clear();
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

  private resolveServerRequest(event: AppServerNotification): void {
    const params = record(event.params);
    const id = params?.requestId ?? params?.id;
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    const ids = eventIds(event);
    if ((ids.threadId && ids.threadId !== pending.active.threadId) || (ids.turnId && ids.turnId !== pending.active.id)) return;
    this.pendingApprovals.delete(id);
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

  private handleFailure(error: AppServerUnavailableError): void {
    this.markUnavailable(error.message);
  }

  private markUnavailable(reason: string): void {
    if (this.unavailableReason) return;
    this.unavailableReason = reason;
    for (const runtime of this.runtimes.values()) {
      this.clearPendingApprovals(runtime, undefined, false);
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
    this.clearPendingApprovals(runtime, active);
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
