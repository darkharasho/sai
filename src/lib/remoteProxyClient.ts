import { dbGetSessions, dbGetMessages } from '../chatDb';

export interface ActiveSessionSnapshot {
  projectPath: string;
  scope: string;
  sessionId: string;
}

export interface RemoteWorkspaceStatusMeta {
  busy?: boolean;
  streaming?: boolean;
  completed?: boolean;
  approval?: boolean;
}

export interface RemoteWorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
  status?: RemoteWorkspaceStatusMeta;
}

export interface RemoteProxyDeps {
  getActiveSession: () => ActiveSessionSnapshot | null;
  listWorkspaces: () => RemoteWorkspaceMeta[];
  setActiveWorkspace: (projectPath: string) => void;
}

export function installRemoteProxyHandler(deps: RemoteProxyDeps): () => void {
  const sai = (window as any).sai;
  if (!sai?.remote?.onProxyRequest) return () => {};

  return sai.remote.onProxyRequest(async ({ reqId, kind, args }: { reqId: number; kind: string; args: any }) => {
    let result: unknown;
    let error: string | undefined;
    try {
      if (kind === 'listSessions') {
        const all = await dbGetSessions(args.projectPath);
        // Phase 1 chat surface: exclude swarm tasks. 'chat' default + 'orchestrator'.
        result = all.filter((s: any) => !s.kind || s.kind === 'chat' || s.kind === 'orchestrator');
      } else if (kind === 'loadHistory') {
        result = await dbGetMessages(args.sessionId);
      } else if (kind === 'getActiveSession') {
        result = deps.getActiveSession();
      } else if (kind === 'listWorkspaces') {
        result = deps.listWorkspaces();
      } else if (kind === 'setActiveWorkspace') {
        deps.setActiveWorkspace(args.projectPath);
        result = null;
      } else {
        throw new Error(`unknown proxy kind: ${kind}`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    void sai.remote.sendProxyReply({ reqId, result, error });
  });
}
