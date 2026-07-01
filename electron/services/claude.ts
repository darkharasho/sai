import { spawn, ChildProcess, execFile } from 'node:child_process';
import { BrowserWindow, ipcMain, app } from 'electron';
import { getOrCreate, get, getClaude, touchActivity, listAllWorkspaces } from './workspace';
import type { PendingToolUse, WorkspaceClaude } from './workspace';
import { sweepIdleScopes, IDLE_SCOPE_MS, SWEEP_INTERVAL_MS } from './idleScopeSweep';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { enrichedEnv, withNodeMemoryCap } from './shellEnv';
import { notifyCompletion, notifyApproval, notifyQuestion, notifyPlanReview } from './notify';
import { extractCodexCommitMessage } from './commit-message-parser';
import { ensureGeminiCommitSession, ensureGeminiTransport, promptGeminiText } from './gemini';
import * as swarmMcpHost from './swarmMcpHost';
import { writeSwarmMcpConfig } from './swarmMcpConfig';
import {
  buildOrchestratorSystemPrompt,
  resolveOrchestratorPromptContext,
  type OrchestratorPromptContext,
} from '../../src/lib/orchestratorSystemPrompt';
import type { SessionBus } from './remote/session-bus';
import { clamp, type PermMode } from './remote/clamp';
import { exitTerminalEvents } from './claudeExit';
import { imageReadResult } from './imageFiles';
import type { StartArgs, CompactArgs } from './claudeBackend/types';
import { getClaudeBackend } from './claudeBackend';
import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from './chatNudges';
import { classifyTurnEnd, isSchedulingTool, type WaitMeta } from './waitClassifier';
export { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE };

const SLASH_COMMANDS_CACHE = path.join(app.getPath('userData'), 'slash-commands-cache.json');

// On Windows, CLI tools like `claude`, `codex`, `gemini`, and even `git` are
// typically shipped as `.cmd`/`.ps1` shims. Node's spawn won't resolve those
// without shell: true, so requests fail with ENOENT.
const IS_WIN = process.platform === 'win32';

// Cap (in MB) applied via NODE_OPTIONS=--max-old-space-size to spawned Node
// processes. 0 disables. Set by main.ts from the user setting on boot and
// on every settings:set change. Applies to the claude CLI itself and any
// node-based grandchildren (vitest, tsc, vite, etc.) — non-node tools are
// unaffected.
let subprocessMemoryCapMB = 0;
export function setSubprocessMemoryCapMB(n: number): void {
  subprocessMemoryCapMB = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function spawnEnv(): NodeJS.ProcessEnv {
  return withNodeMemoryCap(enrichedEnv(), subprocessMemoryCapMB);
}

export function readCachedSlashCommands(): string[] {
  try {
    return JSON.parse(fs.readFileSync(SLASH_COMMANDS_CACHE, 'utf-8'));
  } catch {
    return [];
  }
}

export function writeCachedSlashCommands(commands: string[]) {
  try {
    fs.writeFileSync(SLASH_COMMANDS_CACHE, JSON.stringify(commands));
  } catch { /* ignore write errors */ }
}

let mainWin: BrowserWindow | null = null;

// Single instance across registerClaudeHandlers calls (dev hot reload
// re-registers); cleared by destroyClaude on window close.
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

let remoteBus: SessionBus | null = null;
export function setRemoteBus(bus: SessionBus | null): void {
  remoteBus = bus;
}

let remoteCeiling: PermMode | null = null;
export function setRemoteCeiling(ceiling: PermMode | null): void {
  remoteCeiling = ceiling;
}
export function getRemoteCeiling(): PermMode | null { return remoteCeiling; }

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch {
    // Window already destroyed
  }
}

export function emitChatMessage(msg: Record<string, unknown>): void {
  if (mainWin) safeSend(mainWin, 'claude:message', msg);
  const topic = `chat:${msg.projectPath}:${msg.scope ?? 'chat'}`;
  remoteBus?.publish(topic, msg);
}

/**
 * Emit a `streaming_start` and enforce the turnSeq invariant that keeps the
 * renderer's thinking animation + Stop button from getting stranded.
 *
 * The renderer tags the latest streaming_start's turnSeq as "expected" and
 * drops any terminal `done` whose turnSeq doesn't match (the stale-turn guard).
 * That `done` carries `activeTurnSeq`, so for any continuation the CLI responds
 * to immediately, `activeTurnSeq` MUST already equal `turnSeq` — otherwise the
 * authoritative done is dropped and streaming state sticks forever.
 *
 * The lone exception is an interrupt: `activeTurnSeq` intentionally lags until
 * the old turn drains, so callers pass `interrupting: true` to opt out.
 */
export function emitStreamingStart(
  ws: { projectPath: string },
  claude: WorkspaceClaude,
  scope: string,
  opts: { interrupting?: boolean } = {},
): void {
  if (!opts.interrupting
    && Number.isFinite(claude.turnSeq)
    && claude.activeTurnSeq !== claude.turnSeq) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sai] streaming_start turnSeq desync (scope=${scope}): turnSeq=${claude.turnSeq} `
      + `activeTurnSeq=${claude.activeTurnSeq} — the turn's terminal done will be dropped `
      + `by the renderer's stale-turn guard, stranding the thinking animation + Stop button`,
    );
  }
  // A new/resumed turn boundary clears any prior wait tracking: the resume
  // itself proves the scope is active again, so it must not stay marked as
  // waiting or defer the idle sweep past this point.
  claude.sawSchedulingTool = false;
  claude.wakeupResumeInSeconds = null;
  claude.pendingWakeup = false;
  emitChatMessage({
    type: 'streaming_start',
    projectPath: ws.projectPath,
    scope,
    sessionId: claude.sessionId ?? null,
    turnSeq: claude.turnSeq,
  });
}

/**
 * Read a setting from SAI's settings.json.
 */
export function readSaiSetting(key: string): any {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    return settings[key];
  } catch {
    return undefined;
  }
}

export interface BuildArgsOptions {
  permMode?: string;
  effort?: string;
  model?: string;
  kind?: 'chat' | 'task' | 'orchestrator';
  /** Workspace path passed to the swarm MCP server as SAI_SWARM_WORKSPACE.
   *  Required when kind === 'orchestrator'. */
  workspace?: string;
  /** Optional orchestrator system-prompt context. Falls back to defaults. */
  orchestratorContext?: Partial<OrchestratorPromptContext> | null;
  /** Meta-workspace preamble to append to the system prompt via --append-system-prompt. */
  metaPreamble?: string;
  /** Override hooks for tests. */
  getMcpHandle?: () => { socketPath: string; secret: string };
  resolveMcpServerScriptPath?: () => string;
  resolveElectronExecPath?: () => string;
  writeMcpConfig?: typeof writeSwarmMcpConfig;
  readSetting?: (key: string) => any;
}

function defaultMcpServerScriptPath(): string {
  // vite-electron emits both main and the swarm-mcp-server bundle into
  // the same dist-electron directory, so __dirname resolution works in
  // dev and packaged builds alike.
  return path.join(__dirname, 'swarm-mcp-server.js');
}


