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

export interface ChatPromptArgs {
  text: string;
  projectPath: string;
  scope?: string;
  model?: string;
  effort?: string;
  permMode?: string;
  images?: string[];
}

export interface ChatApprovalArgs {
  toolUseId: string;
  decision: 'approve' | 'deny';
  modifiedCommand?: string;
  projectPath: string;
  scope?: string;
}

export function sendPrompt(c: WireClient, args: ChatPromptArgs): void {
  c.send({ type: 'chat:prompt', ...args });
}
export function sendApproval(c: WireClient, args: ChatApprovalArgs): void {
  c.send({ type: 'chat:approve', ...args });
}
export function attachToSession(c: WireClient, args: { projectPath: string; scope?: string; sessionId: string }): void {
  c.send({ type: 'attach', ...args });
}
export function setActiveWorkspace(c: WireClient, projectPath: string): void {
  c.send({ type: 'workspace:set', projectPath });
}
export function subscribeWorkspaceStatus(c: WireClient): void { c.send({ type: 'workspace:status:subscribe' }); }
export function interrupt(c: WireClient, projectPath: string, scope?: string): void {
  c.send({ type: 'chat:interrupt', projectPath, scope });
}
export function termInput(c: WireClient, termId: number, data: string): void {
  c.send({ type: 'term:input', termId, data });
}
export function termResize(c: WireClient, termId: number, cols: number, rows: number): void {
  c.send({ type: 'term:resize', termId, cols, rows });
}
export function termAttach(c: WireClient, termId: number, cols: number, rows: number): void {
  c.send({ type: 'term:attach', termId, cols, rows });
}
export function termDetach(c: WireClient, termId: number): void {
  c.send({ type: 'term:detach', termId });
}

async function authedJson<T>(baseUrl: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  listWorkspaces: (b: string, t: string) => authedJson<unknown[]>(b, t, '/workspaces'),
  listSessions: (b: string, t: string, projectPath: string) =>
    authedJson<unknown[]>(b, t, `/sessions?projectPath=${encodeURIComponent(projectPath)}`),
  listFiles: (b: string, t: string, cwd: string, path: string) =>
    authedJson<unknown[]>(b, t, `/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  readFile: (b: string, t: string, cwd: string, path: string) =>
    authedJson<{ content?: string; signedUrl?: string; encoding: 'text' | 'binary'; size: number; lang?: string; mime?: string; mtime?: number; sha?: string; }>(
      b, t, `/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`
    ),
  statusFiles: (b: string, t: string, cwd: string) =>
    authedJson<unknown[]>(b, t, `/git/status?cwd=${encodeURIComponent(cwd)}`),
  diffFile: (b: string, t: string, cwd: string, path: string, staged = false) =>
    authedJson<{ diff: string; lang?: string }>(b, t, `/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}&staged=${staged ? '1' : '0'}`),
  listTerminals: (b: string, t: string, cwd: string) =>
    authedJson<Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean; origin: 'phone' | 'desktop' }>>(
      b, t, `/terminals?cwd=${encodeURIComponent(cwd)}`
    ),
};
