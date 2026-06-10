// Image-file detection for the electron main process. Parallel copy of
// src/lib/imageFiles.ts (the renderer and main build contexts do not share
// modules; keep the extension list in sync).
import path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

function extOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

export function isImagePath(filePath: string): boolean {
  return extOf(filePath) in MIME_BY_EXT;
}

export function mimeForImagePath(filePath: string): string {
  return MIME_BY_EXT[extOf(filePath)] ?? 'application/octet-stream';
}

/**
 * Build a Read tool result for an image file: a short placeholder text (so the
 * model context is not fed garbage bytes) plus an image reference by file path.
 * Returns null for non-image paths.
 */
export function imageReadResult(filePath: string): { text: string; image: { path: string; media_type: string } } | null {
  if (!isImagePath(filePath)) return null;
  return {
    text: `[image: ${path.basename(filePath)}]`,
    image: { path: filePath, media_type: mimeForImagePath(filePath) },
  };
}
