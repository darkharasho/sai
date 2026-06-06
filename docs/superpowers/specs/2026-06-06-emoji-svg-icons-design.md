# Emoji → SVG icons in AI chat (ported from otto)

## Problem

Assistant chat responses render raw emoji (✅, 🚀, ⚠️…), which clash with SAI's
restrained, monochrome papery aesthetic. otto already solved this: it replaces emoji
with crisp SVG icons painted in the app's accent color. We want the same in SAI, in
SAI's palette.

## Goal

In assistant chat messages, replace every emoji with an SVG icon painted in SAI's
accent color: curated emoji become matching **Lucide** icons; everything else falls
back to a **Microsoft Fluent "High Contrast"** SVG served from the Iconify CDN, masked
to the accent color. Applies across SAI's chat surfaces (main desktop chat + the remote
renderer). Ported from otto, adapted to SAI's coloring.

## Decisions

- **Coloring:** uniform — all icons painted with `var(--accent)` (SAI gold).
- **Unmapped emoji:** keep otto's behavior — Fluent SVG via the Iconify CDN
  (`https://api.iconify.design/fluent-emoji-high-contrast/{slug}.svg`), masked to accent.
  100% coverage; a runtime network fetch (renders nothing if offline, like otto).
- **Scope:** assistant messages only; both the main desktop chat and the in-app remote
  renderer (the two surfaces, matching otto's renderer + renderer-remote). User messages
  and the separate `sai-mobile` PWA are out of scope (follow-up).

## New dependencies

`emoji-regex@^10`, `unicode-emoji-json@^0.9`, `unist-util-visit@^5`, `@types/hast@^3`.
Already present: `lucide-react`, `react-markdown`, `remark-gfm`, `rehype-*`.

## Design

### Unit 1 — `src/components/Chat/emojiIcons.tsx` (shared data + helpers + renderer)

Ported from otto's `emoji-icons.ts`, plus a shared React renderer so both surfaces reuse
one implementation (otto duplicated it; we won't).

- `EMOJI_TO_ICON: Record<string, LucideIcon>` — copy otto's ~148-entry map **verbatim**
  (otto `src/renderer/components/emoji-icons.ts` lines ~106-276) with its lucide imports.
- `makeEmojiRegex(): RegExp` → `emojiRegex()` (from `emoji-regex`).
- `SKIN_TONE_RANGE`, `fluentEmojiSlug(emoji)`, `fluentEmojiUrl(emoji)` — copy verbatim
  (otto lines 285-318), using `unicode-emoji-json/data-by-emoji.json`.
- `lookupIcon(emoji): LucideIcon | undefined` — `EMOJI_TO_ICON[emoji]` with a skin-tone-
  stripped retry (so 👍🏽 resolves to the 👍 icon), mirroring `fluentEmojiSlug`'s fallback.
- `EmojiIcon({ emoji }: { emoji: string })` — the shared renderer:
  - mapped (`lookupIcon`) → `<Icon className="sai-emoji-icon" strokeWidth={2.25} aria-label={emoji} />`
  - else if `fluentEmojiUrl(emoji)` → `<span role="img" aria-label={emoji} className="sai-emoji-mask" style={{ WebkitMaskImage: url, maskImage: url }} />`
  - else → render the raw `emoji` text (last-resort, e.g. offline + unmapped).

What it does: own all emoji→icon knowledge and rendering. Depends on: lucide-react,
emoji-regex, unicode-emoji-json. No app-specific tokens.

### Unit 2 — `src/components/Chat/rehypeEmojiIcons.ts` (rehype plugin)

Copy otto's `rehype-emoji-icons.ts` verbatim, renaming the marker class `otto-emoji` →
`sai-emoji`. Walks HAST text nodes; replaces **every** emoji grapheme with
`<span class="sai-emoji" data-emoji="…">`. Depends on `unist-util-visit`, `@types/hast`,
and `makeEmojiRegex` from Unit 1.

### Unit 3 — `span` markdown-component handler (shared)

A small helper used in both surfaces' `components.span`: when the span's className
includes `sai-emoji`, read `data-emoji` and render `<EmojiIcon emoji={…} />`; otherwise
fall through to a normal `<span {...props} />`. Provided from Unit 1 (e.g.
`renderEmojiSpan(props)` returning the EmojiIcon or null-for-default) so both call sites
share one branch.

### Unit 4 — wiring

- **Main chat (`src/components/Chat/ChatMessage.tsx`):** add an assistant-only rehype set
  `ASSISTANT_MD_PLUGINS = { ...MD_PLUGINS, rehypePlugins: [rehypeHighlight, rehypeFilePaths, rehypeEmojiIcons] }`,
  used where assistant content renders: the `StreamingAssistantHead` children (the morph
  head) **and** the non-morph assistant branch. User-message rendering keeps the existing
  `MD_PLUGINS` (no emoji conversion). Add the `sai-emoji` case to `markdownComponents`
  (a `span` handler). Because the rehype plugin runs only on assistant content, the span
  handler is inert for user messages.
- **Remote renderer (`src/renderer-remote/chat/Transcript.tsx:235`):** add
  `rehypePlugins={[rehypeEmojiIcons]}` to the assistant render path and the `sai-emoji`
  `span` case to `mdComponents`. (Scope to assistant rows as that file already
  distinguishes role.)

### Unit 5 — styling (SAI coloring)

Add to the chat CSS (e.g. ChatMessage's `<style>` and the remote renderer's CSS):

```css
.sai-emoji-icon {
  display: inline-block;
  width: 1.1em; height: 1.1em;
  vertical-align: -0.2em;
  margin: 0 0.1em;
  color: var(--accent);
}
.sai-emoji-mask {
  display: inline-block;
  width: 1.1em; height: 1.1em;
  vertical-align: -0.2em;
  margin: 0 0.1em;
  background-color: var(--accent);
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
}
```

Sizing is em-relative (scales with text); color is `var(--accent)` for both tiers, giving
the uniform SAI-accent look.

## Data flow

assistant markdown string → `ReactMarkdown` (assistant rehype set incl. `rehypeEmojiIcons`)
→ HAST emoji graphemes become `<span class="sai-emoji" data-emoji>` → `markdownComponents.span`
→ `<EmojiIcon emoji>` → Lucide icon (mapped) or Fluent mask `<span>` (unmapped), both `var(--accent)`.

## Error handling

- The rehype plugin tolerates non-emoji text (regex no-match → node untouched).
- `lookupIcon`/`fluentEmojiUrl` return undefined/null for unknown graphemes → `EmojiIcon`
  renders the raw emoji text (never throws, never blank for a truly unknown grapheme).
- Offline: the Fluent mask `<span>` simply shows nothing (mask image fails to load) — same
  as otto; the layout box is em-sized so text doesn't jump.

## Testing

Port otto's `rehype-emoji-icons.test.tsx` adapted to SAI (`tests/unit/components/Chat/emojiIcons.test.tsx`):

- `rehypeEmojiIcons` via `ReactMarkdown`: a mapped emoji (✅) → a `.sai-emoji` span/icon;
  surrounding text preserved; multiple emoji; emoji inside bold/markdown still converts.
- Unmapped emoji (e.g. 😂) → the Fluent mask span whose mask URL contains
  `fluent-emoji-high-contrast/face-with-tears-of-joy`.
- `fluentEmojiSlug('😂')` → `face-with-tears-of-joy`; skin-tone strip: `lookupIcon('👍🏽')`
  resolves the 👍 icon; `fluentEmojiSlug('👍🏽')` resolves the base slug.
- A mapped emoji renders a lucide `<svg>` carrying the `sai-emoji-icon` class (accent).
- Unknown/non-data grapheme → `EmojiIcon` renders the raw text (no throw).

Run with `vitest --maxWorkers=2`.

## Rollout / risk

Additive; assistant-only, so user input is untouched. The only runtime external dependency
is the Iconify CDN for unmapped emoji (accepted per the decision; degrades to blank
offline, exactly like otto). New deps are small and well-scoped. Mapped emoji (the common
ones) work fully offline via bundled Lucide icons.
