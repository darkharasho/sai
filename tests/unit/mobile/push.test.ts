// Phone side of push notifications: relay registration, per-machine linking
// (send secret + seal key + push.register), revocation, presence and tap routing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { FakeSocket } from './fakeSocket';
import type { FullNativeApi, HttpRequest, PushPermission } from '../../../mobile/src/native';
import { V2Client } from '../../../mobile/src/v2/client';
import { addMachine, listMachines, removeMachine, type Machine } from '../../../mobile/src/machines/store';
import {
  OWNER_TOKEN_KEY, PUSH_ID_KEY, SHARED_ACCESS_GROUP, ensurePushRegistration, linkMachine, sealKeyName, secretKeyName,
} from '../../../mobile/src/push/registration';
import { createPresence } from '../../../mobile/src/push/presence';
import { parseTap, routeTap } from '../../../mobile/src/push/routing';
import { parsePushRegistration } from '../../../electron/services/push/registry';
import { PUSH_RELAY_URL } from '../../../src/lib/push/config';
import { disconnect, installSai } from '../../../mobile/src/shell/connection';
import { PhoneApp } from '../../../mobile/src/shell/App';
import { App as CapApp } from '@capacitor/app';

// The app shell reads getNative(); the App test below swaps in a fake device.
const holder = vi.hoisted(() => ({ native: null as FullNativeApi | null }));
vi.mock('../../../mobile/src/native', async (orig) => {
  const actual = await orig<typeof import('../../../mobile/src/native')>();
  return { ...actual, getNative: () => holder.native ?? actual.getNative() };
});
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: async () => {} })) } }));

const b64url = (n: number, seed: number) => {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from({ length: n }, (_, i) => a[(i * 7 + seed) % 64]).join('');
};
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

/** A fake device: in-memory keychain (per access group), a fake relay and a scriptable push plugin. */
function fakeDevice(opts: { perm?: PushPermission } = {}) {
  const kc = new Map<string, string>();
  const k = (key: string, o?: { accessGroup?: string }) => `${o?.accessGroup ?? ''}|${key}`;
  let perm: PushPermission = opts.perm ?? 'prompt';
  let nextToken = TOKEN_A;
  let regSeq = 0;
  let secSeq = 0;
  const regListeners = new Set<(t: string) => void>();
  const actionListeners = new Set<(d: Record<string, unknown>) => void>();
  const tap = (d: Record<string, unknown>) => { for (const cb of actionListeners) cb(d); };
  const relayCalls: HttpRequest[] = [];
  let relayDown = false;
  /** Overrides POST /v1/secrets (once per call); undefined = the normal answer. */
  let secretsReply: (() => Promise<{ status: number; data: unknown }> | { status: number; data: unknown }) | null = null;

  const http = vi.fn(async (req: HttpRequest) => {
    relayCalls.push(req);
    if (relayDown) throw new Error('offline');
    const body = req.body as Record<string, string>;
    const path = req.url.slice(PUSH_RELAY_URL.length);
    if (req.method === 'POST' && path === '/v1/register') {
      if (body.pushId && body.ownerToken) return { status: 200, data: { pushId: body.pushId, ownerToken: body.ownerToken } };
      regSeq++;
      return { status: 200, data: { pushId: b64url(22, regSeq), ownerToken: b64url(43, regSeq + 10) } };
    }
    if (req.method === 'POST' && path === '/v1/secrets') {
      if (secretsReply) { const r = secretsReply; secretsReply = null; return r(); }
      secSeq++;
      return { status: 200, data: { secretId: b64url(22, 30 + secSeq), sendSecret: b64url(43, 40 + secSeq) } };
    }
    if (req.method === 'DELETE' && path === '/v1/secrets') return { status: 200, data: { ok: true } };
    return { status: 404, data: { error: 'not_found' } };
  });

  const native: FullNativeApi = {
    openUrl() {}, copyText() {}, toast() {},
    async keychainGet(key, o) { return kc.get(k(key, o)) ?? null; },
    async keychainSet(key, v, o) { kc.set(k(key, o), v); },
    async keychainRemove(key, o) { kc.delete(k(key, o)); },
    http,
    async buildEnv() { return 'sandbox'; },
    push: {
      checkPermission: vi.fn(async () => perm),
      requestPermission: vi.fn(async () => { if (perm === 'prompt') perm = opts.perm === 'denied' ? 'denied' : 'granted'; return perm; }),
      register: vi.fn(async () => { const t = nextToken; queueMicrotask(() => { for (const cb of regListeners) cb(t); }); }),
      onRegistration(cb) { regListeners.add(cb); return () => { regListeners.delete(cb); }; },
      onRegistrationError() { return () => {}; },
      onAction(cb) { actionListeners.add(cb); return () => { actionListeners.delete(cb); }; },
    },
  };
  return {
    native, kc, k, relayCalls, http, tap,
    setPerm(p: PushPermission) { perm = p; },
    setRelayDown(v: boolean) { relayDown = v; },
    replyToSecretsOnce(r: NonNullable<typeof secretsReply>) { secretsReply = r; },
    /** iOS hands the app a new APNs token. */
    rotate(token: string) { nextToken = token; for (const cb of regListeners) cb(token); },
  };
}

