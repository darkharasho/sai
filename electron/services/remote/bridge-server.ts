import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { PairingStore } from './pairing-store';
import type { SessionBus } from './session-bus';
import { ScreenshotUrlSigner } from './screenshot-urls';
import type { PhoneTerminalRegistry, PhoneTerminalSummary } from './terminal-store';

export type { PhoneTerminalSummary } from './terminal-store';

export interface PromptArgs {
  text: string;
  projectPath: string;
  scope: string;
  model?: string;
  effort?: string;
  permMode?: string;
}

export interface ApprovalArgs {
  toolUseId: string;
  decision: 'approve' | 'deny';
  modifiedCommand?: string;
  projectPath: string;
  scope: string;
}

export interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
}

export interface ChatMsg { [k: string]: unknown }

export interface SessionActivePayload {
  projectPath: string;
  scope: string;
  sessionId: string;
}

export interface FileEntry { name: string; kind: 'file' | 'dir'; size?: number }
export interface FileReadResult {
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}
export interface FileStatusEntry { path: string; status: string; staged: boolean }
export interface FileDiffResult { diff: string; lang?: string }

export interface BridgeServerOpts {
  tailnetIp: string | null;
  pairing: PairingStore;
  bus: SessionBus;
  pwaDir: string | null;
  screenshotSecret: string;
  loadScreenshot: (id: string) => Promise<Buffer | null>;
  /** Preferred TCP port. Defaults to ephemeral inside the class; the production caller pins 17829. */
  port?: number;
  /** Fallback ports tried in order when `port` is held. If all are held, falls back to ephemeral. */
  fallbackPorts?: number[];
  sendPrompt?: (args: PromptArgs) => void;
  resolveApproval?: (args: ApprovalArgs) => Promise<void | unknown>;
  answerQuestion?: (args: { toolUseId: string; answers: Record<string, string | string[]>; projectPath: string; scope: string }) => Promise<unknown> | unknown;
  interruptTurn?: (projectPath: string, scope: string) => void;
  listSessions?: (projectPath: string) => Promise<SessionMeta[]>;
  loadHistory?: (sessionId: string) => Promise<ChatMsg[]>;
  registerActiveSessionBroadcast?: (broadcast: (payload: SessionActivePayload) => void) => void;
  /** Returns the desktop's current active session payload, or null. */
  getInitialActiveSession?: () => SessionActivePayload | null;
  /** Async fallback that asks the renderer right now when cache is empty. */
  getActiveSessionFromRenderer?: () => Promise<SessionActivePayload | null>;
  listWorkspaces?: () => Promise<import('./renderer-proxy').RemoteWorkspace[]>;
  setActiveWorkspace?: (projectPath: string) => Promise<void>;
  listFiles?: (cwd: string, path: string) => Promise<FileEntry[]>;
  readFile?: (cwd: string, path: string) => Promise<FileReadResult>;
  writeFile?: (cwd: string, path: string, content: string,
               opts: { expectMtime: number | null; expectSha: string | null })
              => Promise<{ mtime: number; sha: string }>;
  statusFiles?: (cwd: string) => Promise<{
    entries: FileStatusEntry[];
    branch?: string | null;
    ahead?: number;
    behind?: number;
  }>;
  diffFile?: (cwd: string, path: string, staged: boolean) => Promise<FileDiffResult>;
  stageFile?:   (cwd: string, path: string) => Promise<void>;
  unstageFile?: (cwd: string, path: string) => Promise<void>;
  commit?:      (cwd: string, message: string) => Promise<{ hash?: string }>;
  push?:        (cwd: string) => Promise<void>;
  pull?:        (cwd: string) => Promise<void>;
  /** Phone-owned PTY registry. If absent, terminal.* messages return an error. */
  terminalStore?: PhoneTerminalRegistry;
  loadBlob?: (id: string) => Promise<{ buffer: Buffer; mime: string } | null>;
}

interface PairingCode { code: string; expiresAt: number }

