import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { ListItem } from 'mdast';
import { blockName, splitBlocks, type CanvasBlock } from './canvasBlocks';
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

type ItemState = 'open' | 'done' | 'failed';

interface ItemInfo {
  text: string;
  state: ItemState;
  notes: string[];
}

/** `- [!] text` (failed, a SAI convention) parses as a plain item whose text starts with `[!]`. */
const FAILED_PREFIX = /^\[!\](?:\s+|$)/;

/** Task items (nested ones included) keyed by first-paragraph text plus occurrence index. */
function itemsOf(source: string): Map<string, ItemInfo> {
  const root = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items = new Map<string, ItemInfo>();
  const seenCount = new Map<string, number>();
  const walk = (node: any) => {
    for (const child of node.children ?? []) {
      const para = child.type === 'listItem' ? child.children.find((c: any) => c.type === 'paragraph') : undefined;
      const raw = para ? collectText(para).trim() : '';
      const task = child.type === 'listItem' && child.checked !== null && child.checked !== undefined;
      const failed = child.type === 'listItem' && !task && FAILED_PREFIX.test(raw);
      if (task || failed) {
        const text = failed ? raw.replace(FAILED_PREFIX, '') : raw;
        const state: ItemState = failed ? 'failed' : child.checked === true ? 'done' : 'open';
        const n = seenCount.get(text) ?? 0;
        seenCount.set(text, n + 1);
        const notes = child.children.filter((c: any) => c.type === 'blockquote').map((c: any) => collectText(c).trim());
        items.set(`${text}\u0000${n}`, { text, state, notes });
      }
      walk(child);
    }
  };
  walk(root);
  return items;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

const STATE_MARK: Record<ItemState, string> = { done: '☑', open: '☐', failed: '✗' };
const stateLine = (state: ItemState, text: string) => `${STATE_MARK[state]} "${text}"`;

/** One agent-facing line and the thing it is about (an item or a block): one change per subject. */
interface EditLine {
  subject: string;
  text: string;
}

function describeChecklist(seen: CanvasBlock, cur: CanvasBlock): EditLine[] {
  const before = itemsOf(seen.source);
  const after = itemsOf(cur.source);
  const lines: EditLine[] = [];
  const push = (key: string, text: string) => lines.push({ subject: `item ${key}`, text });
  for (const [key, info] of after) {
    const { text } = info;
    const old = before.get(key);
    if (!old) {
      push(key, `+ item "${text}"`);
      if (info.state !== 'open') push(key, stateLine(info.state, text));
    } else {
      if (old.state !== info.state) push(key, stateLine(info.state, text));
      for (const note of info.notes) if (note && !old.notes.includes(note)) push(key, `note on "${text}": ${note}`);
    }
  }
  for (const [key, info] of before) if (!after.has(key)) push(key, `− item "${info.text}"`);
  // Never lose an edit the item-level view can't express (e.g. reordered or restructured items).
  if (lines.length === 0 && normalize(seen.source) !== normalize(cur.source)) {
    return [{ subject: 'block', text: `edited block ${cur.index + 1}: ${oneLine(cur.source)}` }];
  }
  return lines;
}

/** `cur` is `curBlocks[cur.index]`: diagrams and html blocks are named in the current canvas. */
function describePair(seen: CanvasBlock, cur: CanvasBlock, curBlocks: readonly CanvasBlock[]): EditLine[] {
  if (seen.kind === 'checklist' && cur.kind === 'checklist') return describeChecklist(seen, cur);
  const one = (text: string) => [{ subject: 'block', text }];
  if (seen.kind === 'mermaid' && cur.kind === 'mermaid') return one(`diagram "${blockName(curBlocks, cur.index)}": edited`);
  if (seen.kind === 'html' && cur.kind === 'html') return one(`html "${blockName(curBlocks, cur.index)}": edited`);
  if (seen.kind === 'stats' && cur.kind === 'stats') return one('stats: edited');
  return one(`edited block ${cur.index + 1}: ${oneLine(cur.source)}`);
}

function userEditLines(seen: string, current: string): EditLine[] {
  const seenBlocks = splitBlocks(seen);
  const curBlocks = splitBlocks(current);
  const { states, inserted } = diffAgainstBase(seenBlocks, curBlocks);
  const added = (slot: number) =>
    inserted[slot].map((b) => ({ subject: `new ${b.index}`, text: `+ block ${b.index + 1}: ${oneLine(b.source)}` }));
  const lines: EditLine[] = [...added(0)];
  seenBlocks.forEach((block, i) => {
    const state = states[i];
    if (state.kind === 'replaced') {
      lines.push(...describePair(block, state.block, curBlocks).map((l) => ({ ...l, subject: `${i} ${l.subject}` })));
    } else if (state.kind === 'deleted') lines.push({ subject: `${i} block`, text: `− block ${i + 1}` });
    lines.push(...added(i + 1));
  });
  return lines;
}

/** Compact, agent-facing lines describing how `current` differs from the `seen` canvas. */
export function describeUserEdits(seen: string, current: string): string[] {
  return userEditLines(seen, current).map((l) => l.text);
}

/**
 * How many things the user changed: distinct items/blocks, not lines (a new item that
 * arrives ticked is one change, though it reads as two lines).
 */
export function countUserEdits(seen: string, current: string): number {
  return new Set(userEditLines(seen, current).map((l) => l.subject)).size;
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

const UPDATE_HEAD = '[Canvas update] ';
const UPDATE_TAIL = '\nRe-read the file for full context.';

/**
 * Split the canvas updates (buildCanvasUpdateMessage blocks) off the front of a user message, so
 * the chat can show them as a quiet note instead of the raw hook text. `relPaths` in order;
 * `rest` is what the user typed (empty for an update sent on its own).
 */
export function splitCanvasUpdates(text: string): { relPaths: string[]; rest: string } {
  const relPaths: string[] = [];
  let rest = text;
  while (rest.startsWith(UPDATE_HEAD)) {
    const end = rest.indexOf(UPDATE_TAIL);
    if (end < 0) break;
    const nl = rest.indexOf('\n');
    relPaths.push(rest.slice(UPDATE_HEAD.length, nl < 0 ? undefined : nl).trim());
    rest = rest.slice(end + UPDATE_TAIL.length).replace(/^\s+/, '');
  }
  return relPaths.length ? { relPaths, rest } : { relPaths, rest: text };
}
