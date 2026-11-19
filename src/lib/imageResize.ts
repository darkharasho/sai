/** Longest side allowed for images attached from the phone. */
export const PHONE_IMAGE_MAX_DIM = 2048;
export const PHONE_IMAGE_QUALITY = 0.85;

/** Scale (w, h) down to fit `max` on the longest side, preserving aspect ratio. Never upscales. */
export function fitWithin(width: number, height: number, max = PHONE_IMAGE_MAX_DIM): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/** Resize an image file to <= 2048px on its longest side and re-encode as JPEG 0.85. Returns a data URL. */
export async function resizeImageToJpegDataUrl(file: Blob): Promise<string> {
  const { source, width, height, release } = await decode(file);
  try {
    const target = fitWithin(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return canvas.toDataURL('image/jpeg', PHONE_IMAGE_QUALITY);
  } finally {
    release();
  }
}
