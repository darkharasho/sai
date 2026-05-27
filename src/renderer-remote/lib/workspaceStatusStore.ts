export interface WorkspaceStatus {
  busy: boolean;
  streaming: boolean;
  completed: boolean;
  approval: boolean;
  /** True while the AI has invoked AskUserQuestion and is awaiting an answer. Visual override only — busy/streaming may still be true. */
  awaitingQuestion: boolean;
  /** Session id of the streaming turn, or null if unknown (first turn before session_id arrives). */
  streamingSessionId?: string | null;
}

export type WorkspaceStatusPriority = 'idle' | 'completed' | 'busy' | 'streaming' | 'awaitingQuestion' | 'approval';

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
