# Emoji → SVG Icons in AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace emoji in assistant chat responses with SVG icons painted in SAI's accent color — curated emoji → Lucide icons, the rest → Fluent High-Contrast SVG via the Iconify CDN — across the main chat and the remote renderer.

**Architecture:** Port otto's emoji map + rehype plugin into one shared SAI module (`emojiIcons.tsx` + `rehypeEmojiIcons.ts`). The plugin rewrites emoji into `<span class="sai-emoji" data-emoji>` markers; a shared `renderEmojiSpan` markdown component draws a Lucide icon (mapped) or a CSS-masked Fluent SVG (unmapped), both `var(--accent)`. Wired into assistant rendering only.

**Tech Stack:** React + TypeScript, react-markdown, lucide-react, emoji-regex, unicode-emoji-json, unist-util-visit, Vitest.

**Reference (sibling repo, read-only):** `/var/home/mstephens/Documents/GitHub/otto/src/renderer/components/emoji-icons.ts` and `.../rehype-emoji-icons.ts` — copy the map + helpers verbatim from here.

---

## File Structure

- **Create** `src/components/Chat/emojiIcons.tsx` — the `EMOJI_TO_ICON` map (verbatim from otto) + `makeEmojiRegex`, `fluentEmojiSlug`, `fluentEmojiUrl`, `lookupIcon`, the `EmojiIcon` component, and `renderEmojiSpan`. One responsibility: all emoji→icon knowledge + rendering.
- **Create** `src/components/Chat/rehypeEmojiIcons.ts` — the rehype plugin (verbatim from otto, class renamed).
- **Create** `tests/unit/components/Chat/emojiIcons.test.tsx`.
- **Modify** `src/components/Chat/ChatMessage.tsx` — assistant rehype set + `span` component + CSS.
- **Modify** `src/styles/globals.css` — `.sai-emoji-*` rules (main renderer).
- **Modify** `src/renderer-remote/chat/Transcript.tsx` — rehype plugin + `span` in `mdComponents`.
- **Modify** the remote renderer's global stylesheet — `.sai-emoji-*` rules.

---

## Task 1: Shared emoji module + rehype plugin

**Files:**
- Create: `src/components/Chat/emojiIcons.tsx`, `src/components/Chat/rehypeEmojiIcons.ts`
- Test: `tests/unit/components/Chat/emojiIcons.test.tsx`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install emoji-regex unicode-emoji-json unist-util-visit
npm install -D @types/hast
```
Expected: installs without error; `package.json` gains the four deps.

- [ ] **Step 2: Create `emojiIcons.tsx` — copy otto's map + helpers, add SAI renderer**

Copy the **entire** contents of `/var/home/mstephens/Documents/GitHub/otto/src/renderer/components/emoji-icons.ts` into a new file `src/components/Chat/emojiIcons.tsx` (note `.tsx`). That gives you: the lucide imports, `EMOJI_TO_ICON` (~148 entries), `makeEmojiRegex()`, `SKIN_TONE_RANGE`, `fluentEmojiSlug()`, `fluentEmojiUrl()`, and `import emojiData from 'unicode-emoji-json/data-by-emoji.json'`.

Then append the SAI-specific additions to the bottom of the file:

```tsx
import React from 'react';

/** Map an emoji to its Lucide icon, retrying with skin-tone modifiers stripped
 *  (👍🏽 → 👍) since the map is keyed by base emoji. */
export function lookupIcon(emoji: string): LucideIcon | undefined {
  return EMOJI_TO_ICON[emoji] ?? EMOJI_TO_ICON[emoji.replace(SKIN_TONE_RANGE, '')];
}

/** Render one emoji as an accent-colored SVG: a Lucide icon when mapped, else a
 *  CSS-masked Fluent High-Contrast SVG, else the raw emoji text (unknown grapheme). */
export function EmojiIcon({ emoji }: { emoji: string }): React.ReactElement {
  const Icon = lookupIcon(emoji);
  if (Icon) {
    return <Icon className="sai-emoji-icon" strokeWidth={2.25} aria-label={emoji} />;
  }
  const url = fluentEmojiUrl(emoji);
  if (url) {
    return (
      <span
        role="img"
        aria-label={emoji}
        className="sai-emoji-mask"
        style={{ WebkitMaskImage: `url(${url})`, maskImage: `url(${url})` }}
      />
    );
  }
  return <>{emoji}</>;
}

