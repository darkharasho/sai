import type { BrowserWindow } from 'electron';

type Kind = 'listSessions' | 'loadHistory' | 'getActiveSession' | 'listWorkspaces' | 'setActiveWorkspace';

export interface RemoteWorkspace {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RendererProxyOpts {
  getWindow: () => BrowserWindow | null;
  timeoutMs?: number;
}

export interface ProxyReply {
  reqId: number;
  result?: unknown;
  error?: string;
}

export class RendererProxy {
  private nextReqId = 1;
  private pending = new Map<number, Pending>();
  private readonly timeoutMs: number;

  constructor(private readonly opts: RendererProxyOpts) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  listSessions(projectPath: string): Promise<unknown[]> {
    return this.request('listSessions', { projectPath }) as Promise<unknown[]>;
  }

  loadHistory(sessionId: string): Promise<unknown[]> {
    return this.request('loadHistory', { sessionId }) as Promise<unknown[]>;
  }

  /**
   * Asks the renderer for its current active workspace + session.
   * Returns null when no workspace is open or it has no session yet.
   */
  getActiveSession(): Promise<{ projectPath: string; scope: string; sessionId: string } | null> {
    return this.request('getActiveSession', {}) as Promise<{ projectPath: string; scope: string; sessionId: string } | null>;
  }

  listWorkspaces(): Promise<RemoteWorkspace[]> {
    return this.request('listWorkspaces', {}) as Promise<RemoteWorkspace[]>;
  }

  setActiveWorkspace(projectPath: string): Promise<void> {
    return this.request('setActiveWorkspace', { projectPath }) as Promise<void>;
  }

  handleReply(reply: ProxyReply): void {
    const p = this.pending.get(reply.reqId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(reply.reqId);
    if (reply.error) p.reject(new Error(reply.error));
    else p.resolve(reply.result);
  }

  private request(kind: Kind, args: Record<string, unknown>): Promise<unknown> {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return Promise.reject(new Error('renderer window unavailable'));
    }
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`renderer-proxy timeout: ${kind}`));
      }, this.timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      win.webContents.send('remote:proxy:request', { reqId, kind, args });
    });
  }
}
