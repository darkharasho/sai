import type { WireMsg, WireState } from './types';

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

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: WireState) => void): () => void;
  probe(): void;
}

export interface ConnectArgs { baseUrl: string; token: string }

export function connectWire({ baseUrl, token }: ConnectArgs): WireClient {
  const handlers = new Set<(m: WireMsg) => void>();
  const stateHandlers = new Set<(s: WireState) => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let retryAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const notifyState = (s: WireState) => { for (const h of stateHandlers) try { h(s); } catch {} };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * Math.pow(2, retryAttempt));
    const jitter = base * (0.8 + Math.random() * 0.4);
    retryAttempt++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, jitter);
  };

  const open = () => {
    if (closed) return;
    notifyState('opening');
    ws = new WebSocket(wsUrl(baseUrl));
    ws.onopen = () => { ws?.send(JSON.stringify({ type: 'auth', token })); };
    ws.onmessage = (e: MessageEvent) => {
      let m: WireMsg; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (m.type === 'auth_ok') {
        retryAttempt = 0;
        notifyState('open');
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => { try { ws?.send(JSON.stringify({ type: 'ping' })); } catch {} }, 20_000);
        return;
      }
      for (const h of handlers) try { h(m); } catch {}
    };
    ws.onclose = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      notifyState('closed');
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws?.close(); } catch {} };
  };

  open();

  return {
    send(msg) { try { ws?.send(JSON.stringify(msg)); } catch {} },
    close() {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      try { ws?.close(); } catch {}
    },
    on(h) { handlers.add(h); return () => handlers.delete(h); },
    onState(h) { stateHandlers.add(h); return () => stateHandlers.delete(h); },
    probe() {
      if (closed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (!ws || ws.readyState !== 1) { retryAttempt = 0; open(); return; }
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { try { ws.close(); } catch {} }
    },
  };
}
