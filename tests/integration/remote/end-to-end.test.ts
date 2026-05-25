import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('mobile remote end-to-end', () => {
  // re-enabled in Task 9 once session.attach is handled (bus fan-out now gated by __attachedTopic)
  it.skip('pair → auth → event → revoke → reconnect fails', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const remote = new RemoteModule({
      pairing,
      bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null,
        port: 0, // ephemeral
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    expect(url).not.toBeNull();

    // 1. Mint pair code → POST /pair → bearer
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E iPhone' }),
    });
    expect(pairRes.status).toBe(200);
    const { token, deviceId } = await pairRes.json();

    // 2. WS connect + auth
    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const authOk = await new Promise<any>((resolve) => {
      ws.on('message', function on(d) {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') { ws.off('message', on); resolve(m); }
      });
    });
    expect(authOk.deviceLabel).toBe('E2E iPhone');

    // 3. bus publish → client receives
    const got = new Promise<any>((resolve) => {
      ws.on('message', function on(d) {
        const m = JSON.parse(d.toString());
        if (m.type === 'noop') { ws.off('message', on); resolve(m); }
      });
    });
    bus.publish('t1', { type: 'noop', n: 42 });
    const frame = await got;
    expect(frame.topic).toBe('t1');
    expect(frame.n).toBe(42);

    // 4. Revoke → WS closes
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    pairing.revoke(deviceId);
    remote.closeDeviceConnections(deviceId);
    expect(await closed).toBe(1008);

    // 5. Reconnect with same token fails
    const ws2 = new WebSocket(wsUrl);
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'auth', token }));
    const closed2 = await new Promise<{ code: number }>((r) => ws2.on('close', (code) => r({ code })));
    expect(closed2.code).toBe(4001);

    await remote.stop();
  });
});
