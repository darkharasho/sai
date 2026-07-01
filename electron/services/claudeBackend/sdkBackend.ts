/**
 * sdkBackend.ts — SdkBackend: a ClaudeBackend that drives @anthropic-ai/claude-agent-sdk
 * with one persistent `query()` per scope (projectPath + scope).
 *
 * Handles core chat (Phase 1), tool approvals via canUseTool, and the
 * AskUserQuestion / ExitPlanMode flows via gated canUseTool promises (non-bypass)
 * or tool-in-stream detection + answer injection (bypass). Only `alwaysAllow`
 * and the one-shot title/commit/model helpers still delegate to the existing
 * claude.ts impls.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { query as QueryFn, SDKUserMessage, PermissionResult, McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { enrichedEnv } from '../shellEnv';
import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from '../chatNudges';
import {
  approveImpl,
  alwaysAllowImpl,
  generateCommitMessageImpl,
  generateTitleImpl,
  getAvailableClaudeModels,
  emitChatMessage,
  readCachedSlashCommands,
  writeCachedSlashCommands,
  readSaiSetting,
  getRemoteCeiling,
  getMainWin,
  spawnEnv,
  touchActivity,
} from '../claude';
import { isImagePath, mimeForImagePath } from '../imageFiles';
import { notifyCompletion, notifyApproval, notifyQuestion, notifyPlanReview } from '../notify';
import { classifyTurnEnd, isSchedulingTool, WAKEUP_GRACE_MS, type WaitMeta } from '../waitClassifier';
import { clamp, type PermMode } from '../remote/clamp';
import { parseUserMcpConfigPaths } from './userMcpConfig';
import { buildSdkOptions } from './sdkOptions';
import { buildOrchestratorSystemPrompt, resolveOrchestratorPromptContext, type OrchestratorPromptContext } from '../../../src/lib/orchestratorSystemPrompt';
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
  /** Normalized per-session config; a send with different values recreates the
   *  session (CLI ensureProcess parity) so model/effort/permMode/feature-setting
   *  changes apply. */
  config: { permMode: string; effort: string; model: string; features: string };
  /** True when canUseTool is active for this session (non-bypass). When false
   *  (bypass / orchestrator), question/plan cards come from drain detection. */
  gated: boolean;
  /** toolUseIds of canUseTool promises currently held for this session. */
  heldToolUses: Set<string>;
  /** A scheduling tool (ScheduleWakeup/CronCreate) fired this turn. */
  sawSchedulingTool: boolean;
  /** delaySeconds from the latest ScheduleWakeup input this turn. */
  wakeupResumeInSeconds: number | null;
  /** Turn ended in a scheduled wait — defer the idle sweep. */
  pendingWakeup: boolean;
  /** Silent turn (e.g. /compact): drop all non-system forwarding until result. */
  suppressForward: boolean;
  /** Epoch ms after which a pendingWakeup is considered abandoned. */
  wakeupDeadline: number | null;
  /** Stored for the idle sweep so we never need to parse the scope key. */
  _projectPath: string;
  _scopeName: string;
}

/** A held canUseTool promise awaiting a user decision. */
interface PendingGate {
  kind: 'approval' | 'question' | 'plan';
  resolve: (r: PermissionResult) => void;
  input: Record<string, unknown>;
  scopeKey: string;
  projectPath: string;
  scope: string;
}

// Use the SDK's SDKUserMessage type for the input channel
type SdkUserInputMessage = SDKUserMessage;

// ─── resolveClaudePath ────────────────────────────────────────────────────────

/**
 * Locate the user's installed `claude` executable.
 *
 * CRITICAL for the packaged app: a Finder-launched GUI app inherits a minimal
 * `process.env.PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) that does NOT include the
 * user's `claude` install (~/.claude/local, homebrew, nvm, volta, …). If we
 * return undefined here, the SDK falls back to its bundled native binary, whose
 * default resolution points *inside* `app.asar` — a file, not a directory — so
 * `child_process.spawn` throws `spawn ENOTDIR` synchronously on every turn.
 *
 * To avoid that we scan the *enriched* login-shell PATH (same source the CLI
 * backend uses via `spawnEnv()`), plus a set of well-known absolute install
 * locations as a belt-and-suspenders fallback. Returns the first absolute path
 * found, or undefined (SDK uses its bundled runtime when the option is omitted).
 */
