import { describe, it, expect } from 'vitest';
import {
  encodeNativeMessage,
  createNativeMessageDecoder,
  createLineDecoder,
  MAX_NATIVE_MESSAGE_BYTES,
} from '@electron/browser-bridge-host';
import {
  bridgeSocketPath,
  bridgeTokenPath,
  bridgeDir,
} from '@electron/services/browserBridgePaths';

describe('native messaging framing', () => {
  it('encodes a 4-byte little-endian length prefix', () => {
    const buf = encodeNativeMessage({ a: 1 });
    const body = JSON.stringify({ a: 1 });
    expect(buf.readUInt32LE(0)).toBe(Buffer.byteLength(body));
    expect(buf.subarray(4).toString('utf8')).toBe(body);
  });

  it('round-trips a message', () => {
    const decoder = createNativeMessageDecoder();
    expect(decoder.push(encodeNativeMessage({ type: 'request', id: 'x' })))
      .toEqual([{ type: 'request', id: 'x' }]);
  });

  it('reassembles a message split across chunks', () => {
    const decoder = createNativeMessageDecoder();
    const framed = encodeNativeMessage({ hello: 'world' });

    // Split mid-header, then mid-body: both are real stdin behaviours.
    expect(decoder.push(framed.subarray(0, 2))).toEqual([]);
    expect(decoder.push(framed.subarray(2, 7))).toEqual([]);
    expect(decoder.push(framed.subarray(7))).toEqual([{ hello: 'world' }]);
  });

  it('returns every message in a coalesced chunk', () => {
    const decoder = createNativeMessageDecoder();
    const chunk = Buffer.concat([
      encodeNativeMessage({ n: 1 }),
      encodeNativeMessage({ n: 2 }),
      encodeNativeMessage({ n: 3 }),
    ]);
    expect(decoder.push(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('skips a corrupt frame but stays in sync for the next one', () => {
    const decoder = createNativeMessageDecoder();
    const bad = Buffer.from('not json', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);

    const chunk = Buffer.concat([header, bad, encodeNativeMessage({ ok: true })]);
    expect(decoder.push(chunk)).toEqual([{ ok: true }]);
  });

  it('refuses to encode past Chrome 1 MB cap', () => {
    const huge = { blob: 'x'.repeat(MAX_NATIVE_MESSAGE_BYTES) };
    expect(() => encodeNativeMessage(huge)).toThrow(/too large/);
  });

  it('rejects an absurd declared length instead of buffering forever', () => {
    const decoder = createNativeMessageDecoder();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0xffffffff, 0);
    expect(() => decoder.push(header)).toThrow(/exceeds limit/);
  });
});

describe('NDJSON line framing', () => {
  it('splits on newlines and reassembles partial lines', () => {
    const decoder = createLineDecoder();
    expect(decoder.push('{"a":1}\n{"b":')).toEqual([{ a: 1 }]);
    expect(decoder.push('2}\n')).toEqual([{ b: 2 }]);
  });

  it('ignores blank and malformed lines', () => {
    const decoder = createLineDecoder();
    expect(decoder.push('\n\nnot json\n{"c":3}\n')).toEqual([{ c: 3 }]);
  });
});

describe('bridge paths', () => {
  it('derives both endpoints from $HOME alone', () => {
    // The relay is spawned by Chrome and can be told nothing, so these must be
    // computable from the home directory and nothing else.
    expect(bridgeSocketPath('/home/u', 'linux')).toBe('/home/u/.sai/browser-bridge/bridge.sock');
    expect(bridgeTokenPath('/home/u')).toBe('/home/u/.sai/browser-bridge/token');
    expect(bridgeDir('/home/u')).toBe('/home/u/.sai/browser-bridge');
  });

  it('uses a named pipe on windows', () => {
    expect(bridgeSocketPath('C:\\Users\\u', 'win32')).toBe('\\\\.\\pipe\\sai-browser-bridge');
  });
});