function connectedClient(): { client: V2Client; sock: () => FakeSocket } {
  const client = new V2Client({ url: 'ws://desk/ws', token: 't', WebSocketImpl: FakeSocket as never });
  client.connect();
  const sock = () => FakeSocket.all[FakeSocket.all.length - 1];
  sock().open();
  sock().authOk();
  return { client, sock };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

const relayTo = (calls: HttpRequest[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.url === `${PUSH_RELAY_URL}${path}`);

beforeEach(() => {
  localStorage.clear();
  FakeSocket.all = [];
  holder.native = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  disconnect();
  vi.unstubAllGlobals();
});

async function pairedMachine(native: FullNativeApi, label = 'desk'): Promise<Machine> {
  return addMachine({ label, baseUrl: `http://${label}:17830`, deviceId: 'd1', token: 'tok' }, native);
}

describe('push registration', () => {
  it('pairing links push: mints secret, stores seal key, sends push.register', async () => {
    const dev = fakeDevice();
    const m = await pairedMachine(dev.native);
    const id = await ensurePushRegistration(dev.native, { prompt: true });
    expect(dev.native.push!.requestPermission).toHaveBeenCalledTimes(1);
    expect(id).not.toBeNull();
    const reg = relayTo(dev.relayCalls, 'POST', '/v1/register');
    expect(reg).toHaveLength(1);
    expect(reg[0].body).toEqual({ apnsToken: TOKEN_A, env: 'sandbox' });
    expect(dev.kc.get(dev.k(PUSH_ID_KEY))).toBe(id!.pushId);
    expect(dev.kc.get(dev.k(OWNER_TOKEN_KEY))).toBe(id!.ownerToken);

    const { client, sock } = connectedClient();
    expect(await linkMachine(m, client, dev.native)).toBe(true);

    const sec = relayTo(dev.relayCalls, 'POST', '/v1/secrets');
    expect(sec).toHaveLength(1);
    expect(sec[0].body).toEqual({ pushId: id!.pushId, ownerToken: id!.ownerToken, label: 'desk' });
    const sealKey = dev.kc.get(dev.k(sealKeyName(m.id), { accessGroup: SHARED_ACCESS_GROUP }));
    expect(sealKey).toBeTruthy();
    // Not in the default group: the Notification Service Extension reads the shared one.
    expect(dev.kc.has(dev.k(sealKeyName(m.id)))).toBe(false);

    const frames = sock().sent.filter((f) => f.type === 'push.register');
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f).toMatchObject({ pushId: id!.pushId, sealKey, keyId: m.id, env: 'sandbox', secretId: expect.any(String), sendSecret: expect.any(String) });
    expect(typeof f.reqId).toBe('string');
    // Exactly what the desktop's validator accepts.
    expect('error' in parsePushRegistration(f)).toBe(false);
  });

  it('never prompts before a pairing asks for it, and a denied permission links nothing', async () => {
    const dev = fakeDevice({ perm: 'denied' });
    const m = await pairedMachine(dev.native);
    expect(await ensurePushRegistration(dev.native)).toBeNull();
    expect(dev.native.push!.requestPermission).not.toHaveBeenCalled();
    const { client, sock } = connectedClient();
    expect(await linkMachine(m, client, dev.native)).toBe(false);
    expect(dev.relayCalls).toHaveLength(0);
    expect(sock().types()).not.toContain('push.register');
  });

  it('a relay outage never throws; the next attempt registers', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const m = await pairedMachine(dev.native);
    dev.setRelayDown(true);
    expect(await ensurePushRegistration(dev.native, { prompt: true })).toBeNull();
    const { client, sock } = connectedClient();
    expect(await linkMachine(m, client, dev.native)).toBe(false);
    expect(sock().types()).not.toContain('push.register');
    dev.setRelayDown(false);
    expect(await ensurePushRegistration(dev.native, { prompt: true, force: true })).not.toBeNull();
    expect(await linkMachine(m, client, dev.native)).toBe(true);
    expect(sock().types()).toContain('push.register');
  });

  it('reconnect resends push.register with the same secret and key', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const m = await pairedMachine(dev.native);
    await ensurePushRegistration(dev.native);
    const { client, sock } = connectedClient();
    client.onAuth(() => { void linkMachine(m, client, dev.native); });
    await linkMachine(m, client, dev.native);
    const first = sock().sent.find((f) => f.type === 'push.register');

    // The desktop's heartbeat drops a backgrounded phone; it reconnects.
    sock().serverClose(1006);
    client.resume();
    sock().open();
    sock().authOk();
    await flush();
    const again = sock().sent.filter((f) => f.type === 'push.register');
    expect(again).toHaveLength(1);
    const strip = ({ reqId: _r, ...rest }: Record<string, unknown>) => rest;
    expect(strip(again[0])).toEqual(strip(first));
    expect(relayTo(dev.relayCalls, 'POST', '/v1/secrets')).toHaveLength(1);
    client.close();
  });

  it('token rotation re-registers with ownerToken', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const id = await ensurePushRegistration(dev.native);
    dev.rotate(TOKEN_B);
    await flush();
    const reg = relayTo(dev.relayCalls, 'POST', '/v1/register');
    expect(reg).toHaveLength(2);
    expect(reg[1].body).toEqual({ apnsToken: TOKEN_B, env: 'sandbox', pushId: id!.pushId, ownerToken: id!.ownerToken });
    expect(dev.kc.get(dev.k(PUSH_ID_KEY))).toBe(id!.pushId);
  });

  it('removeMachine revokes secret and deletes seal key', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const m = await pairedMachine(dev.native);
    const id = await ensurePushRegistration(dev.native);
    const { client, sock } = connectedClient();
    await linkMachine(m, client, dev.native);
    const secretId = sock().sent.find((f) => f.type === 'push.register')!.secretId;

    await removeMachine(m.id, dev.native, client);

    expect(sock().types()).toContain('push.unregister');
    const del = relayTo(dev.relayCalls, 'DELETE', '/v1/secrets');
    expect(del).toHaveLength(1);
    expect(del[0].body).toEqual({ pushId: id!.pushId, ownerToken: id!.ownerToken, secretId });
    expect(dev.kc.has(dev.k(sealKeyName(m.id), { accessGroup: SHARED_ACCESS_GROUP }))).toBe(false);
    expect(dev.kc.has(dev.k(secretKeyName(m.id)))).toBe(false);
    expect(listMachines()).toEqual([]);
    // The phone's own registration stays for the other machines.
    expect(dev.kc.get(dev.k(PUSH_ID_KEY))).toBe(id!.pushId);
  });

  it('removeMachine still removes the machine when the relay is down', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const m = await pairedMachine(dev.native);
    await ensurePushRegistration(dev.native);
    const { client } = connectedClient();
    await linkMachine(m, client, dev.native);
    dev.setRelayDown(true);
    await removeMachine(m.id, dev.native);
    expect(listMachines()).toEqual([]);
    expect(dev.kc.has(dev.k(sealKeyName(m.id), { accessGroup: SHARED_ACCESS_GROUP }))).toBe(false);
  });
});

