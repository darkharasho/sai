import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPushSender, PUSH_SEND_TIMEOUT_MS } from '../../../electron/services/push/sender';
import { PushRegistry, type PushRegistration } from '../../../electron/services/push/registry';
import { open, newSealKey, clampPlain } from '../../../src/lib/push/seal';
import { PUSH_RELAY_URL, pushRelayUrl } from '../../../src/lib/push/config';
import type { PushPlain } from '../../../src/lib/push/types';

/** A fake relay: answers /v1/push with the status queued for the request's pushId. */
interface Hit { url: string; method: string; headers: http.IncomingHttpHeaders; body: string }
const hits: Hit[] = [];
const statusFor = new Map<string, number>(); // pushId → status; 'sleep' pushes hang 10s
const SLEEP = -1;
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
      let pushId = '';
      try { pushId = JSON.parse(body).pushId; } catch { /* bad body */ }
      const status = statusFor.get(pushId) ?? 202;
      if (status === SLEEP) {
        const t = setTimeout(() => { res.statusCode = 202; res.end('{}'); }, 10_000);
        res.on('close', () => clearTimeout(t));
        return;
      }
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(status === 202 ? '{"ok":true}' : '{"error":"x"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => { hits.length = 0; statusFor.clear(); });

let n = 0;
function reg(): PushRegistration {
  n += 1;
  const id = `push${String(n).padStart(4, '0')}`.padEnd(22, 'A');
  return { pushId: id, sendSecret: 'S'.repeat(43), secretId: 'I'.repeat(22), sealKey: newSealKey(), keyId: 'machine-1234', env: 'sandbox' };
}

const plain: PushPlain = {
  v: 1, kind: 'done', chatId: 'chat-secret-id', projectPath: '/home/me/secret-project',
  title: 'Top secret title', body: 'The final answer is forty-two', ts: 99,
};

function mk(timeoutMs?: number) {
  const registry = new PushRegistry(':memory:');
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const send = createPushSender({
    registry, relayUrl: base, ...(timeoutMs ? { timeoutMs } : {}),
    log: (event, data) => logs.push({ event, data }),
  });
  return { registry, send, logs };
}

describe('push sender', () => {
  it('the relay URL is the deployed worker, overridable by SAI_PUSH_RELAY_URL', () => {
    expect(PUSH_RELAY_URL).toBe('https://sai-push-relay.project96.workers.dev');
    expect(pushRelayUrl({})).toBe(PUSH_RELAY_URL);
    expect(pushRelayUrl({ SAI_PUSH_RELAY_URL: 'http://127.0.0.1:9/' })).toBe('http://127.0.0.1:9');
    expect(PUSH_SEND_TIMEOUT_MS).toBe(5000);
  });

  it('payload posted to relay contains no plaintext', async () => {
    const { registry, send, logs } = mk();
    const r = reg();
    registry.set('dev-1', r);
    expect(await send({ deviceId: 'dev-1', reg: r }, plain)).toBe('sent');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit.method).toBe('POST');
    expect(hit.url).toBe('/v1/push');
    expect(hit.headers['content-type']).toBe('application/json');
    const body = JSON.parse(hit.body);
    expect(Object.keys(body).sort()).toEqual(['kind', 'pushId', 'sealed', 'sendSecret']);
    expect(body).toMatchObject({ pushId: r.pushId, sendSecret: r.sendSecret, kind: 'done' });
    for (const s of [plain.chatId, plain.projectPath, plain.title, plain.body, 'secret', 'forty-two', r.sealKey]) {
      expect(hit.body).not.toContain(s);
    }
    expect(await open(r.sealKey, body.sealed)).toEqual(clampPlain(plain));
    // devlog carries only kind, status and duration.
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe('send');
    expect(Object.keys(logs[0].data).sort()).toEqual(['kind', 'ms', 'status']);
    expect(logs[0].data).toMatchObject({ kind: 'done', status: 202 });
    expect(registry.get('dev-1')).not.toBeNull();
  });

  it('relay 401 deletes registration', async () => {
    const { registry, send, logs } = mk();
    for (const status of [401, 404, 410]) {
      const r = reg();
      registry.set(`dev-${status}`, r);
      statusFor.set(r.pushId, status);
      expect(await send({ deviceId: `dev-${status}`, reg: r }, plain)).toBe('removed');
      expect(registry.get(`dev-${status}`)).toBeNull();
    }
    expect(logs.map((l) => l.data.status)).toEqual([401, 404, 410]);
    // A stale target never deletes the phone's newer registration.
    const old = reg();
    const fresh = { ...reg(), pushId: old.pushId, sendSecret: 'T'.repeat(43) };
    registry.set('dev-x', fresh);
    statusFor.set(old.pushId, 401);
    await send({ deviceId: 'dev-x', reg: old }, plain);
    expect(registry.get('dev-x')).toEqual(fresh);
  });

  it('429 and relay errors drop quietly and keep the registration', async () => {
    const { registry, send } = mk();
    for (const status of [429, 502, 503, 413]) {
      const r = reg();
      registry.set('dev-1', r);
      statusFor.set(r.pushId, status);
      expect(await send({ deviceId: 'dev-1', reg: r }, plain)).toBe('dropped');
      expect(registry.get('dev-1')).toEqual(r);
    }
    expect(hits).toHaveLength(4); // no retries
  });

  it('relay timeout does not throw or block', async () => {
    const { registry, send, logs } = mk(400);
    const r = reg();
    registry.set('dev-1', r);
    statusFor.set(r.pushId, SLEEP); // the fake relay sleeps 10s
    const t0 = Date.now();
    const p = send({ deviceId: 'dev-1', reg: r }, plain);
    expect(Date.now() - t0).toBeLessThan(50); // returns at once: the caller never waits
    await expect(p).resolves.toBe('timeout');
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(350);
    expect(took).toBeLessThan(3000);
    expect(registry.get('dev-1')).toEqual(r);
    expect(logs[0].data).toMatchObject({ kind: 'done', status: 'timeout' });
    // An unreachable relay resolves too.
    const dead = createPushSender({ registry, relayUrl: 'http://127.0.0.1:1', log: () => {} });
    await expect(dead({ deviceId: 'dev-1', reg: r }, plain)).resolves.toBe('failed');
  });
});
