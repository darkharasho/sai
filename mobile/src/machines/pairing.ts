import { getNative, type FullNativeApi } from '../native';
import { addMachine, getClientId, type Machine } from './store';

export class PairError extends Error {
  constructor(message: string, readonly code: 'expired' | 'rate_limited' | 'unreachable' | 'bad_response') {
    super(message);
    this.name = 'PairError';
  }
}

/** Parses the URL the desktop shows as a QR: http(s)://host:port/?code=<base64url>. */
export function parsePairUrl(text: string): { baseUrl: string; code: string } | null {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const code = u.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  return { baseUrl: u.origin, code };
}

export async function pair(url: string, deviceLabel: string, native: FullNativeApi = getNative()): Promise<Machine> {
  const parsed = parsePairUrl(url);
  if (!parsed) throw new PairError('not a SAI pairing code', 'bad_response');
  let res;
  try {
    res = await native.http({
      method: 'POST',
      url: `${parsed.baseUrl}/pair`,
      body: { code: parsed.code, deviceLabel, clientId: getClientId() },
      timeoutMs: 10_000,
    });
  } catch {
    throw new PairError("can't reach desktop — is Tailscale on?", 'unreachable');
  }
  if (res.status === 401) throw new PairError('code expired', 'expired');
  if (res.status === 429) throw new PairError('too many attempts, wait a minute', 'rate_limited');
  const d = res.data as { token?: unknown; deviceId?: unknown } | null;
  if (res.status !== 200 || !d || typeof d.token !== 'string' || typeof d.deviceId !== 'string') {
    throw new PairError(`pairing failed (${res.status})`, 'bad_response');
  }
  const host = new URL(parsed.baseUrl).hostname;
  return addMachine({ label: host, baseUrl: parsed.baseUrl, deviceId: d.deviceId, token: d.token }, native);
}