/**
 * Build CLI args for the persistent process based on current config.
 * Exported for unit tests and to support orchestrator-kind sessions which
 * need extra `--mcp-config` / `--strict-mcp-config` / `--tools` flags.
 */
export function buildArgs(options: BuildArgsOptions = {}): string[] {
  const {
    permMode,
    effort,
    model,
    kind = 'chat',
    workspace,
    orchestratorContext,
    metaPreamble,
    getMcpHandle = () => swarmMcpHost.start(),
    resolveMcpServerScriptPath = defaultMcpServerScriptPath,
    resolveElectronExecPath = () => process.execPath,
    writeMcpConfig = writeSwarmMcpConfig,
    readSetting = readSaiSetting,
  } = options;

  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  // The CLI keeps only the LAST --append-system-prompt flag (verified
  // empirically), so all appended prompt sections are collected here and
  // emitted as a single flag at the end.
  const appendPrompts: string[] = [];

  // Orchestrator runs in bypassPermissions because its only tools are
  // mcp__swarm__* (built-ins blocked via --tools '' and --strict-mcp-config),
  // so prompting for approval adds friction with no safety benefit. The
  // swarm tools themselves don't touch files directly.
  if (kind === 'orchestrator' || permMode === 'bypass') {
    args.push('--permission-mode', 'bypassPermissions');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  if (effort && ['low', 'medium', 'high', 'max'].includes(effort)) {
    args.push('--effort', effort);
  }

  if (model) {
    args.push('--model', model);
  }

  if (kind === 'orchestrator') {
    // Orchestrator: SAI-managed MCP only, no built-in tools.
    const handle = getMcpHandle();
    const configPath = writeMcpConfig({
      socketPath: handle.socketPath,
      secret: handle.secret,
      workspace: workspace || '',
      mcpServerScriptPath: resolveMcpServerScriptPath(),
      electronExecPath: resolveElectronExecPath(),
    });
    args.push('--mcp-config', configPath);
    args.push('--strict-mcp-config');
    // Disable all built-in tools — only mcp__swarm__* will be available.
    args.push('--tools', '');
    // Block plugin-provided tools that aren't part of --tools (Skill/Task/Agent
    // load via plugin sync, not the built-in set, so --tools "" alone won't
    // suppress them). Belt-and-suspenders with --disable-slash-commands.
    args.push('--disallowedTools', 'Skill,Task,Agent,TodoWrite');
    args.push('--disable-slash-commands');
    // Replace Claude Code's default system prompt with the orchestrator one,
    // which steers the model to dispatch tasks instead of writing code itself.
    const ctx = resolveOrchestratorPromptContext({
      ...(orchestratorContext || {}),
      workspacePath: orchestratorContext?.workspacePath || workspace || '',
      workspaceName:
        orchestratorContext?.workspaceName ||
        (workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() || workspace : undefined),
    });
    args.push('--system-prompt', buildOrchestratorSystemPrompt(ctx));
  } else {
    // Chat sessions get SAI-native tools (render_html / render_component) via an
    // MCP config, but keep all built-in tools (no --strict-mcp-config).
    // getMcpHandle() (= swarmMcpHost.start()) is safe to call here regardless of
    // session ordering: main.ts starts the host and registers its onToolCall
    // handler unconditionally at app init, and start() is idempotent — this just
    // returns the already-listening handle.
    if (kind === 'chat' && workspace) {
      const handle = getMcpHandle();
      const cfgPath = writeMcpConfig({
        socketPath: handle.socketPath,
        secret: handle.secret,
        workspace,
        mcpServerScriptPath: resolveMcpServerScriptPath(),
        electronExecPath: resolveElectronExecPath(),
        toolset: 'chat',
      });
      args.push('--mcp-config', cfgPath);
      // Steer the chat agent to actually use the in-app renderer: without this
      // the model treats "make me a button" as a write-a-file task (and the
      // frontend-design skill reinforces that), never reaching for the tool.
      appendPrompts.push(CHAT_RENDER_NUDGE);
      // Same story for the CI watcher card: the tool description carries the
      // trigger, but deferred tools don't expose descriptions, so nudge here.
      appendPrompts.push(CHAT_GITHUB_WATCH_NUDGE);
    }

    // Chat/task: pass through user MCP config path(s) from SAI settings.
    const mcpConfig = readSetting('mcpConfigPath');
    if (mcpConfig) {
      const paths = Array.isArray(mcpConfig) ? mcpConfig : [mcpConfig];
      for (const p of paths) {
        if (typeof p === 'string' && p.trim()) {
          args.push('--mcp-config', p.trim());
        }
      }
    }
  }

  // Append meta-workspace preamble to the system prompt when provided.
  if (metaPreamble && metaPreamble.trim()) {
    appendPrompts.push(metaPreamble);
  }

  if (appendPrompts.length > 0) {
    args.push('--append-system-prompt', appendPrompts.join('\n\n'));
  }

  return args;
}

/**
 * Spawn (or respawn) the persistent Claude process for a workspace.
 * Attaches stdout/stderr handlers that route messages to the renderer.
 */
function ensureProcess(
  win: BrowserWindow,
  projectPath: string,
  scope: string = 'chat',
  permMode?: string,
  effort?: string,
  model?: string,
): ChildProcess {
  const ws = getOrCreate(projectPath);
  const claude = getClaude(ws, scope);
  const currentConfig = { permMode: permMode || 'default', effort: effort || '', model: model || '', metaPreamble: claude.metaPreamble || '' };

  // If process exists and config hasn't changed, reuse it
  if (claude.process && claude.processConfig &&
      claude.processConfig.permMode === currentConfig.permMode &&
      claude.processConfig.effort === currentConfig.effort &&
      claude.processConfig.model === currentConfig.model &&
      claude.processConfig.metaPreamble === currentConfig.metaPreamble) {
    return claude.process;
  }

  // Config changed or no process — kill old one and spawn fresh
  if (claude.process) {
    claude.process.kill();
    claude.process = null;
  }

  const args = buildArgs({
    permMode,
    effort,
    model,
    kind: claude.kind,
    workspace: ws.projectPath,
    orchestratorContext: (claude.orchestratorContext as Partial<OrchestratorPromptContext> | null) || null,
    metaPreamble: claude.metaPreamble,
  });

  // Resume existing session if we have one
  if (claude.sessionId) {
    args.push('--resume', claude.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd: claude.cwd || projectPath,
    env: spawnEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: IS_WIN,
  });

  claude.process = proc;
  claude.processConfig = currentConfig;
  claude.buffer = '';

  proc.stdout?.on('data', (data: Buffer) => {
    // Ignore if this process has been replaced
    if (claude.process !== proc) {
      return;
    }

    claude.buffer += data.toString();
    const lines = claude.buffer.split('\n');
    claude.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      claude.lastActivityAt = Date.now();
      // Also reset the workspace-level auto-suspend clock: lastActivity
      // otherwise only tracks user sends, so a long agentic run would look
      // "inactive" to startSuspendTimer the moment it ends.
      ws.lastActivity = Date.now();
      try {
        const msg = JSON.parse(line);
        // [sai-stream-debug] Trace every CLI result + turn-lifecycle frame to pin down
        // the wait/restore bug: the CLI emits a real `result` when it pauses/waits on a
        // background task/subagent, then RESUMES the same logical turn with more
        // assistant output and NO new streaming_start — so streaming clears and the
        // thinking/Stop indicators vanish while the turn keeps going. We need the field
        // that distinguishes a paused result (stop_reason/terminal_reason) from a final
        // one (stop_reason=end_turn). Remove once the fix lands.
        if (msg.type === 'result' || (msg.type === 'system' && /compact|task/.test(String(msg.subtype || '')))) {
          // eslint-disable-next-line no-console
          console.log('[sai-stream-debug] CLI frame', JSON.stringify({
            t: new Date().toISOString(),
            type: msg.type,
            subtype: msg.subtype,
            stop_reason: msg.stop_reason,
            terminal_reason: msg.terminal_reason,
            num_turns: msg.num_turns,
            is_error: msg.is_error,
            scope,
            turnSeq: claude.turnSeq,
            activeTurnSeq: claude.activeTurnSeq,
            streaming: claude.streaming,
            busy: claude.busy,
          }));
        }
        // [sai-stream-debug] THE RESTORE SIGNAL: assistant output arriving in the main
        // process while we've already marked the turn ended (streaming=false) — i.e. the
        // CLI resumed after a wait. This is the backend-side smoking gun for the fix.
        if (msg.type === 'assistant' && !claude.streaming) {
          // eslint-disable-next-line no-console
          console.log('[sai-stream-debug] ⚠️ RESUME-AFTER-DONE assistant frame while streaming=false', JSON.stringify({
            scope, turnSeq: claude.turnSeq, activeTurnSeq: claude.activeTurnSeq,
            blocks: Array.isArray(msg.message?.content) ? msg.message.content.map((b: any) => b.type) : null,
          }));
        }
        // Capture session ID and forward to renderer
        if (msg.session_id && !claude.sessionId) {
          claude.sessionId = msg.session_id;
          emitChatMessage({ type: 'session_id', sessionId: msg.session_id, projectPath: ws.projectPath, scope });
        }

        // Capture slash commands from init (replaces the probe)
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (msg.slash_commands) {
            writeCachedSlashCommands(msg.slash_commands);
          }
          emitChatMessage({ ...msg, projectPath: ws.projectPath, scope });
          continue;
        }

        // When suppressForward is true (silent compact), skip IPC forwarding.
        // Allow system messages through (compact notification) but suppress everything else.
        // When a result arrives, the silent turn is done — clear both flags so the
        // next claude:send doesn't see stale busy state.
        if (claude.suppressForward) {
          if (msg.type === 'result') {
            claude.suppressForward = false;
            claude.busy = false;
          }
          if (msg.type !== 'system') continue;
          // Fall through to forward system messages (e.g. context_compacted)
        }

        // --- Approval flow: buffer messages while awaiting user decision ---
        if (claude.awaitingApproval) {
          claude.approvalBuffered.push(msg);
          continue;
        }

        // --- AskUserQuestion flow: drop the CLI's placeholder tool_result and
        // any follow-up assistant chatter until the user answers in the UI. We
        // forward the assistant message that contains the tool_use itself (so
        // the card shows), then start buffering from the very next message. ---
        if (claude.awaitingQuestionAnswer) {
          if (msg.type === 'result') {
            // The CLI's auto-dismissed turn for this question just ended. If the user has
            // already answered, inject now; otherwise note it drained so a later answer
            // injects immediately.
            claude.questionTurnDrained = true;
            if (claude.pendingQuestionAnswer) flushPendingQuestionAnswer(claude);
          } else if (claude.pendingQuestionAnswer) {
            // Answer is held but the dismissed turn is still streaming — keep deferring.
            armQuestionAnswerFallback(claude);
          }
          continue;
        }

        // --- ExitPlanMode flow: same buffering pattern as AskUserQuestion.
        // Buffer CLI output until the user approves or rejects the plan in the UI. ---
        if (claude.awaitingPlanReview) {
          continue;
        }

        // --- Resume-after-wait: the new CLI ends a turn (emits `result`) when it
        // yields to wait on a background task/subagent, then RESTORES the same logical
        // turn with more assistant output and no new user send. Without re-arming, the
        // turn already looks ended (streaming=false), so the Stop button + thinking
        // indicator stay gone while the response keeps going. Re-emit a turn boundary so
        // they return; the resumed turn's own result/done closes it as usual.
        // (suppressForward assistant frames already returned above, so this only fires
        // on a genuine resume.) ---
        if (msg.type === 'assistant' && !claude.streaming) {
          claude.turnSeq++;
          claude.busy = true;
          claude.activeTurnSeq = claude.turnSeq;
          claude.streaming = true;
          emitStreamingStart(ws, claude, scope);
        }

        // --- Track the latest tool_use from assistant messages ---
        let askUserQuestionId: string | null = null;
        let exitPlanModeId: string | null = null;
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_use') {
              claude.pendingToolUse = {
                toolName: block.name,
                toolUseId: block.id,
                input: block.input || {},
              };
              if (isSchedulingTool(block.name)) {
                claude.sawSchedulingTool = true;
                const delay = (block.input as any)?.delaySeconds;
                if (block.name === 'ScheduleWakeup' && typeof delay === 'number') {
                  claude.wakeupResumeInSeconds = delay;
                }
              }
              if (block.name === 'AskUserQuestion') {
                askUserQuestionId = block.id;
              }
              if (block.name === 'ExitPlanMode') {
                exitPlanModeId = block.id;
              }
            }
          }
        }

        // --- Detect tool_result denial (approval needed) ---
        if (msg.type === 'user' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          const denialBlock = content.find((block: any) => {
            if (block.type !== 'tool_result' || !block.is_error || typeof block.content !== 'string') return false;
            const lower = block.content.toLowerCase();
            return lower.includes('requested permissions') ||
                   lower.includes('was blocked') ||
                   lower.includes("haven't granted");
          });
          if (denialBlock && claude.pendingToolUse) {
            claude.awaitingApproval = true;
            claude.approvalBuffered = [];
            const tu = claude.pendingToolUse;
            const command = tu.input.command
              || tu.input.file_path
              || tu.input.path
              || tu.input.pattern
              || tu.input.url
              || tu.input.query
              || Object.values(tu.input).find(v => typeof v === 'string' && v.length > 0)
              || JSON.stringify(tu.input);
            const description = tu.input.description || '';
            emitChatMessage({
              type: 'approval_needed',
              projectPath: ws.projectPath,
              scope,
              toolName: tu.toolName,
              toolUseId: tu.toolUseId,
              command,
              description,
              input: tu.input,
            });
            const wsName = ws.projectPath.split('/').pop() || ws.projectPath;
            notifyApproval(win, wsName, tu.toolName, command);
            continue;
          }
        }

        // Result signals end of a turn
        if (msg.type === 'result') {
          const wasBusy = claude.busy;
          // Capture the turn this response belongs to BEFORE updating state.
          // If the user sent a new message while this response was in flight,
          // claude.turnSeq already points to the new turn — using activeTurnSeq
          // ensures the renderer can ignore this stale result/done correctly.
          const responseTurnSeq = claude.activeTurnSeq;
          claude.busy = false;
          claude.streaming = false;
          claude.activeTurnSeq = claude.turnSeq; // CLI will now respond to the next queued turn
          emitChatMessage({ ...msg, projectPath: ws.projectPath, scope, turnSeq: responseTurnSeq });
          emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope, turnSeq: responseTurnSeq });
          if (wasBusy) setTimeout(() => notifyCompletion(win, ws.projectPath, {
            provider: 'Claude',
            duration: msg.duration_ms,
            turns: msg.num_turns,
            cost: msg.total_cost_usd,
            summary: msg.result,
          }), 500);
          continue;
        }

        emitChatMessage({ ...msg, projectPath: ws.projectPath, scope });

        // After forwarding the assistant message that introduced an
        // AskUserQuestion tool_use, start buffering subsequent CLI output
        // (placeholder tool_result + any cancellation acknowledgment) until
        // the user answers in the UI.
        if (askUserQuestionId) {
          claude.awaitingQuestionAnswer = true;
          claude.pendingQuestionId = askUserQuestionId;
          claude.questionTurnDrained = false;
          claude.pendingQuestionAnswer = null;
          if (claude.questionAnswerFallbackTimer) {
            clearTimeout(claude.questionAnswerFallbackTimer);
            claude.questionAnswerFallbackTimer = null;
          }
          const wsName = ws.projectPath.split('/').pop() || ws.projectPath;
          const questions = claude.pendingToolUse?.input?.questions;
          const firstQuestion = Array.isArray(questions) && questions[0]?.question
            ? String(questions[0].question)
            : 'The agent is waiting for your answer.';
          notifyQuestion(win, wsName, firstQuestion);
          emitChatMessage({
            type: 'question_needed',
            projectPath: ws.projectPath,
            scope,
            toolUseId: askUserQuestionId,
            question: firstQuestion,
          });
        }

        // After forwarding the assistant message that introduced an
        // ExitPlanMode tool_use, start buffering subsequent CLI output
        // until the user approves or rejects the plan in the UI.
        if (exitPlanModeId) {
          claude.awaitingPlanReview = true;
          claude.pendingPlanReviewId = exitPlanModeId;
          const planInput = claude.pendingToolUse?.input || {};
          const wsName = ws.projectPath.split('/').pop() || ws.projectPath;
          notifyPlanReview(win, wsName);
          emitChatMessage({
            type: 'plan_review_needed',
            projectPath: ws.projectPath,
            scope,
            toolUseId: exitPlanModeId,
            plan: planInput.plan || '',
            planFilePath: planInput.planFilePath || '',
          });
        }
      } catch {
        if (line.includes('"type":"result"') || line.includes('"type": "result"')) {
          const responseTurnSeq = claude.activeTurnSeq;
          claude.busy = false;
          claude.streaming = false;
          claude.activeTurnSeq = claude.turnSeq;
          emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope, turnSeq: responseTurnSeq });
        }
      }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (claude.process !== proc) return;
    const text = data.toString().trim();
    if (text) {
      emitChatMessage({ type: 'error', text, projectPath: ws.projectPath, scope });
    }
  });

  proc.on('exit', (code, signal) => {
    if (claude.process !== proc) return;

    if (claude.buffer.trim()) {
      try {
        const msg = JSON.parse(claude.buffer);
        emitChatMessage({ ...msg, projectPath: ws.projectPath, scope });
      } catch { /* ignore */ }
    }
    const wasBusy = claude.busy;
    claude.buffer = '';
    claude.process = null;
    claude.processConfig = null;
    claude.busy = false;
    claude.suppressForward = false;
    claude.pendingToolUse = null;
    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.awaitingQuestionAnswer = false;
    claude.pendingQuestionId = null;
    claude.pendingQuestionAnswer = null;
    claude.questionTurnDrained = false;
    if (claude.questionAnswerFallbackTimer) {
      clearTimeout(claude.questionAnswerFallbackTimer);
      claude.questionAnswerFallbackTimer = null;
    }
    claude.awaitingPlanReview = false;
    claude.pendingPlanReviewId = null;
    claude.streaming = false;
    for (const ev of exitTerminalEvents(code, signal, wasBusy)) {
      emitChatMessage({ ...ev, projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
    }
  });

  proc.on('error', (err) => {
    if (claude.process !== proc) return;
    claude.process = null;
    claude.processConfig = null;
    claude.busy = false;
    claude.suppressForward = false;
    claude.pendingToolUse = null;
    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.awaitingQuestionAnswer = false;
    claude.pendingQuestionId = null;
    claude.pendingQuestionAnswer = null;
    claude.questionTurnDrained = false;
    if (claude.questionAnswerFallbackTimer) {
      clearTimeout(claude.questionAnswerFallbackTimer);
      claude.questionAnswerFallbackTimer = null;
    }
    claude.awaitingPlanReview = false;
    claude.pendingPlanReviewId = null;
    claude.streaming = false;
    emitChatMessage({
      type: 'error', fatal: true, text: `Claude process error: ${err.message}`, projectPath: ws.projectPath, scope
    });
    emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
  });

  return proc;
}

/** Switch a scope to a different Claude session (history resumption). Shared
 *  by the claude:setSessionId IPC and the remote-bridge prompt path. If this
 *  scope is actively streaming, leave the process running so the user can
 *  switch to it and see real streaming output (with a working Stop button) —
 *  killing it here without emitting done would leave the UI stuck; killing it
 *  WITH a done strips the Stop button before the user can act. An idle
 *  process is killed so the next spawn picks up --resume <sessionId>. */
export function setSessionIdImpl(projectPath: string, sessionId: string | undefined, scope?: string): void {
  const ws = get(projectPath);
  if (!ws) return;
  const claude = getClaude(ws, scope || 'chat');
  if (claude.process) {
    if (claude.streaming || claude.busy) return;
    claude.process.kill();
    claude.process = null;
    claude.processConfig = null;
  }
  claude.sessionId = sessionId;
}

export function sendImpl(
  projectPath: string,
  message: string,
  imagePaths?: string[],
  permMode?: string,
  effort?: string,
  model?: string,
  scope?: string,
  origin: 'desktop' | 'remote' = 'desktop',
): void {
  if (!mainWin) return;
  const ws = get(projectPath);
  if (!ws) return;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);

  let effectivePermMode = permMode as PermMode | undefined;
  if (origin === 'remote') {
    effectivePermMode = clamp(effectivePermMode, remoteCeiling);
  }

  touchActivity(projectPath);

  let prompt = message;
  if (imagePaths && imagePaths.length > 0) {
    const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
    prompt = `${imageRefs}\n\n${message}`;
  }

  const proc = ensureProcess(mainWin, projectPath, effectiveScope, effectivePermMode, effort, model);

  claude.suppressForward = false;

  if (claude.awaitingApproval) {
    claude.awaitingApproval = false;
    claude.approvalBuffered = [];
    claude.pendingToolUse = null;
  }

  if (claude.buffer.trim()) {
    try {
      const stale = JSON.parse(claude.buffer);
      if (stale.type === 'result') {
        const responseTurnSeq = claude.activeTurnSeq;
        claude.busy = false;
        claude.streaming = false;
        claude.activeTurnSeq = claude.turnSeq; // will be updated again below after turnSeq++
        emitChatMessage({ ...stale, projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
        emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
      }
    } catch { /* partial/malformed — discard */ }
    claude.buffer = '';
  }

  const wasInterrupt = claude.busy; // true if we're interrupting an in-progress response
  if (wasInterrupt) {
    // Tell the renderer the old turn is being interrupted. Use the CURRENT turnSeq
    // so the renderer's stale check can dismiss old done/result from the CLI.
    claude.streaming = false;
    emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
  }

  claude.turnSeq++;
  claude.busy = true;
  if (!wasInterrupt) {
    // Normal (non-interrupt) start: the CLI will immediately respond to this new turn.
    claude.activeTurnSeq = claude.turnSeq;
  }
  // Interrupt case: activeTurnSeq stays at the old value until the CLI finishes the
  // old response and the stdout handler updates it to claude.turnSeq.
  claude.streaming = true;
  emitStreamingStart(ws, claude, effectiveScope, { interrupting: wasInterrupt });

  const msg = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt },
  });
  if (!proc.stdin || proc.stdin.destroyed) {
    claude.busy = false;
    claude.streaming = false;
    emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
    return;
  }
  proc.stdin.write(msg + '\n');
  emitChatMessage({
    type: 'user_message',
    projectPath,
    scope: effectiveScope,
    text: message,
    origin,
    turnSeq: claude.turnSeq,
  });
}

