/**
 * mcpRuntimeStatus.ts — in-memory record of the live MCP server connection
 * statuses and loaded plugins reported by the SDK's `system/init` message.
 * Latest report per server name wins across scopes. Read by the `mcp:runtimeStatus`
 * IPC handler so the MCP sidebar can show connected/failed badges (SDK backend only —
 * the CLI path never reports connection status).
 */

export interface McpRuntimeServer {
  status: string;
  scopeKey: string;
  at: number;
}

export interface McpRuntimePlugin {
  name: string;
  path: string;
}

const serverStatus = new Map<string, McpRuntimeServer>();
let loadedPlugins: McpRuntimePlugin[] = [];

export function recordMcpRuntimeStatus(
  scopeKey: string,
  servers: Array<{ name?: string; status?: string }>,
  plugins?: Array<{ name?: string; path?: string }>,
): void {
  const at = Date.now();
  for (const s of servers) {
    if (!s || typeof s.name !== 'string' || !s.name) continue;
    serverStatus.set(s.name, { status: typeof s.status === 'string' ? s.status : 'unknown', scopeKey, at });
  }
  if (Array.isArray(plugins)) {
    loadedPlugins = plugins
      .filter((p): p is { name: string; path: string } => typeof p?.name === 'string' && typeof p?.path === 'string')
      .map((p) => ({ name: p.name, path: p.path }));
  }
}

export function getMcpRuntimeStatus(): {
  servers: Record<string, McpRuntimeServer>;
  plugins: McpRuntimePlugin[];
} {
  return { servers: Object.fromEntries(serverStatus), plugins: loadedPlugins };
}

export function __resetMcpRuntimeStatusForTests(): void {
  serverStatus.clear();
  loadedPlugins = [];
}
