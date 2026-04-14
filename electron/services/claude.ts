import { spawn, ChildProcess, execFile } from 'node:child_process';
import { BrowserWindow, ipcMain, app } from 'electron';
import { getOrCreate, get, getClaude, touchActivity } from './workspace';
import type { PendingToolUse } from './workspace';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { notifyCompletion, notifyApproval } from './notify';
import { extractCodexCommitMessage } from './commit-message-parser';
import { ensureGeminiCommitSession, ensureGeminiTransport, promptGeminiText } from './gemini';

const SLASH_COMMANDS_CACHE = path.join(app.getPath('userData'), 'slash-commands-cache.json');

/**
 * Cached shell environment captured from the user's login shell.
 * Populated once at module load so MCP servers, npx, uvx, etc. are on PATH.
 */
let cachedShellEnv: NodeJS.ProcessEnv | null = null;

/**
 * Spawn the user's login shell, run `env`, and parse the full environment.
 * Falls back gracefully if the shell hangs or fails.
 */
function captureShellEnv(): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve) => {
    const fallback = () => resolve(heuristicEnv());

    let proc: ReturnType<typeof spawn>;
    try {
      const userShell = process.env.SHELL || '/bin/zsh';
      proc = spawn(userShell, ['-ilc', 'env'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TERM: 'dumb' },
        timeout: 5000,
      });
      if (!proc || !proc.on) { fallback(); return; }
    } catch {
      fallback();
      return;
    }

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });

    proc.on('error', fallback);
    proc.on('exit', () => {
      if (!output.trim()) { fallback(); return; }
      const env: Record<string, string> = {};
      let currentKey = '';
      let currentVal = '';
      for (const line of output.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, eqIdx))) {
          // Flush previous key
          if (currentKey) env[currentKey] = currentVal;
          currentKey = line.slice(0, eqIdx);
          currentVal = line.slice(eqIdx + 1);
        } else if (currentKey) {
          // Continuation of a multi-line value
          currentVal += '\n' + line;
        }
      }
      if (currentKey) env[currentKey] = currentVal;

      // Remove shell-specific vars that should not be inherited
      for (const k of ['SHLVL', '_', 'PWD', 'OLDPWD']) delete env[k];

      if (env.PATH) {
        cachedShellEnv = env;
        resolve(env);
      } else {
        fallback();
      }
    });

    // Safety timeout in case the shell hangs
    setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
  });
}

/**
 * Heuristic fallback: prepend common tool paths to PATH.
 * Used when shell env capture fails.
 */
function heuristicEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = require('node:os').homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try { for (const v of fs.readdirSync(nvmDir)) extraPaths.push(path.join(nvmDir, v, 'bin')); } catch {}
  }
  extraPaths.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );
  env.PATH = [...extraPaths, env.PATH || ''].join(':');
  return env;
}

// Kick off shell env capture at module load time.
// By the time a user interacts, this will almost certainly have completed.
captureShellEnv();

/**
 * Return the best available environment for spawning CLI processes.
 * Prefers the captured shell env; falls back to heuristic.
 */
function enrichedEnv(): NodeJS.ProcessEnv {
  if (cachedShellEnv) {
    return { ...cachedShellEnv };
  }
  return heuristicEnv();
}

