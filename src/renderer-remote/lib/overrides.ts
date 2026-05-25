const KEY = 'sai-remote-overrides';

export interface SessionOverrides {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  permMode?: 'auto' | 'auto-read' | 'always-ask';
}

type OverrideMap = Record<string /* sessionId */, SessionOverrides>;

function read(): OverrideMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function write(map: OverrideMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota/etc. */ }
}

export function getOverrides(sessionId: string): SessionOverrides {
  return read()[sessionId] ?? {};
}

export function setOverrides(sessionId: string, next: SessionOverrides): void {
  const map = read();
  map[sessionId] = next;
  write(map);
}

export function clearOverrides(sessionId: string): void {
  const map = read();
  delete map[sessionId];
  write(map);
}
