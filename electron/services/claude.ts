import { spawn, ChildProcess, execFile } from 'node:child_process';
import { BrowserWindow, ipcMain, app } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';
import type { PendingToolUse } from './workspace';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SLASH_COMMANDS_CACHE = path.join(app.getPath('userData'), 'slash-commands-cache.json');

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
    // Skip user-level settings (e.g. Bash(*) in ~/.claude/settings.json)
    // so SAI can gate approvals instead of the CLI auto-allowing
    args.push('--setting-sources', 'project');
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
  }

  const args = buildArgs(permMode, effort, model);

  // Resume existing session if we have one
  if (ws.claude.sessionId) {
    args.push('--resume', ws.claude.sessionId);
  }

  const proc = spawn('claude', args, {
    cwd: ws.claude.cwd || projectPath,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ws.claude.process = proc;
  ws.claude.processConfig = currentConfig;
  ws.claude.buffer = '';

  proc.stdout?.on('data', (data: Buffer) => {
    // Ignore if this process has been replaced
    if (ws.claude.process !== proc) return;

    ws.claude.buffer += data.toString();
    const lines = ws.claude.buffer.split('\n');
    ws.claude.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Capture session ID
        if (msg.session_id && !ws.claude.sessionId) {
          ws.claude.sessionId = msg.session_id;
        }

        // Capture slash commands from init (replaces the probe)
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (msg.slash_commands) {
            writeCachedSlashCommands(msg.slash_commands);
          }
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
        }

        // When suppressForward is true (commit msg generation), skip IPC
        if (ws.claude.suppressForward) continue;

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
          const denialBlock = content.find((block: any) =>
            block.type === 'tool_result' &&
            block.is_error === true &&
            typeof block.content === 'string' &&
            block.content.toLowerCase().includes('requires approval')
          );
          if (denialBlock && ws.claude.pendingToolUse) {
            // Intercept: don't forward this denial to the renderer
            ws.claude.awaitingApproval = true;
            ws.claude.approvalBuffered = [];
            safeSend(win, 'claude:message', {
              type: 'approval_needed',
              projectPath: ws.projectPath,
              toolName: ws.claude.pendingToolUse.toolName,
              toolUseId: ws.claude.pendingToolUse.toolUseId,
              input: ws.claude.pendingToolUse.input,
            });
            continue;
          }
        }

        // Result signals end of a turn
        if (msg.type === 'result') {
          ws.claude.busy = false;
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
          safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
          continue;
        }

        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch { /* ignore malformed JSON */ }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (ws.claude.process !== proc) return;
    const text = data.toString().trim();
    if (text) {
      safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
    }
  });

  proc.on('exit', () => {
    if (ws.claude.process !== proc) return;

    // Flush remaining buffer
    if (ws.claude.buffer.trim()) {
      try {
        const msg = JSON.parse(ws.claude.buffer);
        safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
      } catch { /* ignore */ }
    }
    ws.claude.buffer = '';
    ws.claude.process = null;
    ws.claude.processConfig = null;
    ws.claude.busy = false;
    ws.claude.suppressForward = false;
    ws.claude.pendingToolUse = null;
    ws.claude.approvalBuffered = [];
    ws.claude.awaitingApproval = false;
    // Signal unexpected exit so the UI can recover
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
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
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
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

    // Send cached slash commands so the UI has them instantly
    const cached = readCachedSlashCommands();
    if (cached.length > 0) {
      safeSend(win, 'claude:message', {
        type: 'system', subtype: 'init', slash_commands: cached, projectPath: ws.projectPath,
      });
    }

    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
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
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    }
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

    ws.claude.busy = true;
    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

    // Write the user message as NDJSON to stdin
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    });
    if (!proc.stdin || proc.stdin.destroyed) {
      ws.claude.busy = false;
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
      return;
    }
    proc.stdin.write(msg + '\n');
  });

  // claude:approve — user approved a tool that was denied by the CLI
  ipcMain.handle('claude:approve', async (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws || !ws.claude.pendingToolUse || !ws.claude.awaitingApproval) return;

    const pending = ws.claude.pendingToolUse;
    const cwd = ws.claude.cwd || projectPath;

    let result = '';
    let isError = false;

    try {
      if (pending.toolName === 'Bash' || pending.toolName === 'bash') {
        const command = pending.input.command || '';
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
      } else {
        // For non-bash tools, we can't execute them ourselves
        result = `Tool "${pending.toolName}" was approved but SAI can only execute Bash commands directly.`;
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
    ws.claude.pendingToolUse = null;

    // Send a follow-up message to the CLI so it knows the tool was actually executed
    const proc = ws.claude.process;
    if (proc?.stdin && !proc.stdin.destroyed) {
      const followUp = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: `The tool "${pending.toolName}" was approved and executed by the user. Here is the actual output:\n\n${result}\n\nPlease continue based on this result.`,
        },
      });
      proc.stdin.write(followUp + '\n');
    }

    return { result, isError };
  });

  // claude:deny — user denied a tool that needed approval
  ipcMain.handle('claude:deny', async (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws || !ws.claude.awaitingApproval) return;

    // Flush buffered messages to the renderer (the denial + model's response)
    for (const buffered of ws.claude.approvalBuffered) {
      if (buffered.type === 'result') {
        ws.claude.busy = false;
        safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath });
        safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
      } else {
        safeSend(win, 'claude:message', { ...buffered, projectPath: ws.projectPath });
      }
    }

    ws.claude.approvalBuffered = [];
    ws.claude.awaitingApproval = false;
    ws.claude.pendingToolUse = null;
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
  ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string) => {
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

    // Always use a one-shot process for commit messages to avoid paying
    // for the full conversation context as input tokens.
    return new Promise<string>((resolve) => {
      const proc = spawn('claude', [
        '-p', commitPrompt,
        '--output-format', 'text',
        '--max-turns', '1',
        '--model', 'haiku',
      ], {
        cwd: effectiveCwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.on('exit', () => resolve(output.trim()));
      proc.on('error', () => resolve(''));
    });
  });
}

export function destroyClaude() {
  // Handled by workspace.destroyAll
}
