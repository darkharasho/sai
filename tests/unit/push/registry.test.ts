// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PushRegistry, bindRevocation, parsePushRegistration } from '@electron/services/push/registry';
import { PhonePresence } from '@electron/services/push/presence';
import { ChatV2, isV2FrameType } from '@electron/services/remote/chat-v2';
import { SessionBus } from '@electron/services/remote/session-bus';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { newSealKey } from '../../../src/lib/push/seal';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'push-reg-'));
  dirs.push(d);
  return d;
}

const b64url = (n: number) => Buffer.alloc(n, 7).toString('base64url');
function validFrame(over: Record<string, unknown> = {}) {
  return {
    type: 'push.register', reqId: 'r1',
    pushId: b64url(16), sendSecret: b64url(32), secretId: b64url(16),
    sealKey: newSealKey(), keyId: 'machine-1234', env: 'sandbox',
    ...over,
  };
}

function mk(file: string, live: (deviceId: string) => boolean = () => true) {
  const registry = new PushRegistry(file);
  const presence = new PhonePresence();
  const v2 = new ChatV2({ bus: new SessionBus(), chat: () => null, push: { registry, presence, isLiveDevice: live } });
  const frames: any[] = [];
  const ws = { send: (d: string) => { frames.push(JSON.parse(d)); } };
  return { registry, presence, v2, ws, frames };
}

