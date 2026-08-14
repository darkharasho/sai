import { BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getOrCreate, get, touchActivity } from './workspace';
import type { Workspace } from './workspace';
import { notifyCompletion } from './notify';
import { createAcpClient, type AcpClient } from './acp';

export interface AcpProviderConfig {
  key: 'kimi';                   // IPC channel prefix AND Workspace slot name
  displayName: string;           // User-facing copy + notifyCompletion
  label: string;                 // Must match the ACP client label
  command: string;
  args: string[];
  models: { id: string; name: string }[];
  defaultModel: string;
  /** Model substituted when conversationMode === 'fast'. */
  fastModel?: string;
  /** Extra sentence appended to transport-failure errors (install/login guidance). */
  installHint?: string;
}

function getEnrichedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === 'win32') return env;
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
  env.PATH = [...new Set([...(env.PATH || '').split(path.delimiter), ...extraPaths].filter(Boolean))].join(path.delimiter);
  return env;
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch {
    // Window already destroyed.
  }
}

const BOOTSTRAP_FILES = ['README.md', 'package.json', 'GEMINI.md', 'AGENTS.md', 'CLAUDE.md', 'tsconfig.json'];

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

function buildProjectBootstrap(rootPath: string): string {
  const topLevel = (() => {
    try {
      return fs.readdirSync(rootPath).sort().slice(0, 40).join('\n');
    } catch {
      return '';
    }
  })();

  const projectPaths = collectProjectPaths(rootPath, 120, 2).join('\n');
  const fileSnippets = BOOTSTRAP_FILES
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
    try {
      const imageData = fs.readFileSync(absolutePath).toString('base64');
      prompt.push({
        type: 'image',
        mimeType: getMimeTypeForPath(absolutePath),
        data: imageData,
      });
    } catch {
      // Temp file may have been cleaned up — skip rather than crashing the request.
      prompt.push({ type: 'text', text: `[Image unavailable: ${path.basename(absolutePath)}]` });
    }
  }

  return prompt;
}

function getScopeSessionId(ws: Workspace, scope: string, config: AcpProviderConfig): string | undefined {
  const state = (ws: Workspace) => ws[config.key];
  return scope === 'chat' ? state(ws).chatSessionId : state(ws).terminalSessions.get(scope);
}

function setScopeSessionId(ws: Workspace, scope: string, sessionId: string | undefined, config: AcpProviderConfig) {
  const state = (ws: Workspace) => ws[config.key];
  if (scope === 'chat') state(ws).chatSessionId = sessionId;
  else if (sessionId) state(ws).terminalSessions.set(scope, sessionId);
  else state(ws).terminalSessions.delete(scope);
}

function getApprovalCommand(input: Record<string, any>): string {
  return input.command || input.file_path || JSON.stringify(input);
}

