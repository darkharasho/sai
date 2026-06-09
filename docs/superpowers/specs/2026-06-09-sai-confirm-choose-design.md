# SAI `confirm` / `choose` — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm) — pending implementation plan
**Builds on:** `2026-06-09-sai-render-form-design.md` (the bidirectional `formBridge` channel)

## Summary

Two convenience tools that let the agent ask a quick decision without authoring
form HTML: `confirm` (yes/no) and `choose` (pick one of N options). Both
auto-generate the form HTML and ride the shipped `render_form` machinery —
`formBridge` blocking, the `kind:'form'` card, and the sandboxed `saiSubmit`
bridge — so the result comes back the same way (`{ ok:true, value }`).

## Goals

- `confirm({ message })` → renders message + confirm/cancel buttons → returns
  `{ ok:true, value: true|false }`.
- `choose({ message, options })` → renders message + one button per option →
  returns `{ ok:true, value: <chosen option string> }`.
- Reuse `render_form`'s blocking/timeout/submit machinery — no new channel.

## Non-Goals

- Multi-select `choose` (single choice only; v1).
- Custom per-option values for `choose` (the option string is its value).
- A distinct render kind — these are `kind:'form'` with generated HTML.

## Background / Current State (verified — all shipped)

- `render_form` blocks via `registerPendingForm` (`src/render/formBridge.ts`),
  renders an interactive form in the chat card (`kind:'form'`), and resolves when
  the iframe calls `window.saiSubmit(value)` → `submitForm(value)`.
- `entryFromToolCall` (`RenderToolCallCard.tsx`) builds the `kind:'form'` entry
  from the tool input; `RenderRegion` renders it with `enableSubmit`.
- `App.tsx` `onSwarmToolRequest` has a `render_form` branch that awaits
  `registerPendingForm(formTimeoutMs(input))` and responds with the result; the
  `renderToolCall` guard includes `sai_render_form`.
- The form e2e (`render-tool-call-card.spec.ts`, `kind:'form'`) clicks an
  in-iframe button and asserts the resolved value — the harness pattern these
  tools reuse.

## Architecture

`confirm`/`choose` are `render_form` with **generated** HTML:

```
agent → confirm/choose  (MCP)
  → App.tsx onSwarmToolRequest: (render_form || confirm || choose) branch
       → registerPendingForm(formTimeoutMs(input))  // BLOCKS, identical to render_form
       → respondSwarmTool(req.id, result)
  chat card: entryFromToolCall builds HTML via buildChoiceHtml → kind:'form'
       → RenderedHtml (+ saiSubmit bridge) → user clicks → submitForm(value)
```

## Components

### 1. `src/render/buildChoiceHtml.ts` (new, pure)
```ts
export interface Choice { label: string; value: unknown }
export function buildChoiceHtml(input: { message: string; choices: Choice[] }): string
```
- Throws if `choices` is empty.
- Output: an escaped `<div>` for `message`, a row of `<button>`s each with the
  choice's value JSON-encoded in a `data-sai-value` attribute (attribute-escaped),
  and a `<script>` that wires every `[data-sai-value]` button to
  `saiSubmit(JSON.parse(el.getAttribute('data-sai-value')))`. CSP-safe
  (`addEventListener`, not inline `onclick`).
- HTML-escapes `message` and each `label`; JSON-encodes + attribute-escapes each
  `value` (so a string option, a boolean, etc. round-trip).

### 2. `entryFromToolCall` branches (`RenderToolCallCard.tsx`)
- `sai_confirm`: require a `message` string (else null). Build
  `buildChoiceHtml({ message, choices: [{label: confirmLabel||'Confirm', value:true}, {label: cancelLabel||'Cancel', value:false}] })`
  → `kind:'form'` entry; code pane shows the message.
- `sai_choose`: require `message` string and a non-empty `options` string[] (else
  null). Build `choices = options.map(o => ({ label:o, value:o }))` →
  `buildChoiceHtml(...)` → `kind:'form'` entry.
- Both produce `kind:'form'`, so `RenderRegion` renders them with `enableSubmit`
  (the submit bridge) exactly like `render_form`.

### 3. `App.tsx` — extend the blocking branch + guard
- Change the `render_form` branch condition to
  `req.tool === 'render_form' || req.tool === 'confirm' || req.tool === 'choose'`
  (identical `registerPendingForm`/respond body; `formTimeoutMs(req.input)` works
  for all — confirm/choose may omit `timeoutMs` → default).
- Add `sai_confirm`/`sai_choose` to the `renderToolCall` card guard.

### 4. Schemas (`src/lib/saiTools.ts`)
- `confirm` — toolset 'chat', `required:['message']`, properties
  `{ message, confirmLabel, cancelLabel, timeoutMs }`.
- `choose` — toolset 'chat', `required:['message','options']`, properties
  `{ message, options: string[], timeoutMs }`.

## Error Handling

- `choose` with empty/missing `options` → `entryFromToolCall` returns null (no
  card); the agent's blocked call resolves via `formBridge` timeout
  (`{ ok:false, dismissed:true }`). (`buildChoiceHtml` also throws on empty
  choices as a guard, but the null-return prevents reaching it.)
- `confirm`/`choose` with no `message` → null (no card), same timeout path.
- Timeout / no click → `{ ok:false, dismissed:true, error:'form timed out' }`
  (inherited from `render_form`).
- Double-click → guarded by the existing `submittedRef` in `RenderedHtml`.

## Security

- No new capability beyond `render_form`'s `saiSubmit` bridge. The generated HTML
  is SAI-authored (not model-authored), runs under the existing strict CSP in the
  `allow-scripts`-only sandbox. `message`/`label` are HTML-escaped; `value` is
  JSON-encoded — no injection from the agent's strings.

## Testing

- **Unit (`buildChoiceHtml.test.ts`):** message escaped; one `<button>` per
  choice; each value JSON-encoded in `data-sai-value`; the wiring `<script>`
  present; throws on empty choices; a `"` in a label/message is escaped.
- **Unit (`renderToolCallCard.entry.test.ts`):** `sai_confirm` → `kind:'form'`
  with two buttons; `sai_choose` → `kind:'form'` with N buttons; `choose` with
  no options → null; missing message → null.
- **Unit (`saiTools.test.ts`):** the two schema entries.
- **E2e (harness):** a `kind:'confirm'` story (reusing the `FormStory` wrapper)
  clicks the Confirm button and asserts the resolved value is `true`.

## Key Files

| Area | Files |
|------|-------|
| HTML generator | `src/render/buildChoiceHtml.ts` (new) |
| Card redisplay | `src/components/Chat/RenderToolCallCard.tsx` |
| Blocking branch + guard | `src/App.tsx` |
| Schemas | `src/lib/saiTools.ts` |
| Story + e2e | `src/test-harness/stories/render-tool-call-card.tsx`, `tests/e2e/render-tool-call-card.spec.ts` |

## Open Questions / Future Work

- Multi-select `choose` (return an array) — later if needed.
- Richer styling/theming of the generated buttons (v1 is plain, app-surface
  styled).
