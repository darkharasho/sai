# Thinking Animation — Telemetry Direction

**Date:** 2026-05-03
**Component:** `src/components/ThinkingAnimation.tsx`
**Related fix landed in same session:** `src/components/Chat/ChatMessage.tsx` — assistant message bubbles now always render the SAI mark in `mode="static"`. Drift lives only inside `ThinkingAnimation`.

## Goal

Replace the current "Thinking / Pondering / Ruminating…" typewriter (lifted from Claude's UI) with a sci-fi telemetry line that feels native to SAI. The SAI logo and overall row layout stay; only the right-hand text changes.

## Visual Spec

Layout, left → right:

```
[SAI logo]  [MM:SS.s]  PHRASE█
```

- **Logo** — unchanged. `<SaiLogo mode="drift" size={18} />` when `saiAnimationEnabled` is true. Drift mode is reserved exclusively for this component (assistant message bubbles use `mode="static"`).
- **Clock** — mission-clock counter formatted `MM:SS.d` (zero-padded minutes and seconds, one decisecond digit). Starts at `00:00.0` when the component mounts, ticks at 100ms intervals, resets on unmount.
- **Phrase** — ALL-CAPS, typewriter rhythm matching the existing component (~40–70ms per char type, 1100–1800ms hold, ~22ms per char erase). Pulled randomly without immediate repeat from the vocabulary pool below.
- **Cursor** — solid block `█` immediately after the phrase, hard on/off blink at 1s using `steps(1)`. No fade.
- **No trailing `...`** — removed.

### Colors

Reuse existing CSS variables / accent color used by the current animation (typically `#c7913b`). Add one muted color for the clock prefix (~`#6b6253`).

- Phrase + cursor: accent (current behavior, can be overridden via the `color` prop)
- Clock: muted prefix color (~30–40% lighter than background; subordinate to the phrase)

### Vocabulary

Single pool of ~30 ALL-CAPS phrases, mixed flavors. Examples (final list can be tuned during implementation):

**Mission-control / NASA-flavored**

- `ESTABLISHING UPLINK`
- `TRIANGULATING`
- `CALIBRATING`
- `TRACING SIGNAL`
- `ALIGNING VECTORS`
- `MAPPING TOPOLOGY`
- `LOCKING TELEMETRY`
- `SYNCHRONIZING CLOCKS`

**Cyberpunk / netrunner**

- `JACKING IN`
- `DECRYPTING TOKENS`
- `SCRAPING CACHE`
- `BREACHING ICE`
- `SPOOFING HANDSHAKE`
- `ROUTING THROUGH PROXY`
- `BURNING CYCLES`
- `OVERCLOCKING CORE`

**Starship-computer / TNG-ish**

- `ACCESSING DATABANK`
- `CROSS-REFERENCING`
- `EXTRAPOLATING`
- `COMPUTING VECTORS`
- `RESOLVING INTENT`
- `INDEXING MEMORY`
- `COMPILING THOUGHT`
- `CONSULTING ARCHIVES`
- `PARSING SIGNAL`
- `SYNTHESIZING`

Selection: random index on mount, then `(i + 1 + floor(random()*3)) % len` after each erase (matches current non-repeating pattern).

## Component Behavior

The component already accepts `color?: string`. No new props required.

### State machine (unchanged shape)

`typing → pause → erasing → typing` with the same timings as today. Only the word source and the trailing render change.

### Rendering

```tsx
<div className="thinking-animation" style={color ? { color } : undefined}>
  {saiAnimationEnabled
    ? <SaiLogo mode="drift" size={18} className="thinking-icon" color={color || '#c7913b'} />
    : <Icon size={16} className="thinking-icon" style={color ? { color } : undefined} />}
  <span className="thinking-clock">[{clockText}]</span>
  <span className="thinking-text">
    {displayText}
    <span className="thinking-cursor thinking-cursor-block" />
  </span>
</div>
```

- `clockText` — `MM:SS.d`, updated by a 100ms `setInterval` keyed off a `mountedAt = performance.now()` ref.
- `thinking-cursor-block` — replaces the current `thinking-cursor-breathing` element. CSS rules:
  - `display: inline-block; width: 0.55em; height: 1em; background: currentColor; vertical-align: -0.15em; margin-left: 2px; animation: thinking-cursor-blink 1s steps(1) infinite;`
  - `@keyframes thinking-cursor-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }`

### `saiAnimationEnabled = false` fallback

Unchanged from today: rotating lucide spinner + Title-Case word list (`Thinking`, `Pondering`, …) + breathing bar cursor + `...`. The telemetry treatment is the SAI-native experience; users who opt out keep the current friendly fallback.

### Reduced motion (`prefers-reduced-motion: reduce`)

- Skip the typewriter — display a single fixed phrase (`THINKING`).
- Skip the clock tick — render `[--:--.-]` or omit the clock element entirely.
- Cursor renders solid (no blink).
- SAI logo `drift` already disables under reduced-motion (existing rule in `SaiLogo.css`).

## Files Changed

1. `src/components/ThinkingAnimation.tsx`
   - Replace `THINKING_WORDS` with the new mixed pool (renamed e.g. `TELEMETRY_PHRASES`, kept inside the file).
   - Add a clock state + `setInterval` (100ms) that ticks elapsed time and formats `MM:SS.d`.
   - Replace `<span className="thinking-cursor thinking-cursor-breathing">|</span>...` with `<span className="thinking-cursor thinking-cursor-block" />` and drop the trailing `...`.
   - Fallback path (when `saiAnimationEnabled === false`) is untouched.

2. `src/components/Chat/ChatPanel.tsx` — the `thinking-animation` styles live in an inline `<style>` block around line 1732. Add:
   - `.thinking-clock` — muted prefix color (`#6b6253`), monospace, `font-variant-numeric: tabular-nums`, small right margin so digit width changes don't reflow the phrase.
   - `.thinking-cursor-block` + the `thinking-cursor-blink` keyframes as described above.
   - The existing `.thinking-cursor-breathing` rule and its `thinking-cursor-breathe` keyframes can stay (used by the `saiAnimationEnabled = false` fallback path).

3. `tests/unit/components/Chat/ChatPanel.test.tsx`
   - If any assertion looks for "Thinking" / a specific Claude-style word, update it to the new phrase pool (or assert presence of the cursor / clock instead — whichever is more stable).

## Out of Scope

- No real-time data plumbing. Phrases are decorative; we are not exposing tool names, token counts, or stream phases. (Direction B was the live-status alternative; the user chose A for atmosphere.)
- No changes to assistant message bubble icons (already covered by the in-session fix to `ChatMessage.tsx`).
- No changes to other `SaiLogo` consumers (`WhatsNewModal`, `UpdateNotification`, `TitleBar`, `PluginsSidebar`, `McpSidebar`, `SearchPanel`, empty-state).

## Acceptance Criteria

- When SAI is thinking and `saiAnimationEnabled` is true, the row reads `[MM:SS.s] PHRASE█` with a live mission clock, ALL-CAPS phrases cycling, and a hard-blinking block cursor.
- The clock starts at `00:00.0` each new turn and counts up while the row is mounted.
- Phrases never repeat back-to-back.
- Trailing `...` is gone.
- Historical assistant message bubbles render a still SVG (drift only appears on the active thinking row).
- With `prefers-reduced-motion: reduce`, no animations run.
- With `saiAnimationEnabled = false`, the previous lucide-spinner fallback is unchanged.
- Existing tests pass; any test that asserted specific Claude-style wording is updated.