/** react-markdown `span` component override: render `.sai-emoji` markers via EmojiIcon,
 *  pass everything else through as a normal span. */
export function renderEmojiSpan(props: any): React.ReactElement {
  const { node, className, ...rest } = props;
  const classes = Array.isArray(className)
    ? className
    : typeof className === 'string' ? className.split(/\s+/) : [];
  if (classes.includes('sai-emoji')) {
    const emoji = props['data-emoji'];
    if (typeof emoji === 'string' && emoji.length > 0) return <EmojiIcon emoji={emoji} />;
  }
  return <span className={className} {...rest} />;
}
```

Note: `React` import is needed for JSX in a `.tsx` that the project's config may require; if the project uses the automatic JSX runtime and ESLint complains about an unused `React`, drop the `import React` line and type the components' return as `JSX.Element`. Verify with tsc in Step 5.

- [ ] **Step 3: Create `rehypeEmojiIcons.ts` — copy otto's plugin, rename the class**

Copy `/var/home/mstephens/Documents/GitHub/otto/src/renderer/components/rehype-emoji-icons.ts` into `src/components/Chat/rehypeEmojiIcons.ts`, changing two things: import `makeEmojiRegex` from `'./emojiIcons'`, and rename the marker class `'otto-emoji'` → `'sai-emoji'`. The result:

```ts
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, ElementContent } from 'hast';
import { makeEmojiRegex } from './emojiIcons';

// Walks HAST text nodes and replaces every emoji grapheme with a marker
// <span class="sai-emoji" data-emoji="…" />. The React renderer (renderEmojiSpan)
// decides whether to draw a Lucide icon (mapped) or a Fluent SVG (unmapped).
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
  };
}
```

- [ ] **Step 4: Write the tests**

Create `tests/unit/components/Chat/emojiIcons.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { rehypeEmojiIcons } from '../../../../src/components/Chat/rehypeEmojiIcons';
import { renderEmojiSpan, lookupIcon, fluentEmojiSlug } from '../../../../src/components/Chat/emojiIcons';

const components = { span: renderEmojiSpan } as any;
function renderMd(text: string) {
  return render(
    <ReactMarkdown rehypePlugins={[rehypeEmojiIcons]} components={components}>{text}</ReactMarkdown>
  );
}

describe('emoji rendering', () => {
  it('renders a mapped emoji (✅) as an accent lucide icon, preserving text', () => {
    const { container } = renderMd('done ✅ here');
    expect(container.querySelector('.sai-emoji-icon')).toBeTruthy();
    expect(container.textContent).toContain('done');
    expect(container.textContent).toContain('here');
  });

  it('renders an unmapped emoji (😂) as a fluent mask span with the iconify url', () => {
    const { container } = renderMd('lol 😂');
    const mask = container.querySelector('.sai-emoji-mask');
    expect(mask).toBeTruthy();
    expect(mask!.getAttribute('style') || '').toContain('fluent-emoji-high-contrast/face-with-tears-of-joy');
  });

  it('converts an emoji nested inside bold markdown', () => {
    const { container } = renderMd('**ok ✅**');
    expect(container.querySelector('strong .sai-emoji-icon')).toBeTruthy();
  });

  it('leaves non-emoji text untouched', () => {
    const { container } = renderMd('just text');
    expect(container.querySelector('.sai-emoji-icon, .sai-emoji-mask')).toBeNull();
    expect(container.textContent).toBe('just text');
  });
});