export function resolveClaudePath(): string | undefined {
  const isWin = process.platform === 'win32';
  const sep = isWin ? ';' : ':';
  const bin = isWin ? 'claude.exe' : 'claude';

  // Prefer the enriched login-shell PATH over the raw (possibly stripped) one.
  const pathEnv = enrichedEnv().PATH ?? process.env.PATH ?? '';
  const dirs = pathEnv.split(sep).filter(Boolean);

  // Well-known install locations, checked after PATH. On non-Windows only.
  if (!isWin) {
    const home = os.homedir();
    dirs.push(
      path.join(home, '.claude', 'local'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.volta', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    );
  }

  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Append actionable hints to known failure shapes (missing binary, auth). */
function friendlyError(text: string): string {
  if (/ENOTDIR|ENOENT/.test(text)) {
    return `${text}\n\nClaude Code executable not found. Install the Claude CLI or make sure \`claude\` is on your PATH, then retry.`;
  }
  if (/not logged in|invalid api key|authentication/i.test(text)) {
    return `${text}\n\nClaude may not be logged in — run \`claude\` in a terminal to authenticate, then retry.`;
  }
  return text;
}

/** API image-block support: only these media types are accepted by the API. */
const API_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Max bytes we inline as base64 (API limit is ~5MB per image). */
const MAX_INLINE_IMAGE_BYTES = 4_500_000;

type UserContent = string | Array<Record<string, unknown>>;

/**
 * Build the user-message content. Attached images become real base64 image
 * content blocks (the SDK accepts full MessageParam content) so the model sees
 * them immediately instead of having to Read a `[Attached image: …]` path ref.
 * Unsupported types / oversized / unreadable files fall back to the path ref.
 */
function buildUserContent(message: string, imagePaths?: string[]): UserContent {
  if (!imagePaths || imagePaths.length === 0) return message;

  const blocks: Array<Record<string, unknown>> = [];
  const refs: string[] = [];
  for (const p of imagePaths) {
    try {
      const mediaType = mimeForImagePath(p);
      if (isImagePath(p) && API_IMAGE_TYPES.has(mediaType)) {
        const buf = fs.readFileSync(p);
        if (buf.length <= MAX_INLINE_IMAGE_BYTES) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } });
          continue;
        }
      }
    } catch { /* unreadable — fall through to the path ref */ }
    refs.push(`[Attached image: ${p}]`);
  }

  const text = refs.length > 0 ? `${refs.join('\n')}\n\n${message}` : message;
  if (blocks.length === 0) return text;
  return [...blocks, { type: 'text', text }];
}

/** CLI-parity command derivation for approval cards (claude.ts:507-514). */
function deriveCommand(input: Record<string, unknown>): string {
  return (input.command as string)
    || (input.file_path as string)
    || (input.path as string)
    || (input.pattern as string)
    || (input.url as string)
    || (input.query as string)
    || (Object.values(input).find((v) => typeof v === 'string' && v.length > 0) as string)
    || JSON.stringify(input);
}

// ─── Injectable deps ──────────────────────────────────────────────────────────

/** OS-notification hooks (injectable for tests). */
export interface SdkNotify {
  approval(workspaceName: string, toolName: string, command: string): void;
  question(workspaceName: string, question: string): void;
  planReview(workspaceName: string): void;
  completion(projectPath: string, info: { provider: string; duration?: number; turns?: number; cost?: number; summary?: string }): void;
}

const defaultNotify: SdkNotify = {
  approval: (wsName, toolName, command) => {
    const win = getMainWin();
    if (win) notifyApproval(win, wsName, toolName, command);
  },
  question: (wsName, question) => {
    const win = getMainWin();
    if (win) notifyQuestion(win, wsName, question);
  },
  planReview: (wsName) => {
    const win = getMainWin();
    if (win) notifyPlanReview(win, wsName);
  },
  completion: (projectPath, info) => {
    const win = getMainWin();
    if (win) notifyCompletion(win, projectPath, info);
  },
};

export interface SdkBackendDeps {
  /** Override the SDK's `query` function (for tests). */
  queryFn?: typeof QueryFn;
  /** Where to send claude:message payloads. Default: real ipc / remoteBus. */
  emit?: (payload: Record<string, unknown>) => void;
  /** How to resolve the claude executable path. Default: PATH scan. */
  resolveClaudePath?: () => string | undefined;
  /** OS notification hooks. Default: notify.ts against the registered main window. */
  notify?: SdkNotify;
  /**
   * Build the in-process SAI chat MCP server for a given workspace.
   * Called only for `kind === 'chat'` scopes. If omitted or returns undefined
   * (e.g. the renderer round-trip hasn't been registered yet), no MCP server
   * is attached for that session.
   */
  buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
  /**
   * Build the in-process swarm MCP server for a given workspace.
   * Called only for `kind === 'orchestrator'` scopes. If omitted or returns
   * undefined (e.g. dispatch not yet registered), no swarm server is attached.
   */
  buildSwarmMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
}

// ─── SdkBackend ───────────────────────────────────────────────────────────────

