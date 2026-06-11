// Mobile WS wire protocol. Mirrors src/renderer-remote/wire.ts (PWA) exactly,
// with React Native adaptations: takes baseUrl/token explicitly (no
// same-origin), AppState in place of window visibility/online/pageshow events.
import { AppState, type NativeEventSubscription } from 'react-native';

export const BEARER_KEY_PREFIX = 'sai-mobile-bearer-';

// ---------- pairing URL helpers (mobile-only) ----------

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

// ---------- HTTP helpers (mobile-only) ----------

export function extractPairCode(url: string): string | null {
  try { return new URL(url).searchParams.get('code'); } catch { return null; }
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
    const r = await fetch(`${baseUrl}/healthz`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    return r.ok;
  } catch { return false; }
}

// ---------- wire types ----------

export type WireMsg = { type: string; [k: string]: unknown };
export type WireState = 'opening' | 'open' | 'closed';

export interface WriteStaleError extends Error {
  code: 'stale';
  currentMtime: number;
  currentSha: string;
}
export function isWriteStaleError(e: unknown): e is WriteStaleError {
  return !!e && typeof e === 'object' && (e as any).code === 'stale';
}

export interface ChatPromptArgs {
  text: string;
  projectPath: string;
  scope?: string;
  model?: string;
  effort?: string;
  permMode?: string;
  /** Claude CLI session to resume; threads through to --resume on the desktop
   * so prompts continue the conversation instead of forking a fresh context. */
  sessionId?: string;
  /** Base64 data URLs for inline image attachments (e.g. `data:image/png;base64,…`). */
  images?: string[];
}

export interface ChatApprovalArgs {
  toolUseId: string;
  decision: 'approve' | 'deny';
  modifiedCommand?: string;
  projectPath: string;
  scope?: string;
}

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: WireState) => void): () => void;
  probe(): void;
  attach(args: { projectPath: string; scope?: string; sessionId: string }): void;
  setFollow(enabled: boolean): void;
  listSessions(projectPath: string): Promise<unknown[]>;
  listWorkspaces(): Promise<unknown[]>;
  setActiveWorkspace(projectPath: string): void;
  subscribeWorkspaceStatus(): void;
  unsubscribeWorkspaceStatus(): void;
  subscribeGithubWatcher(): void;
  unsubscribeGithubWatcher(): void;
  sendPrompt(args: ChatPromptArgs): void;
  approve(args: ChatApprovalArgs): void;
  answerQuestion(args: { toolUseId: string; answers: Record<string, string | string[]>; projectPath: string; scope?: string }): void;
  interrupt(projectPath: string, scope?: string): void;
  listFiles(cwd: string, path: string): Promise<unknown[]>;
  readFile(cwd: string, path: string): Promise<{
    content?: string;
    signedUrl?: string;
    encoding: 'text' | 'binary';
    size: number;
    lang?: string;
    mime?: string;
    mtime?: number;
    sha?: string;
  }>;
  writeFile(cwd: string, path: string, content: string,
            expectMtime: number | null, expectSha: string | null
  ): Promise<{ mtime: number; sha: string }>;
  statusFiles(cwd: string): Promise<unknown[]>;
  diffFile(cwd: string, path: string, staged?: boolean): Promise<{ diff: string; lang?: string }>;
  stageFile(cwd: string, path: string): Promise<void>;
  unstageFile(cwd: string, path: string): Promise<void>;
  commit(cwd: string, message: string): Promise<{ hash?: string }>;
  push(cwd: string): Promise<void>;
  pull(cwd: string): Promise<void>;
  listTerminals(cwd: string): Promise<Array<{
    termId: number;
    cwd: string;
    cols: number;
    rows: number;
    alive: boolean;
    origin: 'phone' | 'desktop';
  }>>;
  openTerminal(cwd: string, cols: number, rows: number): Promise<{ termId: number; cols: number; rows: number }>;
  attachTerminal(termId: number, cols: number, rows: number): Promise<{ termId: number; cols: number; rows: number }>;
  detachTerminal(termId: number): void;
  inputTerminal(termId: number, data: string): void;
  resizeTerminal(termId: number, cols: number, rows: number): void;
  signalTerminal(termId: number, signal: string): void;
  killTerminal(termId: number): Promise<void>;
}

export interface ConnectArgs { baseUrl: string; token: string }

