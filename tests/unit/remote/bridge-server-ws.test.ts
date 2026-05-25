import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function buildPairingStore() {
  return new PairingStore(':memory:');
}

function once<T = any>(ws: WebSocket, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.Data) => {
      const m = JSON.parse(data.toString());
      if (m.type === type) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.once('close', (code, reason) => reject(new Error(`closed before ${type}: ${code} ${reason}`)));
  });
}

describe('BridgeServer WS', () => {
  let server: BridgeServer; let port: number;
  let pairing: PairingStore; let bus: SessionBus;

  beforeEach(async () => {
    pairing = buildPairingStore();
    bus = new SessionBus();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus, pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  async function pairAndGetToken(): Promise<string> {
    const code = server.mintPairingCode();
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    return (await r.json()).token;
  }

  it('closes WS with 4001 on missing auth', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const close = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('open', () => ws.send(JSON.stringify({ type: 'wrong' })));
    });
    expect(close.code).toBe(4001);
  });

  it('replies auth_ok on valid token', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const m = await once(ws, 'auth_ok');
    expect(m.deviceLabel).toBe('Test');
    ws.close();
  });

  it('forwards bus events to authed clients', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    // Wait for the attach to register (history may or may not arrive — that depends on whether loadHistory was provided)
    await new Promise((r) => setTimeout(r, 30));
    setTimeout(() => bus.publish('chat:/p:chat', { type: 'noop', payload: 1 }), 10);
    const m = await once(ws, 'noop');
    expect(m.topic).toBe('chat:/p:chat');
    expect(m.payload).toBe(1);
    ws.close();
  });

  it('replies pong to ping', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    ws.send(JSON.stringify({ type: 'ping' }));
    const m = await once(ws, 'pong');
    expect(m).toBeDefined();
    ws.close();
  });

  it('closeDeviceConnections kicks the device', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const ok = await once(ws, 'auth_ok');
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    server.closeDeviceConnections(ok.deviceId);
    expect(await closed).toBe(1008);
  });
});