export function interruptImpl(projectPath: string, scope?: string): void {
  const ws = get(projectPath);
  if (!ws) return;
  const claude = getClaude(ws, scope || 'chat');
  if (claude.process) {
    const proc = claude.process;
    claude.process = null;
    claude.processConfig = null;
    claude.busy = false;
    claude.streaming = false;
    claude.suppressForward = false;
    claude.pendingToolUse = null;
    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    proc.kill();
    emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: scope || 'chat', turnSeq: claude.turnSeq });
  }
}

/** Inject the held AskUserQuestion answer into the CLI as a corrective user message and
 *  re-open the output gate. Called once the CLI's auto-dismissed turn has fully drained
 *  (its `result` was seen) or, as a fallback, after a grace period if the CLI blocked. */
function flushPendingQuestionAnswer(claude: WorkspaceClaude): void {
  const pending = claude.pendingQuestionAnswer;
  if (!pending) return;
  if (claude.questionAnswerFallbackTimer) {
    clearTimeout(claude.questionAnswerFallbackTimer);
    claude.questionAnswerFallbackTimer = null;
  }
  claude.awaitingQuestionAnswer = false;
  claude.pendingQuestionId = null;
  claude.questionTurnDrained = false;
  claude.pendingQuestionAnswer = null;
  const proc = claude.process;
  if (proc?.stdin && !proc.stdin.destroyed) {
    const followUp = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: `[AskUserQuestion answers for tool call ${pending.toolUseId}]\nThe user picked the following answers (the earlier placeholder tool_result for this tool call should be disregarded):\n${JSON.stringify(pending.answers, null, 2)}`,
      },
    });
    proc.stdin.write(followUp + '\n');
  }
}

