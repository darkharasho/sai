import type { Root, Element, ElementContent, Text } from 'hast';

// Tags whose text must stay untouched: wrapping words in spans inside code
// would break syntax highlighting and copy-as-text.
const OPAQUE_TAGS = new Set(['code', 'pre']);

/**
 * Wraps every word in a `<span class="sw">` so words that arrive mid-stream
 * animate in as they mount (CSS `sw-in`, see globals.css). Whitespace stays as
 * bare text nodes between the spans, so line wrapping and copy behavior are
 * unchanged.
 *
 * Only used for the live-streaming markdown render (see
 * ASSISTANT_MD_PLUGINS_STREAM in ChatMessage). React reconciles the spans by
 * position, so on each token re-parse the already-mounted words keep their DOM
 * nodes (no animation replay) and only the new trailing spans mount and fade in.
 */
export function rehypeStreamWords() {
  return (tree: Root) => {
    walk(tree as unknown as Element);
  };
}

function walk(node: { children?: ElementContent[]; tagName?: string }) {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'element') {
      if (OPAQUE_TAGS.has(child.tagName)) continue;
      walk(child);
    } else if (child.type === 'text') {
      const out = splitWords(child.value);
      if (out) {
        children.splice(i, 1, ...out);
        i += out.length - 1;
      }
    }
  }
}

function splitWords(value: string): ElementContent[] | null {
  if (!/\S/.test(value)) return null;
  const parts = value.split(/(\s+)/).filter(Boolean);
  const out: ElementContent[] = parts.map(part =>
    /^\s+$/.test(part)
      ? ({ type: 'text', value: part } as Text)
      : ({
          type: 'element',
          tagName: 'span',
          properties: { className: ['sw'] },
          children: [{ type: 'text', value: part } as Text],
        } as Element)
  );
  return out;
}
