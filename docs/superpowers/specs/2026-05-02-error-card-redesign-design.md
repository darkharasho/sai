# Error Card Redesign

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/ChatMessage.tsx` (error rendering branch + inline CSS), `src/components/Chat/ChatPanel.tsx` (clear-context handler wiring)

## Goal

Replace the current heavy red-on-red error card with a terminal-diagnostic
treatment that fits the SAI aesthetic. Add a two-step "Clear context"
button so the user can nuke chat history when an error indicates the
context has been poisoned.

## Layout

```
┌─────────────────────────────────────────────────────┐
│ ● ERROR · invalid_request_error          HTTP 400   │  ← status bar
├─────────────────────────────────────────────────────┤
│ › Output blocked by content filtering policy        │  ← body
│   req_id  req_011CaeanuZcbSgzbnKUNX8hP             │  ← meta
├─────────────────────────────────────────────────────┤  ← (when details open)
│ RAW RESPONSE                                  ⎘    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ { "type": "error", ... }                        │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ [ ↻ Retry ]   ⌫ Clear context   › Details           │  ← actions
└─────────────────────────────────────────────────────┘
```

## Visual specifics

**Outer container**:
- `bg: var(--bg-secondary)` (deeper than messages)
- `border: 1px solid var(--border)`, 6px radius, `overflow: hidden`
- No left-accent stripe — the status bar is the accent

**Status bar**:
- `bg: var(--bg-input)`, `border-bottom: 1px solid var(--border)`, padding `6px 12px`
- 6px red dot with `box-shadow: 0 0 6px var(--red)` glow
- Subtle pulse animation on the dot (1.4s ease-in-out, scale 1→1.15→1, sync glow softness), gated on `prefers-reduced-motion: no-preference`
- Label `ERROR · <error_type>` in `var(--red)` semibold, letter-spacing 0.06em
- HTTP status pushed right via `margin-left: auto` in `var(--text-muted)`

**Body**:
- Padding `10px 12px`
- Red `›` prompt prefix in `var(--red)`, `user-select: none`
- Message text in `var(--text)`, `white-space: pre-wrap`, `word-break: break-word` so long messages wrap

**Meta row** (only when there's metadata to show):
- Same horizontal padding as body, `margin-top: 4px`, font size 11px
- Field format: `<key> <value>` — key in `var(--text-muted)`, value in `var(--text-secondary)`, monospace
- Currently only `req_id`. If absent (e.g. some envelopes), the row doesn't render.

**Details panel** (only when expanded):
- Renders between the meta row and the actions bar
- Subsection header bar: `RAW RESPONSE` uppercase label in `var(--text-muted)`, letter-spacing 0.08em, font-size 10px, padding `4px 12px`, `border-top: 1px solid var(--border)`
- Copy button right-aligned in the header bar (existing copy icon component, fades from `var(--text-muted)` to `var(--text)` on hover)
- `<pre>` body: padding `8px 12px 10px`, `bg: var(--bg-secondary)` (same as outer), monospace, font-size 11px, `color: var(--text-secondary)`, `overflow-x: auto`, `max-height: 200px`, `overflow-y: auto`

**Actions bar**:
- `bg: var(--bg-input)`, `border-top: 1px solid var(--border)`, padding `6px 8px`, `display: flex; align-items: center; gap: 4px`

**Retry button** (primary, filled):
- `bg: var(--red)`, color `var(--bg-primary)`, font-weight 600, font-size 12px, padding `5px 12px`, 5px radius
- Hover: `bg` lightens to a slightly brighter red
- Icon: `RotateCw` size 12

**Clear-context button** (two-step):
- Idle: ghost style — no background, `color: var(--text-muted)`, font-size 11px, padding `4px 10px`, 4px radius. Hover: `color: var(--text)`, faint background.
- Confirming: `color: var(--red)`, `bg: color-mix(in srgb, var(--red) 8%, transparent)`, `border: 1px solid color-mix(in srgb, var(--red) 30%, transparent)`. Same padding/radius/font.
- Icon: `Eraser` (lucide) or fallback `Trash2`. Whichever lands cleaner — pick at implementation time.
- Behaviour: first click sets local state `confirmingClear: true`. Second click within 3s invokes `onClearContext()`. Auto-reset after 3s (cleared via `setTimeout` ref). Document-level `mousedown` listener while in confirming state cancels on outside click.
- Animation: `motion.button` with `layout` so the width transitions between the two labels. Inside, `AnimatePresence mode="popLayout"` wraps a `motion.span` keyed on `confirmingClear`, with `initial: { opacity: 0, y: 4 }`, `animate: { opacity: 1, y: 0 }`, `exit: { opacity: 0, y: -4 }`, `transition: useReducedMotionTransition(SPRING.flick)`.

**Details toggle button** (`› Details`):
- Same ghost style as the idle clear-context button
- Chevron rotates 90° when open (existing `chat-msg-error-chev` rotation pattern stays)

## Animations

- **Status dot pulse**: as described above, `prefers-reduced-motion: no-preference` only.
- **Details panel expand/collapse**: `AnimatePresence` wrapping the panel; `initial: { height: 0, opacity: 0 }` → `animate: { height: 'auto', opacity: 1 }` → `exit` reverses. `transition: useReducedMotionTransition(SPRING.gentle)`.
- **Clear-context label swap**: `flick` spring, sub-200ms.
- **Card entry**: keep existing `entryProps` (pop spring) and `chat-msg-error-pulse` outline animation — no change.

## Wiring

- ChatMessage gets a new optional prop: `onClearContext?: () => void`. When present, renders the clear-context button; when absent, hides it (e.g. in storybook or test contexts).
- ChatPanel passes `onClearContext={handleClearContext}` to error messages, where `handleClearContext` is:
  ```ts
  const handleClearContext = useCallback(() => {
    setMessages([]);
    setRenderStart(0);
    pendingComposerRectRef.current = null;
  }, [setMessages]);
  ```
  This mirrors the existing `/clear` slash command body exactly.

## Files

- Modify: `src/components/Chat/ChatMessage.tsx` — replace error JSX block + inline CSS for the error card; accept new `onClearContext` prop
- Modify: `src/components/Chat/ChatPanel.tsx` — add `handleClearContext` and pass it to error `ChatMessage` instances
- Modify: `tests/unit/components/Chat/ChatMessage.test.tsx` — extend existing error tests with new structure assertions (status bar present, retry has the right testid, clear-context two-step works) and snapshot the wiring of `onClearContext`

## Testing

Unit tests in `ChatMessage.test.tsx`:

- Error message renders the status-bar markup with `data-testid="chat-msg-error-status-bar"`, error_type label, and HTTP status text.
- Retry button (`data-testid="chat-msg-error-retry"`) calls `onRetry` when clicked.
- Clear-context button (`data-testid="chat-msg-error-clear"`) starts in idle state showing "Clear context".
- First click on clear-context button changes the visible label to "Confirm?" and does NOT call `onClearContext`.
- Second click within 3s calls `onClearContext`.
- After 3s of no second click, the button resets to "Clear context" (use `vi.useFakeTimers()` to advance the clock).
- Outside-click resets the confirming state.
- Details toggle expands/collapses the raw-response panel; copy button copies the raw envelope text.

Manual QA:

- Trigger `/fake-error` and visually confirm the status bar, body, meta, actions match the design.
- Toggle details — panel slides down with the RAW RESPONSE header + JSON.
- Click Retry — the previous user prompt is resent (existing behaviour).
- Click Clear context once — label morphs to Confirm? Click again — chat history clears.
- Click Clear context once — wait 3+ seconds — confirm reverts to "Clear context".
- Click Clear context once — click outside the button — confirm reverts.
- Toggle OS reduced-motion — status dot stops pulsing, label swap goes instant, details expand goes instant.

## Out of scope

- Changing the error parsing/data model (`parseAiError` and `looksLikeApiError` stay).
- Touching the `chat-msg-error-pulse` entry outline (already nice).
- Changing what counts as an error (still `message.error` truthy on a system message).
- Adding more action buttons beyond Retry / Clear context / Details.
- Per-provider error styling differences.
