import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Root, RootContent, List, ListItem } from 'mdast';

export type BlockKind = 'markdown' | 'checklist' | 'mermaid' | 'html' | 'stats';

/** A checklist item: `- [ ]` open, `- [x]` done, `- [!]` failed (SAI convention). */
export type TaskState = 'open' | 'done' | 'failed';

export interface CanvasBlock {
  index: number;
  kind: BlockKind;
  source: string;
  hash: string;
  /** html/mermaid/stats only: first line after the fence lang, e.g. ```html id=picker */
  label?: string;
}

interface ParsedBlock {
  node: RootContent | null;
  start: number;
  end: number;
}

function parse(md: string): Root {
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Slice offsets per top-level node; each block runs up to the next node's start. */
function parseBlocks(md: string): ParsedBlock[] {
  const nodes = parse(md).children.filter((n) => n.position?.start.offset !== undefined);
  if (nodes.length === 0) return md ? [{ node: null, start: 0, end: md.length }] : [];
  return nodes.map((node, i) => ({
    node,
    start: i === 0 ? 0 : node.position!.start.offset!,
    end: i + 1 < nodes.length ? nodes[i + 1].position!.start.offset! : md.length,
  }));
}

function hashSource(source: string): string {
  const s = source.trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * `- [!] text`: GFM has no failed state, so remark-gfm parses it as a plain item whose text
 * starts with `[!]`. Detected from the item's source (its marker, then `[!]` and a space or EOL).
 */
const FAILED_RE = /^(?:[*+-]|\d+[.)])[ \t]+\[!\](?=[ \t]|\r?\n|$)/;

function isFailedItem(md: string, item: ListItem): boolean {
  const at = item.position?.start.offset;
  return (item.checked === null || item.checked === undefined) && at !== undefined && FAILED_RE.test(md.slice(at, at + 64));
}

/** State of a list item, or null when it is not a task item. */
function itemState(md: string, item: ListItem): TaskState | null {
  if (item.checked === true) return 'done';
  if (item.checked === false) return 'open';
  return isFailedItem(md, item) ? 'failed' : null;
}

function classify(md: string, node: RootContent | null): { kind: BlockKind; label?: string } {
  if (node?.type === 'list' && node.children.every((item) => itemState(md, item) !== null)) {
    return { kind: 'checklist' };
  }
  if (node?.type === 'code' && (node.lang === 'mermaid' || node.lang === 'html' || node.lang === 'stats')) {
    const label = node.meta?.trim();
    return label ? { kind: node.lang, label } : { kind: node.lang };
  }
  return { kind: 'markdown' };
}

export function splitBlocks(md: string): CanvasBlock[] {
  return parseBlocks(md).map((b, index) => {
    const source = md.slice(b.start, b.end);
    return { index, source, hash: hashSource(source), ...classify(md, b.node) };
  });
}

export function joinBlocks(blocks: Pick<CanvasBlock, 'source'>[]): string {
  return blocks.map((b) => b.source).join('');
}

export function replaceBlock(md: string, index: number, source: string): string {
  const blocks = splitBlocks(md);
  if (index < 0 || index >= blocks.length) return md;
  return joinBlocks(blocks.map((b, i) => (i === index ? { source } : b)));
}

function findItem(md: string, blockIndex: number, itemIndex: number): { item: ListItem; list: List } | null {
  const block = parseBlocks(md)[blockIndex];
  if (block?.node?.type !== 'list') return null;
  const item = block.node.children[itemIndex];
  return item?.position?.start.offset !== undefined ? { item, list: block.node } : null;
}

const TASK_BOX_RE = /^(?:[*+-]|\d+[.)])[ \t]+\[([ xX!])\]/;

/** Rewrite the target item's `[?]` box to `[mark]`. */
function setBox(md: string, blockIndex: number, itemIndex: number, mark: (state: TaskState) => string | null): string {
  const found = findItem(md, blockIndex, itemIndex);
  const state = found ? itemState(md, found.item) : null;
  if (!found || !state) return md;
  const next = mark(state);
  if (next === null) return md;
  const start = found.item.position!.start.offset!;
  const m = TASK_BOX_RE.exec(md.slice(start));
  if (!m) return md;
  const at = start + m[0].length - 2;
  return md.slice(0, at) + next + md.slice(at + 1);
}