describe('push fix round 1', () => {
  it('a route-level 404 or other 401 is a plain failure: identity kept, backoff applies', async () => {
    for (const reply of [{ status: 404, data: { error: 'not_found' } }, { status: 401, data: 'nope' }]) {
      localStorage.clear();
      const dev = fakeDevice({ perm: 'granted' });
      const m = await pairedMachine(dev.native);
      const id = await ensurePushRegistration(dev.native);
      const { client, sock } = connectedClient();
      dev.replyToSecretsOnce(() => reply);
      expect(await linkMachine(m, client, dev.native)).toBe(false);
      expect(dev.kc.get(dev.k(PUSH_ID_KEY))).toBe(id!.pushId);
      expect(dev.kc.get(dev.k(OWNER_TOKEN_KEY))).toBe(id!.ownerToken);
      expect(relayTo(dev.relayCalls, 'POST', '/v1/register')).toHaveLength(1);
      // The next auth_ok within the backoff doesn't hit the relay again.
      expect(await linkMachine(m, client, dev.native)).toBe(false);
      expect(relayTo(dev.relayCalls, 'POST', '/v1/secrets')).toHaveLength(1);
      expect(sock().types()).not.toContain('push.register');
      client.close();
    }
  });

  it('unknown_push_id / unauthorized from /v1/secrets re-registers and mints again', async () => {
    for (const reply of [{ status: 404, data: { error: 'unknown_push_id' } }, { status: 401, data: { error: 'unauthorized' } }]) {
      localStorage.clear();
      const dev = fakeDevice({ perm: 'granted' });
      const m = await pairedMachine(dev.native);
      const old = await ensurePushRegistration(dev.native);
      const { client, sock } = connectedClient();
      dev.replyToSecretsOnce(() => reply);
      expect(await linkMachine(m, client, dev.native)).toBe(true);
      const reg = relayTo(dev.relayCalls, 'POST', '/v1/register');
      expect(reg).toHaveLength(2);
      expect(reg[1].body).toEqual({ apnsToken: TOKEN_A, env: 'sandbox' }); // fresh, not the dead pushId
      const fresh = dev.kc.get(dev.k(PUSH_ID_KEY));
      expect(fresh).not.toBe(old!.pushId);
      expect(sock().sent.find((f) => f.type === 'push.register')!.pushId).toBe(fresh);
      client.close();
    }
  });

  it('unlink waits for an in-flight link, then revokes what it minted', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    const m = await pairedMachine(dev.native);
    const id = await ensurePushRegistration(dev.native);
    const { client, sock } = connectedClient();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const secretId = b64url(22, 77);
    dev.replyToSecretsOnce(async () => { await gate; return { status: 200, data: { secretId, sendSecret: b64url(43, 78) } }; });
    const linking = linkMachine(m, client, dev.native);
    await flush();
    expect(relayTo(dev.relayCalls, 'POST', '/v1/secrets')).toHaveLength(1);

    const removing = removeMachine(m.id, dev.native, client);
    // push.unregister goes out before anything is awaited.
    expect(sock().types()).toContain('push.unregister');
    release();
    await linking;
    await removing;

    expect(dev.kc.has(dev.k(secretKeyName(m.id)))).toBe(false);
    expect(dev.kc.has(dev.k(sealKeyName(m.id), { accessGroup: SHARED_ACCESS_GROUP }))).toBe(false);
    const del = relayTo(dev.relayCalls, 'DELETE', '/v1/secrets');
    expect(del).toHaveLength(1);
    expect(del[0].body).toEqual({ pushId: id!.pushId, ownerToken: id!.ownerToken, secretId });
    client.close();
  });
});

