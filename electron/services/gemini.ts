import { spawn, type ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';
import type { Workspace } from './workspace';
import { notifyCompletion } from './notify';
import { enrichedEnv } from './shellEnv';

/**
 * Compatibility module for the provider that used to be backed by Gemini CLI.
 *
 * Google retired the Gemini CLI ACP endpoint. Antigravity CLI (`agy`) replaces
 * it with a one-shot, NDJSON-capable print interface, so this deliberately does
 * not use the ACP transport shared by Kimi. The existing `gemini:*` IPC names
 * are retained temporarily to keep persisted sessions and older renderer builds
 * working; every spawned process is Antigravity.
 */
const COMMAND = 'agy';
const DISPLAY_NAME = 'Antigravity';

type StreamEvent = Record<string, any>;

function safeSend(win: BrowserWindow, message: unknown) {
  try {
    if (!win.isDestroyed()) win.webContents.send('claude:message', message);
  } catch {
    // The window may be closing while the child process exits.
  }
}

function scopeSession(ws: Workspace, scope: string): string | undefined {
  return scope === 'chat' ? ws.gemini.chatSessionId : ws.gemini.terminalSessions.get(scope);
}

function scopeCwd(ws: Workspace, scope: string): string {
  return scope === 'chat'
    ? (ws.gemini.cwd || ws.projectPath)
    : (ws.gemini.terminalCwds.get(scope) || ws.gemini.cwd || ws.projectPath);
}

function setScopeSession(ws: Workspace, scope: string, sessionId: string | undefined) {
  if (scope === 'chat') ws.gemini.chatSessionId = sessionId;
  else if (sessionId) ws.gemini.terminalSessions.set(scope, sessionId);
  else ws.gemini.terminalSessions.delete(scope);
}

function readText(event: StreamEvent): string {
  const candidates = [
    event.text,
    event.delta,
    typeof event.content === 'string' ? event.content : undefined,
    event.content?.text,
    event.step?.content?.text,
    event.step_update?.content?.text,
    event.result?.text,
    event.message?.content,
  ];
  return candidates.find((value): value is string => typeof value === 'string') || '';
}

function readConversationId(event: StreamEvent): string | undefined {
  const value = event.conversation_id || event.conversationId || event.session_id || event.sessionId
    || event.init?.conversation_id || event.init?.conversationId || event.result?.conversation_id || event.result?.conversationId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function emitToolEvent(win: BrowserWindow, projectPath: string, scope: string, event: StreamEvent) {
  const tool = event.tool_info || event.tool || event.step?.tool_info || event.step_update?.tool_info;
  if (!tool) return;
  const id = String(tool.id || tool.call_id || tool.callId || `${Date.now()}-${Math.random()}`);
  const name = String(tool.name || tool.tool_name || 'Tool');
  const input = tool.parameters || tool.input || {};
  safeSend(win, {
    type: 'assistant', projectPath, scope,
    message: { content: [{ id, type: 'tool_use', name, input }] },
  });
  if (tool.output !== undefined || tool.result !== undefined || tool.status === 'completed' || tool.status === 'failed') {
    safeSend(win, {
      type: 'user', projectPath, scope,
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: tool.output ?? tool.result ?? '', is_error: tool.status === 'failed' }] },
    });
  }
}

function agyArgs(prompt: string, options: { sessionId?: string; model?: string; approvalMode?: string; conversationMode?: string; imagePaths?: string[] }) {
  const args = ['--print', '--output-format', 'stream-json'];
  if (options.sessionId) args.push('--conversation', options.sessionId);
  // Ignore the retired Gemini defaults left in existing SAI profiles. Valid
  // Antigravity model slugs are obtained live through `agy models`.
  if (options.model && !/^auto-gemini-|^gemini-2\.5-/i.test(options.model)) args.push('--model', options.model);
  if (options.conversationMode === 'planning') {
    args.push('--mode', 'plan', '--effort', 'high');
  } else {
    args.push('--effort', 'low');
    if (options.approvalMode === 'auto_edit') args.push('--mode', 'accept-edits');
  }
  if (options.approvalMode === 'yolo') args.push('--dangerously-skip-permissions');
  // Print mode accepts paths in prompt text; keeping this explicit means image
  // attachment behavior remains useful without relying on undocumented flags.
  const attachments = (options.imagePaths || []).map(file => `\n[Attached image: ${file}]`).join('');
  args.push(`${prompt}${attachments}`);
  return args;
}

