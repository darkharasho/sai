/**
 * sdkBackend.ts — SdkBackend: a ClaudeBackend that drives @anthropic-ai/claude-agent-sdk
 * with one persistent `query()` per scope (projectPath + scope).
 *
 * Phase 1: core chat only. Tool-use approval, question answering, etc. are
 * still delegated to the existing claude.ts impls (same as CliBackend).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { query as QueryFn, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  approveImpl,
  answerQuestionImpl,
  answerPlanReviewImpl,
  alwaysAllowImpl,
  generateCommitMessageImpl,
  generateTitleImpl,
  getAvailableClaudeModels,
  emitChatMessage,
} from '../claude';
import { buildSdkOptions } from './sdkOptions';
import { mapSdkMessage, type MapperState } from './sdkMessageMap';
import type {
  ClaudeBackend,
  StartArgs,
  SendArgs,
  CompactArgs,
  ApproveArgs,
  AnswerQuestionArgs,
  AnswerPlanArgs,
} from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScopeSession {
  /** The live async-generator returned by queryFn */
  query: {
    [Symbol.asyncIterator](): AsyncIterator<any>;
    interrupt(): Promise<void>;
    close(): void;
  };
  /** Enqueue a user message into the input channel */
  pushInput: (msg: SdkUserInputMessage) => void;
  /** Ever-incrementing send counter for this scope */
  turnSeq: number;
  /** turnSeq of the currently-active assistant turn */
  activeTurnSeq: number;
  /** Persisted session ID (for resume) */
  sessionId?: string;
  /** Mapper state threaded through the drain loop */
  mapperState: MapperState;
  cwd: string;
  kind: 'chat' | 'task' | 'orchestrator';
  appendSystemPrompt?: string;
}

// Use the SDK's SDKUserMessage type for the input channel
type SdkUserInputMessage = SDKUserMessage;

// ─── resolveClaudePath ────────────────────────────────────────────────────────

/**
 * Scan PATH for the `claude` executable.  Returns the first absolute path found,
 * or undefined (SDK uses its bundled runtime when the option is omitted).
 */
export function resolveClaudePath(): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// ─── Injectable deps ──────────────────────────────────────────────────────────

export interface SdkBackendDeps {
  /** Override the SDK's `query` function (for tests). */
  queryFn?: typeof QueryFn;
  /** Where to send claude:message payloads. Default: real ipc / remoteBus. */
  emit?: (payload: Record<string, unknown>) => void;
  /** How to resolve the claude executable path. Default: PATH scan. */
  resolveClaudePath?: () => string | undefined;
}

// ─── SdkBackend ───────────────────────────────────────────────────────────────

export class SdkBackend implements ClaudeBackend {
  private readonly sessions = new Map<string, ScopeSession>();
  /** Remembered session IDs for the next send after setSessionId */
  private readonly pendingResume = new Map<string, string>();
  /** Per-scope pending cwd/kind/appendSystemPrompt set by start() */
  private readonly scopeMeta = new Map<string, { cwd: string; kind: 'chat' | 'task' | 'orchestrator'; appendSystemPrompt?: string }>();

  private readonly queryFn: typeof QueryFn;
  private readonly _emit: (payload: Record<string, unknown>) => void;
  private readonly _resolveClaudePath: () => string | undefined;

  constructor(deps?: SdkBackendDeps) {
    if (deps?.queryFn) {
      this.queryFn = deps.queryFn;
    } else {
      // Lazy-load real SDK to avoid hard dependency during tests
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.queryFn = require('@anthropic-ai/claude-agent-sdk').query;
    }

    this._emit = deps?.emit ?? defaultEmit;
    this._resolveClaudePath = deps?.resolveClaudePath ?? resolveClaudePath;
  }

  // ─── start ─────────────────────────────────────────────────────────────────

