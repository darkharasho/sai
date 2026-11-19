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
 * - removed: the relay says the registration is gone (401 bad secret, 404
 *   unknown pushId, 410 APNs unregistered); the local registration is deleted.
 * - dropped: any other answer (429 rate limit, 413, 5xx); no retry.
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

const GONE = new Set([401, 404, 410]);

export function createPushSender(opts: PushSenderOpts): PushSend {
  const base = (opts.relayUrl ?? pushRelayUrl()).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? PUSH_SEND_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  return async (target, plain) => {
    const t0 = now();
    const kind = plain.kind;
    let status: number | 'timeout' | 'network' | 'seal';
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
        // The answer body is never needed; release the connection.
        try { await res.body?.cancel(); } catch { /* already consumed or closed */ }
      } catch {
        status = ctrl.signal.aborted ? 'timeout' : 'network';
      } finally {
        clearTimeout(timer);
      }
    }

    try { opts.log('send', { kind, status, ms: now() - t0 }); } catch { /* logging never fails a send */ }

    if (typeof status !== 'number') return status === 'timeout' ? 'timeout' : 'failed';
    if (status >= 200 && status < 300) return 'sent';
    if (GONE.has(status)) {
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