function getScopeForEvent(ws: Workspace, msg: any, config: AcpProviderConfig): string {
  const state = (ws: Workspace) => ws[config.key];
  const explicitScope = msg?.params?.scope;
  if (typeof explicitScope === 'string' && explicitScope.length > 0) {
    return explicitScope;
  }

  const sessionId = msg?.params?.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    if (sessionId === state(ws).commitSessionId) return 'commit';
    if (sessionId === state(ws).chatSessionId) return 'chat';
    for (const [scope, terminalSessionId] of state(ws).terminalSessions.entries()) {
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

/**
 * Convert an ACP tool-call content array into a tool_result `content` value.
 * Returns a plain string when there are no images (unchanged behavior); returns
 * an array of text + Anthropic-style image blocks when image content is present.
 * Best-effort: only the known image shape is recognized.
 */
export function acpContentToToolResult(content: any[] | undefined): string | any[] {
  if (!Array.isArray(content) || content.length === 0) return '';
  const images: Array<{ media_type: string; data: string }> = [];
  for (const item of content) {
    const inner = item?.content;
    if (item?.type === 'content' && inner?.type === 'image' && inner.data) {
      images.push({ media_type: inner.mimeType || 'application/octet-stream', data: inner.data });
    }
  }
  if (images.length === 0) return renderToolContent(content);
  const textOnly = content.filter(item => !(item?.type === 'content' && item?.content?.type === 'image'));
  return [
    { type: 'text', text: renderToolContent(textOnly) },
    ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
  ];
}

// Map ACP tool_call `kind` values to Claude-equivalent tool names so that
// ChatPanel's icon/type inference (which checks block.name) works. Handles both
// legacy ACP dialect (read_file, run_shell_command, …) and the ACP-standard
// kinds kimi-cli emits (read, edit, execute, …).
function acpKindToName(kind: string | undefined, title: string | undefined): string {
  switch (kind) {
    case 'read_file': return 'Read';
    case 'write_file': case 'create_file': return 'Write';
    case 'replace_in_file': case 'edit_file': case 'patch_file': return 'Edit';
    case 'run_shell_command': case 'shell_command': case 'shell': return 'Bash';
    case 'search_file_content': case 'search_files': return 'Grep';
    case 'glob': case 'list_directory': case 'list_files': return 'Glob';
    case 'web_search': return 'WebSearch';
    case 'web_fetch': return 'WebFetch';
    // ACP-standard kinds (kimi dialect):
    case 'read': return 'Read';
    case 'edit': return 'Edit';
    case 'delete': case 'move': return 'Bash';
    case 'execute': return 'Bash';
    case 'search': return 'Grep';
    case 'fetch': return 'WebFetch';
    case 'think': return 'Thinking';
    default: return title || kind || 'tool';
  }
}

// Extract a plain string from a location value — the ACP may send
// locations as plain strings or as objects with a path/file/name field.
function asPathString(loc: unknown): string {
  if (typeof loc === 'string') return loc;
  if (loc && typeof loc === 'object') {
    const o = loc as Record<string, unknown>;
    return String(o.path || o.file || o.name || JSON.stringify(loc));
  }
  return String(loc ?? '');
}

// Format the input object so the tool card shows useful information
// (file paths, commands) rather than the raw {kind, locations} envelope.
// All values placed in file_path/pattern/command must be strings so that
// ToolCallCard.formatInput never receives a non-string label.
function acpKindToInput(kind: string | undefined, locations: unknown[] | undefined, title: string | undefined): Record<string, unknown> {
  const primaryPath = locations?.length ? asPathString(locations[0]) : undefined;
  const allPaths = locations?.map(asPathString);
  switch (kind) {
    case 'read_file':
    case 'write_file':
    case 'create_file':
    case 'replace_in_file':
    case 'edit_file':
    case 'patch_file':
    case 'read':
    case 'edit':
      return primaryPath
        ? (allPaths!.length > 1 ? { file_path: primaryPath, paths: allPaths } : { file_path: primaryPath })
        : { kind };
    case 'run_shell_command':
    case 'shell_command':
    case 'shell':
    case 'execute':
      return title ? { command: String(title) } : { kind };
    case 'list_directory':
    case 'glob':
    case 'list_files':
      return primaryPath ? { pattern: primaryPath } : { kind };
    case 'search_file_content':
    case 'search_files':
    case 'search':
      return primaryPath ? { pattern: primaryPath, ...(allPaths!.length > 1 ? { paths: allPaths!.slice(1) } : {}) } : { kind };
    default:
      return { kind, ...(primaryPath ? { file_path: primaryPath } : {}) };
  }
}

export function translateAcpEvent(msg: any, projectPath: string, scope: string): any | null {
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
            name: acpKindToName(update.kind, update.title),
            input: acpKindToInput(update.kind, update.locations, update.title),
          }],
        },
      };
    }

    if (update?.sessionUpdate === 'tool_call_update') {
      const terminal = update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled';
      return {
        type: 'user',
        projectPath,
        scope,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: update.toolCallId,
            content: acpContentToToolResult(update.content),
            is_error: update.status === 'failed',
            ...(terminal ? {} : { partial: true }),
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

function disableAcpProvider(win: BrowserWindow, ws: Workspace, scope: string, reason: string, config: AcpProviderConfig) {
  const state = (ws: Workspace) => ws[config.key];
  state(ws).transport?.dispose();
  state(ws).transport = null;
  state(ws).loadedSessionIds.clear();
  state(ws).bootstrappedSessionIds.clear();
  state(ws).suppressedScopes.clear();
  state(ws).availability = 'disabled';
  state(ws).lastError = reason;
  state(ws).busy = false;
  state(ws).activeRequestId = undefined;
  state(ws).pendingApproval = null;
  const hint = config.installHint ? ` ${config.installHint}` : '';
  safeSend(win, 'claude:message', {
    type: 'error',
    projectPath: ws.projectPath,
    scope,
    text: `${config.displayName} unavailable: ${reason}.${hint}`,
  });
  safeSend(win, 'claude:message', {
    type: 'done',
    projectPath: ws.projectPath,
    scope,
    turnSeq: state(ws).turnSeq,
  });
}

export async function ensureAcpTransport(win: BrowserWindow, ws: Workspace, config: AcpProviderConfig): Promise<AcpClient> {
  const state = (ws: Workspace) => ws[config.key];
  if (state(ws).transport) return state(ws).transport!;

  const client = createAcpClient({
    cwd: state(ws).cwd || ws.projectPath,
    env: getEnrichedEnv(),
    clientInfo: { name: 'sai', version: '1.0' },
    command: config.command,
    args: config.args,
    label: config.label,
  });

  client.onEvent((event: any) => {
    const scope = getScopeForEvent(ws, event, config);
    if (scope === 'commit') return;
    if (event?.method === 'tool.approvalRequired' || event?.method === 'tool/approvalRequired') {
      const input = event.params?.input || {};
      state(ws).pendingApproval = {
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
  state(ws).transport = client;
  state(ws).loadedSessionIds.clear();
  state(ws).bootstrappedSessionIds.clear();
  state(ws).availability = 'available';
  state(ws).lastError = undefined;
  return client;
}

async function ensureSession(win: BrowserWindow, ws: Workspace, scope: string, config: AcpProviderConfig) {
  const state = (ws: Workspace) => ws[config.key];
  const client = await ensureAcpTransport(win, ws, config);
  const existing = getScopeSessionId(ws, scope, config);

  if (existing) {
    if (state(ws).loadedSessionIds.has(existing)) {
      return existing;
    }

    await client.request('session/load', {
      sessionId: existing,
      cwd: state(ws).cwd || ws.projectPath,
      scope,
      mcpServers: [],
    });
    state(ws).loadedSessionIds.add(existing);
    return existing;
  }

  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: state(ws).cwd || ws.projectPath,
    scope,
    mcpServers: [],
  });
  setScopeSessionId(ws, scope, result.sessionId, config);
  state(ws).loadedSessionIds.add(result.sessionId);
  safeSend(win, 'claude:message', {
    type: 'session_id',
    sessionId: result.sessionId,
    projectPath: ws.projectPath,
    scope,
  });
  return result.sessionId;
}

export async function ensureAcpCommitSession(win: BrowserWindow, ws: Workspace, config: AcpProviderConfig): Promise<string> {
  const state = (ws: Workspace) => ws[config.key];
  if (state(ws).commitSessionId) return state(ws).commitSessionId!;

  const client = await ensureAcpTransport(win, ws, config);
  const result = await client.request<{ sessionId: string }>('session/new', {
    cwd: state(ws).cwd || ws.projectPath,
    scope: 'commit',
    mcpServers: [],
  });
  state(ws).commitSessionId = result.sessionId;
  state(ws).loadedSessionIds.add(result.sessionId);
  return result.sessionId;
}

export async function promptAcpText(
  win: BrowserWindow,
  ws: Workspace,
  config: AcpProviderConfig,
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
  const client = await ensureAcpTransport(win, ws, config);
  let text = '';

  const unsubscribe = client.onEvent((event: any) => {
    const scope = getScopeForEvent(ws, event, config);
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

export function registerAcpProviderHandlers(win: BrowserWindow, config: AcpProviderConfig) {
  const state = (ws: Workspace) => ws[config.key];

  ipcMain.handle(`${config.key}:models`, () => ({
    models: config.models,
    defaultModel: config.defaultModel,
  }));

  ipcMain.handle(`${config.key}:start`, async (_event, cwd: string, metaPreamble?: string) => {
    if (!cwd) return;
    const ws = getOrCreate(cwd);
    state(ws).cwd = cwd;
    // Stash the meta-workspace preamble. ACP providers do not expose a
    // system-prompt override at the :start level; the preamble is stored here
    // for future use if a clean injection point becomes available.
    state(ws).metaPreamble = metaPreamble || '';
    if (state(ws).availability === 'disabled') {
      state(ws).transport?.dispose();
      state(ws).transport = null;
      state(ws).loadedSessionIds.clear();
      state(ws).bootstrappedSessionIds.clear();
      state(ws).lastError = undefined;
      state(ws).availability = 'available';
      state(ws).pendingApproval = null;
    }
    try {
      await ensureAcpTransport(win, ws, config);
      safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
    } catch (error) {
      disableAcpProvider(win, ws, 'chat', error instanceof Error ? error.message : `${config.displayName} startup failed`, config);
    }
  });

  ipcMain.on(`${config.key}:setSessionId`, (_event, projectPath: string, sessionId: string | undefined, scope: string = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const previousSessionId = getScopeSessionId(ws, scope, config);
    if (previousSessionId === sessionId) return;
    if (previousSessionId) {
      state(ws).loadedSessionIds.delete(previousSessionId);
      state(ws).bootstrappedSessionIds.delete(previousSessionId);
    }
    setScopeSessionId(ws, scope, sessionId, config);
  });

  ipcMain.on(`${config.key}:stop`, async (_event, projectPath: string, scope: string = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const sessionId = getScopeSessionId(ws, scope, config);
    // Capture turnSeq before any async work. If :send arrives and increments
    // turnSeq while session/cancel is awaited, this done should still carry the
    // original turn number so App.tsx's stale-done guard can reject it.
    const stoppedTurnSeq = state(ws).turnSeq;

    if (state(ws).transport && sessionId && state(ws).busy) {
      try {
        await state(ws).transport!.request('session/cancel', {
          sessionId,
          requestId: state(ws).activeRequestId,
          scope,
        });
      } catch {
        // Ignore cancellation failures.
      }
    }

    state(ws).busy = false;
    state(ws).activeRequestId = undefined;
    safeSend(win, 'claude:message', {
      type: 'done',
      projectPath: ws.projectPath,
      scope,
      turnSeq: stoppedTurnSeq,
    });
  });

  ipcMain.on(`${config.key}:approve`, async (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope: string = 'chat') => {
    const ws = get(projectPath);
    if (!ws) return;
    const pending = state(ws).pendingApproval;
    if (!pending || pending.toolUseId !== toolUseId) return;
    const sessionId = scope === 'chat' ? state(ws).chatSessionId : state(ws).terminalSessions.get(scope);
    try {
      await state(ws).transport?.request('tool/approve', {
        sessionId,
        scope,
        toolUseId,
        approved,
        modifiedCommand,
      });
      state(ws).pendingApproval = null;
      safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath, scope });
    } catch (error: any) {
      state(ws).pendingApproval = null;
      safeSend(win, 'claude:message', { type: 'error', projectPath: ws.projectPath, scope, text: `${config.displayName} approval failed: ${error?.message || 'Unknown error'}` });
    }
  });

  ipcMain.on(
    `${config.key}:send`,
    async (_event, projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string, scope: string = 'chat') => {
      const ws = get(projectPath);
      if (!ws) return;
      touchActivity(projectPath);

      if (state(ws).availability === 'disabled') {
        safeSend(win, 'claude:message', {
          type: 'error',
          projectPath: ws.projectPath,
          scope,
          text: `${config.displayName} unavailable: ${state(ws).lastError || `retry ${config.displayName} to continue`}`,
        });
        safeSend(win, 'claude:message', {
          type: 'done',
          projectPath: ws.projectPath,
          scope,
          turnSeq: state(ws).turnSeq,
        });
        return;
      }

      try {
        const client = await ensureAcpTransport(win, ws, config);
        const sessionId = await ensureSession(win, ws, scope, config);
        const bootstrapText = state(ws).bootstrappedSessionIds.has(sessionId)
          ? undefined
          : buildProjectBootstrap(state(ws).cwd || ws.projectPath);
        state(ws).turnSeq += 1;
        state(ws).busy = true;

        safeSend(win, 'claude:message', {
          type: 'streaming_start',
          projectPath: ws.projectPath,
          scope,
          turnSeq: state(ws).turnSeq,
          // Include the ACP session ID so isStreaming can be scoped to the
          // active SAI session — prevents a background streaming turn from
          // showing the thinking animation in a newly opened empty session.
          sessionId,
        });

        // Idle timeout: fire if no ACP event arrives for 2 minutes. Resets on
        // every onEvent so active streaming turns never hit it, but a truly
        // silent/stuck ACP is caught. A fixed total timeout fires even when
        // content has already streamed — this idle approach avoids that.
        const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
        let idleHandle: ReturnType<typeof setTimeout> | null = null;
        let timeoutReject: ((e: Error) => void) | null = null;
        const resetIdle = () => {
          if (idleHandle) clearTimeout(idleHandle);
          if (timeoutReject) {
            idleHandle = setTimeout(
              () => timeoutReject!(new Error(`${config.displayName} request timed out: no response for 2 minutes`)),
              IDLE_TIMEOUT_MS,
            );
          }
        };
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutReject = reject;
          resetIdle();
        });
        const unsubIdle = client.onEvent(() => resetIdle());

        let result: any;
        try {
          result = await Promise.race([timeoutPromise, client.request<any>('session/prompt', {
            sessionId,
            scope,
            prompt: buildPromptItems(message, imagePaths, bootstrapText),
            approvalMode: approvalMode || 'auto_edit',
            conversationMode,
            model: conversationMode === 'fast' && config.fastModel ? config.fastModel : (model || config.defaultModel),
          })]);
        } finally {
          // Always cancel the idle timer and unsubscribe once session/prompt settles.
          if (idleHandle) clearTimeout(idleHandle);
          timeoutReject = null;
          unsubIdle();
        }

        if (bootstrapText) {
          state(ws).bootstrappedSessionIds.add(sessionId);
        }
        state(ws).activeRequestId = result?.requestId;
        state(ws).busy = false;
        state(ws).activeRequestId = undefined;

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
          turnSeq: state(ws).turnSeq,
        });

        notifyCompletion(win, ws.projectPath, { provider: config.displayName });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : `${config.displayName} request failed`;
        // Transport-level failures (ACP process died or never started) require a full
        // session teardown. Request-level errors (bad image, 400, etc.) are specific to
        // this turn — reset the turn state but keep the transport alive so the user can
        // continue chatting.
        const isTransportFailure =
          errorMsg.startsWith(`${config.label} transport`) ||
          errorMsg.startsWith(`${config.label} initialize`) ||
          !state(ws).transport;
        if (isTransportFailure) {
          disableAcpProvider(win, ws, scope, errorMsg, config);
        } else {
          // Clear session for this scope so the next request starts fresh,
          // avoiding any partial server-side state from the failed turn.
          setScopeSessionId(ws, scope, undefined, config);
          state(ws).busy = false;
          state(ws).activeRequestId = undefined;
          safeSend(win, 'claude:message', {
            type: 'error',
            projectPath: ws.projectPath,
            scope,
            text: errorMsg,
          });
          safeSend(win, 'claude:message', {
            type: 'done',
            projectPath: ws.projectPath,
            scope,
            turnSeq: state(ws).turnSeq,
          });
        }
      }
    },
  );
}
