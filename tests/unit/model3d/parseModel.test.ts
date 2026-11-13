import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModel } from '../../../src/model3d/parseModel';

const fx = (n: string) => resolve(__dirname, '../../fixtures/model3d', n);
const toAB = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// Build a binary STL from the ASCII fixture's triangles.
function binaryFromAscii(ascii: string): ArrayBuffer {
  const verts = [...ascii.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  const tris = verts.length / 3;
  const buf = new ArrayBuffer(80 + 4 + tris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50;
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) dv.setFloat32(o + 12 + k * 12 + c * 4, verts[t * 3 + k][c], true);
    }
  }
  return buf;
}

describe('parseModel', () => {
  it('parses ascii and binary stl', async () => {
    const ascii = readFileSync(fx('cube-ascii.stl'), 'utf8');
    for (const buf of [toAB(Buffer.from(ascii)), binaryFromAscii(ascii)]) {
      const m = await parseModel(buf, 'stl');
      expect(m.triangles).toBe(12);
      expect(m.size.x).toBeCloseTo(10);
      expect(m.size.y).toBeCloseTo(10);
      expect(m.size.z).toBeCloseTo(10);
    }
  });

  it('parses obj', async () => {
    const m = await parseModel(toAB(readFileSync(fx('cube.obj'))), 'obj');
    expect(m.triangles).toBe(12);
    expect(m.size.x).toBeCloseTo(10);
  });

  it('rejects garbage and empty input', async () => {
    await expect(parseModel(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'stl')).rejects.toThrow(/invalid model/);
    await expect(parseModel(new ArrayBuffer(0), 'stl')).rejects.toThrow(/invalid model/);
    await expect(parseModel(new ArrayBuffer(0), 'obj')).rejects.toThrow(/invalid model/);
  });
});
