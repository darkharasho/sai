# Emoji Jumbo Sizing + Name Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the inline emoji-icon size to 1.3em, render emoji jumbo (2.2em) when a block is emoji-only (Discord-style), and add a native hover tooltip with the emoji's name.

**Architecture:** Add `emojiName()` to the shared module and a `title` to `EmojiIcon`. The rehype plugin gets a second pass that tags emoji-only block elements (`p`/`li`/`h1`–`h6`) with a `sai-emoji-jumbo` class, so both chat surfaces get jumbo via CSS with no component changes.

**Tech Stack:** React + TypeScript, react-markdown, unist-util-visit, unicode-emoji-json, Vitest.

---

## File Structure

- **Modify** `src/components/Chat/emojiIcons.tsx` — add `emojiName()`; add `title` to `EmojiIcon`.
- **Modify** `src/components/Chat/rehypeEmojiIcons.ts` — second pass tagging emoji-only blocks `sai-emoji-jumbo`.
- **Modify** `tests/unit/components/Chat/emojiIcons.test.tsx` — tests for name, tooltip, jumbo.
- **Modify** `src/styles/globals.css` + `src/renderer-remote/styles.css` — 1.3em base + `.sai-emoji-jumbo` 2.2em.

---

## Task 1: emojiName + tooltip + per-block jumbo marking

**Files:**
- Modify: `src/components/Chat/emojiIcons.tsx`, `src/components/Chat/rehypeEmojiIcons.ts`
- Test: `tests/unit/components/Chat/emojiIcons.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/components/Chat/emojiIcons.test.tsx` (the file already imports `render`, `ReactMarkdown`, `rehypeEmojiIcons`, `renderEmojiSpan`; add `emojiName` to the existing import from `'../../../../src/components/Chat/emojiIcons'` and reuse its `renderMd` helper):

```tsx
import { emojiName } from '../../../../src/components/Chat/emojiIcons';

describe('emojiName', () => {
  it('returns the human name of a mapped emoji', () => {
    expect(emojiName('✅')).toBe('check mark button');
  });
  it('resolves the base name with skin tone stripped', () => {
    expect(emojiName('👍🏽')).toBe(emojiName('👍'));
    expect(emojiName('👍')).toBeTruthy();
  });
  it('returns null for a non-emoji', () => {
    expect(emojiName('x')).toBeNull();
  });
});

describe('emoji tooltip + jumbo', () => {
  it('sets a title tooltip equal to the emoji name on the icon', () => {
    const { container } = renderMd('ok ✅');
    expect(container.querySelector('.sai-emoji-icon')?.getAttribute('title')).toBe(emojiName('✅'));
  });

  it('marks an emoji-only paragraph with sai-emoji-jumbo', () => {
    const { container } = renderMd('🎉✅');
    expect(container.querySelector('p.sai-emoji-jumbo')).toBeTruthy();
  });

  it('does NOT mark a mixed-content paragraph as jumbo', () => {
    const { container } = renderMd('done ✅');
    expect(container.querySelector('p.sai-emoji-jumbo')).toBeNull();
    expect(container.querySelector('p')).toBeTruthy();
  });

  it('marks an emoji-only list item jumbo', () => {
    const { container } = renderMd('- 🎉');
    expect(container.querySelector('.sai-emoji-jumbo .sai-emoji-icon')).toBeTruthy();
  });
});
```

Note on the `'check mark button'` assertion: that is the `name` for ✅ in `unicode-emoji-json`. If the dataset returns a different exact string, update the expected value to the dataset's actual name (read it once via `emojiName('✅')` output in the failing run) — the skin-tone and null cases are the load-bearing assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/emojiIcons.test.tsx --maxWorkers=2`
Expected: FAIL — `emojiName` is not exported; no `title`; no `.sai-emoji-jumbo`.

- [ ] **Step 3: Add `emojiName` and the `title`**

In `src/components/Chat/emojiIcons.tsx`, immediately after `fluentEmojiUrl` (ends ~line 318), add:

```tsx
/** The emoji's human-readable name (e.g. "party popper"), skin-tone-tolerant. */
export function emojiName(emoji: string): string | null {
  const entry = EMOJI_DATA[emoji] ?? EMOJI_DATA[emoji.replace(SKIN_TONE_RANGE, '')];
  return entry ? entry.name : null;
}
```

