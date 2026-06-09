import { renderStore } from './renderStore';
import { dispatchSaiRenderTool } from './saiToolDispatcher';

export interface CapturedImage { base64: string; mimeType: 'image/png'; }

export interface RenderToolDeps {
  /** Optional: waits for the render region to paint, then returns its screenshot. */
  captureRenderRegion?: (renderId: string) => Promise<CapturedImage>;
}

export interface RenderToolRequest { tool: string; input: any; renderId: string; }

export async function handleRenderToolRequest(req: RenderToolRequest, deps: RenderToolDeps) {
  const dispatch = dispatchSaiRenderTool(req.tool, req.input, req.renderId);
  if (!dispatch.ok) {
    return { ok: false, error: dispatch.error };
  }
  renderStore.patch(req.renderId, { status: 'ready' });
  if (!deps.captureRenderRegion) {
    return { ok: true, renderId: req.renderId };
  }
  try {
    const image = await deps.captureRenderRegion(req.renderId);
    return { ok: true, renderId: req.renderId, __mcpImage: image };
  } catch {
    // Capture is best-effort; the render itself succeeded.
    return { ok: true, renderId: req.renderId };
  }
}
