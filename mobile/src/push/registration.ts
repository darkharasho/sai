// The phone's push registration (relay/README.md) and the per-desktop link
// (electron/services/remote/chat-v2.ts push.register).
//
// - ensurePushRegistration: permission (prompted only when a pairing asks),
//   the APNs token, POST /v1/register (reusing pushId + ownerToken so the
//   registration and every send secret survive token rotation).
// - linkMachine: one send secret (POST /v1/secrets) and one seal key per
//   desktop, sent to it in push.register. Idempotent: reconnects resend the
//   stored secret and key; nothing new is minted.
// - unlinkMachine: push.unregister, DELETE /v1/secrets, forget the key. A
//   revoke the relay didn't confirm is kept (Keychain, PENDING_REVOKES_KEY)
//   and retried by every ensurePushRegistration until the relay answers;
//   otherwise the desktop's secret stays valid with its seal key gone, and
//   every push it sends shows the generic fallback alert.
//
// Push is best effort. The relay can be down, rate limited or not configured
// yet: every failure is logged quietly and retried on the next auth_ok or
// launch. Nothing here may throw into pairing or chat.
import { PUSH_RELAY_URL } from '../../../src/lib/push/config';
import { newSealKey } from '../../../src/lib/push/seal';
import type { FullNativeApi, PushEnv } from '../native';
import type { Machine } from '../machines/store';
import type { V2Client } from '../v2/client';

export const PUSH_ID_KEY = 'push.pushId';
export const OWNER_TOKEN_KEY = 'push.ownerToken';
/**
 * Keychain access group shared with the Notification Service Extension (the
 * native side prepends $(AppIdentifierPrefix)). Only seal keys live there.
 */
export const SHARED_ACCESS_GROUP = 'com.project96.sai.shared';
/** The seal key the extension opens this desktop's pushes with. */
export const sealKeyName = (keyId: string) => `seal:${keyId}`;
/** This desktop's relay send secret ({pushId, secretId, sendSecret} JSON, default group). */
export const secretKeyName = (machineId: string) => `push.secret:${machineId}`;
/**
 * Revokes the relay hasn't confirmed: [{pushId, ownerToken, secretId}] JSON,
 * default group (never the shared one), never logged. Newest last.
 */
export const PENDING_REVOKES_KEY = 'push.pendingRevokes';
export const PENDING_REVOKES_MAX = 32;

// Mirrors relay/src/index.ts and electron/services/push/registry.ts.
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SEAL_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

const RELAY_TIMEOUT_MS = 10_000;
/** Removing a machine waits on the revoke: keep it short. */
const REVOKE_TIMEOUT_MS = 5_000;
/** How long ensurePushRegistration waits for iOS to hand over the token. */
const TOKEN_WAIT_MS = 15_000;
/** After a failed relay registration, unforced attempts wait this long (the relay allows 10/min per IP). */
const RETRY_AFTER_MS = 60_000;

export interface PushIdentity { pushId: string; ownerToken: string; env: PushEnv }
interface StoredSecret { pushId: string; secretId: string; sendSecret: string }
interface PendingRevoke { pushId: string; ownerToken: string; secretId: string }

interface State {
  identity: PushIdentity | null;
  listening: boolean;
  inflight: Promise<PushIdentity | null> | null;
  waiters: Array<(id: PushIdentity | null) => void>;
  failedAt: number;
  linking: Map<string, Promise<boolean>>;
  /** machine id → when minting its send secret last failed (unforced retries wait RETRY_AFTER_MS). */
  mintFailedAt: Map<string, number>;
  listeners: Set<(id: PushIdentity) => void>;
  /** Serializes every read-modify-write of PENDING_REVOKES_KEY. */
  revokes: Promise<void>;
  retrying: boolean;
}