  start(args: StartArgs): { slashCommands: string[] } {
    const { projectPath, scope, scopeCwd, kind = 'chat', metaPreamble } = args;
    const scopeKey = toScopeKey(projectPath, scope);
    const cwd = scopeCwd ?? projectPath;
    this.scopeMeta.set(scopeKey, { cwd, kind, appendSystemPrompt: metaPreamble });
    return { slashCommands: [] };
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  send(args: SendArgs): void {
    const { projectPath, message, scope, permMode, effort, model } = args;
    const scopeKey = toScopeKey(projectPath, scope);

    try {
      // Ensure a session exists for this scope
      let session = this.sessions.get(scopeKey);
      if (!session) {
        session = this._createSession(scopeKey, projectPath, scope, { permMode, effort, model });
      }

      // Bump turn counter
      session.turnSeq += 1;
      session.activeTurnSeq = session.turnSeq;
      session.mapperState = { ...session.mapperState, streaming: true };

      // Emit streaming_start for this user turn
      this._emit({
        type: 'streaming_start',
        projectPath,
        scope: scope ?? 'chat',
        turnSeq: session.turnSeq,
      });

      // Push the user message into the input channel
      session.pushInput({
        type: 'user',
        message: { role: 'user', content: message },
        parent_tool_use_id: null,
      });
    } catch (err) {
      // Surface SDK/session-creation failures to the chat instead of silently
      // producing "no thinking, no response" (e.g. the SDK runtime failing to
      // load or spawn). Without this, a synchronous throw from queryFn() in
      // _createSession leaves the renderer with nothing.
      const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      // eslint-disable-next-line no-console
      console.error('[SdkBackend.send] failed:', text);
      this.sessions.delete(scopeKey);
      const cur = this.sessions.get(scopeKey);
      const turnSeq = cur?.activeTurnSeq ?? 0;
      this._emit({ type: 'error', text: `SDK backend error: ${text}`, projectPath, scope: scope ?? 'chat' });
      this._emit({ type: 'done', projectPath, scope: scope ?? 'chat', turnSeq });
    }
  }

  // ─── interrupt ─────────────────────────────────────────────────────────────

  interrupt(projectPath: string, scope?: string): void {
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (session) {
      void session.query.interrupt();
    }
  }

  // ─── setSessionId ──────────────────────────────────────────────────────────

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const scopeKey = toScopeKey(projectPath, scope);
    const session = this.sessions.get(scopeKey);
    if (session) {
      session.query.close();
      this.sessions.delete(scopeKey);
    }
    if (sessionId) {
      this.pendingResume.set(scopeKey, sessionId);
    } else {
      this.pendingResume.delete(scopeKey);
    }
  }

  // ─── compact ───────────────────────────────────────────────────────────────

  compact(args: CompactArgs): void {
    // Phase 1 best-effort: push a /compact user message without emitting streaming_start.
    const { projectPath, scope } = args;
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (session) {
      session.pushInput({
        type: 'user',
        message: { role: 'user', content: '/compact' },
        parent_tool_use_id: null,
      });
    }
    // DONE_WITH_CONCERNS: /compact via injected input may not trigger the SDK's
    // built-in compact flow reliably. Phase 2 should re-evaluate.
  }

  // ─── destroy ───────────────────────────────────────────────────────────────

  destroy(): void {
    for (const session of this.sessions.values()) {
      session.query.close();
    }
    this.sessions.clear();
  }

  // ─── Delegated impls ───────────────────────────────────────────────────────

