import { ipcMain } from 'electron';
import * as os from 'node:os';
import { listMcpServers, upsertMcpServer, removeMcpServer, setMcpServerDisabled } from './mcpConfig';
import type { McpServerConfig, McpSource } from '../../src/types';
import { getMcpRuntimeStatus } from './claudeBackend/mcpRuntimeStatus';

const pathsFor = (projectPath?: string) => ({ home: os.homedir(), projectPath: projectPath || undefined });
const fail = (err: any, fallback: string) => ({ error: err?.message || fallback });

export function registerMcpHandlers() {
  ipcMain.handle('mcp:list', async (_e, projectPath?: string) => {
    try { return listMcpServers(pathsFor(projectPath)); } catch (err) { return fail(err, 'Failed to read MCP config'); }
  });

  ipcMain.handle('mcp:add', async (_e, config: McpServerConfig, projectPath?: string) => {
    try { upsertMcpServer(pathsFor(projectPath), config); return { success: true }; }
    catch (err) { return fail(err, 'Failed to save MCP server'); }
  });

  ipcMain.handle('mcp:remove', async (_e, name: string, source: 'user' | 'project' = 'user', projectPath?: string) => {
    if (name.startsWith('plugin:')) return { error: 'Plugin-provided MCP servers must be removed via the plugin itself' };
    try { removeMcpServer(pathsFor(projectPath), name, source); return { success: true }; }
    catch (err) { return fail(err, 'Failed to remove MCP server'); }
  });

  ipcMain.handle('mcp:update', async (_e, name: string, updates: { disabled?: boolean; source?: McpSource }, projectPath?: string) => {
    try {
      if (typeof updates?.disabled !== 'boolean') return { error: 'Only { disabled } updates are supported; use mcp:add to edit' };
      const source = updates.source ?? (name.startsWith('plugin:') ? 'plugin' : 'user');
      setMcpServerDisabled(pathsFor(projectPath), name, source, updates.disabled);
      return { success: true };
    } catch (err) { return fail(err, 'Failed to update MCP server'); }
  });

  // Live connection status reported by the SDK backend's init messages.
  ipcMain.handle('mcp:runtimeStatus', async (_e, projectPath?: string, scope?: string) => getMcpRuntimeStatus(projectPath ?? '', scope));

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