describe('push tap routing', () => {
  it('tap routes to machine/workspace/chat', async () => {
    const dev = fakeDevice();
    const a = await pairedMachine(dev.native, 'a');
    const b = await pairedMachine(dev.native, 'b');
    const machines = listMachines();
    expect(routeTap(parseTap({ m: b.id, c: 'chat-1', p: '/home/me/proj', aps: {} }), machines))
      .toEqual({ kind: 'chat', machine: b, projectPath: '/home/me/proj', chatId: 'chat-1' });
    expect(routeTap(parseTap({ m: a.id }), machines)).toEqual({ kind: 'chat', machine: a, projectPath: null, chatId: null });
    // Unknown machine (removed since), or a tap the extension couldn't decode: the machine list.
    expect(routeTap(parseTap({ m: 'gone-machine', c: 'x', p: '/p' }), machines)).toEqual({ kind: 'machines' });
    expect(routeTap(parseTap({}), machines)).toEqual({ kind: 'machines' });
    expect(routeTap(parseTap({ m: a.id, c: 'bad id!', p: 7 }), machines)).toEqual({ kind: 'chat', machine: a, projectPath: null, chatId: null });
  });
});

describe('phone presence', () => {
  it('presence frame on chat switch and background', async () => {
    const { client, sock } = connectedClient();
    const presence = createPresence();
    presence.attach(client);
    const frames = () => sock().sent.filter((f) => f.type === 'phone.presence').map(({ chatId, foreground }) => ({ chatId, foreground }));
    expect(frames()).toEqual([{ chatId: null, foreground: true }]);

    presence.setChat('c1');
    presence.setChat('c1'); // unchanged: no frame
    presence.setChat('c2');
    presence.setForeground(false);
    presence.setForeground(true);
    presence.setChat(null);
    expect(frames()).toEqual([
      { chatId: null, foreground: true },
      { chatId: 'c1', foreground: true },
      { chatId: 'c2', foreground: true },
      { chatId: 'c2', foreground: false },
      { chatId: 'c2', foreground: true },
      { chatId: null, foreground: true },
    ]);

    // Offline: nothing queued; the reconnect's auth_ok sends the current state.
    presence.setChat('c3');
    sock().serverClose(1006);
    presence.setChat('c4');
    client.resume();
    sock().open();
    sock().authOk();
    expect(frames()).toEqual([{ chatId: 'c4', foreground: true }]);
    client.close();
  });
});