/** (Re)arm the grace timer that flushes a held answer if the CLI never emits a turn-end
 *  `result` (i.e. it blocked rather than auto-dismissing). Reset on each gated message so
 *  a still-streaming auto-dismissed turn keeps deferring until its `result` arrives. */
function armQuestionAnswerFallback(claude: WorkspaceClaude): void {
  if (claude.questionAnswerFallbackTimer) clearTimeout(claude.questionAnswerFallbackTimer);
  claude.questionAnswerFallbackTimer = setTimeout(() => {
    claude.questionAnswerFallbackTimer = null;
    flushPendingQuestionAnswer(claude);
  }, 1500);
}

export async function answerQuestionImpl(
  projectPath: string,
  toolUseId: string,
  answers: Record<string, string | string[]>,
  scope?: string,
): Promise<boolean> {
  const ws = get(projectPath);
  if (!ws) return false;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);

  // Mark the card answered in the UI immediately.
  emitChatMessage({
    type: 'question_answered',
    projectPath: ws.projectPath,
    scope: effectiveScope,
    toolUseId,
    answers,
  });

  // Deferred injection: the CLI auto-answers AskUserQuestion itself with a placeholder
  // "dismissed" tool_result and keeps streaming that turn. We keep dropping that turn's
  // output until it fully drains, THEN inject the real answer — otherwise releasing the
  // gate the instant the user answers leaks the half-streamed "dismissed" reply. If the
  // turn already drained, inject now; otherwise wait for its `result` (or the grace timer).
  if (claude.awaitingQuestionAnswer && claude.pendingQuestionId === toolUseId) {
    claude.pendingQuestionAnswer = { toolUseId, answers };
    if (claude.questionTurnDrained) {
      flushPendingQuestionAnswer(claude);
    } else {
      armQuestionAnswerFallback(claude);
    }
    return true;
  }

  // Gate already released (e.g. answered after the flow reset): inject directly.
  const proc = claude.process;
  if (proc?.stdin && !proc.stdin.destroyed) {
    const followUp = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: `[AskUserQuestion answers for tool call ${toolUseId}]\nThe user picked the following answers (the earlier placeholder tool_result for this tool call should be disregarded):\n${JSON.stringify(answers, null, 2)}`,
      },
    });
    proc.stdin.write(followUp + '\n');
  }
  return true;
}

