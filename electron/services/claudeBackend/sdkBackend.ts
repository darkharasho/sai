/**
 * sdkBackend.ts — SdkBackend: a ClaudeBackend that drives @anthropic-ai/claude-agent-sdk
 * with one persistent `query()` per scope (projectPath + scope).
 *
 * Handles core chat (Phase 1), tool approvals via canUseTool, and the
 * AskUserQuestion / ExitPlanMode flows via tool-in-stream detection + answer
 * injection (Phase 2). Only `alwaysAllow` and the one-shot title/commit/model
 * helpers still delegate to the existing claude.ts impls.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { query as QueryFn, SDKUserMessage, PermissionResult, McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from '../chatNudges';
import {
  alwaysAllowImpl,
  generateCommitMessageImpl,
  generateTitleImpl,
  getAvailableClaudeModels,
  emitChatMessage,
  readCachedSlashCommands,
  writeCachedSlashCommands,
  readSaiSetting,
  getRemoteCeiling,
} from '../claude';
import { clamp, type PermMode } from '../remote/clamp';
import { parseUserMcpConfigPaths } from './userMcpConfig';
import { buildSdkOptions } from './sdkOptions';
import { mapSdkMessage, type MapperState } from './sdkMessageMap';
import { sweepIdleScopes, IDLE_SCOPE_MS, SWEEP_INTERVAL_MS } from '../idleScopeSweep';
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
  /** Epoch ms of last user/assistant activity; used by the idle sweep. */
  lastActivityAt: number;
  /** True when waiting for approval / AskUserQuestion / plan review. */
  awaitingInput: boolean;
  /** Stored for the idle sweep so we never need to parse the scope key. */
  _projectPath: string;
  _scopeName: string;
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
  /**
   * Build the in-process SAI chat MCP server for a given workspace.
   * Called only for `kind === 'chat'` scopes. If omitted or returns undefined
   * (e.g. the renderer round-trip hasn't been registered yet), no MCP server
   * is attached for that session.
   */
  buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
}

// ─── SdkBackend ───────────────────────────────────────────────────────────────

export class SdkBackend implements ClaudeBackend {
  private readonly sessions = new Map<string, ScopeSession>();
  /** Remembered session IDs for the next send after setSessionId */
  private readonly pendingResume = new Map<string, string>();
  /** Per-scope pending cwd/kind/appendSystemPrompt set by start() */
  private readonly scopeMeta = new Map<string, { cwd: string; kind: 'chat' | 'task' | 'orchestrator'; appendSystemPrompt?: string }>();
  /** Pending tool approval promises keyed by toolUseId */
  private readonly pendingApprovals = new Map<string, (r: PermissionResult) => void>();

