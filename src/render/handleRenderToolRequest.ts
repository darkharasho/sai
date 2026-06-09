import { renderStore } from './renderStore';
import { dispatchSaiRenderTool } from './saiToolDispatcher';

export interface CapturedImage { base64: string; mimeType: 'image/png'; }

export interface RenderToolDeps {
  /** Waits for the render region to paint, then returns its screenshot. */
  captureRenderRegion: (renderId: string) => Promise<CapturedImage>;
}

export interface RenderToolRequest { tool: string; input: any; renderId: string; }

export async function handleRenderToolRequest(req: RenderToolRequest, deps: RenderToolDeps) {
  const dispatch = dispatchSaiRenderTool(req.tool, req.input, req.renderId);
  if (!dispatch.ok) {
    return { ok: false, error: dispatch.error };
  }
  try {
    const image = await deps.captureRenderRegion(req.renderId);
    renderStore.patch(req.renderId, { status: 'ready' });
    return { ok: true, renderId: req.renderId, __mcpImage: image };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderStore.patch(req.renderId, { status: 'error', error: msg });
    return { ok: false, error: msg };
  }
}
