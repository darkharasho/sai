// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService } from '@electron/services/chatlog/service';
import { ChatCommands, type ProviderDispatch } from '@electron/services/chatlog/commands';
import { SessionBus } from '@electron/services/remote/session-bus';
import { ChatV2, SNAPSHOT_MESSAGES } from '@electron/services/remote/chat-v2';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import type { ChatEvent } from '../../../src/lib/chat/types';
import type { PermMode } from '@electron/services/remote/clamp';

const dirs: string[] = [];
const stores: ChatLogStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* ignore */ } }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-v2-'));
  dirs.push(d);
  return d;
}

function mk(opts: { compactAfter?: number; ceiling?: PermMode | null } = {}) {
  const store = new ChatLogStore({ dir: tmp(), compactAfter: opts.compactAfter });
  stores.push(store);
  const bus = new SessionBus();
  const service = new ChatLogService({
    store, bus: () => bus, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
  });
  const dispatch = {
    send: vi.fn(), stop: vi.fn(),
    approve: vi.fn(async () => {}), answer: vi.fn(async () => {}), planReview: vi.fn(async () => {}),
    isBusy: () => false, isLoadPaused: () => false,
  } satisfies ProviderDispatch;
  const commands = new ChatCommands({ log: service, store, dispatch, getRemoteCeiling: () => opts.ceiling ?? null });
  const saveImages = vi.fn((imgs: string[]) => imgs.map((_, i) => `/tmp/sai-images/img${i}.png`));
  const v2 = new ChatV2({ bus, chat: () => ({ store, commands }), saveImages });
  const frames: any[] = [];
  const ws = { send: (d: string) => { frames.push(JSON.parse(d)); } };
  return { store, bus, service, dispatch, commands, v2, ws, frames, saveImages };
}

const um = (t: string): ChatEvent => ({ type: 'user_message', clientId: t, text: t });
const P = '/proj';

