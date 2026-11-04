import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import { readIntactClipboardPng, type ClipboardImageDeps } from '../../../electron/services/clipboardImage';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 1, 2, 3]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const good = tinyPng();
const broken = good.subarray(0, good.length - 12); // IEND missing

function deps(over: Partial<ClipboardImageDeps>): ClipboardImageDeps {
  return { wlPaste: async () => null, electronPng: () => null, isWayland: true, sleep: async () => {}, ...over };
}

describe('readIntactClipboardPng', () => {
  it('prefers an intact wl-paste read on Wayland', async () => {
    const electronPng = vi.fn(() => good);
    const url = await readIntactClipboardPng(deps({ wlPaste: async () => good, electronPng }));
    expect(url).toBe(`data:image/png;base64,${good.toString('base64')}`);
    expect(electronPng).not.toHaveBeenCalled();
  });

  it('falls back to the Electron buffer when wl-paste is broken', async () => {
    const url = await readIntactClipboardPng(deps({ wlPaste: async () => broken, electronPng: () => good }));
    expect(url).toContain(good.toString('base64'));
  });

  it('retries until a read comes back intact', async () => {
    let n = 0;
    const url = await readIntactClipboardPng(deps({ wlPaste: async () => (++n < 3 ? broken : good) }));
    expect(url).not.toBeNull();
    expect(n).toBe(3);
  });

  it('returns null rather than a broken image when every read is corrupt', async () => {
    const url = await readIntactClipboardPng(deps({ wlPaste: async () => broken, electronPng: () => broken }));
    expect(url).toBeNull();
  });

  it('skips wl-paste off Wayland and survives a throwing reader', async () => {
    const wlPaste = vi.fn(async () => good);
    const url = await readIntactClipboardPng(deps({ isWayland: false, wlPaste, electronPng: () => { throw new Error('x'); } }));
    expect(url).toBeNull();
    expect(wlPaste).not.toHaveBeenCalled();
  });
});
