import { splitBlocks, taskItems } from './canvasBlocks';

/**
 * Optional stat tiles: a ```stats fence holds one `Label: value` per line. `auto` computes
 * progress / passed / failed / remaining from the canvas's checklist items; anything else
 * renders verbatim. No stats block, no tiles.
 */
export interface StatLine {
  label: string;
  value: string;
}

export interface ChecklistTotals {
  done: number;
  failed: number;
  open: number;
  total: number;
}

export type StatTile =
  | { label: string; kind: 'progress'; value: string; done: number; total: number }
  | { label: string; kind: 'passed' | 'failed' | 'remaining'; value: string }
  | { label: string; kind: 'text'; value: string; mono: boolean };

function fenceLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const open = lines.findIndex((l) => /^\s*(`{3,}|~{3,})/.test(l));
  const body = open >= 0 ? lines.slice(open + 1) : lines;
  const close = body.findIndex((l) => /^\s*(`{3,}|~{3,})\s*$/.test(l));
  return close >= 0 ? body.slice(0, close) : body;
}

export function parseStats(source: string): StatLine[] {
  const out: StatLine[] = [];
  for (const line of fenceLines(source)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const label = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (label) out.push({ label, value });
  }
  return out;
}

/** Every task item the canvas renders (top-level items of its checklist blocks). */
export function checklistTotals(md: string): ChecklistTotals {
  const t: ChecklistTotals = { done: 0, failed: 0, open: 0, total: 0 };
  for (const b of splitBlocks(md)) {
    if (b.kind !== 'checklist') continue;
    for (const it of taskItems(b.source)) {
      t[it.state === 'done' ? 'done' : it.state === 'failed' ? 'failed' : 'open'] += 1;
      t.total += 1;
    }
  }
  return t;
}

const MONO_RES = [
  /^v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?$/i, // versions: 1.2.3, v0.3.1-dev
  /^(?=[0-9a-f]*\d)[0-9a-f]{7,40}$/i, // commit hashes
  /^#\d+$/, // issue / PR numbers
];

export function resolveStat(line: StatLine, totals: ChecklistTotals): StatTile {
  const { label, value } = line;
  if (value.toLowerCase() === 'auto') {
    switch (label.toLowerCase()) {
      case 'progress':
        return { label, kind: 'progress', value: String(totals.done), done: totals.done, total: totals.total };
      case 'passed':
        return { label, kind: 'passed', value: String(totals.done) };
      case 'failed':
        return { label, kind: 'failed', value: String(totals.failed) };
      case 'remaining':
        return { label, kind: 'remaining', value: String(totals.total - totals.done - totals.failed) };
    }
  }
  const code = /^`([^`]+)`$/.exec(value);
  if (code) return { label, kind: 'text', value: code[1], mono: true };
  return { label, kind: 'text', value, mono: MONO_RES.some((re) => re.test(value)) };
}