export class BridgeServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly codes = new Map<string, PairingCode>();
  private readonly liveSockets = new Map<string, Set<WebSocket>>(); // deviceId -> sockets
  private readonly PAIR_TTL_MS = 120_000;
  private readonly pairHits = new Map<string, number[]>();
  private readonly PAIR_WINDOW_MS = 60_000;
  private readonly PAIR_MAX = 10;
  private static readonly DEFAULT_PORT = 0;
  private readonly signer: ScreenshotUrlSigner;

  constructor(private readonly opts: BridgeServerOpts) {
    this.signer = new ScreenshotUrlSigner(opts.screenshotSecret);
  }

  signScreenshotUrl(id: string): string { return this.signer.sign(id); }

  mintPairingCode(now: number = Date.now()): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { code, expiresAt: now + this.PAIR_TTL_MS });
    return code;
  }

  async start(): Promise<{ port: number }> {
    if (!this.opts.tailnetIp) {
      throw new Error('tailnet IP not available; refusing to bind to 0.0.0.0 or 127.0.0.1');
    }
    const desired = this.opts.port ?? BridgeServer.DEFAULT_PORT;
    const fallbacks = this.opts.fallbackPorts ?? [];
    // Build a fresh http.Server per attempt — reusing the same instance
    // across listen() calls leaks internal listeners.
    const tryListen = (p: number): Promise<http.Server> => new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { void this.handle(req, res); });
      const onErr = (err: Error) => { s.removeListener('error', onErr); s.close(); reject(err); };
      s.once('error', onErr);
      s.listen(p, this.opts.tailnetIp!, () => { s.removeListener('error', onErr); resolve(s); });
    });
    // Pin the stable port; retry on EADDRINUSE to ride out hot-restart
    // races where the previous socket is still releasing. If it stays held
    // (a second SAI instance is running), try the configured fallback
    // ports in order — that keeps the URL stable across restarts so the
    // phone bearer doesn't need a re-pair. Only as a last resort go ephemeral.
    let server: http.Server | null = null;
    if (desired !== 0) {
      for (let i = 0; i < 10; i++) {
        try {
          server = await tryListen(desired);
          break;
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code !== 'EADDRINUSE') throw err;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
    if (!server) {
      for (const fb of fallbacks) {
        try {
          server = await tryListen(fb);
          console.warn(`[remote] port ${desired} held; using fallback port ${fb}`);
          break;
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code !== 'EADDRINUSE') throw err;
        }
      }
    }
    if (!server) {
      console.warn(`[remote] port ${desired}${fallbacks.length ? ` and fallbacks [${fallbacks.join(', ')}]` : ''} held by another process; falling back to ephemeral`);
      server = await tryListen(0);
    }
    this.server = server;
    const { port } = server.address() as AddressInfo;
    console.log(`[remote] bridge listening on http://${this.opts.tailnetIp}:${port}`);
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleWs(ws, req));
    this.opts.registerActiveSessionBroadcast?.((payload) => {
      if (!this.wss) return;
      for (const client of this.wss.clients) {
        if (!(client as any).__followEnabled) continue;
        try {
          client.send(JSON.stringify({ v: 1, type: 'session.active', ...payload }));
        } catch { /* ignore */ }
      }
    });
    return { port };
  }

  async stop(): Promise<void> {
    const s = this.server; this.server = null;
    if (this.wss) {
      // Terminate active clients first; server.close() otherwise waits forever
      // for them to drain on their own (the phone WS will hold the process open).
      for (const client of this.wss.clients) {
        try { client.terminate(); } catch { /* already dead */ }
      }
      this.wss.close();
      this.wss = null;
    }
    this.liveSockets.clear();
    if (!s) return;
    // Force-close any lingering HTTP connections too (Node 18.2+).
    const sAny = s as unknown as { closeAllConnections?: () => void };
    try { sAny.closeAllConnections?.(); } catch { /* method unavailable */ }
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  /** Close all WS connections for a device (called by RemoteModule on revoke). */
  closeDeviceConnections(deviceId: string): void {
    const set = this.liveSockets.get(deviceId);
    if (!set) return;
    for (const ws of set) { try { ws.close(1008, 'revoked'); } catch { /* already closed */ } }
    this.liveSockets.delete(deviceId);
  }

  private rateLimited(req: http.IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const arr = (this.pairHits.get(ip) ?? []).filter((t) => now - t < this.PAIR_WINDOW_MS);
    if (arr.length >= this.PAIR_MAX) { this.pairHits.set(ip, arr); return true; }
    arr.push(now); this.pairHits.set(ip, arr);
    return false;
  }

  private async readJson<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', version: 1 }));
        return;
      }
      if (req.method === 'POST' && req.url === '/pair') return await this.handlePair(req, res);
      if (req.method === 'GET' && req.url?.startsWith('/blob/')) return await this.handleBlob(req, res);
      if (req.method === 'GET' && req.url?.startsWith('/screenshot/')) return await this.handleScreenshot(req, res);
      if (req.method === 'GET' && this.opts.pwaDir) return await this.handleStatic(req, res);
      res.statusCode = 404; res.end('not found');
    } catch {
      res.statusCode = 500; res.end('internal error');
    }
  }

  private async handlePair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.rateLimited(req)) { res.statusCode = 429; res.end('too many requests'); return; }
    const body = await this.readJson<{ code: string; deviceLabel?: string; clientId?: string }>(req);
    const entry = this.codes.get(body.code);
    const now = Date.now();
    if (!entry || entry.expiresAt < now) { res.statusCode = 401; res.end('invalid code'); return; }
    this.codes.delete(body.code);
    const { deviceId, token } = await this.opts.pairing.issue(
      body.deviceLabel ?? 'Mobile',
      body.clientId ?? null,
    );
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token, deviceId, wsUrl: '/ws' }));
  }

  private async handleScreenshot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const result = this.signer.verify(req.url!);
    if (!result.ok || !result.id) { res.statusCode = 401; res.end('bad url'); return; }
    const buf = await this.opts.loadScreenshot(result.id);
    if (!buf) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = 200;
    res.setHeader('content-type', 'image/png');
    res.end(buf);
  }

  private async handleBlob(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const result = this.signer.verify(req.url!);
    if (!result.ok || !result.id) { res.statusCode = 401; res.end('bad url'); return; }
    const blob = await this.opts.loadBlob?.(result.id);
    if (!blob) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = 200;
    res.setHeader('content-type', blob.mime);
    res.setHeader('content-length', blob.buffer.length.toString());
    res.end(blob.buffer);
  }

  signBlobUrl(id: string): string {
    return this.signer.sign(id).replace('/screenshot/', '/blob/');
  }

  private static readonly MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  };

  private async handleStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const root = this.opts.pwaDir!;
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel = nodePath.join(rel, 'index.html');
    const resolved = nodePath.resolve(root, rel);
    if (!resolved.startsWith(nodePath.resolve(root) + nodePath.sep) && resolved !== nodePath.resolve(root, 'index.html')) {
      res.statusCode = 403; res.end('forbidden'); return;
    }
    try {
      const buf = await fsp.readFile(resolved);
      const ext = nodePath.extname(resolved).toLowerCase();
      res.statusCode = 200;
      res.setHeader('content-type', BridgeServer.MIME[ext] ?? 'application/octet-stream');
      // index.html must always be re-fetched so a fresh deploy picks up new
      // bundle filenames; hashed assets (JS/CSS) are immutable and cacheable.
      if (ext === '.html' || ext === '') {
        res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      } else if (ext === '.js' || ext === '.mjs' || ext === '.css' || ext === '.woff2' || ext === '.woff') {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      }
      res.end(buf);
    } catch {
      try {
        const buf = await fsp.readFile(nodePath.join(root, 'index.html'));
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
        res.end(buf);
      } catch { res.statusCode = 404; res.end('not found'); }
    }
  }

  private handleWs(ws: WebSocket, _req: http.IncomingMessage): void {
    let authed = false;
    let deviceId: string | null = null;
    let unsub: null | (() => void) = null;

    const close = (code: number, reason: string) => { try { ws.close(code, reason); } catch { /* already closed */ } };

    ws.on('message', async (data) => {
      let msg: { type?: string; [k: string]: unknown };
      try { msg = JSON.parse(data.toString()); } catch { return close(1003, 'bad json'); }

      if (!authed) {
        if (msg.type !== 'auth' || typeof msg.token !== 'string') return close(4001, 'auth_failed');
        const found = await this.opts.pairing.verify(msg.token);
        if (!found) return close(4001, 'auth_failed');
        authed = true;
        deviceId = found.id;
        let set = this.liveSockets.get(found.id);
        if (!set) { set = new Set(); this.liveSockets.set(found.id, set); }
        set.add(ws);
        ws.send(JSON.stringify({ v: 1, type: 'auth_ok', deviceId: found.id, deviceLabel: found.label }));
        (ws as any).__attachedTopic = null;
        (ws as any).__followEnabled = false;
        (ws as any).__workspaceStatusEnabled = false;
        unsub = this.opts.bus.subscribeAll((topic, e) => {
          if (topic === 'workspace.status') {
            if (!(ws as any).__workspaceStatusEnabled) return;
            try { ws.send(JSON.stringify({ v: 1, ...e })); } catch { /* closed */ }
            return;
          }
          if ((ws as any).__attachedTopic !== topic) return; // gate by attachment
          try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* ws may be closed */ }
        });
        return;
      }

      if (msg.type === 'ping') { ws.send(JSON.stringify({ v: 1, type: 'pong' })); return; }

      if (msg.type === 'workspace.status.subscribe') {
        (ws as any).__workspaceStatusEnabled = true;
        return;
      }
      if (msg.type === 'workspace.status.unsubscribe') {
        (ws as any).__workspaceStatusEnabled = false;
        return;
      }

      if (msg.type === 'session.attach' && typeof msg.projectPath === 'string') {
        const scope = (typeof msg.scope === 'string' ? msg.scope : 'chat');
        const topic = `chat:${msg.projectPath}:${scope}`;
        (ws as any).__attachedTopic = topic;
        if (typeof msg.sessionId === 'string') {
          // Empty sessionId is the "new session" sentinel — skip the history
          // round-trip and send an empty transcript so the phone clears state.
          if (msg.sessionId === '') {
            ws.send(JSON.stringify({
              v: 1, type: 'session.history',
              projectPath: msg.projectPath, scope, sessionId: '', messages: [],
            }));
          } else {
            try {
              const messages = (await this.opts.loadHistory?.(msg.sessionId)) ?? [];
              ws.send(JSON.stringify({
                v: 1, type: 'session.history',
                projectPath: msg.projectPath, scope, sessionId: msg.sessionId, messages,
              }));
            } catch (err) {
              ws.send(JSON.stringify({ v: 1, type: 'error', code: 'history_unavailable', message: (err as Error).message }));
            }
          }
        }
        return;
      }

      if (msg.type === 'session.follow' && typeof msg.enabled === 'boolean') {
        (ws as any).__followEnabled = msg.enabled;
        if (msg.enabled) {
          const send = (payload: SessionActivePayload) => {
            try { ws.send(JSON.stringify({ v: 1, type: 'session.active', ...payload })); }
            catch { /* ws may be closed */ }
          };
          const cached = this.opts.getInitialActiveSession?.();
          if (cached) send(cached);
          else if (this.opts.getActiveSessionFromRenderer) {
            void this.opts.getActiveSessionFromRenderer().then((v) => { if (v) send(v); });
          }
        }
        return;
      }

      if (msg.type === 'sessions.list' && typeof msg.projectPath === 'string') {
        const reqId = msg.reqId;
        try {
          const sessions = (await this.opts.listSessions?.(msg.projectPath)) ?? [];
          ws.send(JSON.stringify({ v: 1, type: 'sessions.list.result', reqId, sessions }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'workspaces.list') {
        const reqId = msg.reqId;
        try {
          const workspaces = (await this.opts.listWorkspaces?.()) ?? [];
          ws.send(JSON.stringify({ v: 1, type: 'workspaces.list.result', reqId, workspaces }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'workspace.set' && typeof msg.projectPath === 'string') {
        try { await this.opts.setActiveWorkspace?.(msg.projectPath); }
        catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', code: 'switch_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'files.list' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
        const reqId = msg.reqId;
        try {
          const entries = (await this.opts.listFiles?.(msg.cwd, msg.path)) ?? [];
          ws.send(JSON.stringify({ v: 1, type: 'files.list.result', reqId, entries }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'files.read' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
        const reqId = msg.reqId;
        try {
          const result = await this.opts.readFile?.(msg.cwd, msg.path);
          if (!result) {
            ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'read_failed', message: 'no readFile callback' }));
            return;
          }
          ws.send(JSON.stringify({ v: 1, type: 'files.read.result', reqId, ...result }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'read_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'files.write' && typeof msg.cwd === 'string' && typeof msg.path === 'string'
          && typeof msg.content === 'string') {
        const reqId = msg.reqId;
        if (!this.opts.writeFile) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'unsupported', message: 'writes disabled' }));
          return;
        }
        const expectMtime = typeof msg.expectMtime === 'number' ? msg.expectMtime : null;
        const expectSha   = typeof msg.expectSha   === 'string' ? msg.expectSha   : null;
        try {
          const { mtime, sha } = await this.opts.writeFile(
            msg.cwd, msg.path, msg.content, { expectMtime, expectSha },
          );
          ws.send(JSON.stringify({ v: 1, type: 'files.write.result', reqId, mtime, sha }));
        } catch (err: any) {
          if (err?.code === 'stale') {
            ws.send(JSON.stringify({
              v: 1, type: 'error', reqId, code: 'stale', message: String(err.message ?? 'stale'),
              currentMtime: err.currentMtime ?? 0, currentSha: err.currentSha ?? '',
            }));
          } else {
            ws.send(JSON.stringify({
              v: 1, type: 'error', reqId,
              code: err?.code ?? 'write_failed',
              message: String(err?.message ?? err),
            }));
          }
        }
        return;
      }

      if (msg.type === 'files.status' && typeof msg.cwd === 'string') {
        const reqId = msg.reqId;
        try {
          const result = (await this.opts.statusFiles?.(msg.cwd)) ?? { entries: [] };
          ws.send(JSON.stringify({
            v: 1, type: 'files.status.result', reqId,
            entries: result.entries,
            branch: result.branch ?? null,
            ahead: result.ahead ?? 0,
            behind: result.behind ?? 0,
          }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'status_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'files.diff' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
        const reqId = msg.reqId;
        try {
          const result = await this.opts.diffFile?.(msg.cwd, msg.path, !!msg.staged);
          if (!result) {
            ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'diff_failed', message: 'no diffFile callback' }));
            return;
          }
          ws.send(JSON.stringify({ v: 1, type: 'files.diff.result', reqId, diff: result.diff, lang: result.lang }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'diff_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'git.stage' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
        const reqId = msg.reqId;
        try {
          await this.opts.stageFile?.(msg.cwd, msg.path);
          ws.send(JSON.stringify({ v: 1, type: 'git.stage.result', reqId }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'stage_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'git.unstage' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
        const reqId = msg.reqId;
        try {
          await this.opts.unstageFile?.(msg.cwd, msg.path);
          ws.send(JSON.stringify({ v: 1, type: 'git.unstage.result', reqId }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'unstage_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'git.commit' && typeof msg.cwd === 'string' && typeof msg.message === 'string') {
        const reqId = msg.reqId;
        try {
          const result = await this.opts.commit?.(msg.cwd, msg.message);
          ws.send(JSON.stringify({ v: 1, type: 'git.commit.result', reqId, hash: result?.hash }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'commit_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'git.push' && typeof msg.cwd === 'string') {
        const reqId = msg.reqId;
        try {
          await this.opts.push?.(msg.cwd);
          ws.send(JSON.stringify({ v: 1, type: 'git.push.result', reqId }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'push_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'git.pull' && typeof msg.cwd === 'string') {
        const reqId = msg.reqId;
        try {
          await this.opts.pull?.(msg.cwd);
          ws.send(JSON.stringify({ v: 1, type: 'git.pull.result', reqId }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'pull_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'terminal.list' && typeof msg.cwd === 'string') {
        const reqId = msg.reqId;
        const store = this.opts.terminalStore;
        if (!store) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
          return;
        }
        try {
          const terms = store.list(msg.cwd);
          ws.send(JSON.stringify({ v: 1, type: 'terminal.list.result', reqId, terms }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_list_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'terminal.open' && typeof msg.cwd === 'string'
          && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        const reqId = msg.reqId;
        const store = this.opts.terminalStore;
        if (!store) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
          return;
        }
        try {
          const t = store.open(msg.cwd, msg.cols, msg.rows);
          ws.send(JSON.stringify({ v: 1, type: 'terminal.opened', reqId, termId: t.termId, cols: t.cols, rows: t.rows }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_open_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'terminal.attach' && typeof msg.termId === 'number'
          && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        const reqId = msg.reqId;
        const store = this.opts.terminalStore;
        if (!store) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
          return;
        }
        const r = store.attach(msg.termId, ws, msg.cols, msg.rows);
        if (!r) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unknown', message: `no such terminal ${msg.termId}` }));
          return;
        }
        ws.send(JSON.stringify({ v: 1, type: 'terminal.attached', reqId, termId: msg.termId, cols: r.cols, rows: r.rows }));
        if (r.replay) {
          ws.send(JSON.stringify({ v: 1, type: 'terminal.output', termId: msg.termId, data: r.replay }));
        }
        return;
      }

      if (msg.type === 'terminal.input' && typeof msg.termId === 'number' && typeof msg.data === 'string') {
        this.opts.terminalStore?.input(msg.termId, msg.data);
        return;
      }

      if (msg.type === 'terminal.resize' && typeof msg.termId === 'number'
          && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        this.opts.terminalStore?.resize(msg.termId, msg.cols, msg.rows);
        return;
      }

      if (msg.type === 'terminal.signal' && typeof msg.termId === 'number' && typeof msg.signal === 'string') {
        this.opts.terminalStore?.signal(msg.termId, msg.signal as NodeJS.Signals);
        return;
      }

      if (msg.type === 'terminal.detach' && typeof msg.termId === 'number') {
        this.opts.terminalStore?.detach(msg.termId, ws);
        return;
      }

      if (msg.type === 'terminal.kill' && typeof msg.termId === 'number') {
        const reqId = msg.reqId;
        try {
          this.opts.terminalStore?.kill(msg.termId);
          ws.send(JSON.stringify({ v: 1, type: 'terminal.kill.result', reqId, termId: msg.termId }));
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_kill_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'prompt' && typeof msg.text === 'string' && typeof msg.projectPath === 'string') {
        this.opts.sendPrompt?.({
          text: msg.text,
          projectPath: msg.projectPath,
          scope: (typeof msg.scope === 'string' ? msg.scope : 'chat'),
          model: typeof msg.model === 'string' ? msg.model : undefined,
          effort: typeof msg.effort === 'string' ? msg.effort : undefined,
          permMode: typeof msg.permMode === 'string' ? msg.permMode : undefined,
        });
        return;
      }

      if (msg.type === 'approval' && typeof msg.toolUseId === 'string' &&
          (msg.decision === 'approve' || msg.decision === 'deny') &&
          typeof msg.projectPath === 'string') {
        try {
          await this.opts.resolveApproval?.({
            toolUseId: msg.toolUseId,
            decision: msg.decision,
            modifiedCommand: typeof msg.modifiedCommand === 'string' ? msg.modifiedCommand : undefined,
            projectPath: msg.projectPath,
            scope: (typeof msg.scope === 'string' ? msg.scope : 'chat'),
          });
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', code: 'approval_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'answer.question'
          && typeof msg.toolUseId === 'string'
          && typeof msg.projectPath === 'string'
          && msg.answers && typeof msg.answers === 'object') {
        const scope = typeof msg.scope === 'string' ? msg.scope : 'chat';
        try {
          await this.opts.answerQuestion?.({
            toolUseId: msg.toolUseId,
            answers: msg.answers as Record<string, string | string[]>,
            projectPath: msg.projectPath,
            scope,
          });
        } catch (err) {
          ws.send(JSON.stringify({ v: 1, type: 'error', code: 'answer_failed', message: (err as Error).message }));
        }
        return;
      }

      if (msg.type === 'interrupt' && typeof msg.projectPath === 'string') {
        this.opts.interruptTurn?.(msg.projectPath, (typeof msg.scope === 'string' ? msg.scope : 'chat'));
        return;
      }

      if (msg.type === 'session.new' && typeof msg.projectPath === 'string') {
        ws.send(JSON.stringify({
          v: 1, type: 'session.active',
          projectPath: msg.projectPath,
          scope: (typeof msg.scope === 'string' ? msg.scope : 'chat'),
          sessionId: '',
        }));
        return;
      }
    });

    ws.on('close', () => {
      this.opts.terminalStore?.detachAll(ws);
      if (unsub) unsub();
      if (deviceId) {
        const set = this.liveSockets.get(deviceId);
        if (set) { set.delete(ws); if (set.size === 0) this.liveSockets.delete(deviceId); }
      }
    });
  }
}
