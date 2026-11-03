/**
 * sai_browser_* tool handling.
 *
 * Thin mapping layer: tool name -> bridge method, plus reshaping the
 * extension's reply into what the MCP content wrapper expects (a screenshot
 * has to arrive as `__mcpImage` to become a real image block).
 *
 * Kept out of App.tsx so it can be unit tested against a fake bridge.
 */

export type BrowserBridgeCall = (method: string, params?: unknown) => Promise<unknown>;

/** Tool name -> bridge method. Also the set of tools this module claims. */
export const BROWSER_TOOL_METHODS: Record<string, string> = {
  browser_tabs: 'tabs.list',
  browser_snapshot: 'snapshot',
  browser_read: 'read',
};

export function isBrowserTool(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(BROWSER_TOOL_METHODS, tool);
}

export interface BrowserToolDeps {
  browserCall?: BrowserBridgeCall;
}

const UNAVAILABLE =
  'The browser bridge is unavailable in this build. See docs/browser-bridge.md.';

export async function handleBrowserToolRequest(
  req: { tool: string; input?: unknown },
  deps: BrowserToolDeps,
): Promise<unknown> {
  const method = BROWSER_TOOL_METHODS[req.tool];
  if (!method) throw new Error(`not a browser tool: ${req.tool}`);
  if (typeof deps.browserCall !== 'function') throw new Error(UNAVAILABLE);

  const input = (req.input ?? {}) as Record<string, unknown>;
  const result = (await deps.browserCall(method, input)) as Record<string, unknown> | null;
  if (!result || typeof result !== 'object') return { ok: false, message: 'browser returned no result' };

  // Hoist the screenshot into __mcpImage so toMcpSuccessContent emits an image
  // block, and drop the (large) base64 from the JSON text payload.
  const screenshot = result.screenshot as
    { base64?: string; mimeType?: string; scale?: number } | undefined;
  if (screenshot && typeof screenshot.base64 === 'string') {
    const { screenshot: _omit, ...rest } = result;
    return {
      ok: true,
      ...rest,
      screenshot: { mimeType: screenshot.mimeType ?? 'image/jpeg', scale: screenshot.scale },
      __mcpImage: { base64: screenshot.base64, mimeType: screenshot.mimeType ?? 'image/jpeg' },
    };
  }

  return { ok: true, ...result };
}
