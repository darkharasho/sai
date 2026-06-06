// Reveal a finished assistant message's DOM word-by-word with a traveling caret,
// without reflow: every word is wrapped (opacity 0) up front so layout is final,
// then words fade in left-to-right. Code blocks / tables / images reveal as atomic
// units. Pure DOM — no React.

export interface RevealController {
  cancel(): void;
}

export interface RevealOpts {
  cadenceMs?: number; // delay between items
  snapMs?: number;    // per-item opacity transition
  budgetMs?: number;  // soft cap on total duration; shrinks cadence for long replies
  maxWords?: number;  // beyond this, render instantly (no animation)
}

// Block-level elements that should not be split into words.
const ATOMIC_TAGS = new Set(['PRE', 'TABLE', 'IMG', 'CANVAS', 'SVG', 'VIDEO']);

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
        child.parentNode?.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (ATOMIC_TAGS.has(el.tagName)) {
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

export function revealWords(container: HTMLElement, opts: RevealOpts = {}): RevealController {
  const cadenceMs = opts.cadenceMs ?? 52;
  const snapMs = opts.snapMs ?? 70;
  const budgetMs = opts.budgetMs ?? 1200;
  const maxWords = opts.maxWords ?? 600;

  const items = collectItems(container, snapMs);

  const showAll = () => { for (const el of items) el.style.opacity = '1'; };

  if (items.length === 0 || items.length > maxWords) {
    showAll();
    return { cancel() {} };
  }

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
      caret.remove();
      return;
    }
    let last = items[i];
    for (let k = 0; k < perTick && i < items.length; k++) {
      last = items[i++];
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
