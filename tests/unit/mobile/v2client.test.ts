// V2Client against a scripted fake WebSocket: auth, subscription replay with
// the current `after`, unpaired closes, heartbeat, backoff, request timeouts
// and the foreground probe.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { V2Client } from '../../../mobile/src/v2/client';
import type { ConnState } from '../../../mobile/src/v2/types';
import { FakeSocket } from './fakeSocket';

const last = () => FakeSocket.all[FakeSocket.all.length - 1];
let clock = 0;
const make = () => new V2Client({
  url: 'ws://desk:17830/ws', token: 'tok', WebSocketImpl: FakeSocket as any, now: () => clock, random: () => 0.5,
});
const advance = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); };

beforeEach(() => { FakeSocket.all = []; clock = 1_000_000; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('V2Client', () => {
  it('auth then resubscribe all on reconnect with current after', () => {
    const c = make();
    const states: ConnState[] = [];
    c.onState((s) => states.push(s));
    c.connect();
    expect(c.state).toBe('connecting');
    const s1 = last();
    s1.open();
    expect(s1.sent[0]).toEqual({ type: 'auth', token: 'tok' });
    s1.authOk();
    expect(c.state).toBe('open');

    c.send({ type: 'chat.subscribe', chatId: 'a', after: 0 });
    expect(c.state).toBe('catching_up');
    c.send({ type: 'chat.subscribe', chatId: 'b', after: 3 });
    void c.request({ type: 'chats.subscribe', projectPath: '/p' }).catch(() => {});
    void c.request({ type: 'workspaces.subscribe' }).catch(() => {});
    s1.recv({ type: 'chat.snapshot', chatId: 'a', seq: 10, state: {}, olderCount: 0 });
    s1.recv({ type: 'chat.entries', chatId: 'a', entries: [{ chatId: 'a', seq: 11 }, { chatId: 'a', seq: 12 }] });
    expect(c.state).toBe('catching_up'); // b still awaits its entries
    s1.recv({ type: 'chat.entries', chatId: 'b', entries: [] });
    expect(c.state).toBe('open');
    s1.recv({ type: 'chat.entry', chatId: 'a', entry: { chatId: 'a', seq: 13 } });
    s1.recv({ type: 'chat.entry', chatId: 'b', entry: { chatId: 'b', seq: 4 } });

    s1.serverClose(1006);
    expect(c.state).toBe('offline');
    advance(1000); // backoff 1s (jitter 0.5 → ×1.0)
    const s2 = last();
    expect(s2).not.toBe(s1);
    s2.open();
    expect(s2.sent).toEqual([{ type: 'auth', token: 'tok' }]); // nothing before auth_ok
    s2.authOk();
    const subs = s2.sent.filter((f) => f.type === 'chat.subscribe').map((f) => [f.chatId, f.after]);
    expect(subs).toEqual([['a', 13], ['b', 4]]);
    expect(s2.types()).toContain('chats.subscribe');
    expect(s2.types()).toContain('workspaces.subscribe');
    expect(s2.sent.find((f) => f.type === 'chats.subscribe').projectPath).toBe('/p');
    expect(c.state).toBe('catching_up');
    s2.recv({ type: 'chat.entries', chatId: 'a', entries: [] });
    s2.recv({ type: 'chat.entries', chatId: 'b', entries: [] });
    expect(c.state).toBe('open');
    expect(states).toEqual(['connecting', 'open', 'catching_up', 'open', 'offline', 'connecting', 'catching_up', 'open']);
  });

  it('a subscribe still awaiting its entries is replayed with its own after', () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    c.send({ type: 'chat.subscribe', chatId: 'a', after: 0 });
    // A stray live entry of an older subscription must not raise the replay's after.
    last().recv({ type: 'chat.entry', chatId: 'a', entry: { chatId: 'a', seq: 40 } });
    last().serverClose(1006);
    advance(1000);
    last().open(); last().authOk();
    expect(last().sent.filter((f) => f.type === 'chat.subscribe').map((f) => f.after)).toEqual([0]);
  });

  it('chat.unsubscribe stops the replay; frames sent offline wait for auth', () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    c.send({ type: 'chat.subscribe', chatId: 'a', after: 0 });
    last().recv({ type: 'chat.entries', chatId: 'a', entries: [] });
    c.send({ type: 'chat.unsubscribe', chatId: 'a' });
    last().serverClose(1006);
    c.send({ type: 'chat.page', chatId: 'x', beforeIndex: 5, limit: 2 });
    advance(1000);
    last().open(); last().authOk();
    expect(last().types()).toEqual(['auth', 'chat.page']);
  });

  it('chats.list.result is tagged with the projectPath it answers, replays included', () => {
    const c = make();
    const got: any[] = [];
    c.on('chats.list.result', (f) => got.push(f));
    c.connect(); last().open(); last().authOk();
    void c.request({ type: 'chats.subscribe', projectPath: '/p' });
    const reqId = last().sent.find((f) => f.type === 'chats.subscribe').reqId;
    last().recv({ type: 'chats.list.result', reqId, chats: [] });
    last().serverClose(1006);
    advance(1000);
    last().open(); last().authOk();
    const replay = last().sent.find((f) => f.type === 'chats.subscribe');
    last().recv({ type: 'chats.list.result', reqId: replay.reqId, chats: [{ chatId: 'z' }] });
    expect(got.map((f) => f.projectPath)).toEqual(['/p', '/p']);
  });

  it('4001 auth_failed surfaces as unpaired and stops reconnecting', async () => {
    const c = make();
    c.connect();
    last().open();
    const pending = c.request({ type: 'models.list', provider: 'claude' });
    last().serverClose(4001);
    expect(c.state).toBe('unpaired');
    await expect(pending).rejects.toMatchObject({ code: 'unpaired' });
    advance(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    c.resume(); // foreground doesn't revive an unpaired machine
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('1008 revoke surfaces as unpaired', () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    last().serverClose(1008);
    expect(c.state).toBe('unpaired');
    advance(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('heartbeat kills a silent socket and reconnects with backoff', () => {
    const c = make();
    c.connect();
    const s1 = last();
    s1.open(); s1.authOk();
    advance(25_000);
    expect(s1.types()).toContain('ping');
    s1.recv({ v: 1, type: 'pong' }); // alive
    advance(10_000);
    expect(s1.readyState).toBe(1);
    advance(15_000); // next ping at 50s; stays silent
    advance(10_000);
    expect(s1.readyState).toBe(3);
    expect(c.state).toBe('offline');
    expect(FakeSocket.all).toHaveLength(1);
    advance(999);
    expect(FakeSocket.all).toHaveLength(1);
    advance(1);
    const s2 = last();
    expect(s2).not.toBe(s1);
    // A failed attempt doubles the delay: 2s next.
    s2.serverClose(1006);
    advance(1999);
    expect(FakeSocket.all).toHaveLength(2);
    advance(1);
    expect(FakeSocket.all).toHaveLength(3);
    // Backoff caps at 30s.
    for (let i = 0; i < 6; i++) { last().serverClose(1006); advance(30_000); }
    const n = FakeSocket.all.length;
    last().serverClose(1006);
    advance(29_999);
    expect(FakeSocket.all).toHaveLength(n);
    advance(1);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  it('a successful auth resets the backoff', () => {
    const c = make();
    c.connect();
    last().serverClose(1006); advance(1000);
    last().serverClose(1006); advance(2000);
    last().open(); last().authOk();
    last().serverClose(1006);
    advance(1000);
    expect(FakeSocket.all).toHaveLength(4);
    expect(c.state).toBe('connecting');
  });

  it('request rejects on timeout', async () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    const p = c.request({ type: 'models.list', provider: 'claude' }, 500);
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    advance(500);
    await assertion;
  });

  it('request resolves on its reqId and rejects on a chat.error with it', async () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    const ok = c.request<any>({ type: 'models.list', provider: 'claude' });
    const bad = c.request<any>({ type: 'chats.subscribe', projectPath: '/q' });
    const [r1, r2] = last().sent.slice(-2).map((f) => f.reqId);
    last().recv({ type: 'models.list.result', reqId: r1, provider: 'claude', models: [1] });
    last().recv({ type: 'chat.error', reqId: r2, code: 'bad_request', message: 'too many chat-list subscriptions' });
    await expect(ok).resolves.toMatchObject({ models: [1] });
    await expect(bad).rejects.toMatchObject({ code: 'bad_request' });
    // A refused chats.subscribe is not replayed.
    last().serverClose(1006); advance(1000); last().open(); last().authOk();
    expect(last().types()).not.toContain('chats.subscribe');
  });

  it('request rejects when its socket closes', async () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    const p = c.request({ type: 'models.list', provider: 'claude' });
    last().serverClose(1006);
    await expect(p).rejects.toMatchObject({ code: 'closed' });
  });

  it('resume probes an open socket with a ping and reconnects if it stays silent 5s', () => {
    const c = make();
    c.connect();
    const s1 = last();
    s1.open(); s1.authOk();
    advance(3000);
    c.resume();
    expect(s1.types().filter((t) => t === 'ping')).toHaveLength(1);
    advance(5000);
    expect(s1.readyState).toBe(3);
    advance(1000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('resume with a live socket keeps it', () => {
    const c = make();
    c.connect();
    const s1 = last();
    s1.open(); s1.authOk();
    c.resume();
    s1.recv({ v: 1, type: 'pong' });
    advance(5000);
    expect(s1.readyState).toBe(1);
  });

  it('resume while offline reconnects at once, skipping the backoff', () => {
    const c = make();
    c.connect();
    last().serverClose(1006);
    last().serverClose(1006); // no-op on a closed socket
    expect(FakeSocket.all).toHaveLength(1);
    c.resume();
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('never pings before auth_ok (a pre-auth frame would read as auth_failed)', () => {
    const c = make();
    c.connect();
    last().open();
    c.resume();
    advance(30_000);
    expect(last().types()).toEqual(['auth']);
  });

  it('close() stops everything and rejects in-flight requests', async () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    const p = c.request({ type: 'models.list', provider: 'claude' });
    c.close();
    await expect(p).rejects.toBeTruthy();
    expect(c.state).toBe('offline');
    advance(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a read_failed chat.error answers that chat\'s pending subscribe', () => {
    const c = make();
    c.connect(); last().open(); last().authOk();
    c.send({ type: 'chat.subscribe', chatId: 'a', after: 0 });
    expect(c.state).toBe('catching_up');
    last().recv({ type: 'chat.error', chatId: 'a', code: 'read_failed', message: 'boom' });
    expect(c.state).toBe('open');
  });
});
