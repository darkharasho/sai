import { env } from 'cloudflare:workers';
import { handle, type Deps, type Env, type Limiter } from '../src/index';
import { D1Store } from '../src/store';
import { _resetJwtCache } from '../src/apns';

export const APNS_TOKEN = 'a1'.repeat(32); // 64 hex chars, like a real token
export const APNS_TOKEN_2 = 'b2'.repeat(32);

export async function resetDb(): Promise<void> {
  const db = env.DB;
  await db.prepare('DROP TABLE IF EXISTS send_secrets').run();
  await db.prepare('DROP TABLE IF EXISTS registrations').run();
  const statements = env.TEST_SCHEMA
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await db.batch(statements.map((s) => db.prepare(s)));
}

/** P-256 PKCS8 key as a `.p8` PEM, plus its public key for verification. */
export async function makeP8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

export interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface Harness {
  env: Env;
  deps: Deps;
  apnsCalls: Captured[];
  /** Next APNs response; default 200. */
  apnsReply: { status: number; body?: string };
  /** Runs inside the fake APNs fetch, before it replies. */
  onApns?: () => Promise<void>;
  /** Unix ms returned by deps.now. */
  clock: number;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
}

export function allowAll(): Limiter {
  return { limit: async () => ({ success: true }) };
}

export async function makeHarness(opts: {
  apns?: boolean;
  p8?: string;
  pushLimiter?: Limiter;
  registerLimiter?: Limiter;
} = {}): Promise<Harness> {
  _resetJwtCache();
  const p8 = opts.p8 ?? (opts.apns === false ? undefined : (await makeP8()).pem);
  const relayEnv: Env = {
    DB: env.DB,
    ...(p8 ? { APNS_KEY_P8: p8, APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAMID6789' } : {}),
  };
  const apnsCalls: Captured[] = [];
  const h: Harness = {
    env: relayEnv,
    apnsCalls,
    apnsReply: { status: 200 },
    clock: 1_800_000_000_000,
    deps: undefined as unknown as Deps,
    async call(method, path, body, headers = {}) {
      const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
      if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
      return handle(new Request(`https://relay.test${path}`, init), h.env, h.deps);
    },
  };
  h.deps = {
    store: new D1Store(env.DB),
    now: () => h.clock,
    pushLimiter: opts.pushLimiter ?? allowAll(),
    registerLimiter: opts.registerLimiter ?? allowAll(),
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const hdrs: Record<string, string> = {};
      req.headers.forEach((v, k) => (hdrs[k] = v));
      apnsCalls.push({ url: req.url, method: req.method, headers: hdrs, body: await req.text() });
      if (h.onApns) await h.onApns();
      return new Response(h.apnsReply.body ?? '', { status: h.apnsReply.status });
    },
  };
  return h;
}

/** A sealed-looking base64 blob (the relay never opens it). */
export function fakeSealed(bytes = 120): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let bin = '';
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