  private readonly queryFn: typeof QueryFn;
  private readonly _emit: (payload: Record<string, unknown>) => void;
  private readonly _resolveClaudePath: () => string | undefined;
  private readonly _buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null;

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
    this._buildChatMcpServer = deps?.buildChatMcpServer;
    this._startIdleSweep();
  }

  // ─── start ─────────────────────────────────────────────────────────────────

  start(args: StartArgs): { slashCommands: string[] } {
    const { projectPath, scope, scopeCwd, kind = 'chat', metaPreamble } = args;
    const scopeKey = toScopeKey(projectPath, scope);
    const cwd = scopeCwd ?? projectPath;
    this.scopeMeta.set(scopeKey, { cwd, kind, appendSystemPrompt: metaPreamble });
    return { slashCommands: readCachedSlashCommands() };
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  send(args: SendArgs): void {
    const { projectPath, message, scope, permMode, effort, model, imagePaths, origin } = args;
    const scopeKey = toScopeKey(projectPath, scope);

    // Mirror CLI sendImpl:740-743: clamp permMode by the remote ceiling when origin==='remote'
    const effectivePermMode =
      origin === 'remote'
        ? (clamp(permMode as PermMode | undefined, getRemoteCeiling()) ?? permMode)
        : permMode;

    try {
      // Ensure a session exists for this scope
      let session = this.sessions.get(scopeKey);
      if (!session) {
        session = this._createSession(scopeKey, projectPath, scope, { permMode: effectivePermMode, effort, model });
      }

      // Bump turn counter
      session.turnSeq += 1;
      session.activeTurnSeq = session.turnSeq;
      session.mapperState = { ...session.mapperState, streaming: true };
      session.lastActivityAt = Date.now();
      session.awaitingInput = false;

      // Emit streaming_start for this user turn
      this._emit({
        type: 'streaming_start',
        projectPath,
        scope: scope ?? 'chat',
        turnSeq: session.turnSeq,
      });

      // Mirror CliBackend.sendImpl: prepend image refs the model can resolve.
      let content = message;
      if (imagePaths && imagePaths.length > 0) {
        const imageRefs = imagePaths.map((p) => `[Attached image: ${p}]`).join('\n');
        content = `${imageRefs}\n\n${message}`;
      }

      // Push the user message into the input channel
      session.pushInput({
        type: 'user',
        message: { role: 'user', content },
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
    const { projectPath, scope } = args;
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (!session) return;

    // Bump turn counter
    session.turnSeq += 1;
    session.activeTurnSeq = session.turnSeq;
    session.mapperState = { ...session.mapperState, streaming: true };
    session.lastActivityAt = Date.now();

    // Emit streaming_start for this compact turn
    this._emit({
      type: 'streaming_start',
      projectPath,
      scope: scope ?? 'chat',
      turnSeq: session.turnSeq,
    });

    // Push the /compact user message into the input channel
    session.pushInput({
      type: 'user',
      message: { role: 'user', content: '/compact' },
      parent_tool_use_id: null,
    });
  }

  // ─── destroy ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer);
      this.idleSweepTimer = null;
    }
    for (const session of this.sessions.values()) {
      session.query.close();
    }
    this.sessions.clear();
  }

  // ─── Delegated impls ───────────────────────────────────────────────────────

  approve(a: ApproveArgs): Promise<boolean> {
    const { projectPath, toolUseId, approved, modifiedCommand, scope } = a;
    const resolver = this.pendingApprovals.get(toolUseId);
    if (resolver) {
      this.pendingApprovals.delete(toolUseId);
      // Clear awaitingInput — user responded to the approval
      const session = this.sessions.get(toScopeKey(projectPath, scope));
      if (session) session.awaitingInput = false;
      if (approved) {
        const result: PermissionResult = { behavior: 'allow' };
        if (modifiedCommand !== undefined) {
          result.updatedInput = { command: modifiedCommand };
        }
        resolver(result);
      } else {
        resolver({ behavior: 'deny', message: 'User denied tool use' });
      }
      return Promise.resolve(true);
    }
    // Not a pending SDK approval — return false (no-op)
    return Promise.resolve(false);
  }
  answerQuestion(a: AnswerQuestionArgs): Promise<boolean> {
    const { projectPath, toolUseId, answers, scope } = a;
    const effectiveScope = scope ?? 'chat';
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (!session) return Promise.resolve(false);

    session.awaitingInput = false;

    // Mark the card answered in the UI immediately (parity with CLI)
    this._emit({ type: 'question_answered', projectPath, scope: effectiveScope, toolUseId, answers });

    // Push a follow-up user message so the agent proceeds
    const content = `[AskUserQuestion answers for tool call ${toolUseId}]\nThe user picked the following answers:\n${JSON.stringify(answers, null, 2)}`;
    session.pushInput({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });

    return Promise.resolve(true);
  }

  answerPlanReview(a: AnswerPlanArgs): Promise<boolean> {
    const { projectPath, toolUseId, approved, scope } = a;
    const effectiveScope = scope ?? 'chat';
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (!session) return Promise.resolve(false);

    session.awaitingInput = false;

    this._emit({ type: 'plan_review_answered', projectPath, scope: effectiveScope, toolUseId, approved });

    const content = approved
      ? `[ExitPlanMode result for tool call ${toolUseId}]\nPlan approved — proceed.`
      : `[ExitPlanMode result for tool call ${toolUseId}]\nPlan rejected.`;
    session.pushInput({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });

    return Promise.resolve(true);
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

    // Build canUseTool callback (only when not bypass)
    const isBypass = kind === 'orchestrator' || queryArgs.permMode === 'bypass';
    const canUseTool = isBypass ? undefined : this._buildCanUseTool(projectPath, scope);

    // Chat scopes get the in-process SAI tool MCP server + the render/github
    // nudges (deferred since Phase 1). Other kinds (task/orchestrator) do not.
    let mcpServers: Record<string, McpSdkServerConfigWithInstance> | undefined;
    let chatAppendSystemPrompt = appendSystemPrompt;
    if (kind === 'chat') {
      const server = this._buildChatMcpServer?.(cwd);
      if (server) {
        mcpServers = { sai: server };
      }
      const nudges = [CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE];
      const existing = appendSystemPrompt && appendSystemPrompt.trim() ? [appendSystemPrompt] : [];
      chatAppendSystemPrompt = [...nudges, ...existing].join('\n\n');
    }

    if (kind === 'chat' || kind === 'task') {
      const userServers = parseUserMcpConfigPaths(
        readSaiSetting('mcpConfigPath'),
        (p) => fs.readFileSync(p, 'utf-8'),
      );
      if (Object.keys(userServers).length > 0) {
        mcpServers = { ...userServers, ...(mcpServers ?? {}) }; // SAI's `sai` key wins on collision
      }
    }

    const options = buildSdkOptions({
      kind,
      permMode: queryArgs.permMode,
      effort: queryArgs.effort,
      model: queryArgs.model,
      cwd,
      sessionId: resumeId,
      claudeExecutablePath: this._resolveClaudePath(),
      appendSystemPrompt: chatAppendSystemPrompt,
      canUseTool,
      mcpServers,
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
      lastActivityAt: Date.now(),
      awaitingInput: false,
      _projectPath: projectPath,
      _scopeName: scope ?? 'chat',
    };

    this.sessions.set(scopeKey, session);
    this._startDrain(session, projectPath, scope);

    return session;
  }

  private _buildCanUseTool(projectPath: string, scope: string | undefined) {
    const effectiveScope = scope ?? 'chat';
    return (toolName: string, input: Record<string, unknown>, opts: { toolUseID: string; [key: string]: unknown }): Promise<PermissionResult> => {
      // AskUserQuestion / ExitPlanMode are NOT tool approvals — they have their own
      // question/plan cards (emitted from the drain as question_needed /
      // plan_review_needed). Auto-allow them here so they don't also pop the approval
      // banner (which would crash on their missing `command`).
      if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
        return Promise.resolve({ behavior: 'allow', updatedInput: input });
      }
      const toolUseId = opts.toolUseID;
      const command = toolName === 'Bash' ? (input.command as string | undefined) : undefined;
      // Mark session as awaiting user input so the idle sweep skips it
      const session = this.sessions.get(toScopeKey(projectPath, scope));
      if (session) session.awaitingInput = true;
      this._emit({
        type: 'approval_needed',
        projectPath,
        scope: effectiveScope,
        toolName,
        toolUseId,
        command,
        description: undefined,
        input,
      });
      return new Promise<PermissionResult>((resolve) => {
        this.pendingApprovals.set(toolUseId, resolve);
      });
    };
  }

  private _startDrain(session: ScopeSession, projectPath: string, scope: string | undefined): void {
    const effectiveScope = scope ?? 'chat';
    const scopeKey = toScopeKey(projectPath, scope);

    const drain = async () => {
      try {
        for await (const m of session.query) {
          session.lastActivityAt = Date.now();
          if (m?.type === 'system' && m?.subtype === 'init' && Array.isArray(m?.slash_commands)) {
            writeCachedSlashCommands(m.slash_commands as string[]);
          }

          const { emits, state, sessionId } = mapSdkMessage(m, session.mapperState);
          session.mapperState = state;

          if (sessionId) {
            session.sessionId = sessionId;
          }

          // Capture the raw SDK message to inspect for special tool_use blocks
          const rawMsg = m;

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

          // After forwarding an assistant message, inspect tool_use blocks for
          // AskUserQuestion and ExitPlanMode (emit AFTER forward so cards render)
          if (rawMsg?.type === 'assistant' && Array.isArray(rawMsg?.message?.content)) {
            for (const block of rawMsg.message.content as Array<Record<string, unknown>>) {
              if (block.type !== 'tool_use') continue;

              if (block.name === 'AskUserQuestion') {
                const input = (block.input ?? {}) as Record<string, unknown>;
                const questions = Array.isArray(input.questions) ? input.questions as Array<Record<string, unknown>> : [];
                const question = (questions[0]?.question as string | undefined) ?? 'The agent is waiting for your answer.';
                // Mark session as awaiting user input so the idle sweep skips it
                const s = this.sessions.get(scopeKey);
                if (s) s.awaitingInput = true;
                this._emit({
                  type: 'question_needed',
                  projectPath,
                  scope: effectiveScope,
                  toolUseId: block.id as string,
                  question,
                });
              } else if (block.name === 'ExitPlanMode') {
                const input = (block.input ?? {}) as Record<string, unknown>;
                // Mark session as awaiting user input so the idle sweep skips it
                const s = this.sessions.get(scopeKey);
                if (s) s.awaitingInput = true;
                this._emit({
                  type: 'plan_review_needed',
                  projectPath,
                  scope: effectiveScope,
                  toolUseId: block.id as string,
                  plan: (input.plan as string | undefined) ?? '',
                  planFilePath: (input.planFilePath as string | undefined) ?? '',
                });
              }
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

  // ─── Idle sweep ────────────────────────────────────────────────────────────

  /** Run one sweep pass. Exposed for testing with a fake clock. */
  _sweepOnce(now: number): void {
    const records = Array.from(this.sessions.entries()).map(([, s]) => ({
      workspaceId: s._projectPath,
      scope: s._scopeName,
      lastActivityAt: s.lastActivityAt,
      streaming: s.mapperState.streaming,
      awaitingInput: s.awaitingInput,
    }));
    sweepIdleScopes({
      now,
      idleMs: IDLE_SCOPE_MS,
      scopes: records,
      stop: (workspaceId, scope) => {
        this._emit({ type: 'scope_suspended', projectPath: workspaceId, scope });
        this.interrupt(workspaceId, scope === 'chat' ? undefined : scope);
      },
    });
  }

  private _startIdleSweep(): void {
    if (this.idleSweepTimer) return;
    this.idleSweepTimer = setInterval(() => this._sweepOnce(Date.now()), SWEEP_INTERVAL_MS);
    if (typeof this.idleSweepTimer.unref === 'function') this.idleSweepTimer.unref();
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
