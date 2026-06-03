// Mobile port of src/renderer-remote/lib/workspaceStatusStore.ts. Plain
// observable store (not Zustand) so consumers can re-render on a tick
// without forcing every status change through React batching. Mirrors the
// PWA shape exactly so subscribeWorkspaceStatus frames drop in unchanged.

export interface WorkspaceStatus {
  busy: boolean;
  streaming: boolean;
  completed: boolean;
  approval: boolean;
  awaitingQuestion: boolean;
  streamingSessionId?: string | null;
  streamingSessionIds?: string[];
  suspendedSessionIds?: string[];
  awaitingSessionIds?: string[];
}

export type WorkspaceStatusPriority =
  | 'idle'
  | 'completed'
  | 'busy'
  | 'streaming'
  | 'awaitingQuestion'
  | 'approval';

export interface WorkspaceStatusStore {
  get(projectPath: string): WorkspaceStatus | undefined;
  set(projectPath: string, status: WorkspaceStatus): void;
  subscribe(fn: (projectPath: string, status: WorkspaceStatus | undefined) => void): () => void;
  priority(status: WorkspaceStatus | undefined): WorkspaceStatusPriority;
}

export function createWorkspaceStatusStore(): WorkspaceStatusStore {
  const map = new Map<string, WorkspaceStatus>();
  const subs = new Set<(projectPath: string, status: WorkspaceStatus | undefined) => void>();
  return {
    get: (p) => map.get(p),
    set: (p, s) => {
      const allFalse = !s.busy && !s.streaming && !s.completed && !s.approval && !s.awaitingQuestion;
      if (allFalse) map.delete(p);
      else map.set(p, s);
      const out = map.get(p);
      for (const fn of subs) { try { fn(p, out); } catch { /* isolate */ } }
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    priority: (s) => {
      if (!s) return 'idle';
      if (s.approval) return 'approval';
      if (s.awaitingQuestion) return 'awaitingQuestion';
      if (s.streaming) return 'streaming';
      if (s.busy) return 'busy';
      if (s.completed) return 'completed';
      return 'idle';
    },
  };
}

// Singleton — chat screen subscribes once, header reads from the same map.
export const workspaceStatusStore = createWorkspaceStatusStore();

export type DisplayPriority = 'idle' | 'busy' | 'completed' | 'approval';

export function displayPriority(status: WorkspaceStatus | undefined): DisplayPriority {
  if (!status) return 'idle';
  if (status.approval) return 'approval';
  if (status.busy || status.streaming || status.awaitingQuestion) return 'busy';
  if (status.completed) return 'completed';
  return 'idle';
}
