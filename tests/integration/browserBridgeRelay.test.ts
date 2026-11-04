/**
 * End-to-end over the REAL relay binary: spawns the built
 * dist-electron/browser-bridge-host.js with a throwaway $HOME, speaks Chrome's
 * native messaging framing at it the way Chrome would, and checks the frames
 * come out the other side on SAI's bridge socket.
 *
 * This is the only test that covers the native framing, the token file, and the
 * socket handshake together — the three things that break when the relay is
 * launched for real.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as bridge from '@electron/services/browserBridge';
import {
  encodeNativeMessage,
  createNativeMessageDecoder,
} from '@electron/browser-bridge-host';
import { bridgeSocketPath, bridgeTokenPath, bridgeDir } from '@electron/services/browserBridgePaths';

const RELAY = path.resolve(__dirname, '../../dist-electron/browser-bridge-host.js');
const TOKEN = 'c'.repeat(64);

// The relay is a build artifact; skip rather than fail in a clean checkout.
const built = fs.existsSync(RELAY);

let home = '';
let relay: ChildProcessWithoutNullStreams | null = null;

/** Reads native-framed frames off the relay's stdout. */
function collectFrames(child: ChildProcessWithoutNullStreams) {
  const decoder = createNativeMessageDecoder();
  const frames: any[] = [];
  const waiters: Array<(f: any) => void> = [];

  child.stdout.on('data', (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    }
  });

  return {
    next(): Promise<any> {
      const buffered = frames.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

beforeAll(() => {
  if (!built) {
    console.warn(`[skip] ${RELAY} not built — run \`npm run build\` to cover the relay`);
  }
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-relay-home-'));
  fs.mkdirSync(bridgeDir(home), { recursive: true });
  fs.writeFileSync(bridgeTokenPath(home), TOKEN + '\n', { mode: 0o600 });

  bridge._test_start({ socketPath: bridgeSocketPath(home, process.platform), token: TOKEN });
});

afterEach(() => {
  if (relay) {
    try { relay.kill('SIGKILL'); } catch { /* already gone */ }
    relay = null;
  }
  bridge._resetForTests();
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* noop */ }
});

function spawnRelay(): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [RELAY], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  relay = child;
  return child;
}

async function waitForConnection(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bridge.status().connected) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('relay never authenticated');
}

/**
 * The relay's exit and the bridge noticing its socket close are independent
 * events — under load the child can be reaped before the close handler runs,
 * so the disconnect has to be awaited rather than asserted inline.
 */
async function waitForDisconnect(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!bridge.status().connected) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('bridge still reports a connected browser');
}

describe.skipIf(!built)('browser bridge relay (real process)', () => {
  it('authenticates with the token file and round-trips a call', async () => {
    await bridge.whenListening();
    const child = spawnRelay();
    const out = collectFrames(child);
    await waitForConnection();

    // SAI asks; the fake extension (us, over stdio) answers.
    const pending = bridge.call('read', { tabId: 2, selector: 'main' });
    const request = await out.next();
    expect(request).toMatchObject({
      type: 'request',
      method: 'read',
      params: { tabId: 2, selector: 'main' },
    });

    child.stdin.write(
      encodeNativeMessage({ type: 'response', id: request.id, ok: true, result: { text: 'hi' } }),
    );
    expect(await pending).toEqual({ text: 'hi' });
  });

  it('forwards extension attach events into bridge status', async () => {
    await bridge.whenListening();
    const child = spawnRelay();
    await waitForConnection();

    child.stdin.write(encodeNativeMessage({ type: 'hello', role: 'extension', attachedTabIds: [5] }));
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !bridge.status().attachedTabIds.length) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(bridge.status().attachedTabIds).toEqual([5]);
  });

  it('tells the extension when SAI is not running', async () => {
    bridge._resetForTests();
    fs.rmSync(bridgeTokenPath(home));

    const child = spawnRelay();
    const out = collectFrames(child);
    expect(await out.next()).toMatchObject({
      type: 'bridge-error',
      error: expect.stringMatching(/SAI is not running/),
    });
  });

  it('exits when the extension closes the port', async () => {
    await bridge.whenListening();
    const child = spawnRelay();
    await waitForConnection();

    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.stdin.end();
    expect(await exited).toBe(0);
    await waitForDisconnect();
  });
});
