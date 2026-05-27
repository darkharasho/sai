import { readPersisted, writePersisted, isString } from './persisted';

const KEY = 'sai-remote-overrides';
const VERSION = 1;

export interface SessionOverrides {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  permMode?: 'auto' | 'auto-read' | 'always-ask';
}

type OverrideMap = Record<string /* sessionId */, SessionOverrides>;

const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);
const ALLOWED_PERM = new Set(['auto', 'auto-read', 'always-ask']);

function validateMap(raw: unknown): OverrideMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: OverrideMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const entry: SessionOverrides = {};
    if (isString(o.model)) entry.model = o.model;
    if (isString(o.effort) && ALLOWED_EFFORT.has(o.effort)) entry.effort = o.effort as SessionOverrides['effort'];
    if (isString(o.permMode) && ALLOWED_PERM.has(o.permMode)) entry.permMode = o.permMode as SessionOverrides['permMode'];
    out[k] = entry;
  }
  return out;
}

function read(): OverrideMap {
  return readPersisted(KEY, VERSION, validateMap, {});
}

function write(map: OverrideMap): void {
  writePersisted(KEY, VERSION, map);
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
