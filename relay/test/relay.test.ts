import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { APNS_TOKEN, APNS_TOKEN_2, fakeSealed, json, makeHarness, resetDb, type Harness } from './helpers';

type Reg = { pushId: string; ownerToken: string };
type Sec = { secretId: string; sendSecret: string };

async function register(h: Harness, body: Record<string, unknown> = {}): Promise<Reg> {
  const res = await h.call('POST', '/v1/register', { apnsToken: APNS_TOKEN, env: 'sandbox', ...body });
  expect(res.status).toBe(200);
  return json<Reg>(res);
}

async function mintSecret(h: Harness, reg: Reg, label = 'Desk'): Promise<Sec> {
  const res = await h.call('POST', '/v1/secrets', { ...reg, label });
  expect(res.status).toBe(200);
  return json<Sec>(res);
}

function push(h: Harness, reg: Reg, sec: Sec, extra: Record<string, unknown> = {}) {
  return h.call('POST', '/v1/push', {
    pushId: reg.pushId,
    sendSecret: sec.sendSecret,
    sealed: fakeSealed(),
    kind: 'done',
    ...extra,
  });
}

async function regRow(pushId: string) {
  return env.DB.prepare('SELECT * FROM registrations WHERE push_id = ?').bind(pushId).first<Record<string, unknown>>();
}

beforeEach(resetDb);

describe('register', () => {
  it('register then re-register with ownerToken updates token, keeps pushId and secrets', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    expect(reg.pushId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(reg.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sec = await mintSecret(h, reg);

    const again = await register(h, { apnsToken: APNS_TOKEN_2, env: 'production', ...reg });
    expect(again).toEqual(reg);

    const row = await regRow(reg.pushId);
    expect(row?.apns_token).toBe(APNS_TOKEN_2);
    expect(row?.env).toBe('production');

    // The existing desktop secret still works, and the push goes to the new token on the production host.
    const res = await push(h, reg, sec);
    expect(res.status).toBe(202);
    expect(h.apnsCalls[0]!.url).toBe(`https://api.push.apple.com/3/device/${APNS_TOKEN_2}`);
  });

  it('re-register with a wrong ownerToken creates a new registration', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const other = await register(h, { pushId: reg.pushId, ownerToken: 'x'.repeat(43) });
    expect(other.pushId).not.toBe(reg.pushId);
    expect((await regRow(reg.pushId))?.apns_token).toBe(APNS_TOKEN);
  });

  it('DELETE /v1/register removes the registration and all its secrets', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    expect((await h.call('DELETE', '/v1/register', { pushId: reg.pushId, ownerToken: 'y'.repeat(43) })).status).toBe(401);
    expect((await h.call('DELETE', '/v1/register', reg)).status).toBe(200);
    expect(await regRow(reg.pushId)).toBeNull();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM send_secrets').first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect((await push(h, reg, sec)).status).toBe(404);
  });

  it('rejects malformed input', async () => {
    const h = await makeHarness();
    const bad = [
      { apnsToken: 'not-hex', env: 'sandbox' },
      { apnsToken: APNS_TOKEN, env: 'staging' },
      { apnsToken: APNS_TOKEN, env: 'sandbox', ownerToken: 'has spaces and is not base64url!!!!!!!!!!!!' },
      { apnsToken: 123, env: 'sandbox' },
    ];
    for (const body of bad) expect((await h.call('POST', '/v1/register', body)).status).toBe(400);
    expect((await h.call('POST', '/v1/register', '{not json')).status).toBe(400);
  });
});

describe('secrets', () => {
  it('push with revoked secret is 401', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const keep = await mintSecret(h, reg, 'Laptop');
    const sec = await mintSecret(h, reg, 'Desk');
    expect((await push(h, reg, sec)).status).toBe(202);

    const del = await h.call('DELETE', '/v1/secrets', { ...reg, secretId: sec.secretId });
    expect(del.status).toBe(200);
    expect((await push(h, reg, sec)).status).toBe(401);
    // Other desktops are unaffected.
    expect((await push(h, reg, keep)).status).toBe(202);
  });

  it('minting a secret requires the ownerToken', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const res = await h.call('POST', '/v1/secrets', { pushId: reg.pushId, ownerToken: 'z'.repeat(43), label: 'x' });
    expect(res.status).toBe(401);
  });

  it('secrets and tokens are stored hashed only', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);

    const regs = (await env.DB.prepare('SELECT * FROM registrations').all()).results;
    const secs = (await env.DB.prepare('SELECT * FROM send_secrets').all()).results;
    const dump = JSON.stringify([regs, secs]);
    expect(dump).not.toContain(reg.ownerToken);
    expect(dump).not.toContain(sec.sendSecret);
    expect(regs[0]!.owner_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(secs[0]!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(regs[0]!).sort()).toEqual(
      ['apns_token', 'created_at', 'env', 'owner_hash', 'push_id', 'updated_at'].sort(),
    );
  });
});

