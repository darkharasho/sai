import {
  Codex,
  type CodexOptions,
  type Input,
  type RunStreamedResult,
  type ThreadEvent,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';
import path from 'node:path';
import { enrichedEnv } from '../shellEnv';
import { getOrCreate as getOrCreateWorkspace } from '../workspace';
import { mapCodexSdkEvent, type SaiEnvelope } from './sdkEventMap';
import { buildCodexInput, buildCodexSdkOptions } from './sdkOptions';
import { resolveBundledCodex } from './bundledModels';
import {
  codexScope,
  codexScopeKey,
  type CodexBackend,
  type CodexModelResult,
  type CodexSendArgs,
  type CodexSessionKind,
  type CodexStartArgs,
} from './types';

export interface CodexSdkThread {
  readonly id: string | null;
  runStreamed(input: Input, options?: TurnOptions): Promise<RunStreamedResult>;
}

export interface CodexSdkClient {
  startThread(options?: ThreadOptions): CodexSdkThread;
  resumeThread(id: string, options?: ThreadOptions): CodexSdkThread;
}

export interface SdkCodexBackendDeps {
  createClient?: (options: CodexOptions) => CodexSdkClient;
  emit?: (event: SaiEnvelope) => void;
  getModels?: (forceRefresh?: boolean) => Promise<CodexModelResult>;
  getEnv?: () => NodeJS.ProcessEnv;
  registerWorkspace?: (projectPath: string) => void;
  notifyCompletion?: (projectPath: string, info: { provider: string; summary?: string }) => void;
}

interface ScopeMeta {
  projectPath: string;
  scope: string;
  cwd: string;
  kind: CodexSessionKind;
  metaPreamble?: string;
  additionalDirectories?: string[];
}

interface ActiveTurn {
  controller: AbortController;
  seq: number;
  done: boolean;
  summary?: string;
}

interface ScopeRuntime extends ScopeMeta {
  sessionId?: string;
  client?: CodexSdkClient;
  thread?: CodexSdkThread;
  configIdentity?: string;
  turnSeq: number;
  active?: ActiveTurn;
}

const emptyModels = async (): Promise<CodexModelResult> => ({
  models: [],
  defaultModel: '',
});

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Codex SDK backend with one independently resumable runtime per workspace
 * scope. The SDK boundary is injectable so unit tests never launch Codex.
 */
export class SdkCodexBackend implements CodexBackend {
  private readonly runtimes = new Map<string, ScopeRuntime>();
  private readonly metadata = new Map<string, ScopeMeta>();
  private readonly createClient: (options: CodexOptions) => CodexSdkClient;
  private readonly emit: (event: SaiEnvelope) => void;
  private readonly loadModels: (forceRefresh?: boolean) => Promise<CodexModelResult>;
  private readonly getEnv: () => NodeJS.ProcessEnv;
  private readonly registerWorkspace: (projectPath: string) => void;
  private readonly notifyCompletion: (projectPath: string, info: { provider: string; summary?: string }) => void;

  constructor(deps: SdkCodexBackendDeps = {}) {
    this.createClient = deps.createClient ?? ((options) => {
      const bundled = resolveBundledCodex();
      const env = { ...(options.env ?? {}) };
      const pathKey = process.platform === 'win32' ? (Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path') : 'PATH';
      env[pathKey] = [...bundled.pathDirs, env[pathKey]].filter(Boolean).join(path.delimiter);
      return new Codex({ ...options, env, codexPathOverride: bundled.executablePath });
    });
    this.emit = deps.emit ?? (() => undefined);
    this.loadModels = deps.getModels ?? emptyModels;
    this.getEnv = deps.getEnv ?? enrichedEnv;
    this.registerWorkspace = deps.registerWorkspace ?? ((projectPath) => {
      try { getOrCreateWorkspace(projectPath); } catch { /* isolated tests or shutdown */ }
    });
    this.notifyCompletion = deps.notifyCompletion ?? (() => undefined);
  }

  start(args: CodexStartArgs): void {
    this.registerWorkspace(args.projectPath);
    const scope = codexScope(args.scope);
    const key = codexScopeKey(args.projectPath, scope);
    const nextMeta: ScopeMeta = {
      projectPath: args.projectPath,
      scope,
      cwd: args.scopeCwd || args.projectPath,
      kind: args.kind ?? 'chat',
      metaPreamble: args.metaPreamble,
      additionalDirectories: [...new Set((args.additionalDirectories ?? []).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))],
    };
    this.metadata.set(key, nextMeta);

    const runtime = this.runtimes.get(key);
    if (runtime) {
      const changed = runtime.cwd !== nextMeta.cwd
        || runtime.kind !== nextMeta.kind
        || runtime.metaPreamble !== nextMeta.metaPreamble;
      const directoriesChanged = JSON.stringify(runtime.additionalDirectories) !== JSON.stringify(nextMeta.additionalDirectories);
      Object.assign(runtime, nextMeta);
      if ((changed || directoriesChanged) && !runtime.active) this.clearConfiguredSdk(runtime);
    }

    this.emit({ type: 'ready', projectPath: args.projectPath, scope });
  }

  send(args: CodexSendArgs): void {
    this.registerWorkspace(args.projectPath);
    const scope = codexScope(args.scope);
    const key = codexScopeKey(args.projectPath, scope);
    const runtime = this.runtimeFor(args.projectPath, scope);

    if (runtime.active) {
      const prior = runtime.active;
      prior.controller.abort();
      this.finishTurn(runtime, prior, { subagentsAborted: true });
      // A Thread may still be draining after AbortSignal cancellation. Never
      // run its replacement through that same mutable object: create a fresh
      // client/thread below and resume only an already-authoritative session ID.
      this.clearConfiguredSdk(runtime);
    }

    const built = buildCodexSdkOptions({
      cwd: runtime.cwd,
      permission: args.permission,
      effort: args.effort,
      model: args.model,
      metaPreamble: runtime.metaPreamble,
      additionalDirectories: runtime.additionalDirectories,
    });
    const configIdentity = JSON.stringify({ thread: built.thread, client: built.clientConfig });
    const active: ActiveTurn = {
      controller: new AbortController(),
      seq: ++runtime.turnSeq,
      done: false,
    };
    runtime.active = active;
    this.emit({
      type: 'streaming_start',
      projectPath: args.projectPath,
      scope,
      turnSeq: active.seq,
      sessionId: runtime.sessionId ?? null,
    });

    try {
      if (!runtime.client || !runtime.thread || runtime.configIdentity !== configIdentity) {
        this.clearConfiguredSdk(runtime);
        runtime.client = this.createClient({
          env: stringEnv(this.getEnv()),
          config: built.clientConfig,
        });
        runtime.thread = runtime.sessionId
          ? runtime.client.resumeThread(runtime.sessionId, built.thread)
          : runtime.client.startThread(built.thread);
        runtime.configIdentity = configIdentity;
      }

      const input = buildCodexInput(args.message, args.imagePaths);
      void this.runTurn(key, runtime, active, runtime.thread, input);
    } catch (error) {
      this.emit({ type: 'error', text: errorText(error), projectPath: args.projectPath, scope, turnSeq: active.seq });
      this.finishTurn(runtime, active, { subagentsAborted: true });
    }
  }

  interrupt(projectPath: string, scope?: string): void {
    const normalizedScope = codexScope(scope);
    const runtime = this.runtimes.get(codexScopeKey(projectPath, normalizedScope));
    if (!runtime?.active) {
      this.emit({ type: 'done', projectPath, scope: normalizedScope, turnSeq: null });
      return;
    }
    const active = runtime.active;
    active.controller.abort();
    this.finishTurn(runtime, active, { subagentsAborted: true });
    // AbortSignal cancellation does not guarantee the SDK iterator has
    // finished draining. Retire the mutable thread while retaining sessionId,
    // so the next send gets a fresh thread and resumes only known-good identity.
    this.clearConfiguredSdk(runtime);
  }

  reconcileScope(projectPath: string, scope?: string): void {
    const normalizedScope = codexScope(scope);
    const runtime = this.runtimes.get(codexScopeKey(projectPath, normalizedScope));
    if (runtime?.active) return;
    this.emit({ type: 'done', projectPath, scope: normalizedScope, turnSeq: null });
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const normalizedScope = codexScope(scope);
    const runtime = this.runtimeFor(projectPath, normalizedScope);
    if (runtime.active) {
      // The renderer calls setSessionId whenever a chat is selected. A live
      // scope already owns its conversation, so selection must not interrupt it.
      return;
    }
    runtime.sessionId = sessionId;
    this.clearConfiguredSdk(runtime);
  }

  getModels(forceRefresh?: boolean): Promise<CodexModelResult> {
    return this.loadModels(forceRefresh);
  }

  suspendWorkspace(projectPath: string): void {
    for (const [key, runtime] of this.runtimes) {
      if (runtime.projectPath !== projectPath) continue;
      if (runtime.active) {
        const active = runtime.active;
        active.controller.abort();
        this.finishTurn(runtime, active, { subagentsAborted: true });
      }
      this.runtimes.delete(key);
    }
    for (const [key, meta] of this.metadata) {
      if (meta.projectPath === projectPath) this.metadata.delete(key);
    }
  }

  isWorkspaceBusy(projectPath: string): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.projectPath === projectPath && runtime.active) return true;
    }
    return false;
  }

  destroy(): void {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.active) continue;
      const active = runtime.active;
      active.controller.abort();
      this.finishTurn(runtime, active, { subagentsAborted: true });
    }
    this.runtimes.clear();
    this.metadata.clear();
  }

  private runtimeFor(projectPath: string, scope: string): ScopeRuntime {
    const key = codexScopeKey(projectPath, scope);
    const existing = this.runtimes.get(key);
    if (existing) return existing;

    const meta = this.metadata.get(key) ?? {
      projectPath,
      scope,
      cwd: projectPath,
      kind: 'chat' as const,
    };
    const runtime: ScopeRuntime = { ...meta, turnSeq: 0 };
    this.runtimes.set(key, runtime);
    return runtime;
  }

  private clearConfiguredSdk(runtime: ScopeRuntime): void {
    runtime.client = undefined;
    runtime.thread = undefined;
    runtime.configIdentity = undefined;
  }

  private isCurrent(runtime: ScopeRuntime, active: ActiveTurn): boolean {
    return runtime.active === active;
  }

  private finishTurn(
    runtime: ScopeRuntime,
    active: ActiveTurn,
    {
      subagentsAborted = false,
      subagentsSettled = false,
    }: { subagentsAborted?: boolean; subagentsSettled?: boolean } = {},
  ): void {
    if (!this.isCurrent(runtime, active) || active.done) return;
    active.done = true;
    this.emit({
      type: 'done',
      projectPath: runtime.projectPath,
      scope: runtime.scope,
      turnSeq: active.seq,
      ...(subagentsAborted ? { subagentsAborted: true } : {}),
      ...(subagentsSettled ? { subagentsSettled: true } : {}),
    });
    runtime.active = undefined;
  }

  private async runTurn(
    key: string,
    runtime: ScopeRuntime,
    active: ActiveTurn,
    thread: CodexSdkThread,
    input: Input,
  ): Promise<void> {
    let pendingResult: SaiEnvelope | undefined;
    try {
      const streamed = await thread.runStreamed(input, { signal: active.controller.signal });
      for await (const event of streamed.events) {
        if (!this.isCurrent(runtime, active) || this.runtimes.get(key) !== runtime) return;
        if (event.type === 'thread.started') runtime.sessionId = event.thread_id;
        if (event.type === 'item.completed' && event.item.type === 'agent_message') {
          active.summary = event.item.text || undefined;
        }
        const envelopes = mapCodexSdkEvent(event, {
          projectPath: runtime.projectPath,
          scope: runtime.scope,
          turnSeq: active.seq,
        });
        if (event.type === 'turn.completed') {
          // Native children can continue emitting collaboration events after
          // their parent reports completion. A SAI `result` is terminal to
          // the renderer, so retain it until the physical stream ends.
          pendingResult = envelopes.find((envelope) => envelope.type === 'result');
          continue;
        }
        if (event.type === 'turn.failed' || event.type === 'error') {
          // Failures must settle promptly: an SDK iterator is allowed to stay
          // open after a terminal error, and waiting for EOF would leave SAI
          // permanently busy. Do not leak a previously pending success.
          pendingResult = undefined;
          for (const envelope of envelopes) {
            if (envelope.type !== 'done' && this.isCurrent(runtime, active)) {
              this.emit(envelope);
            }
          }
          this.finishTurn(runtime, active, { subagentsAborted: true });
          return;
        }
        for (const envelope of envelopes) {
          // The parent can report `turn.completed` before native delegated
          // children emit their terminal collaboration events. Keep draining
          // the SDK iterator and emit its single SAI terminal `done` at EOF.
          if (envelope.type !== 'done' && this.isCurrent(runtime, active)) {
            this.emit(envelope);
          }
        }
      }
      if (thread.id) runtime.sessionId = thread.id;
      if (pendingResult && this.isCurrent(runtime, active)) {
        this.emit(pendingResult);
      }
      const shouldNotifyCompletion = Boolean(pendingResult) && runtime.kind === 'chat';
      // At physical EOF no further collaboration events can arrive. Mark the
      // final envelope so the renderer can clear any child the CLI omitted a
      // terminal event for, while an earlier logical parent done remains safe.
      this.finishTurn(runtime, active, { subagentsSettled: true });
      if (shouldNotifyCompletion) {
        this.notifyCompletion(runtime.projectPath, { provider: 'Codex', summary: active.summary });
      }
    } catch (error) {
      if (!this.isCurrent(runtime, active) || this.runtimes.get(key) !== runtime) return;
      if (!active.controller.signal.aborted && !isAbortError(error)) {
        this.emit({
          type: 'error',
          text: errorText(error),
          projectPath: runtime.projectPath,
          scope: runtime.scope,
          turnSeq: active.seq,
        });
      }
      this.finishTurn(runtime, active, { subagentsAborted: true });
    }
  }
}
