export const BEARER_KEY = 'sai-remote-bearer';

export function extractPairCode(url: string): string | null {
  try { return new URL(url).searchParams.get('code'); } catch { return null; }
}

export interface PairResult { token: string; deviceId: string }

export async function pair(code: string, deviceLabel: string, clientId: string): Promise<PairResult> {
  const r = await fetch('/pair', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel, clientId }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}

export type WireMsg = { type: string; [k: string]: unknown };

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
  onState(handler: (s: 'opening' | 'open' | 'closed') => void): () => void;
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

export function connect(token: string): WireClient {
  const wsUrl = new URL('/ws', location.href.replace(/^http/, 'ws')).toString();
  const handlers = new Set<(msg: WireMsg) => void>();
  const stateHandlers = new Set<(s: 'opening' | 'open' | 'closed') => void>();
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

  const notifyState = (s: 'opening' | 'open' | 'closed') => {
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
    // Some browsers won't fire onclose synchronously on a zombie socket;
    // schedule the reconnect ourselves so the user isn't stuck waiting.
    if (!closed) scheduleReconnect();
  };

  // Probe the connection: called on `online`, `visibilitychange→visible`,
  // and `pageshow`. If the socket is closed, reconnect immediately. If
  // it claims OPEN, send a ping and require a reply within 5s — otherwise
  // assume the socket is half-open (common after iOS background) and reset.
  const probeConnection = () => {
    if (closed) return;
    // Drop any backoff timer — we want to act now, not wait it out.
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      retryAttempt = 0; // user is engaging; don't penalize them with backoff
      open();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return; // CONNECTING — let it finish
    if (probeDeadline) return; // a probe is already in flight
    try { ws.send(JSON.stringify({ type: 'ping' })); }
    catch { killSocket(); return; }
    probeDeadline = setTimeout(() => {
      probeDeadline = null;
      // No traffic since the probe started → half-open. Kick it.
      if (Date.now() - lastActivityTs > 4_500) killSocket();
    }, 5_000);
  };

  const onOnline = () => probeConnection();
  const onVisibility = () => { if (document.visibilityState === 'visible') probeConnection(); };
  const onPageShow = () => probeConnection();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
  }

  const open = () => {
    notifyState('opening');
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      try { ws!.send(JSON.stringify({ type: 'auth', token })); }
      catch { /* socket died between open and send; onclose will follow */ }
    };
    ws.onmessage = (ev) => {
      lastActivityTs = Date.now();
      let msg: WireMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_ok') {
        retryAttempt = 0; // successful auth resets backoff
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(m)); }
    catch { /* socket just transitioned out from under us; onclose handles it */ }
  };

  return {
    send: sendFrame,
    close: () => {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      clearTimers();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('pageshow', onPageShow);
        document.removeEventListener('visibilitychange', onVisibility);
      }
      ws?.close();
    },
    on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
    onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
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
