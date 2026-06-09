import type { CapturedImage } from './handleRenderToolRequest';

const PAINT_SETTLE_MS = 120;

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Waits for paint + fonts, measures the render region, asks main to capture it. */
export async function captureRenderRegion(renderId: string): Promise<CapturedImage> {
  // renderId is interpolated into an attribute selector below. It is always a
  // main-generated `mcp-<uuid>` today, but guard so a malformed id can never
  // break the selector or match unintended elements.
  if (!/^[\w-]+$/.test(renderId)) throw new Error(`invalid renderId: ${renderId}`);
  await nextFrame();
  await nextFrame();
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* noop */ } }
  await new Promise((r) => setTimeout(r, PAINT_SETTLE_MS));

  const el = document.querySelector(`[data-render-region="${renderId}"]`) as HTMLElement | null;
  if (!el) throw new Error(`render region ${renderId} not found in DOM`);
  const r = el.getBoundingClientRect();
  const base64 = await window.sai.captureRegion({ x: r.x, y: r.y, width: r.width, height: r.height });
  if (!base64) throw new Error('capture returned no image');
  return { base64, mimeType: 'image/png' };
}
