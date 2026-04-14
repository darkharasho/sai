const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isSvgFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.svg');
}

export function getImageType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toUpperCase();
  return ext === 'JPG' ? 'JPEG' : ext;
}
