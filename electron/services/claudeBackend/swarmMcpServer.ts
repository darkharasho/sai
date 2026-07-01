import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';
import { jsonSchemaToZodShape } from './jsonSchemaToZod';
import { toMcpSuccessContent, toMcpErrorContent } from '../mcpToolContent';
import type { SaiToolDispatch } from '../saiToolBridge';

export const SWARM_MCP_SERVER_NAME = 'swarm';

export interface SwarmMcpDeps {
  workspace: string;
  dispatch: SaiToolDispatch;
}

/**
 * Build the in-process SDK MCP server exposing the swarm ORCHESTRATOR tools in
 * SDK mode. Registered under server key `swarm` and tools advertised under their
 * BARE names (e.g. `spawn_task`), so the model sees `mcp__swarm__spawn_task` —
 * exactly what SwarmToolCardSelector (SWARM_PREFIX 'mcp__swarm__', switch on the
 * bare baseName) matches, letting the SDK's real tool_use drive the cards (no
 * synthetic injection). Each handler delegates to the shared renderer round-trip
 * via `dispatch`. Built per orchestrator scope so `workspace` is bound.
 */
export function buildSwarmMcpServer(deps: SwarmMcpDeps): McpSdkServerConfigWithInstance {
  const { workspace, dispatch } = deps;
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const tools = SWARM_TOOL_SCHEMA.map((def) => {
    const handler = async (args: Record<string, unknown>) => {
      try {
        const result = await dispatch({ tool: def.name, input: args, workspace });
        return toMcpSuccessContent(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toMcpErrorContent(msg);
      }
    };
    handlersForTest.set(def.name, handler);
    return tool(
      def.name, // bare name → mcp__swarm__<name>
      def.description,
      jsonSchemaToZodShape(def.input_schema),
      handler as Parameters<typeof tool>[3],
    );
  });

  const server = createSdkMcpServer({ name: SWARM_MCP_SERVER_NAME, version: '1.0.0', tools });
  // Test-only seam: expose the raw handlers so unit tests can assert routing
  // without standing up an MCP transport. Non-enumerable so it never serializes.
  Object.defineProperty(server, '__handlersForTest', {
    value: handlersForTest,
    enumerable: false,
  });
  return server;
}