describe('ChatV2', () => {
  it('subscribe after=0 on a fresh chat sends entries 1..n then live entries', async () => {
    const { service, v2, ws, frames } = mk();
    for (let i = 1; i <= 3; i++) service.appendClient('c1', um('m' + i), { projectPath: P });
    await v2.handle(ws, { v: 2, type: 'chat.subscribe', chatId: 'c1', after: 0 });
    expect(frames.map(f => f.type)).toEqual(['chat.entries']);
    expect(frames[0]).toMatchObject({ v: 2, chatId: 'c1' });
    expect(frames[0].entries.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    service.appendClient('c1', um('m4'));
    service.appendClient('c2', um('other'), { projectPath: P }); // not subscribed
    expect(frames.slice(1)).toEqual([{ v: 2, type: 'chat.entry', chatId: 'c1', entry: expect.objectContaining({ seq: 4 }) }]);
    // Unsubscribe stops live delivery.
    await v2.handle(ws, { type: 'chat.unsubscribe', chatId: 'c1' });
    service.appendClient('c1', um('m5'));
    expect(frames).toHaveLength(2);
  });

  it('subscribe with after sends only the entries after it', async () => {
    const { service, v2, ws, frames } = mk();
    for (let i = 1; i <= 5; i++) service.appendClient('c1', um('m' + i), { projectPath: P });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 3 });
    expect(frames.map(f => f.type)).toEqual(['chat.entries']);
    expect(frames[0].entries.map((e: any) => e.seq)).toEqual([4, 5]);
  });

  it('subscribe after compaction sends snapshot', async () => {
    const { store, service, v2, ws, frames } = mk({ compactAfter: 5 });
    for (let i = 1; i <= 6; i++) service.appendClient('c1', um('m' + i), { projectPath: P });
    store.append('c1', { type: 'done' }); // seq 7 compacts
    service.appendClient('c1', um('m8'));
    expect(store.meta('c1')!.snapshotSeq).toBe(7);
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 2 });
    expect(frames.map(f => f.type)).toEqual(['chat.snapshot', 'chat.entries']);
    expect(frames[0]).toMatchObject({ chatId: 'c1', seq: 7, olderCount: 0 });
    expect(frames[0].state.messages).toHaveLength(6);
    expect(frames[1].entries.map((e: any) => e.seq)).toEqual([8]);
    // A client already past the snapshot gets no snapshot.
    frames.length = 0;
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 7 });
    expect(frames.map(f => f.type)).toEqual(['chat.entries']);
  });

  it('snapshot frame sends at most 200 messages with olderCount', async () => {
    const { store, service, v2, ws, frames } = mk();
    const history = Array.from({ length: 250 }, (_, i) => ({ id: 'h' + i, role: 'user' as const, content: 'x' + i, timestamp: i }));
    service.importMessages('c1', { projectPath: P, provider: 'claude', createdAt: 1, updatedAt: 1 }, history);
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    const snap = frames.find(f => f.type === 'chat.snapshot');
    expect(snap.state.messages).toHaveLength(SNAPSHOT_MESSAGES);
    expect(snap.olderCount).toBe(50);
    expect(snap.state.messages[0].id).toBe('h50');
    expect(store.state('c1')!.messages).toHaveLength(250); // the log itself is untouched
    // Older messages page in by absolute index.
    await v2.handle(ws, { type: 'chat.page', reqId: 'r1', chatId: 'c1', beforeIndex: 50, limit: 500 });
    const page = frames.find(f => f.type === 'chat.page.result');
    expect(page).toMatchObject({ v: 2, reqId: 'r1', chatId: 'c1', olderCount: 0 });
    expect(page.messages).toHaveLength(50);
    expect(page.messages.at(-1).id).toBe('h49');
    await v2.handle(ws, { type: 'chat.page', reqId: 'r2', chatId: 'c1', beforeIndex: 50, limit: 20 });
    expect(frames.at(-1)).toMatchObject({ reqId: 'r2', olderCount: 30 });
    expect(frames.at(-1).messages.map((m: any) => m.id)[0]).toBe('h30');
  });

  it('a trimmed snapshot shifts turn.startIndex with the cut', async () => {
    const { service, store, v2, ws, frames } = mk();
    const history = Array.from({ length: 210 }, (_, i) => ({ id: 'h' + i, role: 'user' as const, content: 'x', timestamp: i }));
    service.importMessages('c1', { projectPath: P, provider: 'claude', createdAt: 1, updatedAt: 1 }, history);
    service.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    store.compact('c1');
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    const snap = frames.find(f => f.type === 'chat.snapshot');
    expect(snap.olderCount).toBe(10);
    expect(snap.state.turn.startIndex).toBe(200);
  });

  it('a history fold reaches a subscriber at the pre-fold head as a snapshot (R15.2)', async () => {
    const { service, v2, ws, frames } = mk();
    service.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
    service.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 }); // H = 2
    service.importMessages('c1', { projectPath: P, provider: 'claude', createdAt: 1, updatedAt: 1 },
      [{ id: 'old', role: 'user', content: 'old', timestamp: 0 }]);
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 2 });
    expect(frames.map(f => f.type)).toEqual(['chat.snapshot', 'chat.entries']);
    expect(frames[0].seq).toBe(3);
    expect(frames[0].state.messages.map((m: any) => m.id)).toEqual(['old']);
  });

  it('a client ahead of the log (reset) gets a snapshot of the current state', async () => {
    const { service, v2, ws, frames } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 40 });
    expect(frames.map(f => f.type)).toEqual(['chat.snapshot', 'chat.entries']);
    expect(frames[0]).toMatchObject({ seq: 1 });
    expect(frames[0].state.messages).toHaveLength(1);
  });

  it('an entry published between read and attach is delivered exactly once', async () => {
    const { store, service, bus, commands, ws, frames } = mk();
    service.appendClient('c1', um('m1'), { projectPath: P });
    // A store whose read() lets one more entry land (and publish) mid-read.
    let raced = false;
    const racyStore = new Proxy(store, {
      get(t, prop) {
        if (prop === 'read') {
          return (chatId: string, after: number) => {
            if (!raced) { raced = true; service.appendClient('c1', um('m2')); }
            return t.read(chatId, after);
          };
        }
        const v = Reflect.get(t, prop);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const v2 = new ChatV2({ bus, chat: () => ({ store: racyStore, commands }) });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    service.appendClient('c1', um('m3'));
    const seqs = frames.flatMap(f => f.type === 'chat.entries' ? f.entries.map((e: any) => e.seq) : f.type === 'chat.entry' ? [f.entry.seq] : []);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('an entry published after attach but missing from the read is delivered from the buffer', async () => {
    const { store, service, bus, commands, ws, frames } = mk();
    service.appendClient('c1', um('m1'), { projectPath: P });
    // The read reflects the log before the racing append (stale read).
    const stale = store.read('c1', 0);
    const racyStore = new Proxy(store, {
      get(t, prop) {
        if (prop === 'read') return () => { service.appendClient('c1', um('m2')); return stale; };
        const v = Reflect.get(t, prop);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const v2 = new ChatV2({ bus, chat: () => ({ store: racyStore, commands }) });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    expect(frames.map(f => f.type)).toEqual(['chat.entries', 'chat.entry']);
    expect(frames[1].entry.seq).toBe(2);
  });

  it('chat.command send acks; a duplicate clientId acks duplicate:true and does not dispatch', async () => {
    const { v2, ws, frames, dispatch, store } = mk();
    const cmd = { kind: 'send', chatId: 'c1', clientId: 'k1', text: 'hello', projectPath: P };
    await v2.handle(ws, { type: 'chat.command', command: cmd });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.ack', result: { clientId: 'k1', ok: true, duplicate: false, seq: 1 } });
    expect(dispatch.send).toHaveBeenCalledTimes(1);
    await v2.handle(ws, { type: 'chat.command', command: cmd });
    expect(frames.at(-1)).toEqual({ v: 2, type: 'chat.ack', result: { clientId: 'k1', ok: true, duplicate: true, seq: 1 } });
    expect(dispatch.send).toHaveBeenCalledTimes(1);
    expect(store.state('c1')!.messages).toHaveLength(1);
  });

  it('remote send origin is forced to remote and capped by the remote ceiling', async () => {
    const { v2, ws, frames, dispatch, store, saveImages } = mk({ ceiling: 'always-ask' });
    await v2.handle(ws, { type: 'chat.command', command: {
      kind: 'settings', chatId: 'c1', clientId: 's1', origin: 'desktop', projectPath: P,
      settings: { provider: 'claude', permMode: 'bypass', model: 'opus', bogus: 'x' },
    } });
    expect(frames.at(-1).result.ok).toBe(true);
    expect(store.state('c1')!.settings).toMatchObject({ provider: 'claude', permMode: 'default', model: 'opus' });
    expect((store.state('c1')!.settings as any).bogus).toBeUndefined();
    const img = 'data:image/png;base64,AAAA';
    await v2.handle(ws, { type: 'chat.command', command: {
      kind: 'send', chatId: 'c1', clientId: 'k1', text: 'hi', origin: 'desktop',
      images: [img, 'not-a-data-url'], imagePaths: ['/etc/passwd'], promptOverride: 'evil',
    } });
    expect(frames.at(-1).result).toMatchObject({ ok: true });
    expect(saveImages).toHaveBeenCalledWith([img]);
    const sent = (dispatch.send.mock.calls as any[])[0][1];
    expect(sent).toMatchObject({ origin: 'remote', prompt: 'hi', imagePaths: ['/tmp/sai-images/img0.png'] });
    expect(sent.settings.permMode).toBe('default');
    const last = store.state('c1')!.messages.at(-1)!;
    expect(last).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('a phone-supplied projectPath never overrides an existing chat\'s project', async () => {
    const { service, v2, ws, dispatch, store } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'send', chatId: 'c1', clientId: 'k1', text: 'x', projectPath: '/elsewhere' } });
    expect((dispatch.send.mock.calls as any[])[0][1].projectPath).toBe(P);
    expect(store.meta('c1')!.projectPath).toBe(P);
  });

  it('a phone send creating a chat leaves it unimported so desktop history can still fold in (R15.1)', async () => {
    const { v2, ws, store, service } = mk();
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'send', chatId: 'c1', clientId: 'k1', text: 'from phone', projectPath: P } });
    expect(store.meta('c1')!.imported).toBeFalsy();
    expect(service.importMessages('c1', { projectPath: P, provider: 'claude', createdAt: 1, updatedAt: 1 },
      [{ id: 'old', role: 'user', content: 'old', timestamp: 0 }])).toBe('folded');
    expect(store.state('c1')!.messages.map(m => m.content)).toEqual(['old', 'from phone']);
  });

  it('malformed commands ack ok:false (or chat.error without a clientId)', async () => {
    const { v2, ws, frames, dispatch } = mk();
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'approve', chatId: 'c1', clientId: 'a1', toolUseId: 't' } });
    expect(frames.at(-1)).toMatchObject({ type: 'chat.ack', result: { clientId: 'a1', ok: false, error: 'approved required' } });
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'nope', chatId: 'c1', clientId: 'a2' } });
    expect(frames.at(-1).result).toMatchObject({ ok: false, error: 'unknown command nope' });
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'interrupt', chatId: 'c1' } });
    expect(frames.at(-1)).toMatchObject({ v: 2, type: 'chat.error', chatId: 'c1', code: 'bad_request' });
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'interrupt', chatId: 'c1', clientId: 'a3' } });
    expect(frames.at(-1).result).toMatchObject({ ok: false, error: 'unknown chat c1' });
    expect(dispatch.stop).not.toHaveBeenCalled();
  });

  it('queueRemove of an item that already left the queue acks not queued', async () => {
    const { service, v2, ws, frames } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chat.command', command: { kind: 'queueRemove', chatId: 'c1', clientId: 'q1', target: 'gone' } });
    expect(frames.at(-1).result).toMatchObject({ ok: false, error: 'not queued: gone' });
  });

  it('chats.list matches a symlinked projectPath', async () => {
    const { service, v2, ws, frames } = mk();
    const base = tmp();
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    service.appendClient('c1', um('a'), { projectPath: real });
    service.appendClient('c2', um('a'), { projectPath: path.join(base, 'other') });
    await v2.handle(ws, { type: 'chats.list', reqId: 7, projectPath: link });
    expect(frames.at(-1)).toMatchObject({ v: 2, type: 'chats.list.result', reqId: 7 });
    expect(frames.at(-1).chats.map((m: any) => m.chatId)).toEqual(['c1']);
  });

  it('detach drops every subscription of the socket', async () => {
    const { service, v2, ws, frames } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    v2.detach(ws);
    service.appendClient('c1', um('b'));
    expect(frames.map(f => f.type)).toEqual(['chat.entries']);
  });

  it('a re-subscribe replaces the previous subscription (no double delivery)', async () => {
    const { service, v2, ws, frames } = mk();
    service.appendClient('c1', um('a'), { projectPath: P });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 1 });
    frames.length = 0;
    service.appendClient('c1', um('b'));
    expect(frames).toHaveLength(1);
  });

  it('chat.* frames before the chat log exists get chat.error unavailable', async () => {
    const ws = { send: vi.fn() };
    const v2 = new ChatV2({ bus: new SessionBus(), chat: () => null });
    await v2.handle(ws, { type: 'chat.subscribe', chatId: 'c1', after: 0 });
    expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ v: 2, type: 'chat.error', code: 'unavailable' });
  });
});

