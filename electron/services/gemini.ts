import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getOrCreate, get, touchActivity } from './workspace';
import type { Workspace } from './workspace';
import { notifyCompletion } from './notify';
import { createGeminiAcpClient } from './gemini-acp';

function getEnrichedEnv(): Record<string, string> {
  const env = { ...process.env };
  const home = os.homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');

  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir);
      for (const version of versions) {
        extraPaths.push(path.join(nvmDir, version, 'bin'));
      }
    } catch {
      // Ignore PATH enrichment failures.
    }
  }

  extraPaths.push(path.join(home, '.local', 'bin'), '/usr/local/bin');
  env.PATH = [...new Set([...(env.PATH || '').split(':'), ...extraPaths].filter(Boolean))].join(':');
  return env;
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch {
    // Window already destroyed.
  }
}

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
const GEMINI_BOOTSTRAP_FILES = ['README.md', 'package.json', 'GEMINI.md', 'CLAUDE.md', 'tsconfig.json'];

function readFileSnippet(filePath: string, maxChars: number): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars).trim();
  } catch {
    return null;
  }
}

function collectProjectPaths(rootPath: string, maxEntries: number, maxDepth: number): string[] {
  const results: string[] = [];

  function visit(currentPath: string, depth: number) {
    if (results.length >= maxEntries || depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue;

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath) || '.';
      results.push(entry.isDirectory() ? `${relativePath}/` : relativePath);

      if (entry.isDirectory()) {
        visit(absolutePath, depth + 1);
      }
    }
  }

  visit(rootPath, 0);
  return results;
}

