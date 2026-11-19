// @vitest-environment jsdom
// The phone stack against a real desktop: the real useChatLog reads through
// the phone window.sai shim, whose V2Client talks to a real BridgeServer
// (ChatLogService + ChatCommands) over the `ws` WebSocket.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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
import { V2Client } from '../../../mobile/src/v2/client';
import { createSaiShim } from '../../../mobile/src/v2/saiShim';
import type { SocketLike } from '../../../mobile/src/v2/types';
import { useChatLog } from '../../../src/hooks/useChatLog';

const P = '/proj';
const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(() => {
  // jsdom has no animation frames unless asked; useChatLog batches on them.
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 4) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h));
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  delete (window as any).sai;
  vi.unstubAllGlobals();
});

/** A `ws` socket behind the browser-style surface, with test controls to lose frames and drop the link. */
class TapSocket implements SocketLike {
  static all: TapSocket[] = [];
  deaf = false;
  readonly inner: WebSocket;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  constructor(url: string) {
    TapSocket.all.push(this);
    this.inner = new WebSocket(url);
    this.inner.onopen = (e) => this.onopen?.(e);
    this.inner.onmessage = (e) => { if (!this.deaf) this.onmessage?.({ data: e.data }); };
    this.inner.onclose = (e) => this.onclose?.({ code: e.code, reason: e.reason });
    this.inner.onerror = (e) => this.onerror?.(e);
  }
  get readyState() { return this.inner.readyState; }
  send(d: string) { this.inner.send(d); }
  close(code?: number, reason?: string) { this.inner.close(code, reason); }
  /** A dead network: nothing more arrives, then the link goes. */
  drop() { this.deaf = true; this.inner.terminate(); }
}

async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Waits for the hook's state (React flushes inside waitFor's act). */
async function settle(fn: () => boolean, ms = 10_000) {
  await waitFor(() => { if (!fn()) throw new Error('not yet'); }, { timeout: ms, interval: 5 });
}

async function desktop(compactAfter?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-bridge-'));
  const store = new ChatLogStore({ dir, ...(compactAfter ? { compactAfter } : {}) });
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
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: 'Phone' }),
  })).json();

  TapSocket.all = [];
  const client = new V2Client({ url: `ws://127.0.0.1:${port}/ws`, token, WebSocketImpl: TapSocket });
  cleanup.push(() => client.close());
  const sai = createSaiShim(client, { native: { openUrl: () => {}, copyText: () => {}, toast: () => {} }, settings: () => ({}) });
  (window as any).sai = sai;
  client.connect();
  await until(() => client.state === 'open');
  return { store, service, client, sai };
}

const settings = { provider: 'claude' as const };

describe('phone shim over a real bridge', () => {
  it('resume after socket drop catches up exactly', async () => {
    const { store, service, client } = await desktop(100);
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
    appendOne(); // the chat exists before the first open

    const { result } = renderHook(() => useChatLog('c1', settings));
    await settle(() => result.current.state?.lastSeq === 1);

    // Stream until the phone has seen 150, then lose the network mid-stream.
    while (n < 150) { appendOne(); await new Promise((r) => setImmediate(r)); }
    await settle(() => (result.current.state?.lastSeq ?? 0) >= 150);
    TapSocket.all[TapSocket.all.length - 1].drop();
    await until(() => client.state === 'offline');
    while (n < 300) appendOne();
    const seen = result.current.state!.lastSeq;
    expect(seen).toBeLessThan(300);
    expect(store.meta('c1')!.snapshotSeq).toBeGreaterThan(seen); // catch-up must go through a snapshot

    client.resume(); // foreground: reconnect now
    await settle(() => result.current.state?.lastSeq === 300);
    expect(client.state).toBe('open');
    expect(result.current.state).toEqual(store.state('c1'));
    expect(result.current.state!.messages).toHaveLength(150);

    // Live again after the catch-up.
    appendOne(); appendOne();
    await settle(() => result.current.state?.lastSeq === 302);
    expect(result.current.state).toEqual(store.state('c1'));
  });

  it('resend after reconnect reuses clientId', async () => {
    const { store, service, client, sai } = await desktop();
    service.appendClient('c2', { type: 'local_note', content: 'hello' } as any, { projectPath: P });
    const { result } = renderHook(() => useChatLog('c2', settings));
    await settle(() => result.current.state?.lastSeq === 1);

    // The ack is lost: the desktop runs the send, the phone never hears back.
    const s1 = TapSocket.all[TapSocket.all.length - 1];
    s1.deaf = true;
    const sent = sai.chatlog!.command({ kind: 'send', chatId: 'c2', clientId: 'phone-1', text: 'from phone', origin: 'remote', projectPath: P });
    await until(() => store.state('c2')!.messages.some((m) => m.content === 'from phone'));
    s1.drop();
    await until(() => client.state === 'offline');
    client.resume();
    const ack = await sent;
    expect(ack).toMatchObject({ clientId: 'phone-1', ok: true, duplicate: true });

    await settle(() => result.current.state?.lastSeq === store.meta('c2')!.headSeq);
    const mine = (s: any) => s.messages.filter((m: any) => m.role === 'user' && m.content === 'from phone');
    expect(mine(store.state('c2'))).toHaveLength(1);
    expect(mine(result.current.state)).toHaveLength(1);
    expect(result.current.state).toEqual(store.state('c2'));
  });

  it('/help appends twice and both land', async () => {
    const { store, service, sai } = await desktop();
    service.appendClient('c4', { type: 'local_note', content: 'start' } as any, { projectPath: P });
    await sai.chatlog!.appendClient('c4', { type: 'user_message', local: true, text: '/help' } as any);
    await sai.chatlog!.appendClient('c4', { type: 'local_note', content: 'commands' } as any);
    await sai.chatlog!.appendClient('c4', { type: 'cleared' } as any);
    const types = store.read('c4', 0).entries.map((e) => e.ev.type);
    expect(types).toEqual(['local_note', 'user_message', 'local_note', 'cleared']);
  });

  it('open pages older messages on demand', async () => {
    const { store, service, sai } = await desktop();
    for (let i = 0; i < 450; i++) {
      service.appendClient('c3', { type: 'user_message', clientId: `u${i}`, text: `m${i}` }, { projectPath: P });
    }
    store.compact('c3'); // the whole chat is now one snapshot
    const full = store.state('c3')!;
    expect(full.messages).toHaveLength(450);

    const opened = await sai.chatlog!.open('c3', 0);
    expect(opened.olderCount).toBe(250);
    expect(opened.snapshot!.state.messages).toHaveLength(200);
    const p1 = await sai.chatlog!.page!('c3', 250, 200);
    expect(p1.olderCount).toBe(50);
    const p2 = await sai.chatlog!.page!('c3', 50, 200);
    expect(p2.olderCount).toBe(0);
    const stitched = [...p2.messages, ...p1.messages, ...opened.snapshot!.state.messages];
    expect(stitched.map((m) => m.content)).toEqual(full.messages.map((m) => m.content));

    // The same through the panel's reader and its "Load earlier".
    const { result } = renderHook(() => useChatLog('c3', settings));
    await settle(() => result.current.olderCount === 250);
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.olderCount).toBe(50);
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.olderCount).toBe(0);
    expect(result.current.state).toEqual(full);
  });
});
