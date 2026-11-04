import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { isIntactPng } from '../../src/lib/pngIntegrity';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A real, decodable RGB PNG split into small IDAT chunks (like Qt's 4 KiB chunks). */
function makePng(w = 64, h = 64): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = randomBytes((w * 3 + 1) * h); // incompressible → ~12 KiB of IDAT
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; // filter byte
  const z = zlib.deflateSync(raw);
  const idats: Buffer[] = [];
  for (let o = 0; o < z.length; o += 1024) idats.push(chunk('IDAT', z.subarray(o, o + 1024)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), ...idats, chunk('IEND', Buffer.alloc(0)),
  ]);
}

const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.length);

describe('isIntactPng', () => {
  it('accepts a well-formed PNG', () => {
    expect(isIntactPng(u8(makePng()))).toBe(true);
  });

  it('rejects a PNG truncated at a 1 KiB boundary (no IEND)', () => {
    const png = makePng();
    expect(isIntactPng(u8(png.subarray(0, 4096)))).toBe(false);
  });

  it('rejects a PNG whose middle bytes were replaced by bytes from elsewhere (interleaved transfer)', () => {
    const png = Buffer.from(makePng());
    png.copy(png, 3000, 6000, 7000); // overwrite a run with a later run, length unchanged, IEND intact
    expect(isIntactPng(u8(png))).toBe(false);
  });

  it('rejects non-PNG bytes', () => {
    expect(isIntactPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
