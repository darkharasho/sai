import { dbGetSessions, dbGetMessages } from '../chatDb';

export interface ActiveSessionSnapshot {
  projectPath: string;
  scope: string;
  sessionId: string;
}

export interface RemoteProxyDeps {
  getActiveSession: () => ActiveSessionSnapshot | null;
}

export function installRemoteProxyHandler(deps: RemoteProxyDeps): () => void {
  const sai = (window as any).sai;
  if (!sai?.remote?.onProxyRequest) return () => {};

  return sai.remote.onProxyRequest(async ({ reqId, kind, args }: { reqId: number; kind: string; args: any }) => {
    let result: unknown;
    let error: string | undefined;
    try {
      if (kind === 'listSessions') {
        result = await dbGetSessions(args.projectPath);
      } else if (kind === 'loadHistory') {
        result = await dbGetMessages(args.sessionId);
      } else if (kind === 'getActiveSession') {
        result = deps.getActiveSession();
      } else {
        throw new Error(`unknown proxy kind: ${kind}`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    void sai.remote.sendProxyReply({ reqId, result, error });
  });
}
