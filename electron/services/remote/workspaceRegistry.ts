// The desktop's workspace list as the renderer last reported it
// (`remote:reportWorkspaces`, debounced in App). v2 `workspaces.subscribe`
// reads it here instead of round-tripping through the renderer proxy.
import type { RemoteWorkspace } from './renderer-proxy';

export type WorkspacesListener = (list: RemoteWorkspace[]) => void;

const STATES = new Set(['active', 'open', 'suspended', 'recent']);

/** Keeps a reported row only if it has the RemoteWorkspace shape; drops unknown fields. */
function sanitize(raw: unknown): RemoteWorkspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.projectPath !== 'string' || !r.projectPath || typeof r.name !== 'string') return null;
  if (r.kind !== 'project' && r.kind !== 'meta') return null;
  const out: RemoteWorkspace = { projectPath: r.projectPath, name: r.name, kind: r.kind };
  if (Array.isArray(r.members)) {
    out.members = r.members
      .filter((m): m is { projectPath: string; name: string } =>
        !!m && typeof m === 'object' && typeof (m as any).projectPath === 'string' && typeof (m as any).name === 'string')
      .map((m) => ({ projectPath: m.projectPath, name: m.name }));
  }
  if (r.status && typeof r.status === 'object') out.status = r.status as RemoteWorkspace['status'];
  if (typeof r.state === 'string' && STATES.has(r.state)) out.state = r.state as RemoteWorkspace['state'];
  return out;
}

export class WorkspaceRegistry {
  private list: RemoteWorkspace[] | null = null;
  private json = '';
  private readonly listeners = new Set<WorkspacesListener>();

  /** The latest reported list, or null if the renderer hasn't reported yet. */
  get(): RemoteWorkspace[] | null {
    return this.list;
  }

  /** Replaces the list; emits `changed` only when it differs from the previous one. */
  set(raw: unknown): void {
    const next = Array.isArray(raw) ? raw.map(sanitize).filter((w): w is RemoteWorkspace => w !== null) : [];
    const json = JSON.stringify(next);
    if (this.list && json === this.json) return;
    this.list = next;
    this.json = json;
    for (const cb of this.listeners) {
      try { cb(next); } catch { /* a listener's socket failure must not stop the others */ }
    }
  }

  /** Subscribes to list changes; returns the unsubscribe. */
  onChange(cb: WorkspacesListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}
