/**
 * Exercises the real socket: a fake relay connects to browserBridge exactly
 * the way electron/browser-bridge-host.ts does, and SAI's call() round-trips
 * through it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as bridge from '@electron/services/browserBridge';

const TOKEN = 'a'.repeat(64);

let socketPath = '';

/** A stand-in for the relay process: NDJSON in, NDJSON out. */
class FakeRelay {
  socket: net.Socket;
  frames: any[] = [];
  private buffer = '';
  private waiters: Array<(f: any) => void> = [];

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        const frame = JSON.parse(line);
        const waiter = this.waiters.shift();
        // Hand it straight to a waiting next(), otherwise buffer it — a frame
        // must never be both delivered and left in the queue.
        if (waiter) waiter(frame);
        else this.frames.push(frame);
      }
    });
  }

  static async connect(token: string = TOKEN): Promise<FakeRelay> {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    const relay = new FakeRelay(socket);
    relay.send({ type: 'hello', role: 'relay', token });
    return relay;
  }

  send(frame: unknown): void {
    this.socket.write(JSON.stringify(frame) + '\n');
  }

  next(): Promise<any> {
    const buffered = this.frames.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Answers the next request frame with `result`. */
  async autoRespond(result: unknown): Promise<any> {
    const req = await this.next();
    this.send({ type: 'response', id: req.id, ok: true, result });
    return req;
  }

  close(): void {
    try { this.socket.destroy(); } catch { /* noop */ }
  }
}

beforeEach(async () => {
  socketPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sai-bridge-test-')),
    `b-${crypto.randomBytes(4).toString('hex')}.sock`,
  );
  bridge._test_start({ socketPath, token: TOKEN });
  await bridge.whenListening();
});

afterEach(() => {
  bridge._resetForTests();
});

describe('browserBridge', () => {
  it('reports not-listening before start and listening after', async () => {
    bridge._resetForTests();
    expect(bridge.status()).toEqual({ listening: false, connected: false, attachedTabIds: [] });

    bridge._test_start({ socketPath: socketPath + '2', token: TOKEN });
    await bridge.whenListening();
    expect(bridge.status().listening).toBe(true);
    expect(bridge.status().connected).toBe(false);
  });

  it('fails closed with install guidance when no browser is connected', async () => {
    await expect(bridge.call('snapshot')).rejects.toThrow(/No browser is connected/);
  });

  it('welcomes a relay presenting the right token', async () => {
    const relay = await FakeRelay.connect();
    expect(await relay.next()).toEqual({ type: 'welcome' });
    expect(bridge.status().connected).toBe(true);
    relay.close();
  });

  it('rejects a relay with a bad token and stays disconnected', async () => {
    const relay = await FakeRelay.connect('b'.repeat(64));
    expect(await relay.next()).toMatchObject({ type: 'error', error: 'auth failed' });
    expect(bridge.status().connected).toBe(false);
    relay.close();
  });

  it('rejects a token of the wrong length without throwing on timingSafeEqual', async () => {
    const relay = await FakeRelay.connect('short');
    expect(await relay.next()).toMatchObject({ type: 'error', error: 'auth failed' });
    expect(bridge.status().connected).toBe(false);
    relay.close();
  });

  it('requires hello before anything else', async () => {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    const relay = new FakeRelay(socket);
    relay.send({ type: 'request', id: '1', method: 'snapshot' });
    expect(await relay.next()).toMatchObject({ type: 'error', error: 'expected relay hello' });
    relay.close();
  });

  it('round-trips a call and resolves with the extension result', async () => {
    const relay = await FakeRelay.connect();
    await relay.next(); // welcome

    const pending = bridge.call('read', { tabId: 4, selector: 'main' });
    const req = await relay.autoRespond({ text: 'page text' });

    expect(req).toMatchObject({ type: 'request', method: 'read', params: { tabId: 4, selector: 'main' } });
    expect(await pending).toEqual({ text: 'page text' });
    relay.close();
  });

  it('matches responses to their own call when several are in flight', async () => {
    const relay = await FakeRelay.connect();
    await relay.next();

    const first = bridge.call('read', { tabId: 1 });
    const second = bridge.call('read', { tabId: 2 });
    const reqA = await relay.next();
    const reqB = await relay.next();

    // Answer out of order — correlation is by id, not arrival order.
    relay.send({ type: 'response', id: reqB.id, ok: true, result: { n: 'B' } });
    relay.send({ type: 'response', id: reqA.id, ok: true, result: { n: 'A' } });

    expect(await first).toEqual({ n: 'A' });
    expect(await second).toEqual({ n: 'B' });
    relay.close();
  });

  it('surfaces an extension-side error as a rejection', async () => {
    const relay = await FakeRelay.connect();
    await relay.next();

    const pending = bridge.call('snapshot');
    const req = await relay.next();
    relay.send({ type: 'response', id: req.id, ok: false, error: 'no tab is attached' });

    await expect(pending).rejects.toThrow('no tab is attached');
    relay.close();
  });

  it('tracks attach/detach events in status', async () => {
    const relay = await FakeRelay.connect();
    await relay.next();

    relay.send({ type: 'hello', role: 'extension', version: '0.1.0', attachedTabIds: [11] });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.status().attachedTabIds).toEqual([11]);

    relay.send({ type: 'event', event: 'attached', tabId: 12 });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.status().attachedTabIds.sort()).toEqual([11, 12]);

    relay.send({ type: 'event', event: 'detached', tabId: 11 });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.status().attachedTabIds).toEqual([12]);
    relay.close();
  });

  it('rejects in-flight calls when the browser disconnects', async () => {
    const relay = await FakeRelay.connect();
    await relay.next();

    const pending = bridge.call('snapshot');
    await relay.next(); // let the request land first
    relay.close();

    await expect(pending).rejects.toThrow(/browser disconnected/);
    expect(bridge.status().connected).toBe(false);
  });

  it('lets a reconnecting service worker replace a stale relay', async () => {
    const stale = await FakeRelay.connect();
    await stale.next();

    const fresh = await FakeRelay.connect();
    expect(await fresh.next()).toEqual({ type: 'welcome' });
    expect(bridge.status().connected).toBe(true);

    const pending = bridge.call('tabs.list');
    await fresh.autoRespond({ tabs: [] });
    expect(await pending).toEqual({ tabs: [] });

    stale.close();
    fresh.close();
  });

  it('propagates a bridge-error frame to waiting calls', async () => {
    const relay = await FakeRelay.connect();
    await relay.next();

    const pending = bridge.call('snapshot');
    await relay.next();
    relay.send({ type: 'bridge-error', error: 'native message too large: 2000000 bytes' });

    await expect(pending).rejects.toThrow(/too large/);
    relay.close();
  });

  it('allows exactly the read and control method sets, and nothing else', () => {
    expect([...bridge.BRIDGE_READ_METHODS].sort()).toEqual(['read', 'snapshot', 'tabs.list']);
    expect([...bridge.BRIDGE_WRITE_METHODS].sort())
      .toEqual(['click', 'navigate', 'press', 'scroll', 'type']);
    expect([...bridge.BRIDGE_METHODS].sort()).toEqual([
      'click', 'navigate', 'press', 'read', 'scroll', 'snapshot', 'tabs.list', 'type',
    ]);
  });

  it('exposes no method that could drive a tab without going through the extension', () => {
    // The main process must never speak raw CDP: anything Input/Runtime-shaped
    // would bypass the per-tab control grant the extension enforces.
    for (const method of bridge.BRIDGE_METHODS) {
      expect(method).not.toMatch(/^(Input|Runtime|Page|Network|Target)\./);
    }
  });
});
