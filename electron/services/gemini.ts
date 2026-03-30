import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getOrCreate, get, touchActivity } from './workspace';

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

/** Hardcoded model list — Gemini CLI has no programmatic model enumeration */
const GEMINI_MODELS: { id: string; name: string }[] = [
  { id: 'auto-gemini-3', name: 'Auto (Gemini 3)' },
  { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
];

const GEMINI_DEFAULT_MODEL = 'auto-gemini-3';

/**
 * Translate a Gemini stream-json event into one or more claude:message events.
 */
function translateEvent(msg: any, projectPath: string): any[] {
  const events: any[] = [];

  switch (msg.type) {
    case 'init':
      // Session metadata — emit streaming_start
      events.push({ type: 'streaming_start', projectPath });
      break;

    case 'message': {
      // Skip user message echoes
      if (msg.role === 'user') break;
      if (msg.role === 'assistant' && msg.content) {
        // msg.content can be a string or an object/array — ensure we emit a string
        const text = typeof msg.content === 'string'
          ? msg.content
          : typeof msg.content === 'object' && msg.content !== null
            ? (msg.content.text || JSON.stringify(msg.content))
            : String(msg.content);
        events.push({
          type: 'assistant',
          projectPath,
          message: {
            content: [{ type: 'text', text }],
          },
        });
      }
      break;
    }

    case 'tool_use': {
      const name = msg.tool_name || msg.name || msg.tool || 'unknown';
      const input = msg.parameters || msg.arguments || msg.input || {};
      events.push({
        type: 'assistant',
        projectPath,
        message: {
          content: [{
            type: 'tool_use',
            name,
            input,
          }],
        },
      });
      break;
    }

    case 'tool_result':
      // Ignored — result shown via tool_use card
      break;

    case 'result': {
      const stats = msg.stats;
      if (msg.status === 'error' || msg.error) {
        const err = msg.error;
        const errText = typeof err === 'string' ? err
          : typeof err === 'object' && err !== null ? (err.message || JSON.stringify(err))
          : msg.message || 'Gemini error';
        events.push({
          type: 'error',
          projectPath,
          text: errText,
        });
      } else if (stats) {
        events.push({
          type: 'result',
          projectPath,
          usage: {
            input_tokens: stats.input_tokens || 0,
            cache_read_input_tokens: stats.cached || 0,
            cache_creation_input_tokens: 0,
            output_tokens: stats.output_tokens || 0,
          },
        });
      }
      events.push({ type: 'done', projectPath });
      break;
    }

    case 'error': {
      const errMsg = typeof msg.message === 'string' ? msg.message
        : typeof msg.error === 'string' ? msg.error
        : typeof msg.error === 'object' && msg.error?.message ? msg.error.message
        : 'Gemini error';
      events.push({
        type: 'error',
        projectPath,
        text: errMsg,
      });
      events.push({ type: 'done', projectPath });
      break;
    }

    default:
      break;
  }

  return events;
}

export function registerGeminiHandlers(win: BrowserWindow) {
  ipcMain.handle('gemini:models', () => ({
    models: GEMINI_MODELS,
    defaultModel: GEMINI_DEFAULT_MODEL,
  }));

  ipcMain.handle('gemini:start', (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.gemini.cwd = cwd;
    safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
  });

  ipcMain.on('gemini:stop', (_event, projectPath: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    if (ws.gemini.process) {
      const proc = ws.gemini.process;
      ws.gemini.process = null;
      ws.gemini.busy = false;
      proc.kill();
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    }
  });

  ipcMain.on('gemini:send', (_event, projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string) => {
    const ws = get(projectPath);
    if (!ws) return;
    touchActivity(projectPath);

    // Kill previous gemini process if still running
    if (ws.gemini.process) {
      ws.gemini.process.kill();
      ws.gemini.process = null;
    }

    let prompt = message;
    if (imagePaths && imagePaths.length > 0) {
      const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
      prompt = `${imageRefs}\n\n${message}`;
    }

    const args = ['-p', prompt, '--output-format', 'stream-json'];

    // Conversation mode: 'fast' overrides model to flash
    const effectiveModel = conversationMode === 'fast' ? 'flash' : (model || GEMINI_DEFAULT_MODEL);
    args.push('-m', effectiveModel);

    // Approval mode
    if (approvalMode && approvalMode !== 'default') {
      args.push('--approval-mode', approvalMode);
    }

    const proc = spawn('gemini', args, {
      cwd: ws.gemini.cwd || projectPath,
      env: getEnrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ws.gemini.process = proc;
    ws.gemini.busy = true;
    ws.gemini.buffer = '';

    safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

    proc.stdout?.on('data', (data: Buffer) => {
      if (ws.gemini.process !== proc) return;

      ws.gemini.buffer += data.toString();
      const lines = ws.gemini.buffer.split('\n');
      ws.gemini.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
          // Mark not busy on result
          if (msg.type === 'result') {
            ws.gemini.busy = false;
            if (!win.isFocused()) win.flashFrame(true);
          }
        } catch { /* malformed JSON */ }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (ws.gemini.process !== proc) return;
      const text = data.toString().trim();
      // Gemini CLI prints "Loaded cached credentials." to stderr — skip it
      if (text && !text.startsWith('Loaded cached credentials')) {
        safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
      }
    });

    proc.on('exit', () => {
      if (ws.gemini.process !== proc) return;
      // Flush remaining buffer
      if (ws.gemini.buffer.trim()) {
        try {
          const msg = JSON.parse(ws.gemini.buffer);
          const events = translateEvent(msg, ws.projectPath);
          for (const ev of events) {
            safeSend(win, 'claude:message', ev);
          }
        } catch { /* ignore */ }
      }
      ws.gemini.buffer = '';
      ws.gemini.process = null;
      ws.gemini.busy = false;
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });

    proc.on('error', (err) => {
      if (ws.gemini.process !== proc) return;
      ws.gemini.process = null;
      ws.gemini.busy = false;
      safeSend(win, 'claude:message', {
        type: 'error', text: `Gemini process error: ${err.message}`, projectPath: ws.projectPath,
      });
      safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
    });
  });
}
