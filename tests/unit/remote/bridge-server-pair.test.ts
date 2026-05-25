import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function buildPairingStore() {
  return new PairingStore(':memory:');
}

describe('BridgeServer HTTP', () => {
  let server: BridgeServer;
  let port: number;

  beforeEach(async () => {
    server = new BridgeServer({
      tailnetIp: '127.0.0.1',
      pairing: buildPairingStore(),
      bus: new SessionBus(),
      pwaDir: null,
      screenshotSecret: 'test',
      loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  it('refuses to start without a tailnet IP', async () => {
    const s = new BridgeServer({
      tailnetIp: null,
      pairing: buildPairingStore(),
      bus: new SessionBus(),
      pwaDir: null,
      screenshotSecret: 'x',
      loadScreenshot: async () => null,
    });
    await expect(s.start()).rejects.toThrow(/tailnet/);
  });

  it('GET /healthz returns ok', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe('ok');
  });

  it('POST /pair returns 401 for unknown code', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'unknown', deviceLabel: 'Test' }),
    });
    expect(r.status).toBe(401);
  });

  it('POST /pair succeeds with valid code, then 401 on reuse', async () => {
    const code = server.mintPairingCode();
    const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    expect(r1.status).toBe(200);
    const body = await r1.json();
    expect(body.token).toBeDefined();
    expect(body.deviceId).toBeDefined();

    const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    expect(r2.status).toBe(401);
  });
});
