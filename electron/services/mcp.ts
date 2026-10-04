import { ipcMain, shell } from 'electron';
import * as os from 'node:os';
import { listMcpServers, upsertMcpServer, removeMcpServer, setMcpServerDisabled } from './mcpConfig';
import type { McpActionResult, McpServerConfig, McpSource } from '../../src/types';
import { setMcpInitFrameListener } from './claudeBackend/mcpRuntimeStatus';
import { getClaudeBackend } from './claudeBackend/index';
import { getMainWin } from './claude';
import { createMcpControl, type McpControlQuery } from './claudeBackend/mcpControl';

const pathsFor = (projectPath?: string) => ({ home: os.homedir(), projectPath: projectPath || undefined });
const fail = (err: any, fallback: string) => ({ error: err?.message || fallback });

/** Pushes run from pollers long after the window may be gone: a destroyed
 *  window's webContents throws on send. */
function pushToRenderer(snap: unknown): void {
  const w = getMainWin();
  if (w && !w.isDestroyed()) w.webContents.send('mcp:runtime-status', snap);
}

let control: ReturnType<typeof createMcpControl> | null = null;
function mcpControl() {
  control ??= createMcpControl({
    getQuery: (projectPath, scope, create) =>
      (getClaudeBackend().getLiveQuery?.(projectPath, scope, { create }) as McpControlQuery | null | undefined) ?? null,
    openExternal: (url) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); },
    push: pushToRenderer,
    markMcpStale: (projectPath, scope, opts) => getClaudeBackend().markMcpStale?.(projectPath, scope, opts),
  });
  return control;
}

/** A saved config change reaches sessions by resume-respawn: the panel scope
 *  right away when idle, the rest on their next idle send. A user/plugin edit
 *  touches every project; a project .mcp.json edit only its own. With no
 *  project open there is no panel scope to restart — sessions are only flagged.
 *  Not awaited: the respawned session's status arrives as a push. */
function applyConfig(projectPath: string | undefined, scope: string | undefined, source: McpSource | undefined): void {
  if (!projectPath) { getClaudeBackend().markMcpStale?.('', undefined, { restart: false }); return; }
  mcpControl().applyConfig(projectPath, scope, { projectOnly: source === 'project' }).catch(() => { /* next status call shows it */ });
}