function buildGeminiProjectBootstrap(rootPath: string): string {
  const topLevel = (() => {
    try {
      return fs.readdirSync(rootPath).sort().slice(0, 40).join('\n');
    } catch {
      return '';
    }
  })();

  const projectPaths = collectProjectPaths(rootPath, 120, 2).join('\n');
  const fileSnippets = GEMINI_BOOTSTRAP_FILES
    .map((name) => {
      const snippet = readFileSnippet(path.join(rootPath, name), 2000);
      if (!snippet) return null;
      return `## ${name}\n${snippet}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    'Project bootstrap context for this repository.',
    'Use it as orientation for future edits and suggestions.',
    'Do not answer this message or summarize it back.',
    '',
    `Repository root: ${rootPath}`,
    '',
    topLevel ? `Top-level entries:\n${topLevel}` : '',
    projectPaths ? `Shallow project map:\n${projectPaths}` : '',
    fileSnippets ? `Key file snippets:\n${fileSnippets}` : '',
  ].filter(Boolean).join('\n');
}

function getMimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function buildPromptItems(message: string, imagePaths?: string[], prefixText?: string) {
  const prompt: Array<Record<string, unknown>> = [];

  if (prefixText) {
    prompt.push({ type: 'text', text: prefixText });
  }

  prompt.push({ type: 'text', text: message });

  for (const imagePath of imagePaths || []) {
    const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(imagePath);
    const imageData = fs.readFileSync(absolutePath).toString('base64');
    prompt.push({
      type: 'image',
      mimeType: getMimeTypeForPath(absolutePath),
      data: imageData,
    });
  }

  return prompt;
}

function getScopeSessionId(ws: Workspace, scope: string): string | undefined {
  return scope === 'chat' ? ws.gemini.chatSessionId : ws.gemini.terminalSessions.get(scope);
}

function setScopeSessionId(ws: Workspace, scope: string, sessionId: string | undefined) {
  if (scope === 'chat') ws.gemini.chatSessionId = sessionId;
  else if (sessionId) ws.gemini.terminalSessions.set(scope, sessionId);
  else ws.gemini.terminalSessions.delete(scope);
}

function getApprovalCommand(input: Record<string, any>): string {
  return input.command || input.file_path || JSON.stringify(input);
}

function getScopeForEvent(ws: Workspace, msg: any): string {
  const explicitScope = msg?.params?.scope;
  if (typeof explicitScope === 'string' && explicitScope.length > 0) {
    return explicitScope;
  }

  const sessionId = msg?.params?.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    if (sessionId === ws.gemini.commitSessionId) return 'commit';
    if (sessionId === ws.gemini.chatSessionId) return 'chat';
    for (const [scope, terminalSessionId] of ws.gemini.terminalSessions.entries()) {
      if (terminalSessionId === sessionId) return scope;
    }
  }

  return 'chat';
}

function renderToolContent(content: any[] | undefined): string {
  if (!Array.isArray(content) || content.length === 0) return '';

  return content.map((item) => {
    if (item?.type === 'content' && item.content?.type === 'text') {
      return item.content.text || '';
    }
    if (item?.type === 'diff') {
      return JSON.stringify(item);
    }
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
}

function translateAcpEvent(msg: any, projectPath: string, scope: string): any | null {
  if (msg?.method === 'session/update') {
    const update = msg.params?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') {
      return {
        type: 'assistant',
        projectPath,
        scope,
        message: {
          content: [{
            type: 'text',
            text: update.content?.text || '',
            delta: true,
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call') {
      return {
        type: 'assistant',
        projectPath,
        scope,
        message: {
          content: [{
            id: update.toolCallId,
            type: 'tool_use',
            name: update.title || 'tool',
            input: {
              kind: update.kind,
              locations: update.locations,
            },
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call_update') {
      return {
        type: 'user',
        projectPath,
        scope,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: update.toolCallId,
            content: renderToolContent(update.content),
            is_error: update.status === 'failed',
          }],
        },
      };
    }

    return null;
  }

  if (msg?.method === 'message/assistant') {
    return {
      type: 'assistant',
      projectPath,
      scope,
      message: {
        content: [{
          type: 'text',
          text: msg.params?.text || '',
          delta: !!msg.params?.delta,
        }],
      },
    };
  }

  if (msg?.method === 'tool/call') {
    return {
      type: 'assistant',
      projectPath,
      scope,
      message: {
        content: [{
          id: msg.params?.id,
          type: 'tool_use',
          name: msg.params?.name || 'tool',
          input: msg.params?.input || {},
        }],
      },
    };
  }

  if (msg?.method === 'tool/result') {
    return {
      type: 'user',
      projectPath,
      scope,
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: msg.params?.id,
          content: msg.params?.output || '',
          is_error: !!msg.params?.isError,
        }],
      },
    };
  }

  return null;
}

function disableGemini(win: BrowserWindow, ws: Workspace, scope: string, reason: string) {
  ws.gemini.transport?.dispose();
  ws.gemini.transport = null;
  ws.gemini.loadedSessionIds.clear();
  ws.gemini.bootstrappedSessionIds.clear();
  ws.gemini.suppressedScopes.clear();
  ws.gemini.availability = 'disabled';
  ws.gemini.lastError = reason;
  ws.gemini.busy = false;
  ws.gemini.activeRequestId = undefined;
  ws.gemini.pendingApproval = null;
  safeSend(win, 'claude:message', {
    type: 'error',
    projectPath: ws.projectPath,
    scope,
    text: `Gemini unavailable: ${reason}`,
  });
  safeSend(win, 'claude:message', {
    type: 'done',
    projectPath: ws.projectPath,
    scope,
    turnSeq: ws.gemini.turnSeq,
  });
}

export async function ensureGeminiTransport(win: BrowserWindow, ws: Workspace) {
  if (ws.gemini.transport) return ws.gemini.transport;

  const client = createGeminiAcpClient({
    cwd: ws.gemini.cwd || ws.projectPath,
    env: getEnrichedEnv(),
    clientInfo: { name: 'sai', version: '1.0' },
  });

  client.onEvent((event: any) => {
    const scope = getScopeForEvent(ws, event);
    if (scope === 'commit') return;
    if (event?.method === 'tool.approvalRequired' || event?.method === 'tool/approvalRequired') {
      const input = event.params?.input || {};
      ws.gemini.pendingApproval = {
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        input,
        description: event.params?.description,
        scope,
      };
      safeSend(win, 'claude:message', {
        type: 'approval_needed',
        projectPath: ws.projectPath,
        scope,
        toolUseId: event.params?.id || '',
        toolName: event.params?.name || 'tool',
        command: getApprovalCommand(input),
        description: event.params?.description || '',
        input,
      });
      return;
    }

    const translated = translateAcpEvent(event, ws.projectPath, scope);
    if (translated) {
      safeSend(win, 'claude:message', translated);
    }
  });

  await client.start();
  ws.gemini.transport = client;
  ws.gemini.loadedSessionIds.clear();
  ws.gemini.bootstrappedSessionIds.clear();
  ws.gemini.availability = 'available';
  ws.gemini.lastError = undefined;
  return client;
}

async function ensureSession(win: BrowserWindow, ws: Workspace, scope: string) {
  const client = await ensureGeminiTransport(win, ws);
  const existing = getScopeSessionId(ws, scope);

  if (existing) {
    if (ws.gemini.loadedSessionIds.has(existing)) {
      return existing;
    }

    await client.request('session/load', {
      sessionId: existing,
      cwd: ws.gemini.cwd || ws.projectPath,
      scope,
      mcpServers: [],
    });
    ws.gemini.loadedSessionIds.add(existing);
    return existing;
  }

  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: ws.gemini.cwd || ws.projectPath,
    scope,
    mcpServers: [],
  });
  setScopeSessionId(ws, scope, result.sessionId);
  ws.gemini.loadedSessionIds.add(result.sessionId);
  safeSend(win, 'claude:message', {
    type: 'session_id',
    sessionId: result.sessionId,
    projectPath: ws.projectPath,
    scope,
  });
  return result.sessionId;
}

export async function ensureGeminiCommitSession(win: BrowserWindow, ws: Workspace): Promise<string> {
  if (ws.gemini.commitSessionId) return ws.gemini.commitSessionId;

  const client = await ensureGeminiTransport(win, ws);
  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: ws.gemini.cwd || ws.projectPath,
    scope: 'commit',
    mcpServers: [],
  });
  ws.gemini.commitSessionId = result.sessionId;
  ws.gemini.loadedSessionIds.add(result.sessionId);
  return result.sessionId;
}

export async function promptGeminiText(
  win: BrowserWindow,
  ws: Workspace,
  options: {
    sessionId: string;
    scope: string;
    prompt: string;
    imagePaths?: string[];
    approvalMode?: string;
    conversationMode?: string;
    model?: string;
  },
): Promise<string> {
  const client = await ensureGeminiTransport(win, ws);
  let text = '';

  const unsubscribe = client.onEvent((event: any) => {
    const scope = getScopeForEvent(ws, event);
    if (scope !== options.scope) return;

    if (event?.method === 'session/update' && event.params?.update?.sessionUpdate === 'agent_message_chunk') {
      text += event.params.update.content?.text || '';
      return;
    }

    if (event?.method !== 'message/assistant') return;

    const nextText = event.params?.text || '';
    if (event.params?.delta) text += nextText;
    else text = nextText;
  });

  try {
    const result = await client.request<any>('session/prompt', {
      sessionId: options.sessionId,
      scope: options.scope,
      prompt: buildPromptItems(options.prompt, options.imagePaths),
      approvalMode: options.approvalMode,
      conversationMode: options.conversationMode,
      model: options.model,
    });

    if (text.trim()) return text.trim();
    if (typeof result?.result === 'string') return result.result.trim();
    if (typeof result?.text === 'string') return result.text.trim();
    return '';
  } finally {
    unsubscribe?.();
  }
}

export function registerGeminiHandlers(win: BrowserWindow) {
  ipcMain.handle('gemini:models', () => ({
    models: GEMINI_MODELS,
    defaultModel: GEMINI_DEFAULT_MODEL,
  }));

  ipcMain.handle('gemini:start', async (_event, cwd: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    ws.gemini.cwd = cwd;
    if (ws.gemini.availability === 'disabled') {
      ws.gemini.transport?.dispose();
      ws.gemini.transport = null;
      ws.gemini.loadedSessionIds.clear();
      ws.gemini.bootstrappedSessionIds.clear();
      ws.gemini.lastError = undefined;
      ws.gemini.availability = 'available';
      ws.gemini.pendingApproval = null;
    }
    try {
      await ensureGeminiTransport(win, ws);
      safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
    } catch (error) {
      disableGemini(win, ws, 'chat', error instanceof Error ? error.message : 'Gemini startup failed');
    }
  });

  ipcMain.on('gemini:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope: string = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const previousSessionId = getScopeSessionId(ws, scope);
    if (previousSessionId === sessionId) return;
    if (previousSessionId) {
      ws.gemini.loadedSessionIds.delete(previousSessionId);
      ws.gemini.bootstrappedSessionIds.delete(previousSessionId);
    }
    setScopeSessionId(ws, scope, sessionId);
  });

  ipcMain.on('gemini:stop', async (_event, projectPath: string, scope: string = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const sessionId = getScopeSessionId(ws, scope);

    if (ws.gemini.transport && sessionId && ws.gemini.busy) {
      try {
        await ws.gemini.transport.request('session/cancel', {
          sessionId,
          requestId: ws.gemini.activeRequestId,
          scope,
        });
      } catch {
        // Ignore cancellation failures.
      }
    }

    ws.gemini.busy = false;
    ws.gemini.activeRequestId = undefined;
    safeSend(win, 'claude:message', {
      type: 'done',
      projectPath: ws.projectPath,
      scope,
      turnSeq: ws.gemini.turnSeq,
    });
  });

  ipcMain.on(
    'gemini:send',
    async (_event, projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string, scope: string = 'chat') => {
      const ws = get(projectPath);
      if (!ws) return;
      touchActivity(projectPath);

      if (ws.gemini.availability === 'disabled') {
        safeSend(win, 'claude:message', {
          type: 'error',
          projectPath: ws.projectPath,
          scope,
          text: `Gemini unavailable: ${ws.gemini.lastError || 'retry Gemini to continue'}`,
        });
        safeSend(win, 'claude:message', {
          type: 'done',
          projectPath: ws.projectPath,
          scope,
          turnSeq: ws.gemini.turnSeq,
        });
        return;
      }

      try {
        const client = await ensureGeminiTransport(win, ws);
        const sessionId = await ensureSession(win, ws, scope);
        const bootstrapText = ws.gemini.bootstrappedSessionIds.has(sessionId)
          ? undefined
          : buildGeminiProjectBootstrap(ws.gemini.cwd || ws.projectPath);
        ws.gemini.turnSeq += 1;
        ws.gemini.busy = true;

        safeSend(win, 'claude:message', {
          type: 'streaming_start',
          projectPath: ws.projectPath,
          scope,
          turnSeq: ws.gemini.turnSeq,
        });

        const result = await client.request<any>('session/prompt', {
          sessionId,
          scope,
          prompt: buildPromptItems(message, imagePaths, bootstrapText),
          approvalMode: approvalMode || 'auto_edit',
          conversationMode,
          model: conversationMode === 'fast' ? 'gemini-2.5-flash' : (model || GEMINI_DEFAULT_MODEL),
        });

        if (bootstrapText) {
          ws.gemini.bootstrappedSessionIds.add(sessionId);
        }
        ws.gemini.activeRequestId = result?.requestId;
        ws.gemini.busy = false;
        ws.gemini.activeRequestId = undefined;

        safeSend(win, 'claude:message', {
          type: 'result',
          projectPath: ws.projectPath,
          scope,
          usage: {
            input_tokens: result?.usage?.input_tokens || 0,
            cache_read_input_tokens: result?.usage?.cached || 0,
            cache_creation_input_tokens: 0,
            output_tokens: result?.usage?.output_tokens || 0,
          },
        });
        safeSend(win, 'claude:message', {
          type: 'done',
          projectPath: ws.projectPath,
          scope,
          turnSeq: ws.gemini.turnSeq,
        });

        notifyCompletion(win, ws.projectPath, { provider: 'Gemini' });
      } catch (error) {
        disableGemini(win, ws, scope, error instanceof Error ? error.message : 'Gemini request failed');
      }
    },
  );
}
