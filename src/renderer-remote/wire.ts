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

export interface ChatPromptArgs {
  text: string;
  projectPath: string;
  scope?: string;
  model?: string;
  effort?: string;
  permMode?: string;
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
  sendPrompt(args: ChatPromptArgs): void;
  approve(args: ChatApprovalArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  listFiles(cwd: string, path: string): Promise<unknown[]>;
  readFile(cwd: string, path: string): Promise<{
    content?: string;
    signedUrl?: string;
    encoding: 'text' | 'binary';
    size: number;
    lang?: string;
    mime?: string;
  }>;
  statusFiles(cwd: string): Promise<unknown[]>;
  diffFile(cwd: string, path: string, staged?: boolean): Promise<{ diff: string; lang?: string }>;
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

  let reqCounter = 0;
  const pendingReq = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  handlers.add((msg) => {
    const reqId = (msg as any).reqId;
    if (typeof reqId === 'string' && pendingReq.has(reqId)) {
      const entry = pendingReq.get(reqId)!;
      pendingReq.delete(reqId);
      const t = (msg as any).type;
      if (t === 'error') {
        entry.reject(new Error(String((msg as any).message ?? 'error')));
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
      } else {
        entry.resolve(msg);
      }
    }
  });

  const sendFrame = (m: WireMsg) => ws?.send(JSON.stringify(m));

  return {
    send: sendFrame,
    close: () => { closed = true; ws?.close(); },
    on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
    onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
    attach: (a) => sendFrame({ type: 'session.attach', projectPath: a.projectPath, scope: a.scope ?? 'chat', sessionId: a.sessionId }),
    setFollow: (enabled) => sendFrame({ type: 'session.follow', enabled }),
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
    setActiveWorkspace: (projectPath) => sendFrame({ type: 'workspace.set', projectPath }),
    sendPrompt: (a) => sendFrame({ type: 'prompt', text: a.text, projectPath: a.projectPath, scope: a.scope ?? 'chat', model: a.model, effort: a.effort, permMode: a.permMode }),
    approve: (a) => sendFrame({ type: 'approval', toolUseId: a.toolUseId, decision: a.decision, modifiedCommand: a.modifiedCommand, projectPath: a.projectPath, scope: a.scope ?? 'chat' }),
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
  };
}
