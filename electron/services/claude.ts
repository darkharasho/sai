import { spawn, ChildProcess, execFile } from 'node:child_process';
import { BrowserWindow, ipcMain, app } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';
import type { PendingToolUse } from './workspace';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { notifyCompletion, notifyApproval } from './notify';
import { extractCodexCommitMessage } from './commit-message-parser';

const SLASH_COMMANDS_CACHE = path.join(app.getPath('userData'), 'slash-commands-cache.json');

/**
 * Build an enriched PATH so CLI tools installed via nvm, volta, etc. are found
 * even when Electron doesn't inherit the user's interactive shell PATH.
 */
function enrichedEnv(): NodeJS.ProcessEnv {
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

  return args;
}

/**
 * Spawn (or respawn) the persistent Claude process for a workspace.
 * Attaches stdout/stderr handlers that route messages to the renderer.
 */
function ensureProcess(
  win: BrowserWindow,
  projectPath: string,
  permMode?: string,
  effort?: string,
  model?: string,
): ChildProcess {
  const ws = getOrCreate(projectPath);
  const currentConfig = { permMode: permMode || 'default', effort: effort || '', model: model || '' };

  // If process exists and config hasn't changed, reuse it
  if (ws.claude.process && ws.claude.processConfig &&
      ws.claude.processConfig.permMode === currentConfig.permMode &&
      ws.claude.processConfig.effort === currentConfig.effort &&
      ws.claude.processConfig.model === currentConfig.model) {
    return ws.claude.process;
  }

  // Config changed or no process — kill old one and spawn fresh
  if (ws.claude.process) {
    ws.claude.process.kill();
    ws.claude.process = null;
  } else {
  }

  const args = buildArgs(permMode, effort, model);

  // Resume existing session if we have one
  if (ws.claude.sessionId) {
    args.push('--resume', ws.claude.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd: ws.claude.cwd || projectPath,
    env: enrichedEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ws.claude.process = proc;
  ws.claude.processConfig = currentConfig;
  ws.claude.buffer = '';

  proc.stdout?.on('data', (data: Buffer) => {
    // Ignore if this process has been replaced
    if (ws.claude.process !== proc) {
      return;
    }

    ws.claude.buffer += data.toString();
    const lines = ws.claude.buffer.split('\n');
    ws.claude.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Capture session ID and forward to renderer
        if (msg.session_id && !ws.claude.sessionId) {
          ws.claude.sessionId = msg.session_id;
          safeSend(win, 'claude:message', { type: 'session_id', sessionId: msg.session_id, projectPath: ws.projectPath });
        }

        // Capture slash commands from init (replaces the probe)
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (msg.slash_commands) {
            writeCachedSlashCommands(msg.slash_commands);
          }
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
        }

        // When suppressForward is true (silent compact), skip IPC forwarding.
        // Allow system messages through (compact notification) but suppress everything else.
        // When a result arrives, the silent turn is done — clear the flag.
        if (ws.claude.suppressForward) {
          if (msg.type === 'result') {
            ws.claude.suppressForward = false;
          }
          if (msg.type !== 'system') continue;
          // Fall through to forward system messages (e.g. context_compacted)
        }

        // --- Approval flow: buffer messages while awaiting user decision ---
        if (ws.claude.awaitingApproval) {
          ws.claude.approvalBuffered.push(msg);
          // If we get a result while awaiting, the CLI turn is done (model responded to the denial).
          // We keep buffering — the approve/deny handler will flush or discard.
          continue;
        }

        // --- Track the latest tool_use from assistant messages ---
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
          for (const block of content) {
            if (block.type === 'tool_use') {
              ws.claude.pendingToolUse = {
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
            // CLI denial patterns: "requested permissions", "was blocked", "haven't granted"
            return lower.includes('requested permissions') ||
                   lower.includes('was blocked') ||
                   lower.includes("haven't granted");
          });
          if (denialBlock && ws.claude.pendingToolUse) {
            // Intercept: don't forward this denial to the renderer
            ws.claude.awaitingApproval = true;
            ws.claude.approvalBuffered = [];
            const tu = ws.claude.pendingToolUse;
            const command = tu.input.command || tu.input.file_path || JSON.stringify(tu.input);
            const description = tu.input.description || '';
            safeSend(win, 'claude:message', {
              type: 'approval_needed',
              projectPath: ws.projectPath,
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
          const wasBusy = ws.claude.busy;
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
          // Delay notification so renderer has time to process the result/done IPC
          if (wasBusy) setTimeout(() => notifyCompletion(win, ws.projectPath, {
            provider: 'Claude',
            duration: msg.duration_ms,
            turns: msg.num_turns,
            cost: msg.total_cost_usd,
            summary: msg.result,
          }), 500);
          continue;
        }

        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch {
        // If a malformed line looks like it contains a result, force-send done
        // so the UI doesn't get stuck in streaming state
        if (line.includes('"type":"result"') || line.includes('"type": "result"')) {
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
        }
      }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (ws.claude.process !== proc) return;
    const text = data.toString().trim();
    if (text) {
      safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
    }
  });

  proc.on('exit', (code, signal) => {
    if (ws.claude.process !== proc) return;

    // Flush remaining buffer
    if (ws.claude.buffer.trim()) {
      try {
        const msg = JSON.parse(ws.claude.buffer);
        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch { /* ignore */ }
    }
    const wasBusy = ws.claude.busy;
    ws.claude.buffer = '';
    ws.claude.process = null;
    ws.claude.processConfig = null;
    ws.claude.busy = false;
    ws.claude.suppressForward = false;
    ws.claude.pendingToolUse = null;
    ws.claude.approvalBuffered = [];
    ws.claude.awaitingApproval = false;
    // Only signal done if we were mid-turn — avoids spurious done when idle process crashes
    if (wasBusy) {
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
    }
  });

  proc.on('error', (err) => {
    if (ws.claude.process !== proc) return;
    ws.claude.process = null;
    ws.claude.processConfig = null;
    ws.claude.busy = false;
    ws.claude.suppressForward = false;
    ws.claude.pendingToolUse = null;
    ws.claude.approvalBuffered = [];
    ws.claude.awaitingApproval = false;
    safeSend(win, 'claude:message', {
      type: 'error', text: `Claude process error: ${err.message}`, projectPath: ws.projectPath
    });
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
  });

  return proc;
}

export function registerClaudeHandlers(win: BrowserWindow) {
  // claude:start — no longer spawns a probe. Just signals ready.
  // Sends cached slash commands immediately so they're available before the process init.
  ipcMain.handle('claude:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.claude.cwd = cwd;

    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });

    // Return cached slash commands directly so the renderer can use them
    // without relying on a separate IPC message that may arrive before the listener is ready
    return { slashCommands: readCachedSlashCommands() };
  });

  // claude:stop — kill the persistent process
  ipcMain.on('claude:stop', (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    if (ws.claude.process) {
      const proc = ws.claude.process;
      ws.claude.process = null;
      ws.claude.processConfig = null;
      ws.claude.busy = false;
      ws.claude.suppressForward = false;
      ws.claude.pendingToolUse = null;
      ws.claude.approvalBuffered = [];
      ws.claude.awaitingApproval = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
    }
  });

  // claude:setSessionId — switch to a different Claude session (for history resumption)
  ipcMain.on('claude:setSessionId', (_event, projectPath: string, sessionId: string | undefined) => {
    const ws = get(projectPath);
    if (!ws) return;
    // Kill existing process so next send respawns with --resume for the new session
    if (ws.claude.process) {
      ws.claude.process.kill();
      ws.claude.process = null;
      ws.claude.processConfig = null;
    }
    ws.claude.sessionId = sessionId;
  });

  // claude:send — write message to persistent process stdin
  ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;

    touchActivity(projectPath);

    // Build the prompt (same image handling as before)
    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    // Ensure persistent process is running with current config
    const proc = ensureProcess(win, projectPath, permMode, effort, model);

    // Clear suppressForward in case a silent compact is in progress — user-initiated
    // turns always take priority and need full message forwarding.
    ws.claude.suppressForward = false;

    // Clear stale approval state — if the frontend lost the approval dialog
    // (e.g. workspace switch unmounted ChatPanel), awaitingApproval would stay
    // true and silently buffer ALL subsequent messages, freezing the UI.
    if (ws.claude.awaitingApproval) {
      ws.claude.awaitingApproval = false;
      ws.claude.approvalBuffered = [];
      ws.claude.pendingToolUse = null;
    }

    // Flush any partial buffer from the previous turn so stale results
    // don't leak into the new turn and send a spurious 'done'.
    if (ws.claude.buffer.trim()) {
      try {
        const stale = JSON.parse(ws.claude.buffer);
        if (stale.type === 'result') {
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { ...stale, projectPath: ws.projectPath });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
        }
      } catch { /* partial/malformed — discard */ }
      ws.claude.buffer = '';
    }

    // If previous turn's done was lost (malformed JSON, CLI hiccup), clear stale state
    if (ws.claude.busy) {
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
    }

    // New turn — increment sequence so renderer can ignore stale 'done' messages
    ws.claude.turnSeq++;
    ws.claude.busy = true;
    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });

    // Write the user message as NDJSON to stdin
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
    if (!proc.stdin || proc.stdin.destroyed) {
      ws.claude.busy = false;
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
      return;
    }
    proc.stdin.write(msg + '\n');
  });

  // claude:compact — silently write /compact to stdin without starting a turn.
  // This prevents the UI from entering streaming state for background compaction.
  ipcMain.on('claude:compact', (_event, projectPath: string, permMode?: string, effort?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    touchActivity(projectPath);
    const proc = ensureProcess(win, projectPath, permMode, effort, model);
    ws.claude.suppressForward = true;
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: '/compact' } });
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(msg + '\n');
    } else {
      ws.claude.suppressForward = false;
    }
  });

  // claude:approve — user approved or denied a tool that was denied by the CLI
  ipcMain.handle('claude:approve', async (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string) => {
    const ws = get(projectPath);
    if (!ws || !ws.claude.pendingToolUse || !ws.claude.awaitingApproval) return;

    // --- Deny path ---
    if (!approved) {
      // Flush buffered messages to the renderer (the denial + model's response)
      for (const buffered of ws.claude.approvalBuffered) {
        if (buffered.type === 'result') {
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath, turnSeq: ws.claude.turnSeq });
        } else {
          safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath });
        }
      }
      ws.claude.approvalBuffered = [];
      ws.claude.awaitingApproval = false;
      ws.claude.pendingToolUse = null;
      safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath });
      return;
    }

    // --- Approve path ---
    const pending = ws.claude.pendingToolUse;
    const cwd = ws.claude.cwd || projectPath;

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
            env: { ...process.env },
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
      } else {
        result = `Tool "${pending.toolName}" was approved but SAI cannot execute it directly.`;
        isError = true;
      }
    } catch (err: any) {
      result = err.message || 'Command execution failed';
      isError = true;
    }

    // Send the real tool result to the renderer as if the CLI produced it
    safeSend(win, 'claude:message', {
      type: 'user',
      projectPath: ws.projectPath,
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

    // Discard buffered messages (model's response to the denial)
    ws.claude.approvalBuffered = [];
    ws.claude.awaitingApproval = false;
    // Keep busy = true — Claude will continue processing the follow-up
    ws.claude.pendingToolUse = null;
    safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath });

    // Send a compact follow-up to the CLI with the actual tool result
    const proc = ws.claude.process;
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

    // Spawn the appropriate CLI with its fast model
    let cmd: string;
    let args: string[];
    if (aiProvider === 'codex') {
      cmd = 'codex';
      args = ['exec', '-q', '--json', '-m', 'codex-mini', commitPrompt];
    } else if (aiProvider === 'gemini') {
      cmd = 'gemini';
      args = ['-p', commitPrompt, '--output-format', 'text', '-m', 'flash'];
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
}

export function destroyClaude() {
  // Handled by workspace.destroyAll
}