const states = new WeakMap<FullNativeApi, State>();
function stateOf(native: FullNativeApi): State {
  let s = states.get(native);
  if (!s) {
    s = { identity: null, listening: false, inflight: null, waiters: [], failedAt: 0, linking: new Map(), mintFailedAt: new Map(), listeners: new Set(), revokes: Promise.resolve(), retrying: false };
    states.set(native, s);
  }
  return s;
}

const warn = (msg: string) => { console.warn(`[push] ${msg}`); };
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function kcGet(native: FullNativeApi, key: string, group?: string): Promise<string | null> {
  try { return await native.keychainGet(key, group ? { accessGroup: group } : undefined); } catch { return null; }
}

async function relay(native: FullNativeApi, method: 'POST' | 'DELETE', path: string, body: Record<string, unknown>, timeoutMs = RELAY_TIMEOUT_MS) {
  return native.http({ method, url: `${PUSH_RELAY_URL}${path}`, body, timeoutMs });
}

function parsePending(raw: string | null): PendingRevoke[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((o) => (o && typeof o === 'object'
      && typeof o.pushId === 'string' && ID_RE.test(o.pushId)
      && typeof o.ownerToken === 'string' && TOKEN_RE.test(o.ownerToken)
      && typeof o.secretId === 'string' && ID_RE.test(o.secretId)
      ? [{ pushId: o.pushId, ownerToken: o.ownerToken, secretId: o.secretId }] : []));
  } catch { return []; }
}

/** Runs `fn` on the pending-revoke list under the state's lock and stores what it returns. */
function updatePending(native: FullNativeApi, fn: (list: PendingRevoke[]) => Promise<PendingRevoke[]> | PendingRevoke[]): Promise<void> {
  const s = stateOf(native);
  const run = s.revokes.then(async () => {
    const before = parsePending(await kcGet(native, PENDING_REVOKES_KEY));
    const after = (await fn(before)).slice(-PENDING_REVOKES_MAX);
    if (after.length === 0) {
      if (before.length) await native.keychainRemove(PENDING_REVOKES_KEY).catch(() => {});
    } else if (JSON.stringify(after) !== JSON.stringify(before)) {
      await native.keychainSet(PENDING_REVOKES_KEY, JSON.stringify(after));
    }
  }).catch((err) => { warn(`pending revokes: ${errText(err)}`); });
  s.revokes = run;
  return run;
}

/**
 * DELETE /v1/secrets. True once the relay has answered for good: 2xx, or its
 * own unknown_push_id (404) / unauthorized (401), after which nothing can
 * use that secret anyway. Anything else (offline, 5xx, a route-level 404) is
 * worth retrying. Logs statuses only, never the ids or tokens.
 */
async function revokeAtRelay(native: FullNativeApi, r: PendingRevoke): Promise<boolean> {
  try {
    const res = await relay(native, 'DELETE', '/v1/secrets', { pushId: r.pushId, ownerToken: r.ownerToken, secretId: r.secretId }, REVOKE_TIMEOUT_MS);
    if (res.status >= 200 && res.status < 300) return true;
    const code = res.data && typeof res.data === 'object' ? (res.data as { error?: unknown }).error : undefined;
    if ((res.status === 404 && code === 'unknown_push_id') || (res.status === 401 && code === 'unauthorized')) return true;
    warn(`relay revoke failed (${res.status})`);
  } catch (err) {
    warn(`relay unreachable: ${errText(err)}`);
  }
  return false;
}

/** Retries every revoke the relay hasn't confirmed. Never rejects. */
export async function retryPendingRevokes(native: FullNativeApi): Promise<void> {
  const s = stateOf(native);
  if (s.retrying) return;
  s.retrying = true;
  try {
    await updatePending(native, async (list) => {
      const keep: PendingRevoke[] = [];
      for (const r of list) if (!(await revokeAtRelay(native, r))) keep.push(r);
      return keep;
    });
  } finally {
    s.retrying = false;
  }
}