describe('push', () => {
  it('push builds the exact APNs request', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    const sealed = fakeSealed(200);
    const res = await push(h, reg, sec, { sealed, kind: 'approval' });
    expect(res.status).toBe(202);

    expect(h.apnsCalls).toHaveLength(1);
    const call = h.apnsCalls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`https://api.sandbox.push.apple.com/3/device/${APNS_TOKEN}`);
    expect(call.headers['apns-push-type']).toBe('alert');
    expect(call.headers['apns-topic']).toBe('com.project96.sai');
    expect(call.headers['apns-priority']).toBe('10');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['authorization']).toMatch(/^bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reg.pushId)));
    const threadId = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    expect(JSON.parse(call.body)).toEqual({
      aps: {
        alert: { title: 'SAI', body: 'New activity in a chat' },
        'mutable-content': 1,
        sound: 'default',
        'thread-id': threadId,
      },
      s: sealed,
      k: 'approval',
    });

    // Nothing identifying or secret leaks into the APNs request.
    const wire = call.body + JSON.stringify(call.headers);
    for (const secret of [reg.pushId, reg.ownerToken, sec.sendSecret, sec.secretId, 'Desk']) {
      expect(wire).not.toContain(secret);
    }
  });

  it('unknown pushId is 404, bad secret is 401', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    expect((await push(h, { ...reg, pushId: 'A'.repeat(22) }, sec)).status).toBe(404);
    expect((await push(h, reg, { ...sec, sendSecret: 'B'.repeat(43) })).status).toBe(401);
    expect(h.apnsCalls).toHaveLength(0);
  });

  it('sealed over 3500 chars is 413; non-base64 or bad kind is 400', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    expect((await push(h, reg, sec, { sealed: 'A'.repeat(3504) })).status).toBe(413);
    expect((await push(h, reg, sec, { sealed: 'not base64 at all!' })).status).toBe(400);
    expect((await push(h, reg, sec, { kind: 'chat-text' })).status).toBe(400);
  });

  it('bodies over 8 KB are 413', async () => {
    const h = await makeHarness();
    const res = await h.call('POST', '/v1/push', JSON.stringify({ pad: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
  });

  it('APNs 410 deletes the registration', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    h.apnsReply = { status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: 1 }) };
    const res = await push(h, reg, sec);
    expect(res.status).toBe(410);
    expect(await json(res)).toEqual({ error: 'unregistered', reason: 'Unregistered' });
    expect(await regRow(reg.pushId)).toBeNull();
    expect((await push(h, reg, sec)).status).toBe(404);
  });

  it('APNs 400 BadDeviceToken deletes the registration', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    h.apnsReply = { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
    expect((await push(h, reg, sec)).status).toBe(410);
    expect(await regRow(reg.pushId)).toBeNull();
  });

  it('other APNs errors are 502 with the reason only', async () => {
    const h = await makeHarness();
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    h.apnsReply = { status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) };
    const res = await push(h, reg, sec);
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: 'apns_error', reason: 'TooManyRequests' });
    expect(await regRow(reg.pushId)).not.toBeNull();
  });

  it('missing APNS secrets → 503', async () => {
    const h = await makeHarness({ apns: false });
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    const res = await push(h, reg, sec);
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: 'apns_not_configured' });
    expect(h.apnsCalls).toHaveLength(0);
  });

  it('rate limit returns 429', async () => {
    const keys: string[] = [];
    let n = 0;
    const h = await makeHarness({
      pushLimiter: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: ++n <= 2 };
        },
      },
    });
    const reg = await register(h);
    const sec = await mintSecret(h, reg);
    expect((await push(h, reg, sec)).status).toBe(202);
    expect((await push(h, reg, sec)).status).toBe(202);
    expect((await push(h, reg, sec)).status).toBe(429);
    expect(h.apnsCalls).toHaveLength(2);
    expect(new Set(keys)).toEqual(new Set([reg.pushId]));
  });

  it('register is rate limited per client IP', async () => {
    const keys: string[] = [];
    const h = await makeHarness({
      registerLimiter: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: false };
        },
      },
    });
    const res = await h.call('POST', '/v1/register', { apnsToken: APNS_TOKEN, env: 'sandbox' }, {
      'cf-connecting-ip': '203.0.113.7',
    });
    expect(res.status).toBe(429);
    expect(keys).toEqual(['203.0.113.7']);
  });
});

describe('misc', () => {
  it('GET /healthz', async () => {
    const h = await makeHarness();
    const res = await h.call('GET', '/healthz');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });

  it('CORS allows only the app origins', async () => {
    const h = await makeHarness();
    const pre = await h.call('OPTIONS', '/v1/register', undefined, { origin: 'capacitor://localhost' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    const ok = await h.call('GET', '/healthz', undefined, { origin: 'http://localhost' });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost');
    const evil = await h.call('GET', '/healthz', undefined, { origin: 'https://evil.example' });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('unknown routes are 404', async () => {
    const h = await makeHarness();
    expect((await h.call('GET', '/v1/nope')).status).toBe(404);
  });
});
