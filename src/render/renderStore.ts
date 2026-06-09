export type RenderKind = 'html' | 'component';
export type RenderStatus = 'rendering' | 'ready' | 'error';

export interface RenderEntry {
  renderId: string;
  kind: RenderKind;
  /** For html: { html }. For component: { component, props }. */
  payload: Record<string, unknown>;
  title: string;
  width: number;
  background?: string;
  status: RenderStatus;
  error?: string;
}

type Listener = () => void;

const entries = new Map<string, RenderEntry>();
const listeners = new Set<Listener>();
let active: string | null = null;

function emit(): void {
  for (const l of listeners) l();
}

export const renderStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(id: string): RenderEntry | undefined {
    return entries.get(id);
  },
  activeId(): string | null {
    return active;
  },
  upsert(entry: RenderEntry): void {
    entries.set(entry.renderId, entry);
    active = entry.renderId;
    emit();
  },
  patch(id: string, partial: Partial<RenderEntry>): void {
    const cur = entries.get(id);
    if (!cur) return;
    entries.set(id, { ...cur, ...partial });
    emit();
  },
  _resetForTests(): void {
    entries.clear();
    listeners.clear();
    active = null;
  },
};