/** Called when the identity changes (first registration, a new pushId or env); desktops need a fresh push.register. */
export function onPushIdentity(native: FullNativeApi, cb: (id: PushIdentity) => void): () => void {
  const s = stateOf(native);
  s.listeners.add(cb);
  return () => { s.listeners.delete(cb); };
}

/** The identity from this session's registration, if any. */
export function currentPushIdentity(native: FullNativeApi): PushIdentity | null {
  return stateOf(native).identity;
}

async function buildEnv(native: FullNativeApi): Promise<PushEnv> {
  try { return (await native.buildEnv?.()) ?? 'production'; } catch { return 'production'; }
}

/** POST /v1/register for `token`; on relay failure falls back to a stored registration. */
async function registerToken(native: FullNativeApi, token: string): Promise<void> {
  const s = stateOf(native);
  let next: PushIdentity | null = s.identity;
  try {
    if (!APNS_TOKEN_RE.test(token)) { warn('ignoring a malformed APNs token'); return; }
    const env = await buildEnv(native);
    const prevId = await kcGet(native, PUSH_ID_KEY);
    const prevOwner = await kcGet(native, OWNER_TOKEN_KEY);
    const reuse = prevId && prevOwner && ID_RE.test(prevId) && TOKEN_RE.test(prevOwner);
    let res;
    try {
      res = await relay(native, 'POST', '/v1/register', {
        apnsToken: token, env, ...(reuse ? { pushId: prevId, ownerToken: prevOwner } : {}),
      });
    } catch (err) {
      res = null;
      warn(`relay unreachable: ${errText(err)}`);
    }
    const d = res?.data as { pushId?: unknown; ownerToken?: unknown } | null | undefined;
    if (res && res.status === 200 && d && typeof d.pushId === 'string' && ID_RE.test(d.pushId)
      && typeof d.ownerToken === 'string' && TOKEN_RE.test(d.ownerToken)) {
      if (d.pushId !== prevId) await native.keychainSet(PUSH_ID_KEY, d.pushId);
      if (d.ownerToken !== prevOwner) await native.keychainSet(OWNER_TOKEN_KEY, d.ownerToken);
      next = { pushId: d.pushId, ownerToken: d.ownerToken, env };
      s.failedAt = 0;
    } else {
      if (res) warn(`relay register failed (${res.status})`);
      s.failedAt = Date.now();
      // Still registered from an earlier launch: those secrets keep working.
      if (!next && reuse) next = { pushId: prevId!, ownerToken: prevOwner!, env };
    }
  } catch (err) {
    warn(`register failed: ${errText(err)}`);
    s.failedAt = Date.now();
  } finally {
    const prev = s.identity;
    s.identity = next;
    const waiters = s.waiters;
    s.waiters = [];
    for (const w of waiters) w(next);
    if (next && (!prev || prev.pushId !== next.pushId || prev.ownerToken !== next.ownerToken || prev.env !== next.env)) {
      for (const cb of [...s.listeners]) { try { cb(next); } catch (err) { warn(`identity listener: ${errText(err)}`); } }
    }
  }
}

/**
 * Registers this phone with the relay. Prompts for permission only with
 * `prompt` (after a pairing); never otherwise. Resolves with the identity, or
 * null when push is unavailable, not permitted or the relay is unreachable
 * with nothing stored. Never rejects. `force` skips the retry back-off.
 */
