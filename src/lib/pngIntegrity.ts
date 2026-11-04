// Structural integrity check for PNG bytes.
//
// Why: on Linux/Wayland the clipboard transfer from the copying app into
// Chromium intermittently delivers broken image bytes for large images —
// either cut off at a 1 KiB boundary (no IEND) or with runs of bytes from
// elsewhere in the stream spliced in. Chromium still renders what decodes
// (top of the image, then black), so a paste looks "half black" and the model
// can't read it. Every PNG chunk carries a CRC32, so walking the chunks catches
// both failure shapes cheaply (~ms for a multi-MB screenshot).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** True when `bytes` is a complete PNG: valid signature, every chunk's CRC matches, ends with IEND. */
export function isIntactPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8 + 12) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = view.getUint32(p);
    const dataEnd = p + 8 + len;
    if (dataEnd + 4 > bytes.length) return false;
    if (crc32(bytes, p + 4, dataEnd) !== view.getUint32(dataEnd)) return false;
    const isIend = bytes[p + 4] === 0x49 && bytes[p + 5] === 0x45 && bytes[p + 6] === 0x4e && bytes[p + 7] === 0x44;
    p = dataEnd + 4;
    if (isIend) return true;
  }
  return false;
}
