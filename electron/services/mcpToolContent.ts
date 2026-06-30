/**
 * Shared MCP content wrapping for SAI chat tools. Both transports — the
 * subprocess socket server (electron/swarm-mcp-server.ts) and the in-process
 * SDK MCP server (electron/services/claudeBackend/saiMcpServer.ts) — turn a raw
 * renderer round-trip result into MCP content blocks here, so the `__mcpImage`
 * handling lives in exactly one place.
 */
export interface McpToolContent {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

export function toMcpSuccessContent(result: unknown): McpToolContent {
  const content: Array<Record<string, unknown>> = [];
  const image =
    result && typeof result === 'object' ? (result as { __mcpImage?: unknown }).__mcpImage : undefined;
  const textPayload = image ? { ...(result as Record<string, unknown>), __mcpImage: undefined } : result;
  content.push({ type: 'text', text: JSON.stringify(textPayload) });
  if (image && typeof image === 'object' && typeof (image as { base64?: unknown }).base64 === 'string') {
    const img = image as { base64: string; mimeType?: string };
    content.push({ type: 'image', data: img.base64, mimeType: img.mimeType ?? 'image/png' });
  }
  return { content };
}

export function toMcpErrorContent(message: string): McpToolContent {
  return { content: [{ type: 'text', text: message }], isError: true };
}