export function connect({ baseUrl, token }: ConnectArgs): WireClient {
  const url = wsUrl(baseUrl);
  const handlers = new Set<(msg: WireMsg) => void>();
  const stateHandlers = new Set<(s: WireState) => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongDeadline: ReturnType<typeof setTimeout> | null = null;
  let probeDeadline: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let lastActivityTs = Date.now();

  // Replay state: the server forgets subscriptions/attachments when a socket
  // dies. We remember the latest ones and re-issue them on every auth_ok so
  // consumers don't have to know that a reconnect happened.
  let replayAttach: { projectPath: string; scope: string; sessionId: string } | null = null;
  let replayFollow: boolean | null = null;
  let replayWorkspaceStatus = false;
  let replayGithubWatcher = false;
  let replayActiveWorkspace: string | null = null;

  const notifyState = (s: WireState) => {
    for (const h of stateHandlers) try { h(s); } catch { /* isolate */ }
  };

  // Exponential backoff with jitter. 1s → 2 → 4 → 8 → 16 → 30 (cap), ±20% jitter.
  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * Math.pow(2, retryAttempt));
    const jitter = base * (0.8 + Math.random() * 0.4);
    retryAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, jitter);
  };

  const clearTimers = () => {
    if (pingTimer)     { clearInterval(pingTimer);  pingTimer = null; }
    if (pongDeadline)  { clearTimeout(pongDeadline); pongDeadline = null; }
    if (probeDeadline) { clearTimeout(probeDeadline); probeDeadline = null; }
  };

  // Force the current socket closed (without flipping `closed`) so onclose
  // fires and the backoff/replay path takes over. Used by the foreground
  // probe + pong-timeout watchdog when we detect a zombie OPEN socket.
  const killSocket = () => {
    clearTimers();
    if (!ws) return;
    try { ws.close(); } catch { /* ignore */ }
    if (!closed) scheduleReconnect();
  };

  // Probe the connection: called when AppState flips to 'active'. If the
  // socket is closed, reconnect immediately. If it claims OPEN, send a ping
  // and require a reply within 5s — otherwise assume the socket is half-open
  // (common after iOS backgrounding) and reset.
  const probeConnection = () => {
    if (closed) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const WS_OPEN = (WebSocket as any).OPEN ?? 1;
    const WS_CLOSED = (WebSocket as any).CLOSED ?? 3;
    const WS_CLOSING = (WebSocket as any).CLOSING ?? 2;
    if (!ws || ws.readyState === WS_CLOSED || ws.readyState === WS_CLOSING) {
      retryAttempt = 0;
      open();
      return;
    }
    if (ws.readyState !== WS_OPEN) return; // CONNECTING — let it finish
    if (probeDeadline) return; // a probe is already in flight
    try { ws.send(JSON.stringify({ type: 'ping' })); }
    catch { killSocket(); return; }
    probeDeadline = setTimeout(() => {
      probeDeadline = null;
      if (Date.now() - lastActivityTs > 4_500) killSocket();
    }, 5_000);
  };

  let appStateSub: NativeEventSubscription | null = null;
  try {
    appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') probeConnection();
    });
  } catch { /* AppState not available (e.g. in tests) */ }

  const open = () => {
    if (closed) return;
    notifyState('opening');
    ws = new WebSocket(url);
    ws.onopen = () => {
      try { ws!.send(JSON.stringify({ type: 'auth', token })); }
      catch { /* socket died between open and send; onclose will follow */ }
    };
    ws.onmessage = (ev: MessageEvent) => {
      lastActivityTs = Date.now();
      let msg: WireMsg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (msg.type === 'auth_ok') {
        retryAttempt = 0;
        notifyState('open');
        // Replay client-side state the server doesn't persist across sockets.
        // Order matters: workspace.set before attach so the active-workspace
        // hint lands first, mirroring the original setup sequence.
        if (replayWorkspaceStatus) {
          try { ws!.send(JSON.stringify({ type: 'workspace.status.subscribe' })); } catch { /* ignore */ }
        }
        if (replayGithubWatcher) {
          try { ws!.send(JSON.stringify({ type: 'github.watcher.subscribe' })); } catch { /* ignore */ }
        }
        if (replayActiveWorkspace) {
          try { ws!.send(JSON.stringify({ type: 'workspace.set', projectPath: replayActiveWorkspace })); } catch { /* ignore */ }
        }
        if (replayFollow !== null) {
          try { ws!.send(JSON.stringify({ type: 'session.follow', enabled: replayFollow })); } catch { /* ignore */ }
        }
        if (replayAttach) {
          try { ws!.send(JSON.stringify({ type: 'session.attach', ...replayAttach })); } catch { /* ignore */ }
        }
        // Heartbeat: ping every 25s; expect any traffic within 10s of each
        // ping (server replies with at least a pong / ack), else reconnect.
        pingTimer = setInterval(() => {
          try { ws?.send(JSON.stringify({ type: 'ping' })); }
          catch { killSocket(); return; }
          if (pongDeadline) return;
          const sentAt = Date.now();
          pongDeadline = setTimeout(() => {
            pongDeadline = null;
            if (lastActivityTs < sentAt) killSocket();
          }, 10_000);
        }, 25_000);
      }
      // Any message satisfies an in-flight pong/probe wait.
      if (pongDeadline)  { clearTimeout(pongDeadline);  pongDeadline = null; }
      if (probeDeadline) { clearTimeout(probeDeadline); probeDeadline = null; }
      for (const h of handlers) try { h(msg); } catch { /* isolate */ }
    };
    ws.onclose = () => {
      clearTimers();
      notifyState('closed');
      // Fail every in-flight request now so UI moves on instead of waiting
      // out per-call timeouts (up to 60s for push/pull).
      if (pendingReq.size > 0) {
        const err: any = new Error('connection lost');
        err.code = 'wire_closed';
        for (const [, entry] of pendingReq) try { entry.reject(err); } catch { /* ignore */ }
        pendingReq.clear();
      }
      if (!closed) scheduleReconnect();
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
  };

  let reqCounter = 0;
  const pendingReq = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  open();
  handlers.add((msg) => {
    const reqId = (msg as any).reqId;
    if (typeof reqId === 'string' && pendingReq.has(reqId)) {
      const entry = pendingReq.get(reqId)!;
      pendingReq.delete(reqId);
      const t = (msg as any).type;
      if (t === 'error') {
        const code = (msg as any).code;
        if (code === 'stale') {
          const e = Object.assign(new Error(String((msg as any).message ?? 'stale')), {
            code: 'stale' as const,
            currentMtime: (msg as any).currentMtime ?? 0,
            currentSha: (msg as any).currentSha ?? '',
          });
          entry.reject(e);
        } else {
          const e: any = new Error(String((msg as any).message ?? 'error'));
          if (code) e.code = code;
          entry.reject(e);
        }
      } else if (t === 'files.write.result') {
        entry.resolve({ mtime: (msg as any).mtime, sha: (msg as any).sha });
      } else if (t === 'sessions.list.result') {
        entry.resolve((msg as any).sessions ?? []);
      } else if (t === 'workspaces.list.result') {
        entry.resolve((msg as any).workspaces ?? []);
      } else if (t === 'files.list.result') {
        entry.resolve((msg as any).entries ?? []);
      } else if (t === 'files.read.result') {
        entry.resolve(msg);
      } else if (t === 'files.status.result') {
        entry.resolve((msg as any).entries ?? []);
      } else if (t === 'files.diff.result') {
        entry.resolve({ diff: (msg as any).diff ?? '', lang: (msg as any).lang });
      } else if (t === 'git.stage.result' || t === 'git.unstage.result' || t === 'git.push.result' || t === 'git.pull.result') {
        entry.resolve(undefined);
      } else if (t === 'git.commit.result') {
        entry.resolve({ hash: (msg as any).hash });
      } else if (t === 'terminal.list.result') {
        entry.resolve((msg as any).terms ?? []);
      } else if (t === 'terminal.opened') {
        entry.resolve({ termId: (msg as any).termId, cols: (msg as any).cols, rows: (msg as any).rows });
      } else if (t === 'terminal.attached') {
        entry.resolve({ termId: (msg as any).termId, cols: (msg as any).cols, rows: (msg as any).rows });
      } else if (t === 'terminal.kill.result') {
        entry.resolve(undefined);
      } else {
        entry.resolve(msg);
      }
    }
  });

  const sendFrame = (m: WireMsg) => {
    const WS_OPEN = (WebSocket as any).OPEN ?? 1;
    if (!ws || ws.readyState !== WS_OPEN) return;
    try { ws.send(JSON.stringify(m)); }
    catch { /* socket just transitioned out from under us; onclose handles it */ }
  };

  return {
    send: sendFrame,
    close: () => {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      clearTimers();
      try { appStateSub?.remove(); } catch { /* ignore */ }
      appStateSub = null;
      try { ws?.close(); } catch { /* ignore */ }
    },
    on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
    onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
    probe: probeConnection,
    attach: (a) => {
      const scope = a.scope ?? 'chat';
      replayAttach = { projectPath: a.projectPath, scope, sessionId: a.sessionId };
      sendFrame({ type: 'session.attach', projectPath: a.projectPath, scope, sessionId: a.sessionId });
    },
    setFollow: (enabled) => {
      replayFollow = enabled;
      sendFrame({ type: 'session.follow', enabled });
    },
    listSessions: (projectPath) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('sessions.list timeout')); }, 5000);
      sendFrame({ type: 'sessions.list', projectPath, reqId });
    }),
    listWorkspaces: () => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('workspaces.list timeout')); }, 5000);
      sendFrame({ type: 'workspaces.list', reqId });
    }),
    setActiveWorkspace: (projectPath) => {
      replayActiveWorkspace = projectPath;
      sendFrame({ type: 'workspace.set', projectPath });
    },
    subscribeWorkspaceStatus: () => {
      replayWorkspaceStatus = true;
      sendFrame({ type: 'workspace.status.subscribe' });
    },
    unsubscribeWorkspaceStatus: () => {
      replayWorkspaceStatus = false;
      sendFrame({ type: 'workspace.status.unsubscribe' });
    },
    subscribeGithubWatcher: () => {
      replayGithubWatcher = true;
      sendFrame({ type: 'github.watcher.subscribe' });
    },
    unsubscribeGithubWatcher: () => {
      replayGithubWatcher = false;
      sendFrame({ type: 'github.watcher.unsubscribe' });
    },
    sendPrompt: (a) => sendFrame({
      type: 'prompt',
      text: a.text,
      projectPath: a.projectPath,
      scope: a.scope ?? 'chat',
      model: a.model,
      effort: a.effort,
      permMode: a.permMode,
      sessionId: a.sessionId,
      images: a.images && a.images.length > 0 ? a.images : undefined,
    }),
    approve: (a) => sendFrame({ type: 'approval', toolUseId: a.toolUseId, decision: a.decision, modifiedCommand: a.modifiedCommand, projectPath: a.projectPath, scope: a.scope ?? 'chat' }),
    answerQuestion: (a) => sendFrame({ type: 'answer.question', toolUseId: a.toolUseId, answers: a.answers, projectPath: a.projectPath, scope: a.scope ?? 'chat' }),
    interrupt: (projectPath, scope) => sendFrame({ type: 'interrupt', projectPath, scope: scope ?? 'chat' }),
    listFiles: (cwd, path) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.list timeout')); }, 5000);
      sendFrame({ type: 'files.list', cwd, path, reqId });
    }),
    readFile: (cwd, path) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.read timeout')); }, 10_000);
      sendFrame({ type: 'files.read', cwd, path, reqId });
    }),
    writeFile: (cwd, path, content, expectMtime, expectSha) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.write timeout')); }, 10_000);
      sendFrame({ type: 'files.write', cwd, path, content, expectMtime, expectSha, reqId });
    }),
    statusFiles: (cwd) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.status timeout')); }, 5000);
      sendFrame({ type: 'files.status', cwd, reqId });
    }),
    diffFile: (cwd, path, staged) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.diff timeout')); }, 5000);
      sendFrame({ type: 'files.diff', cwd, path, staged: !!staged, reqId });
    }),
    stageFile: (cwd, path) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.stage timeout')); }, 10_000);
      sendFrame({ type: 'git.stage', cwd, path, reqId });
    }),
    unstageFile: (cwd, path) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.unstage timeout')); }, 10_000);
      sendFrame({ type: 'git.unstage', cwd, path, reqId });
    }),
    commit: (cwd, message) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.commit timeout')); }, 20_000);
      sendFrame({ type: 'git.commit', cwd, message, reqId });
    }),
    push: (cwd) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.push timeout')); }, 60_000);
      sendFrame({ type: 'git.push', cwd, reqId });
    }),
    pull: (cwd) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.pull timeout')); }, 60_000);
      sendFrame({ type: 'git.pull', cwd, reqId });
    }),
    listTerminals: (cwd) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.list timeout')); }, 5000);
      sendFrame({ type: 'terminal.list', cwd, reqId });
    }),
    openTerminal: (cwd, cols, rows) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.open timeout')); }, 10_000);
      sendFrame({ type: 'terminal.open', cwd, cols, rows, reqId });
    }),
    attachTerminal: (termId, cols, rows) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.attach timeout')); }, 10_000);
      sendFrame({ type: 'terminal.attach', termId, cols, rows, reqId });
    }),
    detachTerminal: (termId) => sendFrame({ type: 'terminal.detach', termId }),
    inputTerminal: (termId, data) => sendFrame({ type: 'terminal.input', termId, data }),
    resizeTerminal: (termId, cols, rows) => sendFrame({ type: 'terminal.resize', termId, cols, rows }),
    signalTerminal: (termId, signal) => sendFrame({ type: 'terminal.signal', termId, signal }),
    killTerminal: (termId) => new Promise((resolve, reject) => {
      const reqId = `r${++reqCounter}`;
      pendingReq.set(reqId, { resolve, reject });
      setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.kill timeout')); }, 10_000);
      sendFrame({ type: 'terminal.kill', termId, reqId });
    }),
  };
}

// Back-compat alias so existing callers (e.g. lib/connection.tsx) keep working.
export const connectWire = connect;
