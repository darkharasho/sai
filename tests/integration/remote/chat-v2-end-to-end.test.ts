// Protocol v2 over a real BridgeServer: a paired client subscribes to a chat,
// drops its socket mid-stream, reconnects with `after: <last seen>` and ends
// with exactly the desktop's reduced state.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { ChatCommands } from '@electron/services/chatlog/commands';
import { emptyChatState, reduceMany } from '../../../src/lib/chat/reducer';
import type { ChatLogEntry, ChatState } from '../../../src/lib/chat/types';

const P = '/proj';
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** A v2 client applying the same dedupe/gap rules as useChatLog. */
class Client {
  state: ChatState = emptyChatState({ provider: 'claude' });
  head = 0;
  gaps = 0;
  snapshots = 0;
  dropped = false;
  ws!: WebSocket;
  inbox: any[] = [];
  constructor(private url: string, private token: string, private onEntry?: (c: Client) => void) {}

  async connect(): Promise<void> {
    this.dropped = false;
    this.inbox = [];
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('message', (d) => {
      if (this.dropped) return; // frames racing the drop are lost, like a dead network
      const m = JSON.parse(d.toString());
      this.inbox.push(m);
      if (m.type === 'chat.snapshot') { this.state = m.state; this.head = m.seq; this.snapshots++; }
      if (m.type === 'chat.entries') for (const e of m.entries) this.apply(e);
      if (m.type === 'chat.entry') this.apply(m.entry);
    });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    await until(() => this.inbox.some((m) => m.type === 'auth_ok'));
    ws.send(JSON.stringify({ v: 2, type: 'chat.subscribe', chatId: 'c1', after: this.head }));
  }

  private apply(e: ChatLogEntry) {
    if (e.seq <= this.head) return;
    if (e.seq !== this.head + 1) {
      this.gaps++;
      this.ws.send(JSON.stringify({ v: 2, type: 'chat.subscribe', chatId: 'c1', after: this.head }));
      return;
    }
    this.state = reduceMany(this.state, [e]);
    this.head = e.seq;
    this.onEntry?.(this);
  }

  drop() {
    this.dropped = true;
    this.ws.terminate();
  }
}

async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('chat protocol v2 end-to-end', () => {
  it('catch-up after a dropped socket reproduces the desktop state exactly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-v2-e2e-'));
    const store = new ChatLogStore({ dir, compactAfter: 100 });
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }), () => store.close());
    const bus = new SessionBus();
    const service = new ChatLogService({
      store, bus: () => bus, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
    });
    const commands = new ChatCommands({
      log: service, store,
      dispatch: {
        send: () => {}, stop: () => {}, approve: async () => {}, answer: async () => {}, planReview: async () => {},
        isBusy: () => false, isLoadPaused: () => false,
      },
    });
    const pairing = new PairingStore(':memory:');
    const server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus, pwaDir: null, screenshotSecret: 'e2e', loadScreenshot: async () => null,
      port: 0, chatSync: () => ({ store, commands }),
    });
    const { port } = await server.start();
    cleanup.push(() => server.stop());

    const code = server.mintPairingCode();
    const { token } = await (await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    })).json();

    // 75 turns × 4 entries = 300; every turn's done may compact (compactAfter 100).
    let n = 0;
    const appendOne = () => {
      const t = Math.floor(n / 4) + 1;
      switch (n % 4) {
        case 0: service.appendClient('c1', { type: 'user_message', clientId: `u${t}`, text: `q${t}` }, { projectPath: P }); break;
        case 1: service.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: t }); break;
        case 2: service.record({ type: 'assistant', projectPath: P, scope: 'c1', turnSeq: t, message: { content: [{ type: 'text', text: `a${t}` }] } }); break;
        case 3: service.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq: t }); break;
      }
      n++;
    };
    appendOne(); // the chat exists before the first subscribe

    let dropOnce = true;
    const client = new Client(`ws://127.0.0.1:${port}/ws`, token, (c) => {
      if (dropOnce && c.head >= 150) { dropOnce = false; c.drop(); }
    });
    await client.connect();
    while (n < 300) {
      appendOne();
      await new Promise((r) => setImmediate(r));
      if (n === 200) {
        // By now the client has dropped (it drops on seeing seq 150).
        await until(() => client.dropped);
        expect(client.head).toBeGreaterThanOrEqual(150);
        expect(client.head).toBeLessThan(300);
      }
    }
    expect(store.meta('c1')!.headSeq).toBe(300);
    expect(store.meta('c1')!.snapshotSeq).toBeGreaterThan(client.head); // catch-up must use a snapshot

    await client.connect(); // re-subscribes with after: <last seen>
    await until(() => client.head === 300);
    expect(client.snapshots).toBe(1);
    expect(client.gaps).toBe(0);
    expect(client.state).toEqual(store.state('c1'));
    expect(client.state.messages).toHaveLength(150);

    // Live after catch-up, and duplicate-safe commands over the same socket.
    client.ws.send(JSON.stringify({ v: 2, type: 'chat.command', command: { kind: 'send', chatId: 'c1', clientId: 'p1', text: 'from phone' } }));
    client.ws.send(JSON.stringify({ v: 2, type: 'chat.command', command: { kind: 'send', chatId: 'c1', clientId: 'p1', text: 'from phone' } }));
    await until(() => client.inbox.filter((m) => m.type === 'chat.ack').length === 2 && client.head === 301);
    const acks = client.inbox.filter((m) => m.type === 'chat.ack').map((m) => m.result.duplicate).sort();
    expect(acks).toEqual([false, true]);
    expect(client.state).toEqual(store.state('c1'));
    client.ws.close();
  });
});
