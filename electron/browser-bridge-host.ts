/**
 * SAI Browser Bridge — native messaging relay host.
 *
 * Built to dist-electron/browser-bridge-host.js and registered with Chrome as
 * the native host `com.sai.browser_bridge` (see scripts/install-browser-bridge.mjs).
 * Chrome spawns one copy per extension port and talks Chrome's native
 * messaging framing (4-byte LE length + UTF-8 JSON) over stdio.
 *
 * All this process does is re-frame: native messages become NDJSON lines on
 * SAI's bridge socket and vice versa. It holds no state and makes no policy
 * decisions — SAI decides what to ask for, the extension decides what it will
 * answer.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import { bridgeSocketPath, bridgeTokenPath } from './services/browserBridgePaths';

/** Chrome rejects anything larger in either direction. */
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new Error(`native message too large: ${body.length} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export interface NativeMessageDecoder {
  /** Feeds bytes in, returns every complete message that became available. */
  push(chunk: Buffer): unknown[];
}

export function createNativeMessageDecoder(): NativeMessageDecoder {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk: Buffer): unknown[] {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      const out: unknown[] = [];

      for (;;) {
        if (buffer.length < 4) break;
        const len = buffer.readUInt32LE(0);
        if (len > MAX_NATIVE_MESSAGE_BYTES) {
          throw new Error(`native message length ${len} exceeds limit`);
        }
        if (buffer.length < 4 + len) break;
        const body = buffer.subarray(4, 4 + len).toString('utf8');
        buffer = buffer.subarray(4 + len);
        try {
          out.push(JSON.parse(body));
        } catch {
          // A corrupt frame is unrecoverable for the stream, but the length
          // prefix told us where it ended, so skip it and keep going.
        }
      }
      return out;
    },
  };
}

/** NDJSON line splitter for the socket side. */
export function createLineDecoder(): { push(chunk: string): unknown[] } {
  let buffer = '';
  return {
    push(chunk: string): unknown[] {
      buffer += chunk;
      const out: unknown[] = [];
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* ignore malformed line */
        }
      }
      return out;
    },
  };
}

function writeNative(value: unknown): void {
  try {
    process.stdout.write(encodeNativeMessage(value));
  } catch (err) {
    // Oversized frames are the extension's problem to avoid; tell it so rather
    // than dying silently and looking like SAI crashed.
    const message = err instanceof Error ? err.message : String(err);
    try {
      process.stdout.write(encodeNativeMessage({ type: 'bridge-error', error: message }));
    } catch {
      /* give up */
    }
  }
}

function readToken(tokenPath: string): string | null {
  try {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

export function main(): void {
  const socketPath = bridgeSocketPath();
  const tokenPath = bridgeTokenPath();

  const token = readToken(tokenPath);
  if (!token) {
    writeNative({ type: 'bridge-error', error: 'SAI is not running (no bridge token found)' });
    process.exit(1);
  }

  const socket = net.connect(socketPath);
  socket.setEncoding('utf8');

  const nativeIn = createNativeMessageDecoder();
  const socketIn = createLineDecoder();
  let authed = false;
  /** Frames the extension sent before the handshake completed. */
  const queued: unknown[] = [];

  const toSocket = (frame: unknown) => {
    try {
      socket.write(JSON.stringify(frame) + '\n');
    } catch {
      /* close handler will tear everything down */
    }
  };

  socket.on('connect', () => {
    toSocket({ type: 'hello', role: 'relay', token });
  });

  socket.on('data', (chunk: string) => {
    for (const frame of socketIn.push(chunk)) {
      const f = frame as { type?: string; error?: string };
      if (!authed) {
        if (f?.type === 'welcome') {
          authed = true;
          for (const q of queued.splice(0)) toSocket(q);
          continue;
        }
        writeNative({ type: 'bridge-error', error: f?.error || 'bridge handshake rejected' });
        socket.destroy();
        process.exit(1);
      }
      writeNative(frame);
    }
  });

  socket.on('error', (err) => {
    writeNative({ type: 'bridge-error', error: `cannot reach SAI: ${err.message}` });
    process.exit(1);
  });

  socket.on('close', () => {
    process.exit(0);
  });

  process.stdin.on('data', (chunk: Buffer) => {
    let frames: unknown[];
    try {
      frames = nativeIn.push(chunk);
    } catch (err) {
      writeNative({ type: 'bridge-error', error: err instanceof Error ? err.message : String(err) });
      socket.destroy();
      process.exit(1);
      return;
    }
    for (const frame of frames) {
      if (authed) toSocket(frame);
      else queued.push(frame);
    }
  });

  // Chrome closes our stdin when the extension disconnects the port.
  process.stdin.on('end', () => {
    try { socket.end(); } catch { /* noop */ }
    process.exit(0);
  });
}

// Only auto-run as the Node entry point, so tests can import the codecs.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
