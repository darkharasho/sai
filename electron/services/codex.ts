import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getOrCreate, get, touchActivity } from './workspace';
import { notifyCompletion } from './notify';

/**
 * Build an enriched PATH that includes common locations for nvm/fnm/volta-installed binaries.
 * Electron apps launched from desktop entries don't inherit the user's shell PATH.
 */
function getEnrichedEnv(): Record<string, string> {
  const env = { ...process.env };
  const home = os.homedir();
  const extraPaths: string[] = [];

  // nvm: scan all installed versions
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions) {
        extraPaths.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* ignore */ }
  }

  // Common global bin locations
  extraPaths.push(
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
  );

  const currentPath = env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const additions = extraPaths.filter(p => !pathSet.has(p));
  if (additions.length > 0) {
    env.PATH = currentPath + ':' + additions.join(':');
  }
  return env;
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch { /* window destroyed */ }
}

/**
 * Translate a Codex exec --json event into one or more claude:message events.
 * This lets the frontend handle both providers with minimal differences.
 */
function translateEvent(msg: any, projectPath: string): any[] {
  const events: any[] = [];

  switch (msg.type) {
    case 'thread.started':
      // Don't emit anything — we handle ready separately
      break;

    case 'turn.started':
      events.push({ type: 'streaming_start', projectPath });
      break;

    case 'item.started': {
      const item = msg.item;
      if (item?.type === 'command_execution') {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{
              type: 'tool_use',
              name: 'Bash',
              input: { command: item.command || '' },
            }],
          },
        });
      } else if (item?.type === 'file_change') {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: item.file_path || item.path || '' },
            }],
          },
        });
      }
      break;
    }

    case 'item.completed': {
      const item = msg.item;
      if (item?.type === 'agent_message' && item?.text) {
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text: item.text }],
          },
        });
      } else if (item?.type === 'reasoning' && item?.text) {
        // Show reasoning as a system message
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text: item.text }],
          },
        });
      }
      break;
    }

    case 'turn.completed': {
      const usage = msg.usage;
      events.push({
        type: 'result',
        projectPath,
        ...(usage ? {
          usage: {
            input_tokens: usage.input_tokens || 0,
            cache_read_input_tokens: usage.cached_input_tokens || 0,
            cache_creation_input_tokens: 0,
            output_tokens: usage.output_tokens || 0,
          },
        } : {}),
      });
      events.push({ type: 'done', projectPath });
      break;
    }

    case 'turn.failed':
    case 'error':
      events.push({
        type: 'error',
        projectPath,
        text: msg.message || msg.error || 'Codex error',
      });
      events.push({ type: 'done', projectPath });
      break;

    default:
      break;
  }

  return events;
}

/** Cached model list — fetched once per app session */
let cachedModels: { models: { id: string; name: string }[]; defaultModel: string } | null = null;

/**
 * Fetch available models from the Codex app-server via JSON-RPC.
 * Spawns `codex app-server`, sends initialize + model/list, then kills the process.
 */
function fetchCodexModels(): Promise<{ models: { id: string; name: string }[]; defaultModel: string }> {
  if (cachedModels) return Promise.resolve(cachedModels);

  return new Promise((resolve) => {
    const env = getEnrichedEnv();
    const proc = spawn('codex', ['app-server'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    let resolved = false;
    const fallback = { models: [], defaultModel: '' };

    const finish = (result: typeof fallback) => {
      if (resolved) return;
      resolved = true;
      if (result.models.length > 0) cachedModels = result;
      try { proc.kill(); } catch { /* already dead */ }
      resolve(result);
    };

    const timeout = setTimeout(() => finish(fallback), 10000);

    proc.stdout?.on('data', (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 0 && !msg.error) {
            // Init succeeded — request model list
            proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'model/list', id: 1, params: {} }) + '\n');
          }
          if (msg.id === 1 && msg.result) {
            const data = msg.result.data || [];
            const models = data
              .filter((m: any) => !m.hidden)
              .map((m: any) => ({ id: m.model, name: m.displayName || m.model }));
            const defaultModel = data.find((m: any) => m.isDefault)?.model || models[0]?.id || '';
            clearTimeout(timeout);
            finish({ models, defaultModel });
          }
          if (msg.error) {
            clearTimeout(timeout);
            finish(fallback);
          }
        } catch { /* malformed JSON */ }
      }
    });

    proc.on('error', () => { clearTimeout(timeout); finish(fallback); });
    proc.on('exit', () => { clearTimeout(timeout); if (!resolved) finish(fallback); });

    // Send initialize
    proc.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'sai', version: '1.0' } },
    }) + '\n');
  });
}

export function registerCodexHandlers(win: BrowserWindow) {
  ipcMain.handle('codex:models', () => fetchCodexModels());

  ipcMain.handle('codex:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.codex.cwd = cwd;
    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
  });

  ipcMain.on('codex:stop', (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    if (ws.codex.process) {
      const proc = ws.codex.process;
      ws.codex.process = null;
      ws.codex.busy = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    }
  });

  ipcMain.on('codex:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    touchActivity(projectPath);

    // Kill previous codex process if still running
    if (ws.codex.process) {
      ws.codex.process.kill();
      ws.codex.process = null;
    }

    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    const args = ['exec', '--json'];

    if (model) {
      args.push('-m', model);
    }

    if (permMode === 'full-access') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (permMode === 'read-only') {
      args.push('--sandbox', 'read-only');
    } else {
      // 'auto' (default)
      args.push('--full-auto');
    }

    // Prompt goes last
    args.push(prompt);

    const proc = spawn('codex', args, {
      cwd: ws.codex.cwd || projectPath,
      env: getEnrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ws.codex.process = proc;
    ws.codex.busy = true;
    ws.codex.buffer = '';

    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

    proc.stdout?.on('data', (data: Buffer) => {
      if (ws.codex.process !== proc) return;

      ws.codex.buffer += data.toString();
      const lines = ws.codex.buffer.split('\n');
      ws.codex.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
          // Mark not busy on turn completion
          if (msg.type === 'turn.completed' || msg.type === 'turn.failed') {
            const wasBusy = ws.codex.busy;
            ws.codex.busy = false;
            if (wasBusy) notifyCompletion(win, ws.projectPath, {
              provider: 'Codex',
            });
          }
        } catch { /* malformed JSON */ }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (ws.codex.process !== proc) return;
      const text = data.toString().trim();
      if (text) {
        safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
      }
    });

    proc.on('exit', () => {
      if (ws.codex.process !== proc) return;
      // Flush remaining buffer
      if (ws.codex.buffer.trim()) {
        try {
          const msg = JSON.parse(ws.codex.buffer);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
        } catch { /* ignore */ }
      }
      ws.codex.buffer = '';
      ws.codex.process = null;
      ws.codex.busy = false;
      // Ensure the UI gets a done signal
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });

    proc.on('error', (err) => {
      if (ws.codex.process !== proc) return;
      ws.codex.process = null;
      ws.codex.busy = false;
      safeSend(win, 'claude:message', {
        type: 'error', text: `Codex process error: ${err.message}`, projectPath: ws.projectPath,
      });
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });
  });
}