export class SdkBackend implements ClaudeBackend {
  private readonly sessions = new Map<string, ScopeSession>();
  /** Remembered session IDs for the next send after setSessionId */
  private readonly pendingResume = new Map<string, string>();
  /** Per-scope pending cwd/kind/appendSystemPrompt set by start() */
  private readonly scopeMeta = new Map<string, { cwd: string; kind: 'chat' | 'task' | 'orchestrator'; appendSystemPrompt?: string; orchestratorContext?: Record<string, unknown> | null }>();
  /** Held canUseTool promises (approvals, questions, plan reviews) keyed by toolUseId */
  private readonly pendingGates = new Map<string, PendingGate>();

  private readonly queryFn: typeof QueryFn;
  private readonly _emit: (payload: Record<string, unknown>) => void;
  private readonly _resolveClaudePath: () => string | undefined;
  private readonly _notify: SdkNotify;
  private readonly _buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
  private readonly _buildSwarmMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
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
    this._notify = deps?.notify ?? defaultNotify;
    this._buildChatMcpServer = deps?.buildChatMcpServer;
    this._buildSwarmMcpServer = deps?.buildSwarmMcpServer;
    this._startIdleSweep();
  }

  // ─── start ─────────────────────────────────────────────────────────────────

  start(args: StartArgs): { slashCommands: string[] } {
    const { projectPath, scope, scopeCwd, kind = 'chat', metaPreamble, orchestratorContext } = args;
    const scopeKey = toScopeKey(projectPath, scope);
    const cwd = scopeCwd ?? projectPath;
    this.scopeMeta.set(scopeKey, { cwd, kind, appendSystemPrompt: metaPreamble, orchestratorContext });
    return { slashCommands: readCachedSlashCommands() };
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  send(args: SendArgs): void {
    const { projectPath, message, scope, permMode, effort, model, imagePaths, origin } = args;
    const scopeKey = toScopeKey(projectPath, scope);
    const effectiveScope = scope ?? 'chat';

    // Mirror CLI sendImpl:740-743: clamp permMode by the remote ceiling when origin==='remote'
    const effectivePermMode =
      origin === 'remote'
        ? (clamp(permMode as PermMode | undefined, getRemoteCeiling()) ?? permMode)
        : permMode;

    try {
      // Ensure a session exists for this scope — and that it matches the
      // requested config. The CLI respawned on any permMode/effort/model change
      // (ensureProcess); reusing the old query here silently ignored mid-session
      // model switches and bypass toggles until the scope was idle-swept.
      let session = this.sessions.get(scopeKey);
      const wantConfig = normalizeConfig(effectivePermMode, effort, model);
      if (session && !configEquals(session.config, wantConfig)) {
        this._resolveGatesForScope(scopeKey, 'Session restarted with new settings');
        if (session.mapperState.streaming) {
          // End the in-flight turn in the UI — its result will never arrive.
          this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq });
        }
        if (session.sessionId) this.pendingResume.set(scopeKey, session.sessionId);
        session.query.close();
        this.sessions.delete(scopeKey);
        session = undefined;
      }
      if (!session) {
        session = this._createSession(scopeKey, projectPath, scope, { permMode: effectivePermMode, effort, model });
      }

      // A send while gates are held means the user moved on — unblock the query
      // so the queued message can be processed (mirrors CLI clearing awaitingApproval).
      this._resolveGatesForScope(scopeKey, 'The user sent a new message instead of responding to this request.');

      // A new user turn cancels any pending silent-compact suppression.
      session.suppressForward = false;

      this._beginTurn(session, projectPath, effectiveScope);
      // Workspace auto-suspend watches this clock; without it a workspace with
      // only SDK activity looks quiescent and gets suspended mid-stream.
      try { touchActivity(projectPath); } catch { /* workspace registry unavailable (tests) */ }

      // Push the user message into the input channel
      session.pushInput({
        type: 'user',
        message: { role: 'user', content: buildUserContent(message, imagePaths) },
        parent_tool_use_id: null,
      });

      // CLI parity (claude.ts:801-808): echo the user's prompt so the desktop
      // transcript shows remote-originated messages and the remote bus mirrors
      // desktop-originated ones.
      this._emit({
        type: 'user_message',
        projectPath,
        scope: effectiveScope,
        text: message,
        origin: origin ?? 'desktop',
        turnSeq: session.turnSeq,
      });
    } catch (err) {
      // Surface SDK/session-creation failures to the chat instead of silently
      // producing "no thinking, no response" (e.g. the SDK runtime failing to
      // load or spawn). Without this, a synchronous throw from queryFn() in
      // _createSession leaves the renderer with nothing.
      const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      // eslint-disable-next-line no-console
      console.error('[SdkBackend.send] failed:', text);
      // Capture the turn BEFORE tearing the session down so the recovery done
      // isn't stamped with turnSeq 0 (which the renderer drops as stale).
      const session = this.sessions.get(scopeKey);
      const turnSeq = session?.activeTurnSeq ?? 0;
      try { session?.query.close(); } catch { /* already dead */ }
      this.sessions.delete(scopeKey);
      this._emit({ type: 'error', fatal: true, text: `SDK backend error: ${friendlyError(text)}`, projectPath, scope: effectiveScope });
      this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq });
    }
  }

  // ─── interrupt ─────────────────────────────────────────────────────────────

  interrupt(projectPath: string, scope?: string): void {
    const scopeKey = toScopeKey(projectPath, scope);
    const effectiveScope = scope ?? 'chat';
    const session = this.sessions.get(scopeKey);
    if (!session) return;

    session.query.interrupt().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[SdkBackend.interrupt] interrupt() rejected:', err instanceof Error ? err.message : String(err));
    });

    // Release any held canUseTool promises — a Stop during a pending approval
    // must not leave the query wedged (and the resolver leaked) forever.
    this._resolveGatesForScope(scopeKey, 'Interrupted by user');

    // Clear awaitingInput so a user-Stop on an awaiting scope doesn't leave it
    // permanently un-sweepable (mirrors CLI interruptImpl clearing awaitingApproval).
    session.awaitingInput = false;
    this._resetWaitTracking(session);

    // CLI parity (claude.ts:830): end the turn in the UI immediately. The SDK's
    // own result for the interrupted turn arrives later stamped with this same
    // activeTurnSeq, after the renderer has reset its expected seq — the stale-turn
    // guard drops it. If the interrupt failed and assistant frames keep coming,
    // the mapper re-arms streaming_start (streaming is false), self-healing the UI.
    if (session.mapperState.streaming) {
      session.mapperState = { ...session.mapperState, streaming: false };
      this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq });
    }
  }

  // ─── setSessionId ──────────────────────────────────────────────────────────

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const scopeKey = toScopeKey(projectPath, scope);
    const session = this.sessions.get(scopeKey);
    if (session) {
      this._resolveGatesForScope(scopeKey, 'Session switched');
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
    const { projectPath, scope, permMode, effort, model } = args;
    const scopeKey = toScopeKey(projectPath, scope);
    const effectiveScope = scope ?? 'chat';

    try {
      // Create the session on demand — after an idle-sweep suspension (exactly
      // when context is large enough to need compacting) there is no live
      // session, and a silent no-op here left auto-compact retrying forever.
      let session = this.sessions.get(scopeKey);
      if (!session) {
        session = this._createSession(scopeKey, projectPath, scope, { permMode, effort, model });
      }

      // CLI parity (compactImpl + suppressForward): the compact turn runs
      // SILENTLY — no streaming_start, no forwarded output, no done. Only
      // system frames (compact notification) pass through; the result clears
      // the gate so the next send behaves normally.
      session.suppressForward = true;
      session.lastActivityAt = Date.now();

      // Push the /compact user message into the input channel
      session.pushInput({
        type: 'user',
        message: { role: 'user', content: '/compact' },
        parent_tool_use_id: null,
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[SdkBackend.compact] failed:', text);
      this._emit({ type: 'error', text: `Compact failed: ${friendlyError(text)}`, projectPath, scope: effectiveScope });
      this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: this.sessions.get(scopeKey)?.activeTurnSeq ?? 0 });
    }
  }

  // ─── destroy ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer);
      this.idleSweepTimer = null;
    }
    // Release every held canUseTool promise before closing the queries.
    for (const [toolUseId, gate] of Array.from(this.pendingGates.entries())) {
      this.pendingGates.delete(toolUseId);
      gate.resolve({ behavior: 'deny', message: 'Shutting down' });
    }
    for (const session of this.sessions.values()) {
      session.heldToolUses.clear();
      session.query.close();
    }
    this.sessions.clear();
  }

  // ─── Approvals / questions / plan reviews ──────────────────────────────────

  approve(a: ApproveArgs): Promise<boolean> {
    const { projectPath, toolUseId, approved, modifiedCommand, scope } = a;
    const effectiveScope = scope ?? 'chat';
    const gate = this.pendingGates.get(toolUseId);
    if (gate && gate.kind === 'approval') {
      this._releaseGate(toolUseId, gate);
      if (approved) {
        const result: PermissionResult = { behavior: 'allow' };
        if (modifiedCommand !== undefined) {
          // Merge, don't replace — clobbering non-command fields (description,
          // timeout, …) breaks tools whose input carries more than the command.
          result.updatedInput = { ...gate.input, command: modifiedCommand };
        }
        gate.resolve(result);
      } else {
        gate.resolve({ behavior: 'deny', message: 'User denied tool use' });
      }
      // CLI parity: clear the approval card / titlebar approval state everywhere.
      this._emit({ type: 'approval_resolved', projectPath, scope: effectiveScope });
      return Promise.resolve(true);
    }
    // Not a pending SDK approval — delegate to the CLI impl, which also owns
    // Gemini approvals (they route through the same claude:approve IPC).
    return Promise.resolve(approveImpl(projectPath, toolUseId, approved, modifiedCommand, scope)).then((r) => r === true);
  }

  answerQuestion(a: AnswerQuestionArgs): Promise<boolean> {
    const { projectPath, toolUseId, answers, scope } = a;
    const effectiveScope = scope ?? 'chat';

    const gate = this.pendingGates.get(toolUseId);
    if (gate && gate.kind === 'question') {
      // Mark the card answered in the UI immediately (parity with CLI)
      this._emit({ type: 'question_answered', projectPath, scope: effectiveScope, toolUseId, answers });
      this._releaseGate(toolUseId, gate);
      // Deny with the answers as the message: the model receives them as the
      // tool result in the SAME turn — no placeholder "dismissed" chatter, no
      // extra user turn.
      gate.resolve({
        behavior: 'deny',
        message: `The user answered via the UI:\n${JSON.stringify(answers, null, 2)}\nProceed based on these answers; do not re-ask the same question(s).`,
      });
      return Promise.resolve(true);
    }

    // Bypass-mode fallback: no gate was held (canUseTool absent), the tool
    // auto-ran with a placeholder result — inject a corrective user message.
    const session = this.sessions.get(toScopeKey(projectPath, scope));
    if (!session) return Promise.resolve(false);

    session.awaitingInput = false;
    this._emit({ type: 'question_answered', projectPath, scope: effectiveScope, toolUseId, answers });

    const content = `[AskUserQuestion answers for tool call ${toolUseId}]\nThe user picked the following answers (the earlier placeholder tool_result for this tool call should be disregarded):\n${JSON.stringify(answers, null, 2)}`;
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

    const gate = this.pendingGates.get(toolUseId);
    if (gate && gate.kind === 'plan') {
      this._emit({ type: 'plan_review_answered', projectPath, scope: effectiveScope, toolUseId, approved });
      this._releaseGate(toolUseId, gate);
      if (approved) {
        gate.resolve({ behavior: 'allow', updatedInput: gate.input });
      } else {
        gate.resolve({
          behavior: 'deny',
          message: 'The user rejected the plan. Revise it based on their feedback or ask clarifying questions before proceeding — do not start implementing.',
        });
      }
      return Promise.resolve(true);
    }

    // Bypass-mode fallback: inject a corrective user message.
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

  /**
   * Start a new logical turn on a session: emit the pre-emptive `done` for an
   * interrupted in-flight turn (CLI protocol, claude.ts:771-788), bump turnSeq,
   * and emit streaming_start.
   *
   * The interrupt case deliberately leaves `activeTurnSeq` LAGGING at the old
   * turn: when the superseded turn's `result` eventually drains it is stamped
   * with the old seq and the renderer's stale-turn guard drops it — instead of
   * it killing the new turn's thinking animation. The drain converges
   * activeTurnSeq back to turnSeq when that result is processed.
   */
  private _beginTurn(session: ScopeSession, projectPath: string, effectiveScope: string): void {
    const wasInterrupt = session.mapperState.streaming;
    if (wasInterrupt) {
      this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: session.turnSeq });
    }

    session.turnSeq += 1;
    if (!wasInterrupt) {
      session.activeTurnSeq = session.turnSeq;
    }
    // Interrupt case: activeTurnSeq stays at the old value until the old turn's
    // result drains and the drain loop updates it to session.turnSeq.
    session.mapperState = { ...session.mapperState, streaming: true };
    session.lastActivityAt = Date.now();
    session.awaitingInput = false;
    this._resetWaitTracking(session);

    this._emit({
      type: 'streaming_start',
      projectPath,
      scope: effectiveScope,
      sessionId: session.sessionId ?? null,
      turnSeq: session.turnSeq,
    });
  }

  /** Clear per-turn wait tracking (mirrors claude.ts emitStreamingStart). */
  private _resetWaitTracking(session: ScopeSession): void {
    session.sawSchedulingTool = false;
    session.wakeupResumeInSeconds = null;
    session.pendingWakeup = false;
    session.wakeupDeadline = null;
  }

  /** Remove a gate's bookkeeping (heldToolUses / awaitingInput). Caller resolves. */
  private _releaseGate(toolUseId: string, gate: PendingGate): void {
    this.pendingGates.delete(toolUseId);
    const session = this.sessions.get(gate.scopeKey);
    if (session) {
      session.heldToolUses.delete(toolUseId);
      if (session.heldToolUses.size === 0) session.awaitingInput = false;
    }
  }

  /** Deny-resolve every held gate for a scope (interrupt / new send / teardown). */
  private _resolveGatesForScope(scopeKey: string, message: string): void {
    for (const [toolUseId, gate] of Array.from(this.pendingGates.entries())) {
      if (gate.scopeKey !== scopeKey) continue;
      this._releaseGate(toolUseId, gate);
      gate.resolve({ behavior: 'deny', message });
      if (gate.kind === 'approval') {
        this._emit({ type: 'approval_resolved', projectPath: gate.projectPath, scope: gate.scope });
      }
    }
  }

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
    let systemPromptOverride: string | undefined;

    if (kind === 'orchestrator') {
      const server = this._buildSwarmMcpServer?.(cwd);
      if (server) {
        mcpServers = { swarm: server };
      }
      // Build the full orchestrator system prompt (full replacement, not append),
      // mirroring claude.ts buildArgs: derive workspacePath/Name from cwd when absent.
      const raw = (meta?.orchestratorContext ?? {}) as Partial<OrchestratorPromptContext>;
      const ctx = resolveOrchestratorPromptContext({
        ...raw,
        workspacePath: raw.workspacePath || cwd,
        workspaceName: raw.workspaceName || (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : undefined),
      });
      systemPromptOverride = buildOrchestratorSystemPrompt(ctx);
    }

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

    const effectiveScope = scope ?? 'chat';
    const options = buildSdkOptions({
      kind,
      permMode: queryArgs.permMode,
      effort: queryArgs.effort,
      model: queryArgs.model,
      cwd,
      sessionId: resumeId,
      claudeExecutablePath: this._resolveClaudePath(),
      appendSystemPrompt: chatAppendSystemPrompt,
      systemPromptOverride,
      canUseTool,
      mcpServers,
      env: spawnEnv() as Record<string, string | undefined>,
      stderr: (data: string) => {
        const text = data.toString().trim();
        if (text) {
          this._emit({ type: 'error', text, projectPath, scope: effectiveScope });
        }
      },
      // Feature settings (also part of the session config compare, so toggling
      // any of them resume-respawns the session on the next send).
      thinkingSummarized: readSaiSetting('claudeShowReasoning') === true,
      maxBudgetUsd: Number(readSaiSetting('claudeMaxBudgetUsd')) || undefined,
      oneMContext: readSaiSetting('claude1MContext') === true,
      promptSuggestions: kind === 'chat',
      agentProgressSummaries: true,
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
      suppressForward: false,
      config: normalizeConfig(queryArgs.permMode, queryArgs.effort, queryArgs.model),
      gated: !!canUseTool,
      heldToolUses: new Set(),
      sawSchedulingTool: false,
      wakeupResumeInSeconds: null,
      pendingWakeup: false,
      wakeupDeadline: null,
      _projectPath: projectPath,
      _scopeName: scope ?? 'chat',
    };

    this.sessions.set(scopeKey, session);
    this._startDrain(session, projectPath, scope);

    return session;
  }

  private _buildCanUseTool(projectPath: string, scope: string | undefined) {
    const effectiveScope = scope ?? 'chat';
    const scopeKey = toScopeKey(projectPath, scope);
    const wsName = projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;

    return (toolName: string, input: Record<string, unknown>, opts: { toolUseID: string; [key: string]: unknown }): Promise<PermissionResult> => {
      const toolUseId = opts.toolUseID;
      const session = this.sessions.get(scopeKey);
      if (session) session.awaitingInput = true;

      // AskUserQuestion / ExitPlanMode are NOT tool approvals — they have their
      // own question/plan cards. Hold the promise until the user responds so the
      // model cannot proceed past an unanswered question or an unapproved plan
      // (previously these were auto-allowed, making plan approval decorative).
      if (toolName === 'AskUserQuestion') {
        const questions = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : [];
        const question = (questions[0]?.question as string | undefined) ?? 'The agent is waiting for your answer.';
        this._emit({ type: 'question_needed', projectPath, scope: effectiveScope, toolUseId, question });
        this._notify.question(wsName, question);
        return new Promise<PermissionResult>((resolve) => {
          this.pendingGates.set(toolUseId, { kind: 'question', resolve, input, scopeKey, projectPath, scope: effectiveScope });
          session?.heldToolUses.add(toolUseId);
        });
      }

      if (toolName === 'ExitPlanMode') {
        this._emit({
          type: 'plan_review_needed',
          projectPath,
          scope: effectiveScope,
          toolUseId,
          plan: (input.plan as string | undefined) ?? '',
          planFilePath: (input.planFilePath as string | undefined) ?? '',
        });
        this._notify.planReview(wsName);
        return new Promise<PermissionResult>((resolve) => {
          this.pendingGates.set(toolUseId, { kind: 'plan', resolve, input, scopeKey, projectPath, scope: effectiveScope });
          session?.heldToolUses.add(toolUseId);
        });
      }

      // Regular tool approval. CLI-parity command/description so approval cards
      // for Write/Edit/WebFetch/… show their target, not just Bash commands.
      const command = deriveCommand(input);
      const description = (input.description as string | undefined) || '';
      this._emit({
        type: 'approval_needed',
        projectPath,
        scope: effectiveScope,
        toolName,
        toolUseId,
        command,
        description,
        input,
      });
      this._notify.approval(wsName, toolName, command);
      return new Promise<PermissionResult>((resolve) => {
        this.pendingGates.set(toolUseId, { kind: 'approval', resolve, input, scopeKey, projectPath, scope: effectiveScope });
        session?.heldToolUses.add(toolUseId);
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
          // Mid-session command-list changes (skills discovered dynamically):
          // REPLACE the cache — supportedCommands() never reflects these.
          if (m?.type === 'system' && m?.subtype === 'commands_changed' && Array.isArray(m?.commands)) {
            const names = (m.commands as Array<{ name?: string }>)
              .map((c) => (typeof c?.name === 'string' && c.name ? `/${c.name}` : null))
              .filter((n): n is string => n !== null);
            if (names.length > 0) writeCachedSlashCommands(names);
          }

          // Track the freshest session ID for resume — the runtime can rotate it
          // (e.g. post-compact), and the sweep stashes whatever is stored here.
          if (m?.session_id) {
            session.sessionId = m.session_id as string;
          }

          // Silent turn (compact): mirror the CLI's suppressForward — drop all
          // forwarding except system frames; the result closes the gate without
          // emitting result/done (the turn never appeared in the UI).
          if (session.suppressForward) {
            if (m?.type === 'result') {
              session.suppressForward = false;
              session.mapperState = { ...session.mapperState, streaming: false };
              session.activeTurnSeq = session.turnSeq;
              continue;
            }
            if (m?.type === 'system') {
              this._emit({ ...m, projectPath, scope: effectiveScope });
            }
            continue;
          }

          const wasStreaming = session.mapperState.streaming;

          // Classify WHY a turn ended before mapping: a background yield or a
          // scheduled wakeup is a wait, not a real completion (claude.ts:538-552).
          let wait: WaitMeta | undefined;
          if (m?.type === 'result') {
            wait = classifyTurnEnd({
              terminalReason: m.terminal_reason,
              sawSchedulingTool: session.sawSchedulingTool,
              wakeupResumeInSeconds: session.wakeupResumeInSeconds,
              taskCount: Array.isArray(m.background_tasks) ? m.background_tasks.length : null,
            });
            session.pendingWakeup = wait.kind === 'scheduled';
            session.wakeupDeadline = (wait.kind === 'scheduled' && typeof wait.resumeInSeconds === 'number')
              ? Date.now() + wait.resumeInSeconds * 1000 + WAKEUP_GRACE_MS
              : null;
          }

          const { emits, state } = mapSdkMessage(m, session.mapperState);
          session.mapperState = state;

          // Capture the raw SDK message to inspect for special tool_use blocks
          const rawMsg = m;

          for (const e of emits) {
            if (e.type === 'streaming_start') {
              // Re-arm: the mapper saw an assistant frame (or a stream_event
              // message_start) while streaming=false — a resumed turn.
              session.turnSeq += 1;
              session.activeTurnSeq = session.turnSeq;
              this._resetWaitTracking(session);
              this._emit({ ...e, projectPath, scope: effectiveScope, sessionId: session.sessionId ?? null, turnSeq: session.turnSeq });
            } else if (e.type === 'result' || e.type === 'done') {
              this._emit({ ...e, projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq, ...(wait ? { wait } : {}) });
            } else {
              this._emit({ ...e, projectPath, scope: effectiveScope });
            }
          }

          if (rawMsg?.type === 'result') {
            // The old turn drained: converge activeTurnSeq onto the latest send's
            // turnSeq (it lags during an interrupt — see _beginTurn).
            session.activeTurnSeq = session.turnSeq;
            // Accurate context meter: ask the runtime for its real per-category
            // context accounting (fire-and-forget; renderer falls back to the
            // usage-sum estimate when absent).
            const q = session.query as unknown as { getContextUsage?: () => Promise<any> };
            if (typeof q.getContextUsage === 'function') {
              q.getContextUsage().then((u) => {
                if (u && typeof u.totalTokens === 'number' && typeof u.maxTokens === 'number') {
                  this._emit({
                    type: 'context_usage',
                    projectPath,
                    scope: effectiveScope,
                    totalTokens: u.totalTokens,
                    maxTokens: u.maxTokens,
                    percentage: u.percentage,
                    model: u.model,
                    categories: u.categories,
                  });
                }
              }).catch(() => { /* control request unavailable — estimate stands */ });
            }
            // Only notify on a genuine completion — waits stay silent.
            if (wasStreaming && wait?.kind === 'none') {
              const info = {
                provider: 'Claude',
                duration: rawMsg.duration_ms as number | undefined,
                turns: rawMsg.num_turns as number | undefined,
                cost: rawMsg.total_cost_usd as number | undefined,
                summary: rawMsg.result as string | undefined,
              };
              setTimeout(() => this._notify.completion(projectPath, info), 500);
            }
          }

          // Inspect assistant tool_use blocks: scheduling-tool tracking (wait
          // classification) always; question/plan cards only for UNGATED
          // sessions (bypass/orchestrator) — gated sessions emit those from
          // canUseTool, where the promise hold actually blocks the model.
          if (rawMsg?.type === 'assistant' && Array.isArray(rawMsg?.message?.content)) {
            for (const block of rawMsg.message.content as Array<Record<string, unknown>>) {
              if (block.type !== 'tool_use') continue;

              const blockName = block.name as string;
              if (isSchedulingTool(blockName)) {
                session.sawSchedulingTool = true;
                const delay = (block.input as Record<string, unknown> | undefined)?.delaySeconds;
                if (blockName === 'ScheduleWakeup' && typeof delay === 'number') {
                  session.wakeupResumeInSeconds = delay;
                }
              }

              if (session.gated) continue;

              if (blockName === 'AskUserQuestion') {
                const input = (block.input ?? {}) as Record<string, unknown>;
                const questions = Array.isArray(input.questions) ? input.questions as Array<Record<string, unknown>> : [];
                const question = (questions[0]?.question as string | undefined) ?? 'The agent is waiting for your answer.';
                const s = this.sessions.get(scopeKey);
                if (s) s.awaitingInput = true;
                this._emit({
                  type: 'question_needed',
                  projectPath,
                  scope: effectiveScope,
                  toolUseId: block.id as string,
                  question,
                });
                this._notify.question(projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath, question);
              } else if (blockName === 'ExitPlanMode') {
                const input = (block.input ?? {}) as Record<string, unknown>;
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
                this._notify.planReview(projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath);
              }
            }
          }
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        // fatal: swarm status mirroring marks the task failed (not done) on a
        // crash — without the flag a dead drain reads as a clean completion.
        this._emit({ type: 'error', fatal: true, text: friendlyError(text), projectPath, scope: effectiveScope });
        this._emit({ type: 'done', projectPath, scope: effectiveScope, turnSeq: session.activeTurnSeq });
      } finally {
        // Release any gates still held by this scope — a closed query can never
        // deliver the tool result, and the resolver would leak forever.
        this._resolveGatesForScope(scopeKey, 'Session ended');
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
      // A scope sleeping on a ScheduleWakeup must not be reaped — closing the
      // query kills the pending wakeup and the agent never resumes. Bounded by
      // the wakeup deadline (+grace) so an abandoned wakeup can't defer forever.
      pendingWakeup: s.pendingWakeup && (s.wakeupDeadline == null || now < s.wakeupDeadline),
    }));
    sweepIdleScopes({
      now,
      idleMs: IDLE_SCOPE_MS,
      scopes: records,
      stop: (workspaceId, scope) => {
        this._emit({ type: 'scope_suspended', projectPath: workspaceId, scope });
        // Tear down the session properly (mirrors setSessionId's close+resume-stash),
        // so the SDK runtime is freed but the conversation resumes on the next send.
        // `scope` here is `_scopeName`, stored as `scope ?? 'chat'`, so the chat scope
        // is the literal string 'chat'; convert it back to undefined for toScopeKey.
        const scopeKey = toScopeKey(workspaceId, scope === 'chat' ? undefined : scope);
        const session = this.sessions.get(scopeKey);
        if (session) {
          if (session.sessionId) this.pendingResume.set(scopeKey, session.sessionId);
          session.query.close();
          this.sessions.delete(scopeKey);
        }
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

/** SDK feature settings that require a session respawn to apply. */
function readSdkFeatureKey(): string {
  return [
    readSaiSetting('claudeShowReasoning') === true ? '1' : '0',
    String(Number(readSaiSetting('claudeMaxBudgetUsd')) || 0),
    readSaiSetting('claude1MContext') === true ? '1' : '0',
  ].join('|');
}

/** Same normalization the CLI's ensureProcess used for its respawn check,
 *  plus the SDK feature settings (reasoning display, budget cap, 1M context). */
function normalizeConfig(permMode?: string, effort?: string, model?: string): { permMode: string; effort: string; model: string; features: string } {
  return { permMode: permMode || 'default', effort: effort || '', model: model || '', features: readSdkFeatureKey() };
}

type SessionConfig = ReturnType<typeof normalizeConfig>;

function configEquals(a: SessionConfig, b: SessionConfig): boolean {
  return a.permMode === b.permMode && a.effort === b.effort && a.model === b.model && a.features === b.features;
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