describe('push registry', () => {
  it('register frame validates and persists; replay is idempotent', async () => {
    const file = path.join(tmp(), 'push-registrations.json');
    const { registry, v2, ws, frames } = mk(file);
    expect(isV2FrameType('push.register')).toBe(true);
    expect(isV2FrameType('push.unregister')).toBe(true);
    expect(isV2FrameType('phone.presence')).toBe(true);

    // Every field is validated; nothing is stored for a bad frame.
    const bad: Array<Record<string, unknown>> = [
      { pushId: 'short' },
      { pushId: b64url(16).slice(0, 21) + '!' },
      { sendSecret: b64url(31) },
      { secretId: 42 },
      { sealKey: Buffer.alloc(16, 1).toString('base64') },
      { sealKey: 'not-base64-at-all-but-length-fourty-four-ch' },
      { keyId: 'short' },
      { keyId: 'has space in it' },
      { keyId: 'x'.repeat(65) },
      { env: 'staging' },
      { env: undefined },
    ];
    for (const b of bad) {
      frames.length = 0;
      await v2.handle(ws, validFrame({ ...b, reqId: 'bad' }), { deviceId: 'dev-1' });
      expect(frames).toEqual([expect.objectContaining({ type: 'chat.error', code: 'bad_request', reqId: 'bad' })]);
    }
    expect(registry.all()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);

    // No device identity (should never happen behind bridge auth): refused.
    frames.length = 0;
    await v2.handle(ws, validFrame());
    expect(frames[0]).toMatchObject({ type: 'chat.error', code: 'unauthorized' });

    frames.length = 0;
    const good = validFrame();
    await v2.handle(ws, good, { deviceId: 'dev-1' });
    expect(frames).toEqual([{ v: 2, type: 'push.registered', reqId: 'r1' }]);
    expect(registry.get('dev-1')).toMatchObject({ pushId: good.pushId, sendSecret: good.sendSecret, keyId: 'machine-1234', env: 'sandbox' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['push-registrations.json']); // temp file renamed away

    // Survives a restart.
    expect(new PushRegistry(file).get('dev-1')).toEqual(registry.get('dev-1'));

    // Replay (reconnect resends the same frame): acked, file not rewritten.
    const ino = fs.statSync(file).ino;
    for (let i = 0; i < 3; i++) {
      frames.length = 0;
      await v2.handle(ws, { ...good, reqId: `again${i}` }, { deviceId: 'dev-1' });
      expect(frames).toEqual([{ v: 2, type: 'push.registered', reqId: `again${i}` }]);
    }
    expect(fs.statSync(file).ino).toBe(ino);
    expect(registry.all()).toHaveLength(1);

    // A changed secret replaces in place (one registration per device).
    const next = validFrame({ sendSecret: b64url(32).replace(/^./, 'Z') });
    await v2.handle(ws, next, { deviceId: 'dev-1' });
    expect(registry.all()).toHaveLength(1);
    expect(registry.get('dev-1')?.sendSecret).toBe(next.sendSecret);

    frames.length = 0;
    await v2.handle(ws, { type: 'push.unregister', reqId: 'u1' }, { deviceId: 'dev-1' });
    expect(frames).toEqual([{ v: 2, type: 'push.unregistered', reqId: 'u1' }]);
    expect(registry.get('dev-1')).toBeNull();
    expect(new PushRegistry(file).all()).toEqual([]);
  });

  it('a corrupt or hand-edited file loads only valid registrations', () => {
    const file = path.join(tmp(), 'push-registrations.json');
    const good = parsePushRegistration(validFrame());
    if ('error' in good) throw new Error('fixture invalid');
    const J = JSON.stringify;
    fs.writeFileSync(file, `{"v":1,"devices":{"dev-ok":${J(good)},"dev-bad":${J({ ...good, env: 'x' })},"__proto__":${J(good)}}}`);
    const r = new PushRegistry(file);
    expect(r.all().map((e) => e.deviceId)).toEqual(['dev-ok']);
    fs.writeFileSync(file, '{not json');
    expect(new PushRegistry(file).all()).toEqual([]);
  });

  it('phone.presence is per socket, unioned per device, cleared on close', async () => {
    const { presence, v2, ws } = mk(':memory:');
    const ws2 = { send: () => {} };
    await v2.handle(ws, { type: 'phone.presence', chatId: 'c1', foreground: true }, { deviceId: 'dev-1' });
    await v2.handle(ws2, { type: 'phone.presence', chatId: null, foreground: true }, { deviceId: 'dev-1' });
    expect(presence.isViewing('dev-1', 'c1')).toBe(true);
    expect(presence.isViewing('dev-1', 'c2')).toBe(false);
    expect(presence.isViewing('dev-2', 'c1')).toBe(false);
    // Backgrounded: not viewing even with the chat open.
    await v2.handle(ws, { type: 'phone.presence', chatId: 'c1', foreground: false }, { deviceId: 'dev-1' });
    expect(presence.isViewing('dev-1', 'c1')).toBe(false);
    await v2.handle(ws, { type: 'phone.presence', chatId: 'c1', foreground: true }, { deviceId: 'dev-1' });
    // Invalid frames leave presence untouched.
    await v2.handle(ws, { type: 'phone.presence', chatId: '../x', foreground: true }, { deviceId: 'dev-1' });
    await v2.handle(ws, { type: 'phone.presence', chatId: 'c1', foreground: 'yes' }, { deviceId: 'dev-1' });
    expect(presence.isViewing('dev-1', 'c1')).toBe(true);
    v2.detach(ws);
    expect(presence.isViewing('dev-1', 'c1')).toBe(false);
  });

  it('push frames from a device that is no longer paired are refused and not stored', async () => {
    const revoked = new Set(['dev-old']);
    const { registry, presence, v2, ws, frames } = mk(':memory:', (id) => !revoked.has(id));
    registry.set('dev-old', parsePushRegistration(validFrame()) as any);
    await v2.handle(ws, validFrame({ sendSecret: b64url(32).replace(/^./, 'Q') }), { deviceId: 'dev-old' });
    await v2.handle(ws, { type: 'phone.presence', chatId: 'c1', foreground: true }, { deviceId: 'dev-old' });
    await v2.handle(ws, { type: 'push.unregister', reqId: 'u' }, { deviceId: 'dev-old' });
    expect(frames.map((f) => [f.type, f.code])).toEqual([
      ['chat.error', 'unauthorized'], ['chat.error', 'unauthorized'], ['chat.error', 'unauthorized'],
    ]);
    // Nothing changed for the stale device (the revoke path owns its row).
    expect(registry.get('dev-old')?.sendSecret).toBe(b64url(32));
    expect(presence.isViewing('dev-old', 'c1')).toBe(false);
    // A live device on the same server is unaffected.
    frames.length = 0;
    await v2.handle(ws, validFrame(), { deviceId: 'dev-new' });
    expect(frames).toEqual([{ v: 2, type: 'push.registered', reqId: 'r1' }]);
  });

  it('revoke device deletes registration', () => {
    const file = path.join(tmp(), 'push-registrations.json');
    const registry = new PushRegistry(file);
    const pairing = new PairingStore(':memory:');
    return (async () => {
      const a = await pairing.issue('phone A', 'client-a');
      const b = await pairing.issue('phone B', 'client-b');
      const reg = parsePushRegistration(validFrame());
      if ('error' in reg) throw new Error('fixture invalid');
      registry.set(a.deviceId, reg);
      registry.set(b.deviceId, reg);
      registry.set('gone-device', reg);
      // Startup prune: registrations for unknown or revoked devices drop.
      bindRevocation(pairing, registry);
      expect(registry.get('gone-device')).toBeNull();
      expect(registry.get(a.deviceId)).not.toBeNull();

      pairing.revoke(a.deviceId);
      expect(registry.get(a.deviceId)).toBeNull();
      expect(new PushRegistry(file).get(a.deviceId)).toBeNull();

      // Re-pairing the same client supersedes (revokes) its old device row.
      await pairing.issue('phone B again', 'client-b');
      expect(registry.get(b.deviceId)).toBeNull();
    })();
  });
});

describe('push frames over the bridge', () => {
  it('keys the registration by the authenticated deviceId; presence clears on close', async () => {
    const { BridgeServer } = await import('@electron/services/remote/bridge-server');
    const WebSocket = (await import('ws')).default;
    const pairing = new PairingStore(':memory:');
    const registry = new PushRegistry(':memory:');
    const presence = new PhonePresence();
    const server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus: new SessionBus(), pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null, pushNotifications: { registry, presence },
    });
    const { port } = await server.start();
    try {
      const code = server.mintPairingCode();
      const r = await fetch(`http://127.0.0.1:${port}/pair`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: 'Phone' }),
      });
      const { token } = await r.json();
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const frames: any[] = [];
      const waitFor = (type: string) => new Promise<any>((resolve) => {
        const hit = frames.find((f) => f.type === type);
        if (hit) return resolve(hit);
        ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === type) resolve(m); });
      });
      ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
      await new Promise((res) => ws.once('open', res));
      ws.send(JSON.stringify({ type: 'auth', token }));
      const ok = await waitFor('auth_ok');
      // A deviceId in the frame is ignored: identity comes from auth only.
      ws.send(JSON.stringify(validFrame({ v: 2, deviceId: 'someone-else' })));
      ws.send(JSON.stringify({ v: 2, type: 'phone.presence', chatId: 'c1', foreground: true }));
      expect(await waitFor('push.registered')).toMatchObject({ reqId: 'r1' });
      expect(registry.all().map((e) => e.deviceId)).toEqual([ok.deviceId]);
      await new Promise((res) => setTimeout(res, 20));
      expect(presence.isViewing(ok.deviceId, 'c1')).toBe(true);
      ws.close();
      await new Promise((res) => setTimeout(res, 50));
      expect(presence.isViewing(ok.deviceId, 'c1')).toBe(false);
    } finally {
      await server.stop();
    }
  });
});

