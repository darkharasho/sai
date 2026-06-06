# Emoji icon sizing (Discord-style jumbo) + name tooltip

## Problem

The emoji→SVG icons (just shipped) render at a fixed `1.1em` inline size. The user wants
(1) a slightly larger inline size, (2) Discord-style "jumbo" sizing when emoji stand alone
on a line, and (3) a hover tooltip naming the original emoji (since the icon replaces the
glyph, you can't tell what it was).

## Goal

- Bump the inline emoji-icon size a little.
- Render emoji **jumbo** when they're the only content on a line (in markdown terms, a
  block whose content is nothing but emoji).
- Show the emoji's human name as a native hover tooltip on each icon.

## Decisions

- **Inline size:** `1.1em` → **`1.3em`**.
- **Jumbo trigger:** per-line, realized as **per-block** — a `p`/`li`/`h1`–`h6` element whose
  children are exclusively emoji-icon spans and whitespace (≥1 emoji) renders its emoji at
  **`2.2em`**. Markdown collapses soft line breaks, so the block is the practical "line";
  mixed-content blocks keep the inline size. (This naturally handles "one line is emoji-only
  while other lines have text.")
- **Tooltip:** native `title` attribute = the emoji's name from `unicode-emoji-json`
  (e.g. "party popper"), skin-tone-tolerant, falling back to the raw emoji.
- Applies to both surfaces (main chat + remote), assistant-only — inherited from the existing
  wiring; **no component changes needed**, only the plugin, the `EmojiIcon`, and the CSS.

## Design

### Unit 1 — `emojiName(emoji)` (in `src/components/Chat/emojiIcons.tsx`)

```ts
export function emojiName(emoji: string): string | null;
```
Look up `EMOJI_DATA[emoji]?.name`; retry with skin-tone stripped (reusing `SKIN_TONE_RANGE`),
like `fluentEmojiSlug`. Returns the human name or null. Pure.

### Unit 2 — `EmojiIcon` tooltip

In `EmojiIcon`, compute `const name = emojiName(emoji) ?? emoji;` and add `title={name}` to
both the Lucide `<Icon>` and the fallback mask `<span>` (alongside the existing `aria-label`).
Native browser tooltip on hover.

### Unit 3 — per-block jumbo marking (in `rehypeEmojiIcons.ts`)

After the existing text-node emoji-wrapping pass, add a second `visit(tree, 'element', …)`
pass that, for each block element in `{p, li, h1..h6}`, checks its children: if every child
is either a whitespace-only text node or an element whose className includes `sai-emoji`, and
there is at least one such emoji span, append `sai-emoji-jumbo` to that element's `className`.
(Any real text, link, code, or other element disqualifies the block.) Nested blocks resolve
to the innermost emoji-only block (an outer block containing a child element is disqualified).

This marks emoji-only blocks at the HAST level, so both surfaces get jumbo automatically via
CSS — no `ChatMessage`/`Transcript` changes.

### Unit 4 — CSS (both `src/styles/globals.css` and `src/renderer-remote/styles.css`)

Update the existing rules so the base size is `1.3em`, and add a jumbo scope:

```css
.sai-emoji-icon, .sai-emoji-mask { width: 1.3em; height: 1.3em; /* …unchanged… */ }
.sai-emoji-jumbo .sai-emoji-icon,
.sai-emoji-jumbo .sai-emoji-mask { width: 2.2em; height: 2.2em; vertical-align: -0.35em; }
```
(Keep `vertical-align`, `margin`, color/mask rules; jumbo gets a slightly deeper baseline
offset so the larger glyph sits well.)

## Testing

Extend `tests/unit/components/Chat/emojiIcons.test.tsx`:

- `emojiName('🎉')` → `'party popper'` (or the dataset's exact name — assert via the dataset,
  not a hardcoded guess if unsure); `emojiName('👍🏽')` resolves the base 👍 name;
  `emojiName('x')` → null.
- Render `🎉✅` (emoji-only paragraph) through ReactMarkdown + plugin → the `<p>` carries the
  `sai-emoji-jumbo` class.
- Render `done ✅` → the `<p>` does NOT carry `sai-emoji-jumbo` (mixed content).
- A list item that is only an emoji → its `<li>` (or inner block) carries `sai-emoji-jumbo`.
- An `EmojiIcon` renders a `title` equal to the emoji's name.

Run with `vitest --maxWorkers=2`.

## Rollout / risk

Tiny, additive. The jumbo marking is gated to emoji-only blocks, so prose is unaffected. The
larger sizes are CSS-only and easy to tune. No new dependencies.