export function registerMcpHandlers() {
  // An init frame is the first sign a session exists for the scope: push a
  // FULL snapshot (available + capabilities), so a chat nudge that mounted
  // before the session did stops showing the "no session" state. It may also
  // carry `pending` servers the SDK never re-reports — watch those.
  setMcpInitFrameListener((projectPath, scope) => {
    const c = mcpControl();
    pushToRenderer(c.peek(projectPath, scope));
    c.watchPending(projectPath, scope);
  });

  ipcMain.handle('mcp:list', async (_e, projectPath?: string) => {
    try { return listMcpServers(pathsFor(projectPath)); } catch (err) { return fail(err, 'Failed to read MCP config'); }
  });

  ipcMain.handle('mcp:add', async (_e, config: McpServerConfig, projectPath?: string, scope?: string) => {
    try { upsertMcpServer(pathsFor(projectPath), config); }
    catch (err) { return fail(err, 'Failed to save MCP server'); }
    applyConfig(projectPath, scope, config.source ?? 'user');
    return { success: true };
  });

  ipcMain.handle('mcp:remove', async (_e, name: string, source: 'user' | 'project' = 'user', projectPath?: string, scope?: string) => {
    if (name.startsWith('plugin:')) return { error: 'Plugin-provided MCP servers must be removed via the plugin itself' };
    try { removeMcpServer(pathsFor(projectPath), name, source); }
    catch (err) { return fail(err, 'Failed to remove MCP server'); }
    applyConfig(projectPath, scope, source);
    return { success: true };
  });

  ipcMain.handle('mcp:runtimeStatus', async (_e, projectPath: string, scope?: string) => mcpControl().peek(projectPath, scope));
  ipcMain.handle('mcp:status', async (_e, projectPath: string, scope?: string) => mcpControl().status(projectPath, scope));
  ipcMain.handle('mcp:reconnect', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().reconnect(projectPath, scope, name));
  // `name` is the config key (what is persisted); `controlName` is the name the
  // live session knows the server by (plugin servers differ).
  ipcMain.handle('mcp:toggle', async (
    _e, projectPath: string, scope: string | undefined, name: string, enabled: boolean, source: McpSource, controlName: string = name,
  ): Promise<McpActionResult> => {
    // claude.ai connectors have no local config — the live session is all there is.
    if (source === 'claudeai') return mcpControl().toggle(projectPath, scope, controlName, enabled);
    // Persist first so new sessions agree, then flip the live one.
    try { setMcpServerDisabled(pathsFor(projectPath), name, source, !enabled); }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to save' }; }
    // Only an existing session is flipped — one spawned now reads the saved file.
    const hasLive = !!getClaudeBackend().getLiveQuery?.(projectPath, scope, { create: false });
    const live: McpActionResult = hasLive ? await mcpControl().toggle(projectPath, scope, controlName, enabled) : { ok: true };
    if (enabled) applyConfig(projectPath, scope, source);
    else getClaudeBackend().markMcpStale?.(projectPath, scope, { restart: false, projectOnly: source === 'project' });
    // A session never loads a server that was disabled (or absent) when it
    // spawned, so the live flip can report it missing: there is nothing to turn
    // off, and an enable is brought up by the respawn above.
    return live.ok || live.error.startsWith('Server not found') ? { ok: true } : live;
  });
  ipcMain.handle('mcp:authenticate', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().authenticate(projectPath, scope, name));
  ipcMain.handle('mcp:authCancel', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().cancelAuth(projectPath, scope, name));
  ipcMain.handle('mcp:submitCallbackUrl', async (_e, projectPath: string, scope: string | undefined, name: string, url: string) =>
    mcpControl().submitCallbackUrl(projectPath, scope, name, url));
  ipcMain.handle('mcp:signOut', async (_e, projectPath: string, scope: string | undefined, name: string) =>
    mcpControl().signOut(projectPath, scope, name));

  ipcMain.handle('mcp:registryList', async () => {
    try {
      const allServers: any[] = [];
      let cursor: string | undefined;
      const limit = 100;
      const maxPages = 10;

      for (let page = 0; page < maxPages; page++) {
        const url = cursor
          ? `https://registry.modelcontextprotocol.io/v0/servers?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
          : `https://registry.modelcontextprotocol.io/v0/servers?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Registry fetch error: ${res.status}`);
        const data = await res.json() as { servers: any[]; metadata?: { nextCursor?: string } };
        allServers.push(...data.servers);
        if (!data.metadata?.nextCursor) break;
        cursor = data.metadata.nextCursor;
      }

      const installed = new Set(listMcpServers({ home: os.homedir() }).map((s) => s.name));

      const seen = new Set<string>();
      const results: any[] = [];

      for (const s of allServers) {
        const repoUrl = s.server?.repository?.url || '';
        const name = s.server?.title || s.server?.name || '';
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const remotes = Array.isArray(s.server?.remotes) ? s.server.remotes : [];
        const packages = Array.isArray(s.server?.packages) ? s.server.packages : [];
        const icons = Array.isArray(s.server?.icons) ? s.server.icons : [];
        const iconUrl = icons.length > 0 ? (icons[0].src || '') : '';

        results.push({
          name: slug,
          title: name,
          description: s.server?.description || '',
          source: repoUrl,
          repositoryUrl: repoUrl,
          websiteUrl: s.server?.websiteUrl || '',
          iconUrl,
          transport: remotes.length > 0 ? 'streamable-http' as const : 'stdio' as const,
          version: s.server?.version || '',
          installed: installed.has(slug),
          packages,
          remotes,
        });
      }

      return results;
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch MCP registry' };
    }
  });
}