  approve(a: ApproveArgs): Promise<boolean> {
    return approveImpl(a.projectPath, a.toolUseId, a.approved, a.modifiedCommand, a.scope) as Promise<boolean>;
  }
  answerQuestion(a: AnswerQuestionArgs) {
    return Promise.resolve(answerQuestionImpl(a.projectPath, a.toolUseId, a.answers, a.scope));
  }
  answerPlanReview(a: AnswerPlanArgs) {
    return Promise.resolve(answerPlanReviewImpl(a.projectPath, a.toolUseId, a.approved, a.scope));
  }
  alwaysAllow(projectPath: string, toolPattern: string) {
    return alwaysAllowImpl(projectPath, toolPattern);
  }
  generateCommitMessage(cwd: string, provider?: string) {
    return generateCommitMessageImpl(cwd, provider);
  }
  generateTitle(cwd: string, userMessage: string, provider?: string) {
    return generateTitleImpl(cwd, userMessage, provider);
  }
  getModels() {
    return getAvailableClaudeModels();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _createSession(
    scopeKey: string,
    projectPath: string,
    scope: string | undefined,
    queryArgs: { permMode?: string; effort?: string; model?: string },
  ): ScopeSession {
    const meta = this.scopeMeta.get(scopeKey);
    const cwd = meta?.cwd ?? projectPath;
    const kind = meta?.kind ?? 'chat';
    const appendSystemPrompt = meta?.appendSystemPrompt;

    // Check for a pending resume session ID
    const resumeId = this.pendingResume.get(scopeKey);
    this.pendingResume.delete(scopeKey);

    const options = buildSdkOptions({
      kind,
      permMode: queryArgs.permMode,
      effort: queryArgs.effort,
      model: queryArgs.model,
      cwd,
      sessionId: resumeId,
      claudeExecutablePath: this._resolveClaudePath(),
      appendSystemPrompt,
    });

    // Build an async-iterable input channel (push-based queue)
    const inputQueue: SdkUserInputMessage[] = [];
    let inputResolve: (() => void) | null = null;
    let inputClosed = false;

    // SINGLE-CONSUMER: this iterable must be iterated exactly once (the drain loop).
    // A second [Symbol.asyncIterator]() call would share inputResolve and strand the first iterator.
    const inputIterable: AsyncIterable<SdkUserInputMessage> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (true) {
              if (inputQueue.length > 0) {
                return { value: inputQueue.shift()!, done: false as const };
              }
              if (inputClosed) {
                return { value: undefined as any, done: true as const };
              }
              await new Promise<void>((res) => { inputResolve = res; });
            }
          },
          async return() {
            inputClosed = true;
            inputResolve?.();
            return { value: undefined as any, done: true as const };
          },
        };
      },
    };

    function pushInput(msg: SdkUserInputMessage) {
      inputQueue.push(msg);
      const res = inputResolve;
      inputResolve = null;
      res?.();
    }

    const queryResult = this.queryFn({ prompt: inputIterable, options });

    const session: ScopeSession = {
      query: queryResult,
      pushInput,
      turnSeq: 0,
      activeTurnSeq: 0,
      sessionId: resumeId,
      mapperState: { streaming: false, sessionIdSeen: false },
      cwd,
      kind,
      appendSystemPrompt,
    };

    this.sessions.set(scopeKey, session);
    this._startDrain(session, projectPath, scope);

    return session;
  }

  private _startDrain(session: ScopeSession, projectPath: string, scope: string | undefined): void {
    const effectiveScope = scope ?? 'chat';
    const scopeKey = toScopeKey(projectPath, scope);

    const drain = async () => {
      try {
        for await (const m of session.query) {
          const { emits, state, sessionId } = mapSdkMessage(m, session.mapperState);
          session.mapperState = state;

          if (sessionId) {
            session.sessionId = sessionId;
          }

          for (const e of emits) {
            if (e.type === 'streaming_start') {
              // Re-arm: the mapper saw an assistant message while streaming=false
              session.turnSeq += 1;
              session.activeTurnSeq = session.turnSeq;
              this._emit({ ...e, projectPath, scope: effectiveScope, turnSeq: session.turnSeq });
            } else if (e.type === 'result' || e.type === 'done') {
              this._emit({ ...e, projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq });
            } else {
              this._emit({ ...e, projectPath, scope: effectiveScope });
            }
          }
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        this._emit({ type: 'error', text, projectPath, scope: effectiveScope });
        this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq });
      } finally {
        // Remove the dead session only if it hasn't been replaced by a newer one
        // (e.g. setSessionId may have already deleted+recreated it)
        if (this.sessions.get(scopeKey) === session) {
          this.sessions.delete(scopeKey);
        }
      }
    };

    void drain();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toScopeKey(projectPath: string, scope?: string): string {
  return `${projectPath} ${scope ?? 'chat'}`;
}

/**
 * Default emit: delegates to claude.ts's emitChatMessage, which targets the
 * REGISTERED main window (mainWin) + the remote bus — the same proven path
 * CliBackend uses. (A previous version sent to BrowserWindow.getAllWindows()[0],
 * which is the wrong window when more than one window exists.)
 */
function defaultEmit(payload: Record<string, unknown>): void {
  emitChatMessage(payload);
}
