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
  checked: boolean;
  notes: string[];
}

/** Checklist items keyed by their first-paragraph text. */
function itemsOf(source: string): Map<string, ItemInfo> {
  const root = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items = new Map<string, ItemInfo>();
  for (const list of root.children) {
    if (list.type !== 'list') continue;
    for (const item of list.children as ListItem[]) {
      const para = item.children.find((c) => c.type === 'paragraph');
      const text = para ? collectText(para).trim() : '';
      if (items.has(text)) continue;
      const notes = item.children.filter((c) => c.type === 'blockquote').map((c) => collectText(c).trim());
      items.set(text, { checked: item.checked === true, notes });
    }
  }
  return items;
}

function describeChecklist(seen: CanvasBlock, cur: CanvasBlock): string[] {
  const before = itemsOf(seen.source);
  const after = itemsOf(cur.source);
  const lines: string[] = [];
  for (const [text, info] of after) {
    const old = before.get(text);
    if (!old) {
      lines.push(`+ item "${text}"`);
      continue;
    }
    if (!old.checked && info.checked) lines.push(`☑ "${text}"`);
    else if (old.checked && !info.checked) lines.push(`☐ "${text}"`);
    for (const note of info.notes) if (note && !old.notes.includes(note)) lines.push(`note on "${text}": ${note}`);
  }
  for (const text of before.keys()) if (!after.has(text)) lines.push(`− item "${text}"`);
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

export function buildCanvasUpdateMessage(input: {
  relPath: string;
  lines: string[];
  emits: { label: string; data: unknown }[];
  fullContent?: string;
}): string {
  const emitLines = input.emits.map(
    (e) => `html "${e.label}" sent: ${(JSON.stringify(e.data) ?? 'null').slice(0, EMIT_MAX_CHARS)}`,
  );
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
