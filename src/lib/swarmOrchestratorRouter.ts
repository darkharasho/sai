import { dispatchSwarmTool, type SwarmHost } from './swarmOrchestratorDispatcher';
import { SWARM_TOOL_SCHEMA } from './swarmOrchestratorTools';

const SWARM_TOOL_NAMES: ReadonlySet<string> = new Set<string>(SWARM_TOOL_SCHEMA.map(t => t.name));

export interface OrchestratorToolUseEvent {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: any;
}

export interface OrchestratorRouterDeps {
  isOrchestratorSession(sessionId: string): boolean;
  host: SwarmHost;
}

export function isSwarmTool(name: string): boolean {
  return SWARM_TOOL_NAMES.has(name);
}

/**
 * Returns a dispatch result if the event is an orchestrator-owned swarm tool call;
 * returns null otherwise (caller should defer to the normal tool runner).
 *
 * NOTE: Schema injection into provider CLIs (Claude/Codex/Gemini) is deferred — those
 * CLIs do not currently accept custom tool definitions in their arg lists. This module
 * implements only the routing half; wiring into an actual provider stream is a follow-up
 * task once an MCP server or equivalent registration path is available.
 */
export async function routeOrchestratorToolUse(
  evt: OrchestratorToolUseEvent,
  deps: OrchestratorRouterDeps,
): Promise<{ toolUseId: string; result: unknown } | null> {
  if (!deps.isOrchestratorSession(evt.sessionId)) return null;
  if (!isSwarmTool(evt.toolName)) return null;
  const result = await dispatchSwarmTool(evt.toolName, evt.input, deps.host);
  return { toolUseId: evt.toolUseId, result };
}
