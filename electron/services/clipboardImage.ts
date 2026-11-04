// Re-read a clipboard image when the renderer's paste delivered broken bytes.
//
// Chromium's Wayland clipboard transfer intermittently hands the renderer a
// corrupt PNG for large images (truncated at a 1 KiB boundary, or with runs of
// bytes spliced in from elsewhere in the stream). A fresh read usually comes
// back clean, and `wl-paste` is a plain blocking reader that doesn't share
// Chromium's transfer path, so we try that first on Wayland, then Electron's
// raw `image/png` buffer. Every candidate is CRC-checked; we never return a
// broken image.

import { isIntactPng } from '../../src/lib/pngIntegrity';

export interface ClipboardImageDeps {
  /** Raw `image/png` bytes via `wl-paste`, or null when unavailable/failed. */
  wlPaste: () => Promise<Buffer | null>;
  /** Raw `image/png` bytes via Electron's clipboard, or null when empty. */
  electronPng: () => Buffer | null;
  isWayland: boolean;
  sleep: (ms: number) => Promise<void>;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const intact = (b: Buffer | null): b is Buffer =>
  !!b && b.length > 0 && isIntactPng(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));

/** Returns a `data:image/png;base64,…` URL of an intact clipboard image, or null. */
export async function readIntactClipboardPng(deps: ClipboardImageDeps, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await deps.sleep(150 * i);
    const sources: Array<[string, () => Promise<Buffer | null> | Buffer | null]> = [];
    if (deps.isWayland) sources.push(['wl-paste', deps.wlPaste]);
    sources.push(['electron', deps.electronPng]);
    for (const [name, read] of sources) {
      let buf: Buffer | null = null;
      try { buf = await read(); } catch { buf = null; }
      const ok = intact(buf);
      deps.log?.('clipboard-image-reread', { attempt: i, source: name, bytes: buf?.length ?? 0, ok });
      if (ok) return `data:image/png;base64,${buf!.toString('base64')}`;
    }
  }
  return null;
}
