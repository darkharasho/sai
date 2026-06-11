import { create } from 'zustand';

export interface TranscriptEvent {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'approval' | 'question' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolUseId?: string;
  images?: string[];
  ts?: number;
  /** Set on assistant rows when a `result` envelope arrives so we can render
   *  the desktop-style `[Nms]` tag above the bubble. */
  durationMs?: number;
}

interface State {
  byKey: Record<string, TranscriptEvent[]>;
  append(key: string, ev: TranscriptEvent): void;
  appendBatch(key: string, evs: TranscriptEvent[]): void;
  /** Swap the full event list for a key — used when a `session.history` dump
   *  arrives (initial attach AND reconnect resync), where the server's view
   *  supersedes whatever was accumulated locally. */
  replace(key: string, evs: TranscriptEvent[]): void;
  clear(key: string): void;
}

export const useTranscript = create<State>((set, get) => ({
  byKey: {},
  append(key, ev) {
    const current = get().byKey[key] ?? [];
    const i = current.findIndex((e) => e.id === ev.id);
    const next = i >= 0
      ? [...current.slice(0, i), ev, ...current.slice(i + 1)]
      : [...current, ev];
    set({ byKey: { ...get().byKey, [key]: next } });
  },
  appendBatch(key, evs) {
    for (const ev of evs) get().append(key, ev);
  },
  replace(key, evs) {
    set({ byKey: { ...get().byKey, [key]: [...evs] } });
  },
  clear(key) {
    const { [key]: _, ...rest } = get().byKey;
    set({ byKey: rest });
  },
}));

export function transcriptKey(machineId: string, projectPath: string, sessionId: string): string {
  return `${machineId}|${projectPath}|${sessionId}`;
}
