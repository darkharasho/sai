/**
 * SAI push relay.
 *
 * Maps opaque push ids to APNs device tokens and forwards sealed blobs it
 * cannot read. Never log request bodies, tokens or secrets: the only log line
 * is `{route, status, ms}` per request.
 */
import { buildApnsBody, getApnsJwt, sendApns, type ApnsConfig } from './apns';
import { randomB64url, sha256Hex, timingSafeEqualStr } from './crypto';
import { D1Store, type ApnsEnv, type Registration, type Store } from './store';

export interface Env {
  DB: D1Database;
  PUSH_LIMITER?: Limiter;
  REGISTER_LIMITER?: Limiter;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
}

/** Shape of the Workers rate-limit binding. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Deps {
  store: Store;
  fetch: typeof fetch;
  now: () => number;
  pushLimiter?: Limiter;
  registerLimiter?: Limiter;
}

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_SEALED_CHARS = 3500;
export const MAX_SECRETS_PER_PUSH_ID = 32;
const ALLOWED_ORIGINS = new Set(['capacitor://localhost', 'http://localhost']);
const KINDS = new Set(['done', 'approval', 'question', 'error']);

const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url (pushId, secretId)
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url (ownerToken, sendSecret)
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

const bad = (field: string) => new HttpError(400, { error: 'invalid', field });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, { error: 'too_large' });
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, { error: 'too_large' });
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, { error: 'bad_json' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, { error: 'bad_json' });
  return parsed as Record<string, unknown>;
}

function str(body: Record<string, unknown>, field: string, re: RegExp): string {
  const v = body[field];
  if (typeof v !== 'string' || !re.test(v)) throw bad(field);
  return v;
}

function optStr(body: Record<string, unknown>, field: string, re: RegExp): string | undefined {
  return body[field] === undefined || body[field] === null ? undefined : str(body, field, re);
}

function apnsEnv(body: Record<string, unknown>): ApnsEnv {
  const v = body.env;
  if (v !== 'sandbox' && v !== 'production') throw bad('env');
  return v;
}

function label(body: Record<string, unknown>): string {
  const v = body.label ?? '';
  if (typeof v !== 'string' || v.length > 64 || CONTROL_RE.test(v)) throw bad('label');
  return v;
}

async function limited(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false; // fail open: a limiter outage must not take pushes down
  }
}

/** Looks up a registration and checks the owner token in constant time. */
async function authOwner(store: Store, pushId: string, ownerToken: string): Promise<Registration> {
  const reg = await store.getRegistration(pushId);
  if (!reg) throw new HttpError(404, { error: 'unknown_push_id' });
  if (!timingSafeEqualStr(await sha256Hex(ownerToken), reg.ownerHash)) {
    throw new HttpError(401, { error: 'unauthorized' });
  }
  return reg;
}

async function register(req: Request, deps: Deps): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (await limited(deps.registerLimiter, ip)) throw new HttpError(429, { error: 'rate_limited' });
  const body = await readJson(req);
  const apnsToken = str(body, 'apnsToken', APNS_TOKEN_RE).toLowerCase();
  const env = apnsEnv(body);
  const ownerToken = optStr(body, 'ownerToken', TOKEN_RE);
  const pushId = optStr(body, 'pushId', ID_RE);
  const now = deps.now();

  if (pushId && ownerToken) {
    const reg = await deps.store.getRegistration(pushId);
    if (reg && timingSafeEqualStr(await sha256Hex(ownerToken), reg.ownerHash)) {
      await deps.store.updateRegistration(pushId, apnsToken, env, now);
      return jsonResponse(200, { pushId, ownerToken });
    }
  }
  const fresh = { pushId: randomB64url(16), ownerToken: randomB64url(32) };
  await deps.store.createRegistration({
    pushId: fresh.pushId,
    ownerHash: await sha256Hex(fresh.ownerToken),
    apnsToken,
    env,
    createdAt: now,
    updatedAt: now,
  });
  return jsonResponse(200, fresh);
}

async function unregister(req: Request, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  const reg = await authOwner(deps.store, str(body, 'pushId', ID_RE), str(body, 'ownerToken', TOKEN_RE));
  await deps.store.deleteRegistration(reg.pushId);
  return jsonResponse(200, { ok: true });
}

async function createSecret(req: Request, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  const pushId = str(body, 'pushId', ID_RE);
  const ownerToken = str(body, 'ownerToken', TOKEN_RE);
  const lbl = label(body);
  await authOwner(deps.store, pushId, ownerToken);
  if ((await deps.store.listSecrets(pushId)).length >= MAX_SECRETS_PER_PUSH_ID) {
    throw new HttpError(409, { error: 'too_many_secrets' });
  }
  const secretId = randomB64url(16);
  const sendSecret = randomB64url(32);
  await deps.store.addSecret({
    secretId,
    pushId,
    secretHash: await sha256Hex(sendSecret),
    label: lbl,
    createdAt: deps.now(),
  });
  return jsonResponse(200, { secretId, sendSecret });
}