function readCachedSlashCommands(): string[] {
  try {
    return JSON.parse(fs.readFileSync(SLASH_COMMANDS_CACHE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeCachedSlashCommands(commands: string[]) {
  try {
    fs.writeFileSync(SLASH_COMMANDS_CACHE, JSON.stringify(commands));
  } catch { /* ignore write errors */ }
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch {
    // Window already destroyed
  }
}

/**
 * Read a setting from SAI's settings.json.
 */
function readSaiSetting(key: string): any {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    return settings[key];
  } catch {
    return undefined;
  }
}

/**
 * Build CLI args for the persistent process based on current config.
 */
function buildArgs(permMode?: string, effort?: string, model?: string): string[] {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (permMode === 'bypass') {
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

  // Pass through MCP config path(s) from SAI settings
  const mcpConfig = readSaiSetting('mcpConfigPath');
  if (mcpConfig) {
    const paths = Array.isArray(mcpConfig) ? mcpConfig : [mcpConfig];
    for (const p of paths) {
      if (typeof p === 'string' && p.trim()) {
        args.push('--mcp-config', p.trim());
      }
    }
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
  const currentConfig = { permMode: permMode || 'default', effort: effort || '', model: model || '' };

  // If process exists and config hasn't changed, reuse it
  if (claude.process && claude.processConfig &&
      claude.processConfig.permMode === currentConfig.permMode &&
      claude.processConfig.effort === currentConfig.effort &&
      claude.processConfig.model === currentConfig.model) {
    return claude.process;
  }

  // Config changed or no process — kill old one and spawn fresh
  if (claude.process) {
    claude.process.kill();
    claude.process = null;
  }

  const args = buildArgs(permMode, effort, model);

  // Resume existing session if we have one
  if (claude.sessionId) {
    args.push('--resume', claude.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd: claude.cwd || projectPath,
    env: enrichedEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
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
      try {
        const msg = JSON.parse(line);
        // Capture session ID and forward to renderer
        if (msg.session_id && !claude.sessionId) {
          claude.sessionId = msg.session_id;
          safeSend(win, 'claude:message', { type: 'session_id', sessionId: msg.session_id, projectPath: ws.projectPath, scope });
        }

        // Capture slash commands from init (replaces the probe)
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (msg.slash_commands) {
            writeCachedSlashCommands(msg.slash_commands);
          }
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath, scope });
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

        // --- Track the latest tool_use from assistant messages ---
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_use') {
              claude.pendingToolUse = {
                toolName: block.name,
                toolUseId: block.id,
                input: block.input || {},
              };
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
            const command = tu.input.command || tu.input.file_path || JSON.stringify(tu.input);
            const description = tu.input.description || '';
            safeSend(win, 'claude:message', {
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
          claude.busy = false;
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath, scope });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
          if (wasBusy) setTimeout(() => notifyCompletion(win, ws.projectPath, {
            provider: 'Claude',
            duration: msg.duration_ms,
            turns: msg.num_turns,
            cost: msg.total_cost_usd,
            summary: msg.result,
          }), 500);
          continue;
        }

        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath, scope });
      } catch {
        if (line.includes('"type":"result"') || line.includes('"type": "result"')) {
          claude.busy = false;
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
        }
      }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (claude.process !== proc) return;
    const text = data.toString().trim();
    if (text) {
      safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath, scope });
    }
  });

  proc.on('exit', (code, signal) => {
    if (claude.process !== proc) return;

    if (claude.buffer.trim()) {
      try {
        const msg = JSON.parse(claude.buffer);
        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath, scope });
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
    if (wasBusy) {
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
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
    safeSend(win, 'claude:message', {
      type: 'error', text: `Claude process error: ${err.message}`, projectPath: ws.projectPath, scope
    });
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
  });

  return proc;
}

