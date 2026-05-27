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

  it('POST /pair allows reuse within TTL so Safari + home-screen PWA can both pair', async () => {
    const code = server.mintPairingCode();
    const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Safari' }),
    });
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    expect(body1.token).toBeDefined();
    expect(body1.deviceId).toBeDefined();

    const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'PWA' }),
    });
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(body2.token).toBeDefined();
    expect(body2.deviceId).toBeDefined();
    expect(body2.deviceId).not.toBe(body1.deviceId);
  });

  it('POST /pair with clientId dedupes prior pairings from the same client', async () => {
    const code1 = server.mintPairingCode();
    const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code1, deviceLabel: 'iPhone', clientId: 'client-A' }),
    });
    expect(r1.status).toBe(200);
    const code2 = server.mintPairingCode();
    const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code2, deviceLabel: 'iPhone (re-pair)', clientId: 'client-A' }),
    });
    expect(r2.status).toBe(200);
    const list = (server as unknown as { opts: { pairing: PairingStore } }).opts.pairing.list();
    const active = list.filter((d) => !d.revokedAt);
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe('iPhone (re-pair)');
  });

  it('POST /pair without clientId stores clientId as null', async () => {
    const code = server.mintPairingCode();
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Legacy' }),
    });
    expect(r.status).toBe(200);
    const list = (server as unknown as { opts: { pairing: PairingStore } }).opts.pairing.list();
    expect(list[0].clientId).toBeNull();
  });

  it('GET /blob/<id> serves bytes via the same signer + loadBlob', async () => {
    let loaded: string | null = null;
    const server2 = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: buildPairingStore(), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'sek', loadScreenshot: async () => null,
      loadBlob: async (id) => { loaded = id; return { buffer: Buffer.from('hello'), mime: 'text/plain' }; },
    });
    const { port: p2 } = await server2.start();
    const url = server2.signBlobUrl('blob-123');
    const r = await fetch(`http://127.0.0.1:${p2}${url}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('hello');
    expect(loaded).toBe('blob-123');
    // Second fetch: signer enforces single-use, returns 401
    const r2 = await fetch(`http://127.0.0.1:${p2}${url}`);
    expect(r2.status).toBe(401);
    await server2.stop();
  });
});