describe('ChatV2 on the bridge socket', () => {
  async function startBridge() {
    const ctx = mk();
    const pairing = new PairingStore(':memory:');
    const server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus: ctx.bus, pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null,
      chatSync: () => ({ store: ctx.store, commands: ctx.commands }),
    });
    const { port } = await server.start();
    return { ...ctx, server, port };
  }

  function collect(ws: WebSocket): any[] {
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    return inbox;
  }
  async function until(fn: () => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it('unauthenticated chat.* frames close the socket 4001', async () => {
    const { server, port } = await startBridge();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const close = await new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
        ws.on('open', () => ws.send(JSON.stringify({ v: 2, type: 'chat.subscribe', chatId: 'c1', after: 0 })));
      });
      expect(close).toBe(4001);
    } finally { await server.stop(); }
  });

  it('v1 frames still work alongside v2 on the same socket', async () => {
    const { server, port, service, bus } = await startBridge();
    try {
      const code = server.mintPairingCode();
      const { token } = await (await fetch(`http://127.0.0.1:${port}/pair`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: 'T' }),
      })).json();
      service.appendClient('c1', um('a'), { projectPath: P });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const inbox = collect(ws);
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'auth', token }));
      await until(() => inbox.some(m => m.type === 'auth_ok'));
      ws.send(JSON.stringify({ v: 2, type: 'chat.subscribe', chatId: 'c1', after: 0 }));
      ws.send(JSON.stringify({ type: 'ping' }));
      ws.send(JSON.stringify({ type: 'session.attach', projectPath: P, scope: 'chat' }));
      await until(() => inbox.some(m => m.type === 'pong') && inbox.some(m => m.type === 'chat.entries'));
      await new Promise((r) => setTimeout(r, 30));
      bus.publish(`chat:${P}:chat`, { type: 'noop', payload: 1 });
      service.appendClient('c1', um('b'));
      await until(() => inbox.some(m => m.type === 'noop') && inbox.some(m => m.type === 'chat.entry'));
      expect(inbox.find(m => m.type === 'pong').v).toBe(1);
      expect(inbox.find(m => m.type === 'noop')).toMatchObject({ v: 1, topic: `chat:${P}:chat` });
      expect(inbox.find(m => m.type === 'chat.entry')).toMatchObject({ v: 2, chatId: 'c1', entry: { seq: 2 } });
      // chatlog topics never leak into the v1 forwarder.
      expect(inbox.filter(m => m.v === 1 && String(m.topic ?? '').startsWith('chatlog:'))).toEqual([]);
      ws.close();
    } finally { await server.stop(); }
  });
});