async function deleteSecret(req: Request, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  const pushId = str(body, 'pushId', ID_RE);
  const ownerToken = str(body, 'ownerToken', TOKEN_RE);
  const secretId = str(body, 'secretId', ID_RE);
  await authOwner(deps.store, pushId, ownerToken);
  await deps.store.deleteSecret(pushId, secretId); // idempotent
  return jsonResponse(200, { ok: true });
}

function apnsConfig(env: Env): ApnsConfig | null {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
  return { APNS_KEY_P8: env.APNS_KEY_P8, APNS_KEY_ID: env.APNS_KEY_ID, APNS_TEAM_ID: env.APNS_TEAM_ID };
}

async function pushRoute(req: Request, env: Env, deps: Deps): Promise<Response> {
  const body = await readJson(req);
  const pushId = str(body, 'pushId', ID_RE);
  const sendSecret = str(body, 'sendSecret', TOKEN_RE);
  const sealed = body.sealed;
  if (typeof sealed !== 'string') throw bad('sealed');
  if (sealed.length > MAX_SEALED_CHARS) throw new HttpError(413, { error: 'sealed_too_large' });
  // nonce(12) + tag(16) = 28 bytes minimum, i.e. 40 base64 chars.
  if (sealed.length < 40 || sealed.length % 4 !== 0 || !BASE64_RE.test(sealed)) throw bad('sealed');
  const kind = body.kind;
  if (typeof kind !== 'string' || !KINDS.has(kind)) throw bad('kind');

  if (await limited(deps.pushLimiter, pushId)) throw new HttpError(429, { error: 'rate_limited' });

  const reg = await deps.store.getRegistration(pushId);
  if (!reg) throw new HttpError(404, { error: 'unknown_push_id' });
  const hash = await sha256Hex(sendSecret);
  let authorized = false;
  for (const s of await deps.store.listSecrets(pushId)) {
    // No early exit: every stored hash is compared.
    if (timingSafeEqualStr(hash, s.secretHash)) authorized = true;
  }
  if (!authorized) throw new HttpError(401, { error: 'unauthorized' });

  const cfg = apnsConfig(env);
  if (!cfg) throw new HttpError(503, { error: 'apns_not_configured' });
  let jwt: string;
  try {
    jwt = await getApnsJwt(cfg, deps.now());
  } catch {
    throw new HttpError(503, { error: 'apns_key_invalid' });
  }

  const outcome = await sendApns({
    fetch: deps.fetch,
    jwt,
    env: reg.env,
    deviceToken: reg.apnsToken,
    body: await buildApnsBody(pushId, sealed, kind),
  });
  switch (outcome.kind) {
    case 'ok':
      return jsonResponse(202, { ok: true });
    case 'gone':
      await deps.store.deleteRegistration(pushId);
      return jsonResponse(410, { error: 'unregistered', reason: outcome.reason });
    case 'error':
      return jsonResponse(502, { error: 'apns_error', reason: outcome.reason });
    case 'unreachable':
      return jsonResponse(502, { error: 'apns_unreachable' });
  }
}

type Handler = (req: Request, env: Env, deps: Deps) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  'GET /healthz': async () => jsonResponse(200, { ok: true }),
  'POST /v1/register': (req, _env, deps) => register(req, deps),
  'DELETE /v1/register': (req, _env, deps) => unregister(req, deps),
  'POST /v1/secrets': (req, _env, deps) => createSecret(req, deps),
  'DELETE /v1/secrets': (req, _env, deps) => deleteSecret(req, deps),
  'POST /v1/push': pushRoute,
};

function withCors(res: Response, origin: string | null): Response {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.append('vary', 'Origin');
  return out;
}

/** Route a request. `deps` is injectable for tests. */
export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const started = Date.now();
  const path = new URL(req.url).pathname;
  const origin = req.headers.get('origin');
  let route = `${req.method} ${path}`;
  let res: Response;

  if (req.method === 'OPTIONS') {
    route = 'OPTIONS';
    res = new Response(null, { status: 204 });
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
      res.headers.set('access-control-allow-headers', 'content-type');
      res.headers.set('access-control-max-age', '86400');
    }
  } else {
    const handler = ROUTES[route];
    if (!handler) {
      route = 'unknown'; // never log arbitrary paths
      res = jsonResponse(404, { error: 'not_found' });
    } else {
      try {
        res = await handler(req, env, deps);
      } catch (err) {
        res =
          err instanceof HttpError ? jsonResponse(err.status, err.body) : jsonResponse(500, { error: 'internal' });
      }
    }
  }
  // The only log line: no bodies, tokens, secrets, ids or IPs.
  console.log(JSON.stringify({ route, status: res.status, ms: Date.now() - started }));
  return withCors(res, origin);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env, {
      store: new D1Store(env.DB),
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      pushLimiter: env.PUSH_LIMITER,
      registerLimiter: env.REGISTER_LIMITER,
    });
  },
} satisfies ExportedHandler<Env>;