Then update `EmojiIcon` (around line 330) to compute and apply the title:

```tsx
export function EmojiIcon({ emoji }: { emoji: string }): React.ReactElement {
  const title = emojiName(emoji) ?? emoji;
  const Icon = lookupIcon(emoji);
  if (Icon) {
    return <Icon className="sai-emoji-icon" strokeWidth={2.25} aria-label={emoji} title={title} />;
  }
  const url = fluentEmojiUrl(emoji);
  if (url) {
    return (
      <span
        role="img"
        aria-label={emoji}
        title={title}
        className="sai-emoji-mask"
        style={{ WebkitMaskImage: `url(${url})`, maskImage: `url(${url})` }}
      />
    );
  }
  return <>{emoji}</>;
}
```

(Electron is Chromium, where a `title` attribute on the lucide `<svg>` and on the mask `<span>` both produce a native hover tooltip.)

- [ ] **Step 4: Add the per-block jumbo pass to the rehype plugin**

Replace the contents of `src/components/Chat/rehypeEmojiIcons.ts` with (adds the `Element` type import, a `JUMBO_BLOCKS` set + `isEmojiSpan` helper, and a second `visit` after the emoji-wrapping pass):

```ts
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/emojiIcons.test.tsx --maxWorkers=2`
Expected: PASS (all old + new cases). If the `'check mark button'` assertion fails, replace it with the dataset's actual `emojiName('✅')` value and re-run.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/emojiIcons.tsx src/components/Chat/rehypeEmojiIcons.ts tests/unit/components/Chat/emojiIcons.test.tsx
git commit -m "feat(chat): emoji name tooltip + per-block jumbo marking"
```

---

## Task 2: Sizing CSS (inline bump + jumbo) on both surfaces

**Files:**
- Modify: `src/styles/globals.css`, `src/renderer-remote/styles.css`

- [ ] **Step 1: Update `src/styles/globals.css`**

In the `.sai-emoji-icon` and `.sai-emoji-mask` rules (around lines 241-262), change both `width: 1.1em; height: 1.1em;` to `width: 1.3em; height: 1.3em;`. Then, immediately after the `.sai-emoji-mask { … }` rule, add:

```css
.sai-emoji-jumbo .sai-emoji-icon,
.sai-emoji-jumbo .sai-emoji-mask {
  width: 2.2em;
  height: 2.2em;
  vertical-align: -0.35em;
}
```

- [ ] **Step 2: Update `src/renderer-remote/styles.css`**

Apply the exact same edits to the `.sai-emoji-icon`/`.sai-emoji-mask` rules (around lines 7-28): `1.1em` → `1.3em` for both width/height, and append the same `.sai-emoji-jumbo …` rule after them.

- [ ] **Step 3: Full verification**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual smoke (if running the app)**

Have the AI send a reply that is just emoji on its own line (e.g. `🎉✅`) → renders large; an inline `done ✅` → slightly bigger than before but in-line; hover an icon → tooltip shows the emoji's name. Check the remote/PWA chat too.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css src/renderer-remote/styles.css
git commit -m "style(chat): bump inline emoji size; jumbo emoji-only blocks"
```

---

## Self-Review Notes

- **Spec coverage:** inline 1.3em + jumbo 2.2em CSS → Task 2; per-block jumbo marking → Task 1 Step 4; `emojiName` + `title` tooltip → Task 1 Steps 3; tests → Task 1 Step 1; both surfaces (CSS in both files; plugin shared) → Tasks 1-2. ✅
- **No placeholders:** all code shown in full; the one dataset-name assertion has an explicit fallback instruction. ✅
- **Type consistency:** `emojiName`, `EmojiIcon` title, `JUMBO_BLOCKS`/`isEmojiSpan`, class `sai-emoji-jumbo` consistent across tasks. ✅
- **Correctness:** the jumbo `visit('element')` runs after the emoji-wrapping `visit('text')` completes (two sequential visits on the same tree); nested blocks resolve to the innermost emoji-only block (an outer block with a child element is disqualified). ✅
- **Machine constraint:** vitest `--maxWorkers=2`.
