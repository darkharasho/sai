import fs from 'node:fs';
import path from 'node:path';
import type { AiUnit, Provider, ScopeTag, SystemSample } from './types';
import type { Classified } from './classify';

const NOTE_TTL_MS = 10 * 60 * 1000;
const ALSO_RUNNING_MAX = 3;

const gb = (kb: number) => (kb / 1024 / 1024).toFixed(1);
const gbFromMb = (mb: number) => (mb / 1024).toFixed(1);

export function warningNote(s: SystemSample, c: Classified, swapRising: boolean): string {
  const pct = Math.round((1 - s.memAvailableKb / s.memTotalKb) * 100);
  const swapUsedKb = s.swapTotalKb - s.swapFreeKb;
  let text = `[SAI system load: WARNING] RAM ${pct}% used (${gb(s.memAvailableKb)} GB free of ${gb(s.memTotalKb)} GB), ` +
    `swap ${gb(swapUsedKb)} GB used${swapRising ? ' and rising' : ''}, ` +
    `memory pressure ${Math.round(s.psiMemSome10)}%, CPU pressure ${Math.round(s.psiCpuSome10)}%.`;
  if (s.gpu) {
    text += ` GPU ${Math.round(s.gpu.utilPct)}%, VRAM ${gbFromMb(s.gpu.vramUsedMb)}/${gbFromMb(s.gpu.vramTotalMb)} GB.`;
  }
  const entries: string[] = [];
  if (c.game) entries.push(`game "${c.game.name}" ${gb(c.game.sizeKb)} GB`);
  for (const t of c.top) {
    if (entries.length >= ALSO_RUNNING_MAX) break;
    if (t.owner !== 'other') continue;
    entries.push(`${t.label} ${gb(t.sizeKb)} GB`);
  }
  if (entries.length > 0) text += ` Also running: ${entries.join(', ')}.`;
  text += ` SAI's own processes: ${gb(c.saiAiKb)} GB. Prefer lighter work for now (fewer parallel workers, avoid full builds or whole test suites, or wait), and tell the user if you're holding back.`;
  return text;
}

export function normalNote(): string {
  return '[SAI system load: back to normal] Normal workloads are fine again.';
}

export function killNote(u: AiUnit, memUsedPct: number): string {
  return `[SAI system load: CRITICAL] SAI killed \`${u.label}\` (${gb(u.sizeKb)} GB) to keep the user's PC from freezing (RAM ${Math.round(memUsedPct)}% used). Don't re-run it as-is; use a lighter approach or ask the user first.`;
}

const pathCache = new Map<string, string>();
/** /home/x may be a symlink to /var/home/x; callers report either form. */
function normPath(p: string): string {
  if (p === '*') return p;
  let r = pathCache.get(p);
  if (r === undefined) {
    try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
    pathCache.set(p, r);
  }
  return r;
}

interface Note {
  text: string;
  at: number;
  /** null = every scope */
  target: Omit<ScopeTag, 'instance'> | null;
  seen: Set<string>;
}

export class NoteBox {
  private loadNote: Note | null = null;
  private targeted: Note[] = [];

  postAll(text: string, now: number): void {
    this.loadNote = { text, at: now, target: null, seen: new Set() };
  }

  postTo(tag: Omit<ScopeTag, 'instance'>, text: string, now: number): void {
    this.targeted.push({ text, at: now, target: tag, seen: new Set() });
  }

  take(provider: Provider, projectPath: string, scope: string, now: number): string | null {
    this.targeted = this.targeted.filter(n => now - n.at <= NOTE_TTL_MS);
    if (this.loadNote && now - this.loadNote.at > NOTE_TTL_MS) this.loadNote = null;
    const key = `${provider}|${normPath(projectPath)}|${scope}`;
    const out: string[] = [];
    const consider = (n: Note) => {
      if (n.seen.has(key)) return;
      const t = n.target;
      if (t) {
        if (t.provider !== provider) return;
        if (t.projectPath !== '*' && normPath(t.projectPath) !== normPath(projectPath)) return;
        if (t.scope !== '*' && t.scope !== scope) return;
      }
      n.seen.add(key);
      out.push(n.text);
    };
    for (const n of this.targeted) consider(n);
    if (this.loadNote) consider(this.loadNote);
    return out.length ? out.join('\n') : null;
  }
}
