import { describe, it, expect } from 'vitest';
import { isBlankFrame } from '../../../../electron/capture/blankFrame';

function rgba(pixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => { out.set([r, g, b, a], i * 4); });
  return out;
}

describe('isBlankFrame', () => {
  it('flags an all-black opaque buffer as blank', () => {
    const buf = rgba(Array.from({ length: 2000 }, () => [0, 0, 0, 255] as [number, number, number, number]));
    expect(isBlankFrame(buf, { sampleStride: 1 })).toBe(true);
  });

  it('flags a fully transparent buffer as blank', () => {
    const buf = rgba(Array.from({ length: 2000 }, () => [10, 20, 30, 0] as [number, number, number, number]));
    expect(isBlankFrame(buf, { sampleStride: 1 })).toBe(true);
  });

  it('does NOT flag a buffer with real content', () => {
    const px = Array.from({ length: 2000 }, () => [0, 0, 0, 255] as [number, number, number, number]);
    for (let i = 0; i < 1000; i++) px[i] = [120, 130, 140, 255];
    expect(isBlankFrame(rgba(px), { sampleStride: 1 })).toBe(false);
  });

  it('treats an empty buffer as blank', () => {
    expect(isBlankFrame(new Uint8Array(0))).toBe(true);
  });
});
