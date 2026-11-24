import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Root, RootContent, List, ListItem } from 'mdast';

export type BlockKind = 'markdown' | 'checklist' | 'mermaid' | 'html';

export interface CanvasBlock {
  index: number;
  kind: BlockKind;
  source: string;
  hash: string;
  /** html/mermaid only: first line after the fence lang, e.g. ```html id=picker */
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

function classify(node: RootContent | null): { kind: BlockKind; label?: string } {
  if (node?.type === 'list' && node.children.every((item) => item.checked !== null && item.checked !== undefined)) {
    return { kind: 'checklist' };
  }
  if (node?.type === 'code' && (node.lang === 'mermaid' || node.lang === 'html')) {
    const label = node.meta?.trim();
    return label ? { kind: node.lang, label } : { kind: node.lang };
  }
  return { kind: 'markdown' };
}

export function splitBlocks(md: string): CanvasBlock[] {
  return parseBlocks(md).map((b, index) => {
    const source = md.slice(b.start, b.end);
    return { index, source, hash: hashSource(source), ...classify(b.node) };
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

export function toggleTask(md: string, blockIndex: number, itemIndex: number): string {
  const found = findItem(md, blockIndex, itemIndex);
  if (!found || found.item.checked === null || found.item.checked === undefined) return md;
  const start = found.item.position!.start.offset!;
  const m = /^(?:[*+-]|\d+[.)])[ \t]+\[([ xX])\]/.exec(md.slice(start));
  if (!m) return md;
  const at = start + m[0].length - 2;
  return md.slice(0, at) + (found.item.checked ? ' ' : 'x') + md.slice(at + 1);
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
