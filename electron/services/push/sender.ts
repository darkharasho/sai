// Seals a push for one phone and POSTs it to the relay (relay/README.md,
// POST /v1/push). Fire-and-forget: the returned promise never rejects, and a
// slow or unreachable relay is cut off after PUSH_SEND_TIMEOUT_MS. Callers
// don't await it.
//
// Logged: kind, HTTP status (or 'timeout' / 'network' / 'seal') and duration.
// Never the payload, the secret, the key or the pushId.
import { clampPlain, seal } from '../../../src/lib/push/seal';
import { pushRelayUrl } from '../../../src/lib/push/config';
import type { PushPlain } from '../../../src/lib/push/types';
import type { PushRegistration, PushRegistry } from './registry';

export const PUSH_SEND_TIMEOUT_MS = 5000;

/**
 * - sent: the relay accepted it (2xx).
 * - removed: the relay says this desktop's registration is gone (401 bad
 *   secret, 404 unknown pushId, each with the relay's JSON `{error}` body);
 *   the local registration is deleted.
 * - dropped: any other answer (410 APNs unregistered, which can race the phone
 *   re-registering a new token, 429 rate limit, 413, 5xx, or a 401/404 that
 *   isn't the relay's JSON error); no retry, the registration stays.
 * - timeout / failed: no answer in time / network or sealing failure.
 */
export type PushSendOutcome = 'sent' | 'removed' | 'dropped' | 'timeout' | 'failed';

export interface PushTarget { deviceId: string; reg: PushRegistration }

export type PushSend = (target: PushTarget, plain: PushPlain) => Promise<PushSendOutcome>;

export interface PushSenderOpts {
  registry: Pick<PushRegistry, 'delete'>;
  /** Defaults to pushRelayUrl() (SAI_PUSH_RELAY_URL or the deployed relay). */
  relayUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  log: (event: string, data: Record<string, unknown>) => void;
  now?: () => number;
}

/** Statuses that mean the relay no longer knows this desktop's secret or the phone. */
const GONE = new Set([401, 404]);
/** A relay error body is a few dozen bytes; anything bigger is not the relay. */
const MAX_ERROR_BODY = 2048;

/**
 * True for the relay's own error body (`{"error": "<string>", ...}`). A
 * misrouted SAI_PUSH_RELAY_URL answering an HTML 404 must not wipe every
 * registration.
 */
function isRelayError(text: string): boolean {
  if (!text || text.length > MAX_ERROR_BODY) return false;
  try {
    const v: unknown = JSON.parse(text);
    return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { error?: unknown }).error === 'string';
  } catch {
    return false;
  }
}

export function createPushSender(opts: PushSenderOpts): PushSend {
  const base = (opts.relayUrl ?? pushRelayUrl()).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? PUSH_SEND_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  return async (target, plain) => {
    const t0 = now();
    const kind = plain.kind;
    let status: number | 'timeout' | 'network' | 'seal';
    let relayError = false;
    let sealed: string | null;
    try { sealed = await seal(target.reg.sealKey, clampPlain(plain)); } catch { sealed = null; }
    if (sealed === null) {
      status = 'seal';
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      timer.unref?.();
      try {
        const res = await (opts.fetch ?? fetch)(`${base}/v1/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pushId: target.reg.pushId, sendSecret: target.reg.sendSecret, sealed, kind }),
          signal: ctrl.signal,
        });
        status = res.status;
        if (GONE.has(status)) {
          // Still under the timeout: a slow body counts as no answer.
          try { relayError = isRelayError(await res.text()); } catch { relayError = false; }
        } else {
          // The answer body is not needed; release the connection.
          try { await res.body?.cancel(); } catch { /* already consumed or closed */ }
        }
      } catch {
        status = ctrl.signal.aborted ? 'timeout' : 'network';
      } finally {
        clearTimeout(timer);
      }
    }

    try { opts.log('send', { kind, status, ms: now() - t0 }); } catch { /* logging never fails a send */ }

    if (typeof status !== 'number') return status === 'timeout' ? 'timeout' : 'failed';
    if (status >= 200 && status < 300) return 'sent';
    if (GONE.has(status) && relayError) {
      // Only the registration this send used: the phone may have re-registered meanwhile.
      try {
        opts.registry.delete(target.deviceId, (cur) =>
          cur.pushId === target.reg.pushId && cur.sendSecret === target.reg.sendSecret);
      } catch { /* a failed write retries on the next change */ }
      return 'removed';
    }
    return 'dropped';
  };
}
