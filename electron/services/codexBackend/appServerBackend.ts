import {
  AppServerClient,
  AppServerUnavailableError,
  type AppServerClientTransport,
  type AppServerNotification,
} from './appServerClient';
import { mapAppServerEvent } from './appServerEventMap';
import { normalizeCodexModelOption, codexScope, codexScopeKey, type CodexAppServerPreviewStatus, type CodexBackend, type CodexModelResult, type CodexSendArgs, type CodexSessionKind, type CodexStartArgs } from './types';
import type { SaiEnvelope } from './sdkEventMap';
import { getOrCreate as getOrCreateWorkspace } from '../workspace';

interface ScopeMeta {
  projectPath: string;
  scope: string;
  cwd: string;
  kind: CodexSessionKind;
}

interface ActiveTurn {
  id: string;
  seq: number;
  done: boolean;
}

interface ScopeRuntime extends ScopeMeta {
  sessionId?: string;
  threadId?: string;
  turnSeq: number;
  active?: ActiveTurn;
}

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

function eventIds(event: AppServerNotification): { threadId?: string; turnId?: string } {
  const params = record(event.params);
  const thread = record(params?.thread);
  const turn = record(params?.turn);
  return {
    threadId: typeof params?.threadId === 'string' ? params.threadId : typeof thread?.id === 'string' ? thread.id : undefined,
    turnId: typeof params?.turnId === 'string' ? params.turnId : typeof turn?.id === 'string' ? turn.id : undefined,
  };
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
  private unsubscribeFailure: (() => void) | undefined;

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
    }
  }

  send(args: CodexSendArgs): void {
    this.registerWorkspace(args.projectPath);
    const scope = codexScope(args.scope);
    const runtime = this.runtimeFor(args.projectPath, scope);
    if (args.imagePaths?.length) {
      const active: ActiveTurn = { id: '', seq: ++runtime.turnSeq, done: false };
      runtime.active = active;
      this.emit({ type: 'streaming_start', projectPath: args.projectPath, scope, turnSeq: active.seq, sessionId: runtime.sessionId ?? null });
      this.emit({ type: 'error', text: new AppServerUnsupportedCapabilityError('image input').message, projectPath: args.projectPath, scope, turnSeq: active.seq });
      this.finishTurn(runtime, active, { subagentsAborted: true });
      return;
    }
    void this.startTurn(runtime, args.message);
  }

  interrupt(projectPath: string, scope?: string): void {
    const runtime = this.runtimes.get(codexScopeKey(projectPath, codexScope(scope)));
    if (!runtime?.active) {
      this.emit({ type: 'done', projectPath, scope: codexScope(scope), turnSeq: null });
      return;
    }
    const active = runtime.active;
    void this.interruptTurn(runtime, active);
  }

  reconcileScope(projectPath: string, scope?: string): void {
    const normalizedScope = codexScope(scope);
    const runtime = this.runtimes.get(codexScopeKey(projectPath, normalizedScope));
    if (!runtime?.active) this.emit({ type: 'done', projectPath, scope: normalizedScope, turnSeq: null });
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const runtime = this.runtimeFor(projectPath, codexScope(scope));
    if (runtime.active) return;
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

  suspendWorkspace(projectPath: string): void {
    for (const [key, runtime] of this.runtimes) {
      if (runtime.projectPath !== projectPath) continue;
      if (runtime.active) this.finishTurn(runtime, runtime.active, { subagentsAborted: true });
      this.runtimes.delete(key);
    }
    for (const [key, meta] of this.metadata) if (meta.projectPath === projectPath) this.metadata.delete(key);
  }

  isWorkspaceBusy(projectPath: string): boolean {
    return [...this.runtimes.values()].some((runtime) => runtime.projectPath === projectPath && Boolean(runtime.active));
  }

  destroy(): void {
    for (const runtime of this.runtimes.values()) if (runtime.active) this.finishTurn(runtime, runtime.active, { subagentsAborted: true });
    this.runtimes.clear();
    this.metadata.clear();
    this.unsubscribeNotifications?.();
    this.unsubscribeFailure?.();
    this.unsubscribeNotifications = undefined;
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
    const result = runtime.sessionId
      ? await client.request('thread/resume', { threadId: runtime.sessionId })
      : await client.request('thread/start', { cwd: runtime.cwd });
    const threadId = idFrom(result, 'thread');
    if (!threadId) throw new AppServerUnavailableError('Codex App Server returned a thread without an ID');
    runtime.threadId = threadId;
    runtime.sessionId = threadId;
  }

  private async startTurn(runtime: ScopeRuntime, message: string): Promise<void> {
    if (runtime.active) await this.interruptTurn(runtime, runtime.active);
    const active: ActiveTurn = { id: '', seq: ++runtime.turnSeq, done: false };
    runtime.active = active;
    this.emit({ type: 'streaming_start', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, sessionId: runtime.sessionId ?? null });
    try {
      await this.ensureThread(runtime);
      const client = await this.ensureClient();
      const result = await client.request('turn/start', {
        threadId: runtime.threadId,
        input: [{ type: 'text', text: message }],
      });
      const turnId = idFrom(result, 'turn');
      if (!turnId) throw new AppServerUnavailableError('Codex App Server returned a turn without an ID');
      if (runtime.active !== active) return;
      active.id = turnId;
    } catch (error) {
      if (runtime.active === active) this.settleUnavailable(runtime, errorText(error));
    }
  }

  private async interruptTurn(runtime: ScopeRuntime, active: ActiveTurn): Promise<void> {
    try {
      if (active.id && runtime.threadId) {
        const client = await this.ensureClient();
        await client.request('turn/interrupt', { threadId: runtime.threadId, turnId: active.id });
      }
    } catch (error) {
      this.markUnavailable(errorText(error));
    } finally {
      this.finishTurn(runtime, active, { subagentsAborted: true });
    }
  }

  private handleNotification(event: AppServerNotification): void {
    const ids = eventIds(event);
    // A notification without enough identity cannot be safely attributed to a
    // SAI scope; ignoring it is safer than leaking it into a newer chat.
    if (!ids.threadId) return;
    for (const [key, runtime] of this.runtimes) {
      if (runtime.threadId !== ids.threadId || this.runtimes.get(key) !== runtime) continue;
      if (runtime.active && (!ids.turnId || ids.turnId !== runtime.active.id)) continue;
      const context = { projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: runtime.active?.seq ?? runtime.turnSeq, threadId: runtime.threadId, turnId: runtime.active?.id };
      const envelopes = mapAppServerEvent(event, context);
      const terminal = envelopes.some((envelope) => envelope.type === 'done');
      // The mapper exposes `done` for standalone consumers, while this
      // backend owns scope cleanup. Emit it exactly once with lifecycle flags.
      for (const envelope of envelopes) if (envelope.type !== 'done') this.emit(envelope);
      if (terminal && runtime.active) this.finishTurn(runtime, runtime.active, { subagentsSettled: true });
    }
  }

  private handleFailure(error: AppServerUnavailableError): void {
    this.markUnavailable(error.message);
  }

  private markUnavailable(reason: string): void {
    if (this.unavailableReason) return;
    this.unavailableReason = reason;
    for (const runtime of this.runtimes.values()) if (runtime.active) this.settleUnavailable(runtime, reason);
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
    this.emit({ type: 'done', projectPath: runtime.projectPath, scope: runtime.scope, turnSeq: active.seq, ...flags });
    runtime.active = undefined;
  }
}