export function ensurePushRegistration(
  native: FullNativeApi,
  opts: { prompt?: boolean; force?: boolean; timeoutMs?: number } = {},
): Promise<PushIdentity | null> {
  const s = stateOf(native);
  // Called on launch, resume and every auth_ok: a good moment to finish old revokes.
  void retryPendingRevokes(native);
  const push = native.push;
  if (!push) return Promise.resolve(null);
  if (s.inflight) return s.inflight;
  if (!opts.force && !opts.prompt && !s.identity && s.failedAt && Date.now() - s.failedAt < RETRY_AFTER_MS) {
    return Promise.resolve(null);
  }
  const run = (async (): Promise<PushIdentity | null> => {
    try {
      let perm = await push.checkPermission().catch(() => 'denied' as const);
      if (perm === 'prompt' && opts.prompt) perm = await push.requestPermission().catch(() => 'denied' as const);
      if (perm !== 'granted') return null;
      if (!s.listening) {
        s.listening = true;
        // Fires for every register() and whenever iOS rotates the token.
        push.onRegistration((token) => { void registerToken(native, token); });
        push.onRegistrationError((e) => { warn(`APNs registration failed: ${e}`); });
      }
      const next = new Promise<PushIdentity | null>((resolve) => {
        const timer = setTimeout(() => {
          s.waiters = s.waiters.filter((w) => w !== done);
          resolve(s.identity);
        }, opts.timeoutMs ?? TOKEN_WAIT_MS);
        const done = (id: PushIdentity | null) => { clearTimeout(timer); resolve(id); };
        s.waiters.push(done);
      });
      await push.register();
      return await next;
    } catch (err) {
      warn(`registration failed: ${errText(err)}`);
      return s.identity;
    }
  })();
  s.inflight = run;
  void run.finally(() => { if (s.inflight === run) s.inflight = null; });
  return run;
}

function parseSecret(raw: string | null): StoredSecret | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.pushId === 'string' && ID_RE.test(o.pushId) && typeof o.secretId === 'string' && ID_RE.test(o.secretId)
      && typeof o.sendSecret === 'string' && TOKEN_RE.test(o.sendSecret)) {
      return { pushId: o.pushId, secretId: o.secretId, sendSecret: o.sendSecret };
    }
  } catch { /* corrupt: mint a new one */ }
  return null;
}

async function mintSecret(native: FullNativeApi, machine: Machine, id: PushIdentity): Promise<StoredSecret | 'stale' | null> {
  let res;
  try {
    // No label: the relay sees only ids, sealed blobs and timestamps.
    res = await relay(native, 'POST', '/v1/secrets', { pushId: id.pushId, ownerToken: id.ownerToken });
  } catch (err) {
    warn(`relay unreachable: ${errText(err)}`);
    return null;
  }
  const d = res.data as { secretId?: unknown; sendSecret?: unknown } | null;
  if (res.status === 200 && d && typeof d.secretId === 'string' && ID_RE.test(d.secretId)
    && typeof d.sendSecret === 'string' && TOKEN_RE.test(d.sendSecret)) {
    const secret = { pushId: id.pushId, secretId: d.secretId, sendSecret: d.sendSecret };
    await native.keychainSet(secretKeyName(machine.id), JSON.stringify(secret));
    return secret;
  }
  warn(`relay secret failed (${res.status})`);
  // Only the relay's own answers mean the registration is gone (APNs said the
  // token died) or the owner token no longer matches. Any other 401/404 (a
  // route-level not_found during a deploy mismatch, a proxy) is a plain failure.
  const code = d && typeof d === 'object' ? (d as { error?: unknown }).error : undefined;
  return (res.status === 404 && code === 'unknown_push_id') || (res.status === 401 && code === 'unauthorized') ? 'stale' : null;
}

