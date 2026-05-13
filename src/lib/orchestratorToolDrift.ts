const SWARM_TOOL_PREFIX = 'mcp__swarm__';

export function isOrchestratorToolDrift(toolName: string): boolean {
  if (!toolName) return false;
  return !toolName.startsWith(SWARM_TOOL_PREFIX);
}

export function describeToolDrift(toolName: string): string {
  return `Orchestrator tried to call non-swarm tool "${toolName}". This shouldn't be possible with --tools "" + --strict-mcp-config. Investigate Claude CLI behavior or flag regression.`;
}
