// Background-task snapshots per chat scope, for main-process listeners (the
// remote v2 chat.background push). Fed by the same emit as the renderer's
// claude:backgroundTasks IPC (claude.ts emitBackgroundTasks).
import type { BackgroundTaskDetail } from './claudeBackend/backgroundTasks';

export interface BackgroundTasksPayload {
  projectPath: string;
  scope: string;
  tasks: BackgroundTaskDetail[];
}

export class BackgroundTasksFeed {
  /** scope → its latest non-empty snapshot (an empty one deletes the entry). */
  private readonly latestByScope = new Map<string, BackgroundTasksPayload>();
  private readonly listeners = new Set<(p: BackgroundTasksPayload) => void>();

  publish(payload: BackgroundTasksPayload): void {
    if (!payload || typeof payload.scope !== 'string') return;
    if (Array.isArray(payload.tasks) && payload.tasks.length > 0) this.latestByScope.set(payload.scope, payload);
    else this.latestByScope.delete(payload.scope);
    for (const cb of [...this.listeners]) {
      try { cb(payload); } catch { /* a listener must not break the emit */ }
    }
  }

  /** The scope's latest tasks ([] when none). Scopes are chat ids for chats. */
  latest(scope: string): BackgroundTaskDetail[] {
    return this.latestByScope.get(scope)?.tasks ?? [];
  }

  onChange(cb: (p: BackgroundTasksPayload) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}

export const backgroundTasksFeed = new BackgroundTasksFeed();