export async function answerPlanReviewImpl(
  projectPath: string,
  toolUseId: string,
  approved: boolean,
  scope?: string,
): Promise<boolean> {
  const ws = get(projectPath);
  if (!ws) return false;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);

  if (claude.awaitingPlanReview && claude.pendingPlanReviewId === toolUseId) {
    claude.awaitingPlanReview = false;
    claude.pendingPlanReviewId = null;
  }

  emitChatMessage({
    type: 'plan_review_answered',
    projectPath: ws.projectPath,
    scope: effectiveScope,
    toolUseId,
    approved,
  });

  const proc = claude.process;
  if (proc?.stdin && !proc.stdin.destroyed) {
    const content = approved
      ? `[ExitPlanMode result for tool call ${toolUseId}]\nThe user approved the plan. Proceed with implementation.`
      : `[ExitPlanMode result for tool call ${toolUseId}]\nThe user rejected the plan. Please ask what changes they'd like and revise your approach.`;
    const followUp = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
    });
    proc.stdin.write(followUp + '\n');
  }
  return true;
}

export async function approveImpl(
  projectPath: string,
  toolUseId: string,
  approved: boolean,
  modifiedCommand?: string,
  scope?: string,
): Promise<void | boolean | { result: string; isError: boolean }> {
  const ws = get(projectPath);
  if (!ws) return;
  const effectiveScope = scope || 'chat';

  const pendingGemini = ws.gemini?.pendingApproval;
  if (pendingGemini && pendingGemini.toolUseId === toolUseId && pendingGemini.scope === effectiveScope) {
    const sessionId = effectiveScope === 'chat'
      ? ws.gemini?.chatSessionId
      : ws.gemini?.terminalSessions.get(effectiveScope);

    try {
      await ws.gemini?.transport?.request('tool/approve', {
        sessionId,
        scope: effectiveScope,
        toolUseId,
        approved,
        modifiedCommand,
      });
      if (ws.gemini) ws.gemini.pendingApproval = null;
      emitChatMessage({ type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });
      return true;
    } catch (error: any) {
      if (ws.gemini) ws.gemini.pendingApproval = null;
      emitChatMessage({
        type: 'error',
        text: `Gemini approval failed: ${error?.message || 'Unknown error'}`,
        projectPath: ws.projectPath,
        scope: effectiveScope,
      });
      emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: ws.gemini?.turnSeq });
      return false;
    }
  }

  const claude = getClaude(ws, effectiveScope);
  // Idempotency guard: if there is no pending approval, this is either an
  // unknown toolUseId or a second-resolver call — return silently.
  if (!claude.pendingToolUse || !claude.awaitingApproval) return;

  // --- Deny path ---
  if (!approved) {
    for (const buffered of claude.approvalBuffered) {
      if (buffered.type === 'result') {
        const responseTurnSeq = claude.activeTurnSeq;
        claude.busy = false;
        claude.activeTurnSeq = claude.turnSeq;
        emitChatMessage({ ...buffered, projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
        emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
      } else {
        emitChatMessage({ ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
      }
    }
    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.pendingToolUse = null;
    emitChatMessage({ type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });
    return;
  }

  // --- Approve path ---
  const pending = claude.pendingToolUse;
  const cwd = claude.cwd || projectPath;

  // Known tools that SAI can execute locally
  const localTools = new Set(['Bash', 'bash', 'Write', 'Edit', 'Read']);

  // --- MCP / unknown tools: delegate back to the CLI ---
  if (!localTools.has(pending.toolName)) {
    // Add to allow list so the CLI won't deny it again
    const claudeDir = path.join(projectPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    let settings: Record<string, any> = {};
    let canWriteSettings = true;
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch (err) {
        // Don't clobber a malformed user-edited file. Surface the error and skip the write.
        canWriteSettings = false;
        console.warn(`[sai] Refusing to overwrite malformed ${settingsPath}:`, err);
      }
    }
    if (canWriteSettings) {
      if (!settings.permissions) settings.permissions = {};
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
      if (!settings.permissions.allow.includes(pending.toolName)) {
        settings.permissions.allow.push(pending.toolName);
        try { fs.mkdirSync(claudeDir, { recursive: true }); } catch {}
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    }

    // Flush any buffered messages to the renderer
    for (const buffered of claude.approvalBuffered) {
      if (buffered.type === 'result') {
        const responseTurnSeq = claude.activeTurnSeq;
        claude.busy = false;
        claude.activeTurnSeq = claude.turnSeq;
        emitChatMessage({ ...buffered, projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
        emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: responseTurnSeq });
      } else {
        emitChatMessage({ ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
      }
    }

    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.pendingToolUse = null;
    emitChatMessage({ type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });

    // Tell the CLI to retry — the permission is now in the allow list
    const proc = claude.process;
    if (proc?.stdin && !proc.stdin.destroyed) {
      claude.turnSeq++;
      // The CLI immediately responds to this retry, so activeTurnSeq must track
      // turnSeq (mirrors the non-interrupt branch in sendImpl). Otherwise the
      // turn's terminal result→done carries the stale activeTurnSeq, the
      // renderer's stale-turn guard drops it, and the thinking animation +
      // Stop button stay stuck.
      claude.activeTurnSeq = claude.turnSeq;
      claude.busy = true;
      emitStreamingStart(ws, claude, effectiveScope);
      const retryMsg = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: `The user has approved the use of the "${pending.toolName}" tool. Please proceed with the same tool call you just attempted.`,
        },
      });
      proc.stdin.write(retryMsg + '\n');
    }

    return { result: 'Tool approved — CLI is re-executing via MCP', isError: false };
  }

  // --- Local tool execution (Bash, Write, Edit, Read) ---
  let result = '';
  let isError = false;
  let resultImages: Array<{ path: string; media_type: string }> | null = null;

  try {
    if (pending.toolName === 'Bash' || pending.toolName === 'bash') {
      // Use modified command if user edited it, otherwise use original
      const command = modifiedCommand || pending.input.command || '';
      const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const shellBin = IS_WIN ? (process.env.ComSpec || 'cmd.exe') : 'bash';
        const shellArgs = IS_WIN ? ['/d', '/s', '/c', command] : ['-c', command];
        execFile(shellBin, shellArgs, {
          cwd,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: spawnEnv(),
          windowsVerbatimArguments: IS_WIN,
        }, (err, stdout, stderr) => {
          if (err && !stdout && !stderr) {
            reject(err);
          } else {
            resolve({ stdout: stdout || '', stderr: stderr || '' });
          }
        });
      });
      result = execResult.stdout;
      if (execResult.stderr) {
        result += (result ? '\n' : '') + execResult.stderr;
      }
    } else if (pending.toolName === 'Write') {
      const filePath = pending.input.file_path;
      const content = pending.input.content || '';
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      result = `Successfully wrote to ${filePath}`;
    } else if (pending.toolName === 'Edit') {
      const filePath = pending.input.file_path;
      const oldStr = pending.input.old_string;
      const newStr = pending.input.new_string;
      if (!fs.existsSync(filePath)) {
        result = `File not found: ${filePath}`;
        isError = true;
      } else {
        let fileContent = fs.readFileSync(filePath, 'utf-8');
        if (!fileContent.includes(oldStr)) {
          result = `old_string not found in ${filePath}`;
          isError = true;
        } else {
          fileContent = fileContent.replace(oldStr, newStr);
          fs.writeFileSync(filePath, fileContent, 'utf-8');
          result = `Successfully edited ${filePath}`;
        }
      }
    } else if (pending.toolName === 'Read') {
      const filePath = pending.input.file_path;
      if (!fs.existsSync(filePath)) {
        result = `File not found: ${filePath}`;
        isError = true;
      } else {
        const img = imageReadResult(filePath);
        if (img) {
          result = img.text;
          resultImages = [img.image];
        } else {
          result = fs.readFileSync(filePath, 'utf-8');
        }
      }
    }
  } catch (err: any) {
    result = err.message || 'Command execution failed';
    isError = true;
  }

  const toolResultContent = resultImages
    ? [
        { type: 'text', text: result },
        ...resultImages.map(im => ({ type: 'image', source: { type: 'sai-file', path: im.path, media_type: im.media_type } })),
      ]
    : result;

  // Send the real tool result to the renderer as if the CLI produced it
  emitChatMessage({
    type: 'user',
    projectPath: ws.projectPath,
    scope: effectiveScope,
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: pending.toolUseId,
        content: toolResultContent,
        is_error: isError,
      }],
    },
  });

  claude.approvalBuffered = [];
  claude.awaitingApproval = false;
  claude.pendingToolUse = null;
  emitChatMessage({ type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });

  const proc = claude.process;
  if (proc?.stdin && !proc.stdin.destroyed) {
    // Truncate large results to avoid inflating context
    const maxLen = 8000;
    const truncated = result.length > maxLen
      ? result.slice(0, maxLen) + `\n... (truncated ${result.length - maxLen} chars)`
      : result;
    const followUp = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: `[${pending.toolName} output]\n${truncated}`,
      },
    });
    proc.stdin.write(followUp + '\n');
  }

  return { result, isError };
}

