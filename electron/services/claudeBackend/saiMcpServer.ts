// electron/services/claudeBackend/saiMcpServer.ts
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { toolsForToolset } from '../../../src/lib/saiTools';
import { jsonSchemaToZodShape } from './jsonSchemaToZod';
import { toMcpSuccessContent, toMcpErrorContent } from '../mcpToolContent';
import type { SaiToolDispatch } from '../saiToolBridge';

export const SAI_MCP_SERVER_NAME = 'sai';

export interface SaiMcpDeps {
  workspace: string;
  dispatch: SaiToolDispatch;
}

/**
 * Build the in-process SDK MCP server exposing SAI's chat tools to the model in
 * SDK mode. Tools are advertised as `sai_<name>` (matching the socket server),
 * so the model sees `mcp__sai__sai_render_html` etc. Each handler delegates to
 * the shared renderer round-trip via `dispatch`, reusing the exact `__mcpImage`
 * wrapping the socket transport uses. Built per chat scope so `workspace` is
 * bound for every call.
 */
export function buildSaiChatMcpServer(deps: SaiMcpDeps): McpSdkServerConfigWithInstance {
  const { workspace, dispatch } = deps;
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const tools = toolsForToolset('chat').map((def) => {
    const advertisedName = `sai_${def.name}`;
    const handler = async (args: Record<string, unknown>) => {
      try {
        const result = await dispatch({ tool: def.name, input: args, workspace });
        return toMcpSuccessContent(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toMcpErrorContent(msg);
      }
    };
    handlersForTest.set(advertisedName, handler);
    return tool(
      advertisedName,
      def.description,
      jsonSchemaToZodShape(def.input_schema),
      handler as Parameters<typeof tool>[3],
    );
  });

  const server = createSdkMcpServer({ name: SAI_MCP_SERVER_NAME, version: '1.0.0', tools });
  // Test-only seam: expose the raw handlers so unit tests can assert routing
  // without standing up an MCP transport. Non-enumerable so it never serializes.
  Object.defineProperty(server, '__handlersForTest', {
    value: handlersForTest,
    enumerable: false,
  });
  return server;
}
