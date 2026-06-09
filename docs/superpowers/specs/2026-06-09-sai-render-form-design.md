# SAI `render_form` — Bidirectional Input Channel — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm) — pending implementation plan
**Builds on:** `2026-06-09-sai-mcp-tools-v2-design.md` (Tier 3 keystone)

## Summary

Give the in-app chat agent a **bidirectional** render tool: `render_form` renders
an interactive form in the chat card's sandboxed iframe, **blocks** until the
user submits, and returns the submitted value to the agent. This turns SAI's
render surface from one-way (agent → screenshot) into a real human-in-the-loop
input channel — the agent can ask rich, visual questions (pick one of these
styles, drag this slider, fill these fields) instead of plain text.

## Goals

- The agent calls `render_form` with HTML; the form renders inline in the chat
  card; the user interacts and submits; the tool result is `{ ok:true, value }`.
- The tool call **blocks** until submit or timeout (no premature resolution).
- Exactly one new capability is added to the sandbox: a JSON `postMessage` of the
  submitted value to the parent (`window.saiSubmit(value)`).
- Correlation between a submit and its pending tool call is simple and isolated
  in one testable module.

## Non-Goals (v1)

- JSON-Schema validation of the returned value (`schema` input deferred; value
  passes through as-is).
- A focused modal surface (we use the inline chat card — decided in brainstorm).
- Concurrent forms (the agent blocks on each form; single-pending FIFO is
  sufficient and assumed).
- `confirm`/`choose` convenience variants (later, on this same channel).

## Background / Current State (verified)

- **Chat card iframe + parent bridge exist.** `RenderToolCard.tsx`'s
  `RenderedHtml` mounts a `sandbox="allow-scripts"` iframe with a strict CSP and
  injects `HEIGHT_REPORTER`, which `parent.postMessage`s its height; the parent
  matches on `event.source` and resizes. The submit bridge is a direct extension
  of this exact mechanism.
- **Render tools resolve immediately today.** `App.tsx` `onSwarmToolRequest`
  dispatches render tools via `handleRenderToolRequest`, which resolves after
  render (+ optional capture). `render_form` must instead hold the resolution.
- **Main hard-times-out tool calls at 60s.** `electron/main.ts` `onToolCall`
  wraps each call in `setTimeout(() => reject('timed out after 60s'), 60_000)`.
  Too short for a human filling a form — must be extended for `render_form`.
- **Result plumbing.** `electron/swarm-mcp-server.ts:140-147` serializes a result
  to a text block (`JSON.stringify(result)`), so `{ ok:true, value }` reaches the
  agent with no server change.

## Architecture

```
agent → render_form(html, timeoutMs?)  (MCP)
  → main onToolCall  ── timeout = render_form ? min(input.timeoutMs ?? 180000, 600000) : 60000
  → renderer onSwarmToolRequest (render_form branch):
       │  const result = await registerPendingForm(timeoutMs)   // BLOCKS
       │  respondSwarmTool(req.id, result)
       ▼
  chat card (built from the tool_use by entryFromToolCall, kind:'form'):
       │  RenderRegion kind:'form' → RenderedHtml (+ SUBMIT_BRIDGE injected)
       │  user clicks a control that calls window.saiSubmit(value)
       │  iframe → parent.postMessage({__saiFormSubmit:1, value})
       │  card message handler → formBridge.submitForm(value)
       ▼
  formBridge: resolve the front pending form with { ok:true, value }
       ▼
  onSwarmToolRequest resolves → agent receives { ok:true, value }
```

## Components

### 1. `src/render/formBridge.ts` (new) — correlation + timeout
Module-level FIFO of pending forms. Isolated and unit-testable; holds the only
cross-component state.

```ts
export interface FormResult { ok: boolean; value?: unknown; dismissed?: boolean; error?: string }

// Registers a pending form; returns a promise that resolves on submitForm() or
// after timeoutMs. The returned `cancel` lets a caller abandon it.
export function registerPendingForm(timeoutMs: number): { promise: Promise<FormResult>; cancel: () => void }

// Resolves the OLDEST pending form with the submitted value. No-op if none pending.
export function submitForm(value: unknown): void

// test-only reset
export function _resetForTests(): void
```
- `registerPendingForm` pushes a resolver; on `timeoutMs` it resolves
  `{ ok:false, dismissed:true, error:'form timed out' }` and drops itself.
- `submitForm` shifts the front resolver and resolves `{ ok:true, value }`;
  clears that form's timer.
- Single-pending in practice (agent blocks); FIFO handles the degenerate case.

### 2. Submit bridge in the iframe — `src/components/Chat/RenderToolCard.tsx`
A `SUBMIT_BRIDGE` script (sibling to `HEIGHT_REPORTER`) injected only for
`kind:'form'`:
```js
window.saiSubmit = function(v){ try{ parent.postMessage({__saiFormSubmit:1, value:v}, '*'); }catch(e){} };
```
`RenderedHtml` gains an `enableSubmit` prop; when set, it injects the bridge and,
in its existing `message` listener, handles `data.__saiFormSubmit` by calling
`formBridge.submitForm(data.value)` (guarded on `event.source === iframe.contentWindow`,
same as the height path). The iframe stays `sandbox="allow-scripts"` (no
same-origin); the CSP already allows the inline script.

