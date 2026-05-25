export const BEARER_KEY = 'sai-remote-bearer';

export function extractPairCode(url: string): string | null {
  try { return new URL(url).searchParams.get('code'); } catch { return null; }
}

export interface PairResult { token: string; deviceId: string }

export async function pair(code: string, deviceLabel: string): Promise<PairResult> {
  const r = await fetch('/pair', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}

export type WireMsg = { type: string; [k: string]: unknown };

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: 'opening' | 'open' | 'closed') => void): () => void;
}

export function connect(token: string): WireClient {
  const wsUrl = new URL('/ws', location.href.replace(/^http/, 'ws')).toString();
  const handlers = new Set<(msg: WireMsg) => void>();
  const stateHandlers = new Set<(s: 'opening' | 'open' | 'closed') => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const notifyState = (s: 'opening' | 'open' | 'closed') => {
    for (const h of stateHandlers) try { h(s); } catch { /* isolate */ }
  };

  const open = () => {
    notifyState('opening');
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (ev) => {
      let msg: WireMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_ok') {
        notifyState('open');
        pingTimer = setInterval(() => {
          try { ws?.send(JSON.stringify({ type: 'ping' })); } catch { /* socket may be closed */ }
        }, 25_000);
      }
      for (const h of handlers) try { h(msg); } catch { /* isolate */ }
    };
    ws.onclose = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      notifyState('closed');
      if (!closed) setTimeout(open, 2_000); // simple linear reconnect
    };
  };
  open();

  return {
    send: (msg) => ws?.send(JSON.stringify(msg)),
    close: () => { closed = true; ws?.close(); },
    on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
    onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
  };
}