describe('bridge heartbeat', () => {
  afterEach(() => { vi.useRealTimers(); });

  async function setup() {
    const { BridgeServer, BRIDGE_HEARTBEAT_MS } = await import('@electron/services/remote/bridge-server');
    const WebSocket = (await import('ws')).default;
    const pairing = new PairingStore(':memory:');
    const registry = new PushRegistry(':memory:');
    const presence = new PhonePresence();
    bindRevocation(pairing, registry); // as main.ts wires it
    const server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus: new SessionBus(), pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null, pushNotifications: { registry, presence },
    });
    const { port } = await server.start();
    async function connect(label: string, clientId: string, autoPong: boolean, existingToken?: string) {
      let token = existingToken;
      if (!token) {
        const code = server.mintPairingCode();
        const r = await fetch(`http://127.0.0.1:${port}/pair`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: label, clientId }),
        });
        token = (await r.json()).token as string;
      }
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { autoPong });
      const closed = new Promise<void>((res) => ws.once('close', () => res()));
      await new Promise((res) => ws.once('open', res));
      const authed = new Promise<any>((res) => ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'auth_ok') res(m); }));
      ws.send(JSON.stringify({ type: 'auth', token }));
      const ok = await authed;
      return { ws, deviceId: ok.deviceId as string, closed, token };
    }
    return { server, pairing, registry, presence, connect, BRIDGE_HEARTBEAT_MS, WebSocket, port };
  }

  const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms));

  it('terminates a socket that misses a pong, clearing its foreground presence', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { server, presence, connect, BRIDGE_HEARTBEAT_MS } = await setup();
    expect(BRIDGE_HEARTBEAT_MS).toBe(30_000);
    try {
      // The half-open socket: never answers pings (a phone that switched networks).
      const dead = await connect('Phone', 'client-1', false);
      // The same phone reconnects (same device, new socket): answers pings and reports background.
      const live = await connect('Phone', 'client-1', true, dead.token);
      expect(live.deviceId).toBe(dead.deviceId);
      dead.ws.send(JSON.stringify({ v: 2, type: 'phone.presence', chatId: 'c1', foreground: true }));
      live.ws.send(JSON.stringify({ v: 2, type: 'phone.presence', chatId: 'c1', foreground: false }));
      await settle();
      // The dead socket's foreground wins the union: pushes for c1 would be suppressed.
      expect(presence.isViewing(dead.deviceId, 'c1')).toBe(true);
      vi.advanceTimersByTime(BRIDGE_HEARTBEAT_MS); // ping
      await settle();
      expect(presence.isViewing(dead.deviceId, 'c1')).toBe(true); // one missed beat is not yet fatal
      vi.advanceTimersByTime(BRIDGE_HEARTBEAT_MS); // no pong since the last ping: terminate
      await dead.closed;
      await settle();
      expect(presence.isViewing(dead.deviceId, 'c1')).toBe(false);
      // A socket that answers pings survives any number of beats.
      for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(BRIDGE_HEARTBEAT_MS); await settle(); }
      expect(live.ws.readyState).toBe(live.ws.OPEN);
      live.ws.close();
    } finally {
      await server.stop();
    }
  });

  it('a superseded device (re-paired) cannot re-register on its old socket', async () => {
    const { server, registry, connect } = await setup();
    try {
      const old = await connect('Phone', 'client-1', true);
      old.ws.send(JSON.stringify(validFrame({ v: 2 })));
      await settle(50);
      expect(registry.get(old.deviceId)).not.toBeNull();
      // Re-pair from the same phone: the old device row is revoked.
      const fresh = await connect('Phone', 'client-1', true);
      expect(registry.get(old.deviceId)).toBeNull();
      // The old socket replays push.register: refused, nothing stored.
      const replies: any[] = [];
      old.ws.on('message', (d) => replies.push(JSON.parse(d.toString())));
      old.ws.send(JSON.stringify(validFrame({ v: 2, reqId: 'stale' })));
      await settle(50);
      expect(registry.get(old.deviceId)).toBeNull();
      expect(replies.some((m) => m.type === 'push.registered')).toBe(false);
      old.ws.close(); fresh.ws.close();
    } finally {
      await server.stop();
    }
  });
});