### 3. New render kind `'form'`
- `renderStore.ts`: add `'form'` to `RenderKind`.
- `RenderRegion` (`RenderToolCard.tsx`): `kind:'form'` → `<RenderedHtml entry enableSubmit />`.
- `entryFromToolCall` (`RenderToolCallCard.tsx`): `sai_render_form` branch
  validates a non-empty `html` string → `kind:'form'`, `payload:{ html }`, title
  'Form'; code pane shows the html. This is the **sole** builder for the form
  entry — `render_form` skips `handleRenderToolRequest`/`dispatchSaiRenderTool`
  entirely (it blocks instead of capturing), so no dispatcher case is added.

### 4. Schema — `src/lib/saiTools.ts`
`render_form`, toolset `chat`, `required:['html']`, optional `timeoutMs`/`title`/
`width`. Description tells the agent to author a form whose submit control calls
`saiSubmit(value)` with a JSON-serializable value, and that the call blocks until
the user submits.

### 5. `App.tsx` — blocking branch
In `onSwarmToolRequest`, BEFORE the `startsWith('render_')` block, a `render_form`
branch. Note it does NOT call `handleRenderToolRequest`: the interactive form is
the **chat card** (built by `entryFromToolCall` from the tool input, `kind:'form'`
with `enableSubmit`), which is wired straight to `formBridge`. The blocking is
purely the pending-form promise; the card's submit resolves it via FIFO.
```ts
if (req.tool === 'render_form') {
  const { promise } = registerPendingForm(formTimeoutMs(req.input));
  void promise.then(
    (result) => sai.respondSwarmTool(req.id, result),
    (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
  );
  return;
}
```
(`formTimeoutMs` clamps `input.timeoutMs` to `[10_000, 600_000]`, default 180_000.)
Because the card renders from the tool_use independently of `renderStore`, no
`renderStore` upsert is needed for `render_form`.

### 6. `electron/main.ts` — tool-aware timeout
In `onToolCall`, compute the reject timeout: `render_form` →
`min(max(input.timeoutMs ?? 180000, 10000), 600000)`; all other tools keep 60_000.
This backstops the renderer's own form timeout.

## Data Flow

Already diagrammed above. Key invariant: the renderer's `registerPendingForm`
timeout is ≤ main's `render_form` timeout, so the renderer resolves first with a
clean `{ ok:false, dismissed:true }` rather than main rejecting with a raw
"timed out" error.

## Error Handling

- **Timeout / no submit:** renderer resolves `{ ok:false, dismissed:true,
  error:'form timed out' }`; the agent learns the user didn't answer.
- **Extra submits after resolution:** queue empty → `submitForm` is a no-op.
- **Malformed form (no submit control):** never resolves until timeout — the
  agent's responsibility (documented in the tool description).
- **Non-serializable value:** `postMessage` structured-clone drops functions/DOM;
  the agent receives whatever survives clone (typically fine for JSON values).

## Security / Sandboxing

- The submit bridge is the ONLY new sandbox capability: a single JSON
  `postMessage` to the parent. Still `sandbox="allow-scripts"`, no
  `allow-same-origin`, no IPC, no parent-DOM reach.
- The submitted value is returned to the agent as plain result data (text); SAI
  never renders it as HTML, so there is no injection surface.
- The form HTML itself is model-authored and runs under the existing strict CSP
  (no network, inline only) — same trust model as `render_html`.

## Testing

- **Unit:** `formBridge` — register→submit resolves `{ok:true,value}`; timeout
  resolves `{ok:false,dismissed:true}`; FIFO order with two pending; `cancel`;
  `submitForm` with empty queue is a no-op. Schema registration. `entryFromToolCall`
  form branch (valid/empty html). `formTimeoutMs` clamping.
- **E2e (harness):** a `render-tool-call-card` story `kind:'form'` that calls
  `registerPendingForm`, renders a form whose button calls `saiSubmit('picked-B')`,
  clicks it, and asserts the story displays the resolved value `picked-B` —
  exercising the iframe bridge → formBridge → resolution end to end.

## Key Files

| Area | Files |
|------|-------|
| Correlation/timeout | `src/render/formBridge.ts` (new) |
| Iframe submit bridge + form kind | `src/components/Chat/RenderToolCard.tsx` |
| Render store kind | `src/render/renderStore.ts` |
| Schema | `src/lib/saiTools.ts` |
| Card redisplay | `src/components/Chat/RenderToolCallCard.tsx` |
| Blocking branch + timeout helper | `src/App.tsx` |
| Tool-aware main timeout | `electron/main.ts` |
| Story + e2e | `src/test-harness/stories/render-tool-call-card.tsx`, `tests/e2e/render-tool-call-card.spec.ts` |

## Open Questions / Future Work

- `schema` validation of the returned value (deferred to a later add).
- `confirm`/`choose` convenience tools on the same `formBridge` channel.
- A "Submitted ✓" disabled state on the card after resolution (v1 leaves the form
  interactive; post-resolution submits are no-ops).
