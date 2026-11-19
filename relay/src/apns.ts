import { bytesToB64url, sha256Hex, strToB64url } from './crypto';
import type { ApnsEnv } from './store';

export const APNS_TOPIC = 'com.project96.sai';
export const FALLBACK_ALERT = { title: 'SAI', body: 'New activity in a chat' } as const;
export const JWT_TTL_MS = 50 * 60_000;

export interface ApnsConfig {
  APNS_KEY_P8: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
}

export function apnsHost(env: ApnsEnv): string {
  return env === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
}

// Module-scope cache: one isolate signs at most one token per 50 minutes.
// APNs rejects tokens refreshed more often than every 20 minutes or older than an hour.
let cache: { keyId: string; teamId: string; p8: string; jwt: string; issuedAt: number } | null = null;

export function _resetJwtCache(): void {
  cache = null;
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** ES256 provider token for APNs, cached for 50 minutes. Throws if the key is not a P-256 PKCS8 key. */
export async function getApnsJwt(cfg: ApnsConfig, nowMs: number): Promise<string> {
  if (
    cache &&
    cache.keyId === cfg.APNS_KEY_ID &&
    cache.teamId === cfg.APNS_TEAM_ID &&
    cache.p8 === cfg.APNS_KEY_P8 &&
    nowMs - cache.issuedAt < JWT_TTL_MS &&
    nowMs >= cache.issuedAt
  ) {
    return cache.jwt;
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(cfg.APNS_KEY_P8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = strToB64url(JSON.stringify({ alg: 'ES256', kid: cfg.APNS_KEY_ID }));
  const claims = strToB64url(JSON.stringify({ iss: cfg.APNS_TEAM_ID, iat: Math.floor(nowMs / 1000) }));
  const input = `${header}.${claims}`;
  // WebCrypto ECDSA returns raw r||s (64 bytes): exactly the JWS ES256 signature form.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)),
  );
  const jwt = `${input}.${bytesToB64url(sig)}`;
  cache = { keyId: cfg.APNS_KEY_ID, teamId: cfg.APNS_TEAM_ID, p8: cfg.APNS_KEY_P8, jwt, issuedAt: nowMs };
  return jwt;
}

export async function buildApnsBody(pushId: string, sealed: string, kind: string): Promise<string> {
  const threadId = (await sha256Hex(pushId)).slice(0, 16);
  return JSON.stringify({
    aps: {
      alert: { title: FALLBACK_ALERT.title, body: FALLBACK_ALERT.body },
      'mutable-content': 1,
      sound: 'default',
      'thread-id': threadId,
    },
    s: sealed,
    k: kind,
  });
}

export type ApnsOutcome =
  | { kind: 'ok' }
  | { kind: 'gone'; reason: string } // registration must be deleted
  | { kind: 'error'; status: number; reason: string }
  | { kind: 'unreachable' };

const REASON_RE = /^[A-Za-z]{1,64}$/;

export async function sendApns(opts: {
  fetch: typeof fetch;
  jwt: string;
  env: ApnsEnv;
  deviceToken: string;
  body: string;
}): Promise<ApnsOutcome> {
  let res: Response;
  try {
    res = await opts.fetch(`https://${apnsHost(opts.env)}/3/device/${opts.deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${opts.jwt}`,
        'apns-push-type': 'alert',
        'apns-topic': APNS_TOPIC,
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: opts.body,
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 200) {
    await res.body?.cancel();
    return { kind: 'ok' };
  }
  let reason = 'Unknown';
  try {
    const parsed = (await res.json()) as { reason?: unknown };
    if (typeof parsed.reason === 'string' && REASON_RE.test(parsed.reason)) reason = parsed.reason;
  } catch {
    // non-JSON error body: keep "Unknown"
  }
  if (res.status === 410) return { kind: 'gone', reason };
  if (res.status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) {
    return { kind: 'gone', reason };
  }
  if (res.status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) {
    _resetJwtCache();
  }
  return { kind: 'error', status: res.status, reason };
}
