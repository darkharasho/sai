// Image-file detection shared across the renderer (ChatPanel, ToolCallCard,
// ToolResultImagePreview). The electron side has a parallel copy in
// electron/services/imageFiles.ts (kept in sync; the two build contexts do
// not share modules).

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
  const dot = filePath.lastIndexOf('.');
  if (dot < 0 || dot === filePath.length - 1) return '';
  return filePath.slice(dot + 1).toLowerCase();
}

export function isImagePath(filePath: string): boolean {
  return extOf(filePath) in MIME_BY_EXT;
}

export function mimeForImagePath(filePath: string): string {
  return MIME_BY_EXT[extOf(filePath)] ?? 'application/octet-stream';
}