export interface ClaudeModelOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
  oneM?: boolean;
  extra?: boolean;
}

// Built-in models shipped by the current Claude Code CLI. Account/org gating
// (extra models like Fable, 1M-context access) is layered on top from the CLI's
// own cache in ~/.claude.json so we don't advertise models the org disallows.
const BASE_CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: 'default', label: 'Default', description: 'Your account’s recommended model', recommended: true },
  { id: 'sonnet',  label: 'Sonnet',  description: 'Claude Sonnet 4.6 · Efficient for routine tasks' },
  { id: 'opus',    label: 'Opus',    description: 'Claude Opus 4.8 · Most capable for complex work' },
  { id: 'haiku',   label: 'Haiku',   description: 'Claude Haiku 4.5 · Fastest for quick answers' },
];

function readClaudeUserConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Derives the models actually available to this account/org rather than assuming
// every Anthropic model is allowed. The Claude CLI has no "list models" command,
// but it caches the relevant signals in ~/.claude.json:
//   - additionalModelOptionsCache: account-specific extra models (e.g. Fable)
//   - s1mAccessCache[orgUuid].hasAccess: whether the org can use 1M context
//   - oauthAccount.organizationUuid: the key into s1mAccessCache
// When not logged in (no cache) we fall back to the built-in set.
export function getAvailableClaudeModels(): { models: ClaudeModelOption[]; detected: boolean } {
  const cfg = readClaudeUserConfig();
  if (!cfg || !cfg.oauthAccount) {
    return { models: BASE_CLAUDE_MODELS, detected: false };
  }

  const orgUuid: string | undefined = cfg.oauthAccount.organizationUuid;
  const has1m = !!(orgUuid && cfg.s1mAccessCache?.[orgUuid]?.hasAccess === true);

  const [defaultModel, sonnet, opus, haiku] = BASE_CLAUDE_MODELS;
  const models: ClaudeModelOption[] = [defaultModel];

  // Extra account-specific models the CLI advertises (already shaped value/label/description).
  const extras = Array.isArray(cfg.additionalModelOptionsCache) ? cfg.additionalModelOptionsCache : [];
  for (const m of extras) {
    if (m && typeof m.value === 'string') {
      models.push({
        id: m.value,
        label: typeof m.label === 'string' && m.label ? m.label : m.value,
        description: typeof m.description === 'string' ? m.description : '',
        extra: true,
        oneM: m.value.includes('[1m]'),
      });
    }
  }

  models.push(sonnet);
  if (has1m) models.push({ id: 'sonnet[1m]', label: 'Sonnet 1M', description: 'Sonnet 4.6 with 1M context for long sessions', oneM: true });
  models.push(opus);
  if (has1m) models.push({ id: 'opus[1m]', label: 'Opus 1M', description: 'Opus 4.8 with 1M context for long sessions', oneM: true });
  models.push(haiku);

  return { models, detected: true };
}