/** Click on a checkbox: open -> done, done -> open, failed -> open. */
export function toggleTask(md: string, blockIndex: number, itemIndex: number): string {
  return setBox(md, blockIndex, itemIndex, (s) => (s === 'open' ? 'x' : ' '));
}

/** "Mark failed": writes `[!]`. A failed item stays as is. */
export function markTaskFailed(md: string, blockIndex: number, itemIndex: number): string {
  return setBox(md, blockIndex, itemIndex, (s) => (s === 'failed' ? null : '!'));
}

export interface TaskItem {
  state: TaskState;
  /** Label line, then continuation lines (notes) with their indent stripped. */
  text: string;
}

/** Top-level task items of a checklist block's source, with their continuation lines. */
export function taskItems(source: string): TaskItem[] {
  const items: TaskItem[] = [];
  let indent = -1; // the first item's indent (0-3) marks the top level
  for (const line of source.split('\n')) {
    const m = /^( {0,3})(?:[*+-]|\d+[.)])[ \t]+\[([ xX!])\](?:[ \t]+(.*))?$/.exec(line);
    if (m && (indent < 0 || m[1].length === indent)) {
      indent = m[1].length;
      items.push({ state: m[2] === '!' ? 'failed' : m[2] === ' ' ? 'open' : 'done', text: (m[3] ?? '').replace(/\r$/, '') });
    } else if (items.length && line.trim()) items[items.length - 1].text += '\n' + line.replace(/^\s{1,4}/, '').replace(/\r$/, '');
  }
  return items;
}

export function addTaskNote(md: string, blockIndex: number, itemIndex: number, note: string): string {
  const found = findItem(md, blockIndex, itemIndex);
  if (!found) return md;
  const pos = found.item.position!;
  const indent = ' '.repeat(pos.start.column - 1 + 2);
  const text = note.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const at = pos.end.offset!;
  return `${md.slice(0, at)}${eol}${indent}> ${text}${md.slice(at)}`;
}

export function canvasTitle(md: string, fallbackSlug: string): string {
  for (const node of parse(md).children) {
    if (node.type === 'heading' && node.depth === 1) {
      const text = collectText(node).trim();
      if (text) return text;
    }
  }
  return fallbackSlug;
}

function collectText(node: any): string {
  if (typeof node.value === 'string') return node.value;
  return Array.isArray(node.children) ? node.children.map(collectText).join('') : '';
}

export type BlockShape =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph' | 'table' | 'list' | 'code' | 'blockquote' | 'other' | 'empty' };

/** What a block is by its first node: drives page title / subtitle / section cards in the view. */
export function blockShape(source: string): BlockShape {
  const [node] = parse(source).children;
  if (!node) return { type: 'empty' };
  if (node.type === 'heading') return { type: 'heading', depth: node.depth, text: collectText(node).trim() };
  if (node.type === 'paragraph' || node.type === 'table' || node.type === 'list' || node.type === 'code' || node.type === 'blockquote') {
    return { type: node.type };
  }
  return { type: 'other' };
}

/** Text of a block that is a lone heading (ATX or setext), else null. */
function headingText(source: string): string | null {
  const [node] = parse(source).children;
  return node?.type === 'heading' ? collectText(node).trim() || null : null;
}

/** A block's own name before disambiguation: fence title, nearest preceding heading, or null. */
function baseName(blocks: readonly CanvasBlock[], index: number): { name: string; titled: boolean } | null {
  const b = blocks[index];
  if (b?.label) return { name: b.label, titled: true };
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].kind !== 'markdown') continue;
    const h = headingText(blocks[i].source);
    if (h) return { name: h, titled: false };
  }
  return null;
}

/**
 * Agent-facing name of a block (diagram/html): its fence title, else the nearest preceding
 * heading ("Shop flow"), else "block N". Emits coalesce by this name, so an untitled block whose
 * heading name is shared by another block of the same kind gets a suffix: "Shop flow (block 5)".
 * A unique name stays plain; a fence title is never suffixed.
 */
export function blockName(blocks: readonly CanvasBlock[], index: number): string {
  const own = baseName(blocks, index);
  if (!own) return `block ${index + 1}`;
  if (own.titled) return own.name;
  const kind = blocks[index].kind;
  const shared = blocks.some((b, i) => i !== index && b.kind === kind && baseName(blocks, i)?.name === own.name);
  return shared ? `${own.name} (block ${index + 1})` : own.name;
}
