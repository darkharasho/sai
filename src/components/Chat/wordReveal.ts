// Reveal a finished assistant message's DOM word-by-word with a traveling caret.
// Words are wrapped (opacity 0) up front; trailing BLOCKS are hidden and
// un-hide as the sweep reaches them, so the message GROWS with the typing
// instead of reserving its full final height as a blank slab (the old
// layout-stable variant made long replies render as a big empty block).
// The transcript's bottom-pin is handled by ChatPanel's ResizeObserver on the
// container children, which re-pins scroll whenever content grows async.
// Code blocks / tables / images reveal as atomic units. Pure DOM — no React.

export interface RevealController {
  cancel(): void;
}

export interface RevealOpts {
  cadenceMs?: number; // delay between items
  snapMs?: number;    // per-item opacity transition
  budgetMs?: number;  // soft cap on total duration; default scales with length
  maxWords?: number;  // beyond this, render instantly (pathological safety)
}

// Block-level elements that should not be split into words.
const ATOMIC_TAGS = new Set(['PRE', 'TABLE', 'IMG', 'CANVAS', 'SVG', 'VIDEO']);

// Containers whose direct children reveal as sub-blocks, so a long list or
// quote grows item-by-item instead of appearing as one full-height chunk.
const SUBDIVIDE_TAGS = new Set(['UL', 'OL', 'BLOCKQUOTE']);

function collectItems(root: HTMLElement, snapMs: number): HTMLElement[] {
  const doc = root.ownerDocument;
  const items: HTMLElement[] = [];

  const walk = (node: Node) => {
    // Snapshot children: we mutate the tree (replace text nodes) while iterating.
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text.trim() === '') continue;
        const frag = doc.createDocumentFragment();
        // Keep whitespace runs as plain text; wrap non-space tokens.
        for (const part of text.split(/(\s+)/)) {
          if (part === '') continue;
          if (/^\s+$/.test(part)) {
            frag.appendChild(doc.createTextNode(part));
          } else {
            const span = doc.createElement('span');
            span.className = 'rv-word';
            span.textContent = part;
            span.style.opacity = '0';
            span.style.transition = `opacity ${snapMs}ms linear`;
            frag.appendChild(span);
            items.push(span);
          }
        }
        // Insert spans before the text node rather than replacing it.
        // replaceChild() orphans the text node, breaking React's removeChild()
        // call during fiber cleanup (React still holds a reference to it).
        child.parentNode?.insertBefore(frag, child);
        child.textContent = '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        // toUpperCase: SVG elements report a lowercase tagName ('svg'), unlike
        // HTML elements. Emoji icons (accent SVGs / CSS-masked spans) carry no
        // text nodes, so they must be revealed as atomic items too or they
        // pop in ahead of the typing sweep.
        if (
          ATOMIC_TAGS.has(el.tagName.toUpperCase()) ||
          el.classList.contains('sai-emoji-icon') ||
          el.classList.contains('sai-emoji-mask')
        ) {
          el.style.opacity = '0';
          el.style.transition = `opacity ${snapMs}ms linear`;
          items.push(el);
        } else {
          walk(el);
        }
      }
    }
  };

  walk(root);
  return items;
}

/** Document-order growth units: the container's direct children, with list /
 *  blockquote children subdivided one level so long lists grow per item. */
function collectBlocks(container: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (SUBDIVIDE_TAGS.has(child.tagName.toUpperCase()) && child.children.length > 0) {
      blocks.push(...(Array.from(child.children) as HTMLElement[]));
    } else {
      blocks.push(child);
    }
  }
  return blocks;
}

export function revealWords(container: HTMLElement, opts: RevealOpts = {}): RevealController {
  const cadenceMs = opts.cadenceMs ?? 52;
  const snapMs = opts.snapMs ?? 70;
  const maxWords = opts.maxWords ?? 20000;

  const items = collectItems(container, snapMs);
  // Long replies type FASTER (budget batching below), and the very longest
  // get a slightly larger budget so the cascade is still perceptible.
  const budgetMs = opts.budgetMs ?? Math.min(2200, 1200 + items.length / 4);

  const showWords = () => { for (const el of items) el.style.opacity = '1'; };

  if (items.length === 0 || items.length > maxWords) {
    showWords();
    return { cancel() {} };
  }

  // Grow-as-it-types: blocks after the first start hidden and un-hide as the
  // sweep reaches them, so the message never reserves untyped height. (A
  // subdivided parent — UL/OL/BLOCKQUOTE — hides too, or its empty shell
  // would render borders/margins ahead of the typing.)
  const blocks = collectBlocks(container);
  const blockIndex = new Map<HTMLElement, number>();
  blocks.forEach((b, i) => blockIndex.set(b, i));
  for (let b = 1; b < blocks.length; b++) blocks[b].style.display = 'none';
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (SUBDIVIDE_TAGS.has(child.tagName.toUpperCase()) && child.children.length > 0) {
      // Hide the shell unless it owns the still-visible first block.
      if (child.children[0] !== blocks[0]) child.style.display = 'none';
    }
  }

  // Map each item to its growth unit.
  const itemBlock = items.map((item) => {
    let n: HTMLElement | null = item;
    while (n && n !== container) {
      const idx = blockIndex.get(n);
      if (idx != null) return idx;
      n = n.parentElement;
    }
    return 0;
  });

  let grownTo = 0; // blocks[0] is visible from the start
  const growTo = (b: number) => {
    while (grownTo < b) {
      grownTo++;
      const el = blocks[grownTo];
      if (el.style.display === 'none') el.style.display = '';
      // Un-hide any hidden ancestor shells (subdivided UL/OL/BLOCKQUOTE).
      let p = el.parentElement;
      while (p && p !== container) {
        if (p.style.display === 'none') p.style.display = '';
        p = p.parentElement;
      }
    }
  };

  const showAll = () => {
    growTo(blocks.length - 1);
    showWords();
  };

  // Honor the duration budget: short/medium replies reveal one item per tick at a
  // shrinking cadence; long replies keep an 8ms floor but reveal several items per
  // tick so the whole reveal still finishes within ~budgetMs.
  const MIN_STEP = 8;
  const idealStep = Math.floor(budgetMs / items.length);
  let step: number;
  let perTick: number;
  if (idealStep >= cadenceMs) { step = cadenceMs; perTick = 1; }
  else if (idealStep >= MIN_STEP) { step = idealStep; perTick = 1; }
  else { step = MIN_STEP; perTick = Math.ceil((items.length * MIN_STEP) / budgetMs); }

  const caret = container.ownerDocument.createElement('span');
  caret.className = 'rv-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▋';

  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    // Caller unmounted the message without calling cancel() — stop and clean up.
    if (!container.isConnected) { cancelled = true; caret.remove(); return; }
    if (i >= items.length) {
      // Trailing blocks with no items (hr, empty elements) still need to show.
      growTo(blocks.length - 1);
      caret.remove();
      return;
    }
    let last = items[i];
    for (let k = 0; k < perTick && i < items.length; k++) {
      const idx = i++;
      last = items[idx];
      growTo(itemBlock[idx]);
      last.style.opacity = '1';
    }
    last.parentNode?.insertBefore(caret, last.nextSibling);
    timer = setTimeout(tick, step);
  };
  tick();

  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      showAll();
      caret.remove();
    },
  };
}
