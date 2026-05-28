import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

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

describe('bridge workspace.status routing', () => {
  let server: BridgeServer; let port: number;
  let pairing: PairingStore; let bus: SessionBus;

  beforeEach(async () => {
    pairing = new PairingStore(':memory:');
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

  it('forwards workspace.status events to opted-in sockets', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    ws.send(JSON.stringify({ type: 'workspace.status.subscribe' }));
    await new Promise((r) => setTimeout(r, 20));
    setTimeout(() => bus.publish('workspace.status', {
      type: 'workspace.status', projectPath: '/p', status: { streaming: true },
    }), 10);
    const m = await once(ws, 'workspace.status');
    expect(m.projectPath).toBe('/p');
    expect(m.status.streaming).toBe(true);
    ws.close();
  });

  it('does not forward workspace.status events to sockets that did not subscribe', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');

    const received: any[] = [];
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      received.push(m);
    });

    bus.publish('workspace.status', {
      type: 'workspace.status', projectPath: '/p', status: { streaming: true },
    });
    // Allow any erroneous forwarding to flush
    await new Promise((r) => setTimeout(r, 50));
    expect(received.find((m) => m.type === 'workspace.status')).toBeUndefined();
    ws.close();
  });

  it('workspace.status.unsubscribe stops further events', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    ws.send(JSON.stringify({ type: 'workspace.status.subscribe' }));
    await new Promise((r) => setTimeout(r, 20));

    setTimeout(() => bus.publish('workspace.status', {
      type: 'workspace.status', projectPath: '/p', status: { streaming: true },
    }), 5);
    const m1 = await once(ws, 'workspace.status');
    expect(m1.projectPath).toBe('/p');

    ws.send(JSON.stringify({ type: 'workspace.status.unsubscribe' }));
    await new Promise((r) => setTimeout(r, 20));

    const received: any[] = [];
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      received.push(m);
    });
    bus.publish('workspace.status', {
      type: 'workspace.status', projectPath: '/q', status: { streaming: false },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(received.find((m) => m.type === 'workspace.status')).toBeUndefined();
    ws.close();
  });
});
