import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Element, ElementContent } from 'hast';
import { makeEmojiRegex } from './emojiIcons';

const JUMBO_BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isEmojiSpan(node: ElementContent): boolean {
  if (node.type !== 'element') return false;
  const cls = node.properties?.className;
  return Array.isArray(cls) && cls.includes('sai-emoji');
}

// Walks HAST text nodes and replaces every emoji grapheme with a marker
// <span class="sai-emoji" data-emoji="…" />, then tags emoji-only blocks
// (p/li/h1..h6) with `sai-emoji-jumbo` so the CSS can render them large.
export function rehypeEmojiIcons() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const text = node.value;
      const regex = makeEmojiRegex();
      if (!regex.test(text)) return;
      regex.lastIndex = 0;

      const out: ElementContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const emoji = m[0];
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
        out.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['sai-emoji'], 'data-emoji': emoji },
          children: [],
        });
        last = m.index + emoji.length;
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) });

      parent.children.splice(index, 1, ...out);
      return [SKIP, index + out.length];
    });

    // Jumbo pass: a block whose children are exclusively emoji spans + whitespace
    // (≥1 emoji) gets the sai-emoji-jumbo class. Real text / links / code disqualify it.
    visit(tree, 'element', (node: Element) => {
      if (!JUMBO_BLOCKS.has(node.tagName)) return;
      let emojiCount = 0;
      for (const child of node.children) {
        if (child.type === 'text') {
          if (child.value.trim() !== '') return;
        } else if (isEmojiSpan(child)) {
          emojiCount++;
        } else {
          return;
        }
      }
      if (emojiCount === 0) return;
      const props = node.properties || (node.properties = {});
      const cls = props.className;
      props.className = Array.isArray(cls)
        ? [...cls, 'sai-emoji-jumbo']
        : typeof cls === 'string' && cls
          ? [cls, 'sai-emoji-jumbo']
          : ['sai-emoji-jumbo'];
    });
  };
}