describe('lookupIcon / fluentEmojiSlug', () => {
  it('resolves a mapped base emoji', () => {
    expect(lookupIcon('✅')).toBeTruthy();
  });
  it('strips skin tone before lookup (👍🏽 → 👍)', () => {
    expect(lookupIcon('👍')).toBeTruthy();
    expect(lookupIcon('👍🏽')).toBe(lookupIcon('👍'));
  });
  it('returns the kebab fluent slug for an unmapped emoji', () => {
    expect(fluentEmojiSlug('😂')).toBe('face-with-tears-of-joy');
  });
  it('returns undefined/null for a non-emoji', () => {
    expect(lookupIcon('x')).toBeUndefined();
    expect(fluentEmojiSlug('x')).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat/emojiIcons.test.tsx --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean. **If tsc reports an unknown export from `lucide-react`** (an icon name in otto's map that SAI's lucide-react version doesn't have), replace that import with the nearest existing icon (e.g. `CheckCircle2` → `CheckCircle`) and update the corresponding `EMOJI_TO_ICON` value. Re-run until clean. Also resolve any `data-by-emoji.json` import error by ensuring `resolveJsonModule` is on (it is for this project) — if not, add `import emojiData from 'unicode-emoji-json/data-by-emoji.json' assert { type: 'json' }` or the project's existing JSON-import pattern.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/Chat/emojiIcons.tsx src/components/Chat/rehypeEmojiIcons.ts tests/unit/components/Chat/emojiIcons.test.tsx
git commit -m "feat(chat): add emoji->SVG icon module + rehype plugin (ported from otto)"
```

---

## Task 2: Wire into the main chat (ChatMessage)

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx`
- Modify: `src/styles/globals.css`
- Test: `tests/unit/components/Chat/ChatMessage.test.tsx` (regression only — should stay green)

- [ ] **Step 1: Import the plugin + span renderer**

In `src/components/Chat/ChatMessage.tsx`, after the existing markdown imports (near the `rehypeFilePaths`/`remarkGfm` imports at the top), add:

```tsx
import { rehypeEmojiIcons } from './rehypeEmojiIcons';
import { renderEmojiSpan } from './emojiIcons';
```

- [ ] **Step 2: Add an assistant-only plugin set**

Find the `MD_PLUGINS` definition (around line 33):

```tsx
const MD_PLUGINS = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeHighlight, rehypeFilePaths],
  urlTransform: (url: string) =>
    url.startsWith('sai-file://') ? url : defaultUrlTransform(url),
};
```

Immediately after it, add:

```tsx
// Assistant messages also convert emoji to accent-colored SVG icons. User messages
// keep MD_PLUGINS (no conversion) so typed emoji are left as-is.
const ASSISTANT_MD_PLUGINS = {
  ...MD_PLUGINS,
  rehypePlugins: [rehypeHighlight, rehypeFilePaths, rehypeEmojiIcons],
};
```

- [ ] **Step 3: Add the `span` handler to `markdownComponents`**

In the `markdownComponents` `useMemo` (around line 751), add a `span` entry alongside `pre` and `a`:

```tsx
    span: (props: any) => renderEmojiSpan(props),
```

(The handler only transforms `.sai-emoji` markers — which exist only in assistant content — and passes every other span through unchanged, so this is inert for user messages.)

- [ ] **Step 4: Use `ASSISTANT_MD_PLUGINS` for assistant rendering**

Assistant content is rendered in two places. Update both to spread `ASSISTANT_MD_PLUGINS` instead of `MD_PLUGINS`:

1. Inside `StreamingAssistantHead` children (around line 803):
   change `<ReactMarkdown {...MD_PLUGINS} components={markdownComponents}>` to
   `<ReactMarkdown {...ASSISTANT_MD_PLUGINS} components={markdownComponents}>`.

2. The non-morph assistant branch (around line 825): this same `mdRef`/`chat-msg-md`
   block renders BOTH user and assistant (it's inside the `!useMorphHead && message.content && !isAssistantStreaming` branch which fires for any role). Make the plugin set role-conditional so only assistant messages get emoji conversion. Change:

```tsx
              <ReactMarkdown {...MD_PLUGINS} components={markdownComponents}>{(() => {
```
to:
```tsx
              <ReactMarkdown {...(message.role === 'assistant' ? ASSISTANT_MD_PLUGINS : MD_PLUGINS)} components={markdownComponents}>{(() => {
```

- [ ] **Step 5: Add the CSS**

In `src/styles/globals.css`, add (near the other chat/emoji-ish rules, or at the end):

```css
.sai-emoji-icon {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
  margin: 0 0.1em;
  color: var(--accent);
}
.sai-emoji-mask {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
  margin: 0 0.1em;
  background-color: var(--accent);
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
Expected: PASS (existing ChatMessage tests stay green; emoji tests pass).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx src/styles/globals.css
git commit -m "feat(chat): render emoji as accent SVG icons in assistant messages"
```

---

## Task 3: Wire into the remote renderer (Transcript)

**Files:**
- Modify: `src/renderer-remote/chat/Transcript.tsx`
- Modify: the remote renderer's global stylesheet

- [ ] **Step 1: Find the remote stylesheet**

Run: `grep -rn "import.*\.css" src/renderer-remote/*.tsx src/renderer-remote/**/*.tsx 2>/dev/null | head`
Identify the CSS file the remote entry imports (e.g. `src/renderer-remote/index.css` or a `globals.css`). Call it `<REMOTE_CSS>`.

- [ ] **Step 2: Add the CSS to `<REMOTE_CSS>`**

Append the same two rules as Task 2 Step 5 (`.sai-emoji-icon` and `.sai-emoji-mask`) to `<REMOTE_CSS>`. (They reference `var(--accent)`, which the remote theme also defines.)

- [ ] **Step 3: Import the plugin + span renderer in Transcript**

In `src/renderer-remote/chat/Transcript.tsx`, after the existing imports (it imports `ReactMarkdown` and `remarkGfm` already), add:

```tsx
import { rehypeEmojiIcons } from '../../components/Chat/rehypeEmojiIcons';
import { renderEmojiSpan } from '../../components/Chat/emojiIcons';
```

(Both renderer bundles live under `src/`, so importing the shared module across folders is fine.)

- [ ] **Step 4: Add `span` to `mdComponents`**

In the module-level `mdComponents` object (around line 13), add a `span` entry:

```tsx
  span: (props: any) => renderEmojiSpan(props),
```

- [ ] **Step 5: Add the rehype plugin to the assistant render**

The assistant branch renders markdown at line 235 (the `: (` branch of `isUser ? <pre> : <ReactMarkdown>`), so it is already assistant-only. Change:

```tsx
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
```
to:
```tsx
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeEmojiIcons]} components={mdComponents}>
```

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer-remote/chat/Transcript.tsx <REMOTE_CSS>
git commit -m "feat(remote): render emoji as accent SVG icons in assistant messages"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Manual smoke (if running the app)**

Ask the AI something that elicits emoji (e.g. a checklist). Confirm: mapped emoji (✅, 🚀, ⚠️) render as gold Lucide icons inline with text; an uncommon emoji (😂) renders as a gold Fluent SVG; user-typed emoji in your own message stay as native emoji; the same holds in the remote/PWA chat.

- [ ] **Step 3: Final commit (empty if nothing to add)**

```bash
git add -A
git commit -m "test(chat): verify emoji SVG icon rendering" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** shared module (map + helpers + EmojiIcon + renderEmojiSpan) → Task 1; rehype plugin → Task 1; uniform accent CSS → Task 2/3; CDN Fluent fallback → Task 1 (`fluentEmojiUrl`) + `EmojiIcon`; assistant-only across main + remote → Task 2/3; deps → Task 1. ✅
- **No placeholders:** the large `EMOJI_TO_ICON` map is "copy verbatim from otto's file" (a concrete, existing source), not a TODO; all new code shown in full. ✅
- **Type consistency:** `rehypeEmojiIcons`, `makeEmojiRegex`, `fluentEmojiSlug`/`fluentEmojiUrl`, `lookupIcon`, `EmojiIcon`, `renderEmojiSpan`, `ASSISTANT_MD_PLUGINS`, class `sai-emoji`/`sai-emoji-icon`/`sai-emoji-mask` — consistent across tasks. ✅
- **Risk flagged:** lucide-react icon-name drift between otto and SAI is caught by tsc (Task 1 Step 5) with a remediation note. ✅
- **Machine constraint:** vitest `--maxWorkers=2`.
