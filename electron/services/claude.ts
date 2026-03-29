import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';

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
          safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
        }

        // When suppressForward is true (commit msg generation), skip IPC
        if (ws.claude.suppressForward) continue;

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
    // Signal unexpected exit so the UI can recover
    safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
  });

  return proc;
}

export function registerClaudeHandlers(win: BrowserWindow) {
  // claude:start — no longer spawns a probe. Just signals ready.
  ipcMain.handle('claude:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.claude.cwd = cwd;
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
    proc.stdin?.write(msg + '\n');
  });

  // claude:generateCommitMessage — route through persistent process or one-shot fallback
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

    // If persistent process exists and is idle, use it for caching benefits.
    // suppressForward prevents the main stdout handler from sending commit
    // message results to the renderer (which would pollute the chat UI).
    // Instead, the result is captured here via a temporary listener.
    if (ws?.claude.process && !ws.claude.busy) {
      return new Promise<string>((resolve) => {
        const proc = ws.claude.process!;
        let resolved = false;

        ws.claude.busy = true;
        ws.claude.suppressForward = true;

        const commitHandler = (data: Buffer) => {
          if (resolved) return;
          const text = data.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'result') {
                const commitResult = typeof msg.result === 'string' ? msg.result : '';
                ws.claude.busy = false;
                ws.claude.suppressForward = false;
                resolved = true;
                proc.stdout?.removeListener('data', commitHandler);
                resolve(commitResult.trim());
                return;
              }
            } catch { /* ignore */ }
          }
        };

        proc.stdout?.on('data', commitHandler);

        const msg = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: commitPrompt },
        });
        proc.stdin?.write(msg + '\n');

        // Timeout fallback — if no result in 30s, resolve empty
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            proc.stdout?.removeListener('data', commitHandler);
            ws.claude.busy = false;
            ws.claude.suppressForward = false;
            resolve('');
          }
        }, 30000);
      });
    }

    // Fallback: one-shot process (no persistent process available or it's busy)
    return new Promise<string>((resolve) => {
      const proc = spawn('claude', [
        '-p', commitPrompt,
        '--output-format', 'text',
        '--max-turns', '1',
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