async function linkOnce(machine: Machine, client: V2Client, native: FullNativeApi): Promise<boolean> {
  const s = stateOf(native);
  const keyId = machine.id;
  if (!KEY_ID_RE.test(keyId)) { warn('machine id is not a valid keyId'); return false; }
  let id = s.identity ?? await ensurePushRegistration(native);
  if (!id) return false;

  let secret = parseSecret(await kcGet(native, secretKeyName(machine.id)));
  if (!secret || secret.pushId !== id.pushId) {
    const failedAt = s.mintFailedAt.get(machine.id);
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return false;
    let minted = await mintSecret(native, machine, id);
    if (minted === 'stale') {
      // Re-register (the relay hands out a fresh pushId) and try once more.
      s.identity = null;
      await native.keychainRemove(PUSH_ID_KEY).catch(() => {});
      await native.keychainRemove(OWNER_TOKEN_KEY).catch(() => {});
      id = await ensurePushRegistration(native, { force: true });
      minted = id ? await mintSecret(native, machine, id) : null;
    }
    if (!minted || minted === 'stale' || !id) { s.mintFailedAt.set(machine.id, Date.now()); return false; }
    s.mintFailedAt.delete(machine.id);
    secret = minted;
  }

  let sealKey = await kcGet(native, sealKeyName(keyId), SHARED_ACCESS_GROUP);
  if (!sealKey || !SEAL_KEY_RE.test(sealKey)) {
    sealKey = newSealKey();
    await native.keychainSet(sealKeyName(keyId), sealKey, { accessGroup: SHARED_ACCESS_GROUP });
  }

  if (!client.connected) return false; // the next auth_ok sends it
  client.request({
    type: 'push.register',
    pushId: secret.pushId, sendSecret: secret.sendSecret, secretId: secret.secretId,
    sealKey, keyId, env: id.env,
  }).catch((err) => { warn(`push.register refused: ${errText(err)}`); });
  return true;
}

/**
 * Links `machine` for push and sends it push.register over `client` (when
 * connected). Call on every auth_ok and identity change. Resolves true when
 * the frame went out; never rejects.
 */
export function linkMachine(machine: Machine, client: V2Client, native: FullNativeApi): Promise<boolean> {
  const s = stateOf(native);
  const running = s.linking.get(machine.id);
  if (running) return running;
  const run = linkOnce(machine, client, native).catch((err) => { warn(`link failed: ${errText(err)}`); return false; });
  s.linking.set(machine.id, run);
  void run.finally(() => { if (s.linking.get(machine.id) === run) s.linking.delete(machine.id); });
  return run;
}

/** Revokes the machine's stored secret (queued for retry on failure) and forgets its secret and seal key. */
async function purgeMachine(machineId: string, native: FullNativeApi): Promise<void> {
  try {
    const secret = parseSecret(await kcGet(native, secretKeyName(machineId)));
    const pushId = await kcGet(native, PUSH_ID_KEY);
    const ownerToken = await kcGet(native, OWNER_TOKEN_KEY);
    if (secret && pushId && ownerToken && secret.pushId === pushId && TOKEN_RE.test(ownerToken)) {
      const r: PendingRevoke = { pushId, ownerToken, secretId: secret.secretId };
      if (!(await revokeAtRelay(native, r))) {
        await updatePending(native, (list) => [...list.filter((x) => x.secretId !== r.secretId), r]);
      }
    }
  } catch (err) {
    warn(`unlink failed: ${errText(err)}`);
  }
  await native.keychainRemove(secretKeyName(machineId)).catch(() => {});
  await native.keychainRemove(sealKeyName(machineId), { accessGroup: SHARED_ACCESS_GROUP }).catch(() => {});
}

/**
 * Unlinks a desktop being removed: push.unregister over `client` (when
 * connected), revokes its send secret at the relay (kept for retry when the
 * relay doesn't confirm), forgets the secret and seal key. Never rejects.
 */
export async function unlinkMachine(machine: Pick<Machine, 'id'>, client: V2Client | null, native: FullNativeApi): Promise<void> {
  const s = stateOf(native);
  // Synchronous, before any await: the caller closes the socket right after.
  try {
    if (client?.connected) client.request({ type: 'push.unregister' }).catch(() => { /* closing anyway */ });
  } catch { /* closing anyway */ }
  // A link still minting would write the secret and seal key back after we
  // delete them: wait for it, but never longer than a revoke. If it's still
  // running then, purge again once it settles.
  const running = s.linking.get(machine.id);
  if (running) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      running.then(() => true, () => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), REVOKE_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (!settled) void running.finally(() => purgeMachine(machine.id, native));
  }
  s.mintFailedAt.delete(machine.id);
  await purgeMachine(machine.id, native);
}