export function startImpl(args: StartArgs): { slashCommands: string[] } | undefined {
  const { projectPath, scope, kind, orchestratorContext, scopeCwd, metaPreamble } = args;
  if (!projectPath) return;
  const ws = getOrCreate(projectPath);
  const claude = getClaude(ws, scope || 'chat', kind);
  // scopeCwd lets a swarm task pin its scope to its worktree dir while keeping
  // the workspace key (and therefore msg.projectPath in emitted events) as the
  // original project root — so ChatPanel + listeners match on projectPath.
  claude.cwd = scopeCwd || projectPath;
  if (kind === 'orchestrator' && orchestratorContext) {
    claude.orchestratorContext = orchestratorContext as Record<string, unknown>;
  }
  claude.metaPreamble = metaPreamble || '';
  emitChatMessage({ type: 'ready', projectPath: ws.projectPath, scope: scope || 'chat' });
  return { slashCommands: readCachedSlashCommands() };
}

export function compactImpl(args: CompactArgs): void {
  const { projectPath, permMode, effort, model, scope } = args;
  const ws = get(projectPath);
  if (!ws) return;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);
  touchActivity(projectPath);
  const proc = ensureProcess(mainWin!, projectPath, effectiveScope, permMode, effort, model);
  claude.suppressForward = true;
  const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: '/compact' } });
  if (proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.write(msg + '\n');
  } else {
    claude.suppressForward = false;
  }
}

