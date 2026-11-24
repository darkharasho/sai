import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { ListItem } from 'mdast';
import { splitBlocks, type CanvasBlock } from './canvasBlocks';
import { diffAgainstBase } from './canvasMerge';

const PREVIEW_CHARS = 80;
const EMIT_MAX_CHARS = 500;

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

function collectText(node: any): string {
  if (typeof node.value === 'string') return node.value;
  return Array.isArray(node.children) ? node.children.map(collectText).join('') : '';
}

interface ItemInfo {
  text: string;
  checked: boolean;
  notes: string[];
}

/** Task items (nested ones included) keyed by first-paragraph text plus occurrence index. */
function itemsOf(source: string): Map<string, ItemInfo> {
  const root = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items = new Map<string, ItemInfo>();
  const seenCount = new Map<string, number>();
  const walk = (node: any) => {
    for (const child of node.children ?? []) {
      if (child.type === 'listItem' && child.checked !== null && child.checked !== undefined) {
        const para = child.children.find((c: any) => c.type === 'paragraph');
        const text = para ? collectText(para).trim() : '';
        const n = seenCount.get(text) ?? 0;
        seenCount.set(text, n + 1);
        const notes = child.children.filter((c: any) => c.type === 'blockquote').map((c: any) => collectText(c).trim());
        items.set(`${text}\u0000${n}`, { text, checked: child.checked === true, notes });
      }
      walk(child);
    }
  };
  walk(root);
  return items;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function describeChecklist(seen: CanvasBlock, cur: CanvasBlock): string[] {
  const before = itemsOf(seen.source);
  const after = itemsOf(cur.source);
  const lines: string[] = [];
  for (const [key, info] of after) {
    const { text } = info;
    const old = before.get(key);
    if (!old) {
      lines.push(`+ item "${text}"`);
      if (info.checked) lines.push(`☑ "${text}"`);
    } else {
      if (!old.checked && info.checked) lines.push(`☑ "${text}"`);
      else if (old.checked && !info.checked) lines.push(`☐ "${text}"`);
      for (const note of info.notes) if (note && !old.notes.includes(note)) lines.push(`note on "${text}": ${note}`);
    }
  }
  for (const [key, info] of before) if (!after.has(key)) lines.push(`− item "${info.text}"`);
  // Never lose an edit the item-level view can't express (e.g. reordered or restructured items).
  if (lines.length === 0 && normalize(seen.source) !== normalize(cur.source)) {
    return [`edited block ${cur.index + 1}: ${oneLine(cur.source)}`];
  }
  return lines;
}

function describePair(seen: CanvasBlock, cur: CanvasBlock): string[] {
  const n = cur.index + 1;
  if (seen.kind === 'checklist' && cur.kind === 'checklist') return describeChecklist(seen, cur);
  if (seen.kind === 'mermaid' && cur.kind === 'mermaid') return [`diagram "${cur.label ?? `block ${n}`}": edited`];
  return [`edited block ${n}: ${oneLine(cur.source)}`];
}

/** Compact, agent-facing lines describing how `current` differs from the `seen` canvas. */
export function describeUserEdits(seen: string, current: string): string[] {
  const seenBlocks = splitBlocks(seen);
  const { states, inserted } = diffAgainstBase(seenBlocks, splitBlocks(current));
  const added = (slot: number) => inserted[slot].map((b) => `+ block ${b.index + 1}: ${oneLine(b.source)}`);
  const lines: string[] = [...added(0)];
  seenBlocks.forEach((block, i) => {
    const state = states[i];
    if (state.kind === 'replaced') lines.push(...describePair(block, state.block));
    else if (state.kind === 'deleted') lines.push(`− block ${i + 1}`);
    lines.push(...added(i + 1));
  });
  return lines;
}

/**
 * JSON for an emit payload that never throws: this runs during render (hasPending), so a
 * cyclic or BigInt payload from a canvas widget must not take the app down.
 */
export function safeStringify(value: unknown): string {
  const ancestors: unknown[] = [];
  try {
    const out = JSON.stringify(value, function (this: unknown, _key, val: unknown) {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val !== 'object' || val === null) return val;
      // `this` is the object holding `val`: unwind to it, so only true ancestors count as cycles.
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(val)) return '[Circular]';
      ancestors.push(val);
      return val;
    });
    return out ?? 'null';
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }
}

export interface CanvasEmit {
  label: string;
  /** Latest payload for this label. */
  data: unknown;
  /** Emits coalesced into this one (1 when omitted). */
  count?: number;
}

export function buildCanvasUpdateMessage(input: {
  relPath: string;
  lines: string[];
  emits: CanvasEmit[];
  fullContent?: string;
}): string {
  const emitLines = input.emits.map((e) => {
    const times = e.count && e.count > 1 ? ` (×${e.count})` : '';
    return `html "${e.label}" sent: ${safeStringify(e.data).slice(0, EMIT_MAX_CHARS)}${times}`;
  });
  const out = [`[Canvas update] ${input.relPath}`];
  if (input.fullContent !== undefined) {
    out.push(
      'The user is sharing this canvas with you (current content below).',
      '',
      '```markdown',
      input.fullContent.replace(/\n$/, ''),
      '```',
    );
    out.push(...emitLines.map((l) => `- ${l}`));
  } else {
    out.push('The user edited the canvas:', ...[...input.lines, ...emitLines].map((l) => `- ${l}`));
  }
  out.push('Re-read the file for full context.');
  return out.join('\n');
}
