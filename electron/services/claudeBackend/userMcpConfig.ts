/**
 * Parse the user's `mcpConfigPath` SAI setting (string | string[]) into a merged
 * map of MCP server configs, for passthrough into the SDK `mcpServers` option in
 * chat/task scopes. Mirrors the CLI, which forwards each path via --mcp-config.
 * Malformed or unreadable files are skipped (logged by the caller), never thrown.
 */
export function parseUserMcpConfigPaths(
  setting: unknown,
  readFile: (p: string) => string,
): Record<string, unknown> {
  if (!setting) return {};
  const paths = Array.isArray(setting) ? setting : [setting];
  const merged: Record<string, unknown> = {};
  for (const p of paths) {
    if (typeof p !== 'string' || !p.trim()) continue;
    try {
      const parsed = JSON.parse(readFile(p.trim())) as { mcpServers?: Record<string, unknown> };
      if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        Object.assign(merged, parsed.mcpServers);
      }
    } catch {
      // skip unreadable/malformed config
    }
  }
  return merged;
}
