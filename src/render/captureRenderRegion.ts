import type { CapturedImage } from './handleRenderToolRequest';

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_INTERVAL_MS = 50;

export interface CaptureOptions {
  /** How long to wait for the region to appear on-screen and lay out. */
  timeoutMs?: number;
  /** Poll interval while waiting for the region. */
  intervalMs?: number;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Polls for the render region until it is in the DOM AND has a non-zero
 * layout box, or the timeout elapses. The region is mounted reactively (the
 * preview panel opens when a render arrives), so a fixed wait would race the
 * panel opening; polling waits exactly as long as needed.
 */
async function waitForVisibleRegion(
  renderId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const el = document.querySelector(`[data-render-region="${renderId}"]`) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    if (Date.now() >= deadline) {
      throw new Error(`render region ${renderId} not found or not visible after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

/** Waits for the region to paint on-screen, then asks main to capture it. */
export async function captureRenderRegion(renderId: string, opts: CaptureOptions = {}): Promise<CapturedImage> {
  // renderId is interpolated into an attribute selector below. It is always a
  // main-generated `mcp-<uuid>` today, but guard so a malformed id can never
  // break the selector or match unintended elements.
  if (!/^[\w-]+$/.test(renderId)) throw new Error(`invalid renderId: ${renderId}`);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  const el = await waitForVisibleRegion(renderId, timeoutMs, intervalMs);
  // Settle web fonts and give one more frame for final paint before capture.
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* noop */ } }
  await nextFrame();

  const r = el.getBoundingClientRect();
  const base64 = await window.sai.captureRegion({ x: r.x, y: r.y, width: r.width, height: r.height });
  if (!base64) throw new Error('capture returned no image');
  return { base64, mimeType: 'image/png' };
}
