export const BEARER_KEY_PREFIX = 'sai-mobile-bearer-';

export function parsePairingUrl(input: string): { baseUrl: string; code: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    if (!code) return null;
    return { baseUrl: `${url.protocol}//${url.host}`, code };
  } catch {
    return null;
  }
}

export function isAllowedPairHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.ts.net')) return true;
  // CGNAT: 100.64.0.0/10 → first octet 100, second 64-127
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws') + '/ws';
}

export interface PairResult { token: string; deviceId: string }

export async function pair(
  baseUrl: string,
  code: string,
  deviceLabel: string,
  clientId: string
): Promise<PairResult> {
  const r = await fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel, clientId }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}

export async function unpair(baseUrl: string, deviceId: string, token: string): Promise<void> {
  const r = await fetch(`${baseUrl}/pair/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 404) throw new Error(`unpair failed: ${r.status}`);
}

export async function health(baseUrl: string, token: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    return r.ok;
  } catch { return false; }
}