export async function alwaysAllowImpl(projectPath: string, toolPattern: string): Promise<boolean> {
  const claudeDir = path.join(projectPath, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch { /* file doesn't exist yet */ }
  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
  if (!settings.permissions.allow.includes(toolPattern)) {
    settings.permissions.allow.push(toolPattern);
  }
  try { fs.mkdirSync(claudeDir, { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
}

export async function generateCommitMessageImpl(cwd: string, aiProvider?: string): Promise<string> {
  const ws = get(cwd);
  const effectiveCwd = cwd || (ws && getClaude(ws).cwd) || process.env.HOME || '/';

  // Get the diff
  const getDiff = (args: string[]) => new Promise<string>((resolve) => {
    const diffProc = spawn('git', ['diff', ...args], {
      cwd: effectiveCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WIN,
    });
    let out = '';
    diffProc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    diffProc.on('exit', () => resolve(out.trim()));
    diffProc.on('error', () => resolve(''));
  });

  let diff = await getDiff(['--staged']);
  if (!diff) diff = await getDiff([]);
  if (!diff) return '';

  const maxLen = 8000;
  const truncatedDiff = diff.length > maxLen
    ? diff.slice(0, maxLen) + '\n... (diff truncated)'
    : diff;

  const commitPrompt = `Generate a concise commit message for this diff. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.\n\n${truncatedDiff}`;

  const env = spawnEnv();

  if (aiProvider === 'gemini') {
    try {
      const geminiWs = getOrCreate(effectiveCwd);
      geminiWs.gemini.cwd = effectiveCwd;
      await ensureGeminiTransport(mainWin!, geminiWs);
      const sessionId = await ensureGeminiCommitSession(mainWin!, geminiWs);
      const result = await promptGeminiText(mainWin!, geminiWs, {
        sessionId,
        scope: 'commit',
        prompt: commitPrompt,
        approvalMode: 'plan',
        model: 'gemini-2.5-flash',
      });
      return result.trim();
    } catch {
      return '';
    }
  }

  // Spawn the appropriate CLI with its fast model
  let cmd: string;
  let args: string[];
  if (aiProvider === 'codex') {
    cmd = 'codex';
    args = ['exec', '-q', '--json', '-m', 'codex-mini', commitPrompt];
  } else {
    cmd = 'claude';
    args = ['-p', commitPrompt, '--output-format', 'text', '--max-turns', '1', '--model', 'haiku'];
  }

  return new Promise<string>((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: effectiveCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WIN,
    });
    proc.stdin?.end();

    let output = '';
    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('exit', () => {
      let result = output.trim();
      if (aiProvider === 'codex') result = extractCodexCommitMessage(result);
      resolve(result);
    });
    proc.on('error', () => resolve(''));
  });
}

export async function generateTitleImpl(cwd: string, userMessage: string, aiProvider?: string): Promise<string> {
  const ws = get(cwd);
  const effectiveCwd = cwd || (ws && getClaude(ws).cwd) || process.env.HOME || '/';

  const titlePrompt = `Summarize this conversation in 3-5 words as a title. Respond with only the title, no quotes or punctuation. User said: ${userMessage.slice(0, 500)}`;

  const env = spawnEnv();

  let cmd: string;
  let args: string[];
  if (aiProvider === 'codex') {
    cmd = 'codex';
    args = ['exec', '-q', '--json', '-m', 'codex-mini', titlePrompt];
  } else if (aiProvider === 'gemini') {
    cmd = 'gemini';
    args = ['-p', titlePrompt, '--output-format', 'text', '-m', 'flash'];
  } else {
    cmd = 'claude';
    args = ['-p', titlePrompt, '--output-format', 'text', '--max-turns', '1', '--model', 'haiku'];
  }

  return new Promise<string>((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: effectiveCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WIN,
    });
    proc.stdin?.end();

    let output = '';
    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('exit', () => {
      let result = output.trim();
      if (aiProvider === 'codex') result = extractCodexCommitMessage(result);
      // Clean up: remove quotes, trailing punctuation
      result = result.replace(/^["']|["']$/g, '').trim();
      resolve(result || '');
    });
    proc.on('error', () => resolve(''));
  });
}

export function registerClaudeHandlers(win: BrowserWindow) {
  mainWin = win;
  // claude:models — which models this account/org can actually use (org allow-lists
  // and 1M gating vary), derived from the CLI cache rather than hardcoded.
  ipcMain.handle('claude:models', () => getClaudeBackend().getModels());
  // claude:start — no longer spawns a probe. Just signals ready.
  // Sends cached slash commands immediately so they're available before the process init.
  ipcMain.handle('claude:start', (_event, projectPath: string, scope?: string, kind?: 'chat' | 'task' | 'orchestrator', orchestratorContext?: Partial<OrchestratorPromptContext> | null, scopeCwd?: string, metaPreamble?: string) =>
    getClaudeBackend().start({ projectPath, scope, kind, orchestratorContext: orchestratorContext as Record<string, unknown> | null, scopeCwd, metaPreamble })
  );

  // claude:stop — kill the persistent process for a scope
  ipcMain.on('claude:stop', (_event, projectPath: string, scope?: string) => {
    getClaudeBackend().interrupt(projectPath, scope);
  });

  // claude:setSessionId — switch to a different Claude session (for history resumption)
  ipcMain.on('claude:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope?: string) => {
    getClaudeBackend().setSessionId(projectPath, sessionId, scope);
  });

  // claude:send — write message to persistent process stdin
  ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) =>
    getClaudeBackend().send({ projectPath, message, imagePaths, permMode, effort, model, scope })
  );

  // claude:compact — silently write /compact to stdin without starting a turn.
  ipcMain.on('claude:compact', (_event, projectPath: string, permMode?: string, effort?: string, model?: string, scope?: string) =>
    getClaudeBackend().compact({ projectPath, permMode, effort, model, scope })
  );

  // claude:approve — user approved or denied a tool that was denied by the CLI
  ipcMain.handle('claude:approve', (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope?: string) =>
    getClaudeBackend().approve({ projectPath, toolUseId, approved, modifiedCommand, scope })
  );

  // claude:answer-question — user answered an AskUserQuestion tool call in the UI.
  // We send the user's answers back to the CLI as a follow-up user message so the
  // agent receives the real answer (the CLI's auto-generated headless placeholder
  // tool_result still passes through, but this corrective message is authoritative).
  // We also emit `question_answered` so the renderer can paint the answered state
  // by merging answers into the tool call's input JSON.
  ipcMain.handle('claude:answer-question', (_event, projectPath: string, toolUseId: string, answers: Record<string, string | string[]>, scope?: string) =>
    getClaudeBackend().answerQuestion({ projectPath, toolUseId, answers, scope })
  );

  // claude:answer-plan-review — user approved or rejected an ExitPlanMode tool call.
  // Same pattern as answer-question: send the decision as a follow-up user message.
  ipcMain.handle('claude:answer-plan-review', (_event, projectPath: string, toolUseId: string, approved: boolean, scope?: string) =>
    getClaudeBackend().answerPlanReview({ projectPath, toolUseId, approved, scope })
  );

  // claude:alwaysAllow — add a tool pattern to the project's .claude/settings.local.json
  ipcMain.handle('claude:alwaysAllow', (_event, projectPath: string, toolPattern: string) =>
    getClaudeBackend().alwaysAllow(projectPath, toolPattern)
  );

  // claude:generateCommitMessage — always one-shot to avoid context token costs
  // Uses each AI provider's fast/cheap model for generation.
  ipcMain.handle('claude:generateCommitMessage', (_event, cwd: string, aiProvider?: string) =>
    getClaudeBackend().generateCommitMessage(cwd, aiProvider)
  );

  // claude:generateTitle — one-shot lightweight title generation for chat sessions
  // Always uses the cheapest/fastest model per provider.
  ipcMain.handle('claude:generateTitle', (_event, cwd: string, userMessage: string, aiProvider?: string) =>
    getClaudeBackend().generateTitle(cwd, userMessage, aiProvider)
  );

  // Idle-scope sweep: stop Claude scopes that have been inactive for >30 min
  if (idleSweepTimer) clearInterval(idleSweepTimer);
  idleSweepTimer = setInterval(() => {
    const records: { workspaceId: string; scope: string; lastActivityAt: number; streaming: boolean; awaitingInput: boolean }[] = [];
    for (const ws of listAllWorkspaces()) {
      for (const [scope, claude] of ws.claudeScopes.entries()) {
        records.push({
          workspaceId: ws.projectPath,
          scope,
          lastActivityAt: claude.lastActivityAt,
          streaming: claude.streaming,
          // A scope waiting on the user (question/approval/plan review) must not
          // be swept — interrupting it kills the process that the answer is
          // injected into, leaving the prompt permanently unanswerable.
          awaitingInput: claude.awaitingQuestionAnswer || claude.awaitingApproval || claude.awaitingPlanReview,
        });
      }
    }
    sweepIdleScopes({
      now: Date.now(),
      idleMs: IDLE_SCOPE_MS,
      scopes: records,
      stop: (workspaceId, scope) => {
        const ws = get(workspaceId);
        if (ws) {
          emitChatMessage({
            type: 'scope_suspended',
            projectPath: ws.projectPath,
            scope,
          });
        }
        interruptImpl(workspaceId, scope);
      },
    });
  }, SWEEP_INTERVAL_MS);
  idleSweepTimer.unref?.();
}

export function destroyClaude() {
  // Subprocess teardown is handled by workspace.destroyAll; this clears the
  // module-level sweep timer so it can't fire against a destroyed window.
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
  // Tear down the active backend (e.g. SdkBackend closes all live queries).
  // Call-time-only import avoids a circular-reference problem at module load.
  getClaudeBackend().destroy?.();
}
