export function isBlankFrame(
  rgba: Uint8Array | Buffer,
  opts: { sampleStride?: number; threshold?: number } = {},
): boolean {
  const stride = Math.max(1, opts.sampleStride ?? 997);
  const threshold = opts.threshold ?? 0.01;
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return true;
  let sampled = 0;
  let nonBlank = 0;
  for (let p = 0; p < pixelCount; p += stride) {
    const i = p * 4;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    sampled++;
    const transparent = a === 0;
    const black = r === 0 && g === 0 && b === 0;
    if (!transparent && !black) nonBlank++;
  }
  if (sampled === 0) return true;
  return nonBlank / sampled <= threshold;
}