describe('PhoneApp push wiring', () => {
  it('links on auth_ok, sends presence, and a tap switches machine, workspace and chat', async () => {
    const dev = fakeDevice({ perm: 'granted' });
    holder.native = dev.native;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    document.documentElement.dataset.saiPhone = '1';
    installSai();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    try {
      const a = await pairedMachine(dev.native, 'a');
      const b = await pairedMachine(dev.native, 'b');
      localStorage.setItem('sai.activeMachine.v1', a.id);
      render(createElement(PhoneApp));

      await waitFor(() => expect(FakeSocket.all.length).toBe(1));
      const sa = FakeSocket.all[0];
      act(() => { sa.open(); sa.authOk(); });
      await waitFor(() => expect(sa.types()).toContain('push.register'));
      expect(sa.sent.find((f) => f.type === 'push.register')).toMatchObject({ keyId: a.id, env: 'sandbox' });
      expect(sa.sent.filter((f) => f.type === 'phone.presence').at(-1)).toMatchObject({ foreground: true });

      // Tap a notification from desktop b.
      act(() => { dev.tap({ m: b.id, c: 'chat-7', p: '/proj' }); });
      await waitFor(() => expect(FakeSocket.all.length).toBe(2));
      const sb = FakeSocket.all[1];
      expect(sb.url).toBe('ws://b:17830/ws');
      act(() => { sb.open(); sb.authOk(); });
      act(() => { sb.recv({ type: 'workspaces.list.result', workspaces: [{ projectPath: '/proj', name: 'proj', kind: 'project', state: 'active' }] }); });
      await waitFor(() => expect(sb.sent.some((f) => f.type === 'chat.subscribe' && f.chatId === 'chat-7')).toBe(true));
      expect(sb.sent.filter((f) => f.type === 'phone.presence').at(-1)).toEqual({ type: 'phone.presence', chatId: 'chat-7', foreground: true });
      await waitFor(() => expect(sb.sent.find((f) => f.type === 'push.register')).toMatchObject({ keyId: b.id }));

      // A tap for a machine that's gone opens the machine list.
      act(() => { dev.tap({ m: 'removed-machine', c: 'x', p: '/proj' }); });
      await waitFor(() => expect(document.querySelector('[data-testid="notifications-row"]')?.textContent).toContain('On'));
    } finally {
      delete document.documentElement.dataset.saiPhone;
    }
  });
});

describe('PhoneApp permission granted in Settings', () => {
  it('registers on resume once the permission turned granted, without prompting', async () => {
    const dev = fakeDevice({ perm: 'denied' });
    holder.native = dev.native;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    installSai();
    const addListener = vi.mocked(CapApp.addListener);
    addListener.mockClear();
    await pairedMachine(dev.native);
    render(createElement(PhoneApp));
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    await waitFor(() => expect(dev.native.push!.checkPermission).toHaveBeenCalled());
    await flush();
    expect(relayTo(dev.relayCalls, 'POST', '/v1/register')).toHaveLength(0);

    const onState = addListener.mock.calls.find((c) => c[0] === 'appStateChange')![1] as (s: { isActive: boolean }) => void;
    // Resumed, still denied: nothing.
    await act(async () => { onState({ isActive: true }); await flush(); });
    expect(relayTo(dev.relayCalls, 'POST', '/v1/register')).toHaveLength(0);

    // The user enabled notifications in iOS Settings and came back.
    dev.setPerm('granted');
    await act(async () => { onState({ isActive: false }); onState({ isActive: true }); await flush(); });
    await waitFor(() => expect(relayTo(dev.relayCalls, 'POST', '/v1/register')).toHaveLength(1));
    expect(dev.native.push!.requestPermission).not.toHaveBeenCalled();
  });
});
