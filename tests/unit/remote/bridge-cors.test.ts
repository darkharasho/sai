// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

describe('BridgeServer CORS', () => {
  let server: BridgeServer;
  let base: string;

  beforeEach(async () => {
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(), pwaDir: null,
      screenshotSecret: 'test', loadScreenshot: async () => null,
    });
    const { port } = await server.start();
    base = `http://127.0.0.1:${port}`;
  });
  afterEach(async () => { await server.stop(); });

  const corsOf = (r: Response) => Object.fromEntries(Object.keys(CORS).map((k) => [k, r.headers.get(k)]));

  it('OPTIONS /pair answers 204 with CORS headers', async () => {
    const r = await fetch(`${base}/pair`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(corsOf(r)).toEqual(CORS);
    expect(await r.text()).toBe('');
  });

  it('OPTIONS /healthz answers 204 and GET /healthz carries CORS headers', async () => {
    const pre = await fetch(`${base}/healthz`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(corsOf(pre)).toEqual(CORS);
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(corsOf(r)).toEqual(CORS);
    expect(await r.json()).toEqual({ status: 'ok', version: 1 });
  });

  it('POST /pair carries CORS headers on success and failure', async () => {
    const bad = await fetch(`${base}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'nope' }),
    });
    expect(bad.status).toBe(401);
    expect(corsOf(bad)).toEqual(CORS);
    const code = server.mintPairingCode();
    const ok = await fetch(`${base}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceLabel: 'T' }),
    });
    expect(ok.status).toBe(200);
    expect(corsOf(ok)).toEqual(CORS);
    expect(await ok.json()).toMatchObject({ wsUrl: '/ws' });
  });

  it('other paths have no CORS headers', async () => {
    for (const [method, p] of [['GET', '/'], ['GET', '/blob/x'], ['GET', '/screenshot/x'], ['OPTIONS', '/ws'], ['OPTIONS', '/'], ['GET', '/pair?x=1']] as const) {
      const r = await fetch(`${base}${p}`, { method });
      expect(r.status, `${method} ${p}`).not.toBe(204);
      for (const k of Object.keys(CORS)) expect(r.headers.get(k), `${method} ${p} ${k}`).toBeNull();
    }
  });
});