async function listModels(cwd: string): Promise<{ id: string; name: string }[]> {
  return new Promise(resolve => {
    const child = spawn(COMMAND, ['models'], { cwd, env: enrichedEnv(), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let output = '';
    child.stdout?.on('data', data => { output += data.toString(); });
    child.on('error', () => resolve([]));
    child.on('exit', () => {
      const models = output.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !/^fetching/i.test(line))
        .map(line => {
          try {
            const parsed = JSON.parse(line);
            const id = parsed.id || parsed.name || parsed.slug;
            return id ? { id: String(id), name: String(parsed.display_name || parsed.displayName || id) } : null;
          } catch {
            const id = line.split(/\s+/)[0];
            return id ? { id, name: line } : null;
          }
        })
        .filter((model): model is { id: string; name: string } => !!model);
      resolve(models);
    });
  });
}

export async function promptAntigravityText(
  win: BrowserWindow,
  ws: Workspace,
  options: { scope: string; prompt: string; imagePaths?: string[]; approvalMode?: string; conversationMode?: string; model?: string },
): Promise<string> {
  const scope = options.scope;
  const args = agyArgs(options.prompt, { ...options, sessionId: scopeSession(ws, scope) });
  return new Promise((resolve, reject) => {
    const child = spawn(COMMAND, args, {
      cwd: scopeCwd(ws, scope),
      env: enrichedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    ws.gemini.process = child;
    let stdout = '';
    let stderr = '';
    let text = '';
    let buffer = '';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (ws.gemini.process === child) ws.gemini.process = null;
      error ? reject(error) : resolve(text.trim());
    };
    const consume = (line: string) => {
      if (!line.trim()) return;
      let event: StreamEvent;
      try { event = JSON.parse(line); } catch { return; }
      const sessionId = readConversationId(event);
      if (sessionId && sessionId !== scopeSession(ws, scope)) {
        setScopeSession(ws, scope, sessionId);
        safeSend(win, { type: 'session_id', sessionId, projectPath: ws.projectPath, scope });
      }
      emitToolEvent(win, ws.projectPath, scope, event);
      const chunk = readText(event);
      if (chunk && event.type !== 'result') {
        text += chunk;
        safeSend(win, { type: 'assistant', projectPath: ws.projectPath, scope, message: { content: [{ type: 'text', text: chunk, delta: true }] } });
      } else if (chunk && event.type === 'result' && !text) {
        text = chunk;
      }
    };

    child.stdout?.on('data', data => {
      const chunk = data.toString();
      stdout += chunk;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(consume);
    });
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', error => finish(new Error(`Antigravity could not start: ${error.message}. Install it with: curl -fsSL https://antigravity.google/cli/install.sh | bash`)));
    child.on('exit', code => {
      if (buffer) consume(buffer);
      if (code === 0) finish();
      else finish(new Error((stderr || stdout || `Antigravity exited with status ${code}`).trim()));
    });
  });
}

export async function promptAntigravityOneShot(cwd: string, prompt: string, model?: string): Promise<string> {
  const ws = getOrCreate(cwd);
  ws.gemini.cwd = cwd;
  // BrowserWindow is only used for streaming IPC. Commit/title requests do not
  // need to render their internal turn, so a minimal no-op window is sufficient.
  return promptAntigravityText({ isDestroyed: () => true } as BrowserWindow, ws, { scope: 'commit', prompt, model, approvalMode: 'plan' });
}

export function registerGeminiHandlers(win: BrowserWindow) {
  ipcMain.handle('gemini:models', async (_event, cwd?: string) => {
    const models = await listModels(cwd || process.cwd());
    return { models, defaultModel: models[0]?.id || '' };
  });
  ipcMain.handle('gemini:start', async (_event, cwd: string, ...tail: unknown[]) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.gemini.cwd = cwd;
    // Two-argument calls are the old `start(cwd, metaPreamble)` bridge. The
    // unified provider bridge supplies scope/kind/context/scopeCwd/preamble.
    const legacy = tail.length <= 1;
    const scope = legacy ? 'chat' : (typeof tail[0] === 'string' ? tail[0] : 'chat');
    const scopeCwdValue = legacy ? undefined : tail[3];
    if (scope !== 'chat' && typeof scopeCwdValue === 'string' && scopeCwdValue) {
      ws.gemini.terminalCwds.set(scope, scopeCwdValue);
    }
    ws.gemini.metaPreamble = (legacy ? tail[0] : tail[4]) as string || '';
    ws.gemini.availability = 'available';
    safeSend(win, { type: 'ready', projectPath: cwd });
  });
  ipcMain.on('gemini:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope = 'chat') => {
    const ws = get(projectPath);
    if (ws) setScopeSession(ws, scope, sessionId);
  });
  ipcMain.on('gemini:stop', (_event, projectPath: string, scope = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const stoppedTurnSeq = ws.gemini.turnSeq;
    ws.gemini.process?.kill();
    ws.gemini.process = null;
    ws.gemini.busy = false;
    safeSend(win, { type: 'done', projectPath, scope, turnSeq: stoppedTurnSeq });
  });
  // Antigravity print mode cannot pause for an IPC approval round-trip. The
  // appropriate permission mode is selected before each launch instead.
  ipcMain.on('gemini:approve', () => undefined);
  ipcMain.on('gemini:send', async (_event, projectPath: string, message: string, imagePaths: string[] = [], approvalMode?: string, conversationMode?: string, model?: string, scope = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    touchActivity(projectPath);
    ws.gemini.turnSeq += 1;
    const turnSeq = ws.gemini.turnSeq;
    ws.gemini.busy = true;
    safeSend(win, { type: 'streaming_start', projectPath, scope, turnSeq, sessionId: scopeSession(ws, scope) });
    try {
      const preamble = ws.gemini.metaPreamble && !scopeSession(ws, scope) ? `${ws.gemini.metaPreamble}\n\n` : '';
      await promptAntigravityText(win, ws, { scope, prompt: `${preamble}${message}`, imagePaths, approvalMode, conversationMode, model });
      safeSend(win, { type: 'result', projectPath, scope, usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } });
      notifyCompletion(win, projectPath, { provider: DISPLAY_NAME });
    } catch (error) {
      safeSend(win, { type: 'error', projectPath, scope, text: error instanceof Error ? error.message : 'Antigravity request failed' });
    } finally {
      ws.gemini.busy = false;
      ws.gemini.process = null;
      safeSend(win, { type: 'done', projectPath, scope, turnSeq });
    }
  });
}