export function registerClaudeHandlers(win: BrowserWindow) {
  // claude:start — no longer spawns a probe. Just signals ready.
  // Sends cached slash commands immediately so they're available before the process init.
  ipcMain.handle('claude:start', (_event, cwd: string, scope?: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    const claude = getClaude(ws, scope || 'chat');
    claude.cwd = cwd;

    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath, scope: scope || 'chat' });

    return { slashCommands: readCachedSlashCommands() };
  });

  // claude:stop — kill the persistent process for a scope
  ipcMain.on('claude:stop', (_event, projectPath: string, scope?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    const claude = getClaude(ws, scope || 'chat');
    if (claude.process) {
      const proc = claude.process;
      claude.process = null;
      claude.processConfig = null;
      claude.busy = false;
      claude.suppressForward = false;
      claude.pendingToolUse = null;
      claude.approvalBuffered = [];
      claude.awaitingApproval = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: scope || 'chat', turnSeq: claude.turnSeq });
    }
  });

  // claude:setSessionId — switch to a different Claude session (for history resumption)
  ipcMain.on('claude:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    const claude = getClaude(ws, scope || 'chat');
    if (claude.process) {
      claude.process.kill();
      claude.process = null;
      claude.processConfig = null;
    }
    claude.sessionId = sessionId;
  });

  // claude:send — write message to persistent process stdin
  ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    const effectiveScope = scope || 'chat';
    const claude = getClaude(ws, effectiveScope);

    touchActivity(projectPath);

    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    const proc = ensureProcess(win, projectPath, effectiveScope, permMode, effort, model);

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
          claude.busy = false;
          safeSend(win, 'claude:message', { ...stale, projectPath: ws.projectPath, scope: effectiveScope });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
        }
      } catch { /* partial/malformed — discard */ }
      claude.buffer = '';
    }

    if (claude.busy) {
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
    }

    claude.turnSeq++;
    claude.busy = true;
    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });

    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
    if (!proc.stdin || proc.stdin.destroyed) {
      claude.busy = false;
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
      return;
    }
    proc.stdin.write(msg + '\n');
  });

  // claude:compact — silently write /compact to stdin without starting a turn.
  ipcMain.on('claude:compact', (_event, projectPath: string, permMode?: string, effort?: string, model?: string, scope?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    const effectiveScope = scope || 'chat';
    const claude = getClaude(ws, effectiveScope);
    touchActivity(projectPath);
    const proc = ensureProcess(win, projectPath, effectiveScope, permMode, effort, model);
    claude.suppressForward = true;
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: '/compact' } });
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(msg + '\n');
    } else {
      claude.suppressForward = false;
    }
  });

  // claude:approve — user approved or denied a tool that was denied by the CLI
  ipcMain.handle('claude:approve', async (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope?: string) => {
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
        safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });
        return true;
      } catch (error: any) {
        if (ws.gemini) ws.gemini.pendingApproval = null;
        safeSend(win, 'claude:message', {
          type: 'error',
          text: `Gemini approval failed: ${error?.message || 'Unknown error'}`,
          projectPath: ws.projectPath,
          scope: effectiveScope,
        });
        safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: ws.gemini?.turnSeq });
        return false;
      }
    }

    const claude = getClaude(ws, effectiveScope);
    if (!claude.pendingToolUse || !claude.awaitingApproval) return;

    // --- Deny path ---
    if (!approved) {
      for (const buffered of claude.approvalBuffered) {
        if (buffered.type === 'result') {
          claude.busy = false;
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
        } else {
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
        }
      }
      claude.approvalBuffered = [];
      claude.awaitingApproval = false;
      claude.pendingToolUse = null;
      safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });
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
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
      if (!settings.permissions) settings.permissions = {};
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
      if (!settings.permissions.allow.includes(pending.toolName)) {
        settings.permissions.allow.push(pending.toolName);
        try { fs.mkdirSync(claudeDir, { recursive: true }); } catch {}
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      // Flush any buffered messages to the renderer
      for (const buffered of claude.approvalBuffered) {
        if (buffered.type === 'result') {
          claude.busy = false;
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
        } else {
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath, scope: effectiveScope });
        }
      }

      claude.approvalBuffered = [];
      claude.awaitingApproval = false;
      claude.pendingToolUse = null;
      safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });

      // Tell the CLI to retry — the permission is now in the allow list
      const proc = claude.process;
      if (proc?.stdin && !proc.stdin.destroyed) {
        claude.turnSeq++;
        claude.busy = true;
        safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath, scope: effectiveScope, turnSeq: claude.turnSeq });
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

    try {
      if (pending.toolName === 'Bash' || pending.toolName === 'bash') {
        // Use modified command if user edited it, otherwise use original
        const command = modifiedCommand || pending.input.command || '';
        const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execFile('bash', ['-c', command], {
            cwd,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: enrichedEnv(),
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
          result = fs.readFileSync(filePath, 'utf-8');
        }
      }
    } catch (err: any) {
      result = err.message || 'Command execution failed';
      isError = true;
    }

    // Send the real tool result to the renderer as if the CLI produced it
    safeSend(win, 'claude:message', {
      type: 'user',
      projectPath: ws.projectPath,
      scope: effectiveScope,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: pending.toolUseId,
          content: result,
          is_error: isError,
        }],
      },
    });

    claude.approvalBuffered = [];
    claude.awaitingApproval = false;
    claude.pendingToolUse = null;
    safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath, scope: effectiveScope });

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
  });

  // claude:alwaysAllow — add a tool pattern to the project's .claude/settings.local.json
  ipcMain.handle('claude:alwaysAllow', async (_event, projectPath: string, toolPattern: string) => {
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
  });

  // claude:generateCommitMessage — always one-shot to avoid context token costs
  // Uses each AI provider's fast/cheap model for generation.
  ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string, aiProvider?: string) => {
    const ws = get(cwd);
    const effectiveCwd = cwd || ws?.claude.cwd || process.env.HOME || '/';

    // Get the diff
    const getDiff = (args: string[]) => new Promise<string>((resolve) => {
      const diffProc = spawn('git', ['diff', ...args], {
        cwd: effectiveCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
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

    const env = enrichedEnv();

    if (aiProvider === 'gemini') {
      try {
        const geminiWs = getOrCreate(effectiveCwd);
        geminiWs.gemini.cwd = effectiveCwd;
        await ensureGeminiTransport(win, geminiWs);
        const sessionId = await ensureGeminiCommitSession(win, geminiWs);
        const result = await promptGeminiText(win, geminiWs, {
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
  });

  // claude:generateTitle — one-shot lightweight title generation for chat sessions
  // Always uses the cheapest/fastest model per provider.
  ipcMain.handle('claude:generateTitle', async (_event, cwd: string, userMessage: string, aiProvider?: string) => {
    const ws = get(cwd);
    const effectiveCwd = cwd || ws?.claude.cwd || process.env.HOME || '/';

    const titlePrompt = `Summarize this conversation in 3-5 words as a title. Respond with only the title, no quotes or punctuation. User said: ${userMessage.slice(0, 500)}`;

    const env = enrichedEnv();

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
  });
}

export function destroyClaude() {
  // Handled by workspace.destroyAll
}
