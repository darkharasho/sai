# SAI MCP Tools v2 — Roadmap Design

**Date:** 2026-06-09
**Status:** Draft (brainstorm roadmap) — pending per-tier implementation plans
**Builds on:** `2026-06-08-sai-mcp-html-renderer-design.md` (shipped: `render_html`, `render_component`)

## Summary

The shipped HTML/component renderer proved out a reusable shape: a **SAI-native
tool** is one entry in `SAI_TOOL_SCHEMA` (`src/lib/saiTools.ts`) plus a handler,
routed by `target` to either the **renderer** (live React surface + real-pixel
`capturePage`) or the **main** process. That gave us two primitives most apps
don't have:

1. A **live in-app render surface** (`renderStore` → inline card + pop-out
   panel) the agent can paint into.
2. **Faithful pixel capture** of any region, returned to the agent as an image
   tool-result so it can self-correct.

This roadmap extends that into a family of tools, grouped into three tiers by
how much **new plumbing** each needs. Tiers 1–2 reuse the existing one-way
(agent → screenshot) flow. Tier 3 adds the missing half: **values flowing back
from the user**, turning the render surface from a preview into an interactive
UI channel.

This is **one umbrella spec** so the shared framework deltas are stated once;
each tier gets its own implementation plan when we build it.

## Goals

- Grow the SAI tool family without re-plumbing process wiring per tool.
- Keep "add a tool = one registry entry + a handler" true for Tiers 1–2.
- Exercise the `target: 'main'` route the v1 spec scaffolded but never used.
- Add a **bidirectional** tool-result contract (user value, not just an image)
  for Tier 3, designed so it doesn't disturb the existing image-result path.

## Non-Goals

- Network access from mocks (unchanged from v1: sandboxed, CSP-locked).
- Arbitrary component import paths (allow-list registry only, unchanged).
- A second offscreen render process (Approach B) — still deferred.

## Current State (verified)

- `src/lib/saiTools.ts` — `SaiToolDef { name, description, toolset, input_schema }`,
  `SAI_TOOL_SCHEMA`, `toolsForToolset`. **Note:** v1 landed `toolset` but not the
  `target` field the design described; see Framework Delta A.
- `src/render/saiToolDispatcher.ts` — `dispatchSaiRenderTool(name, input, renderId)`,
  switch over tool name, writes to `renderStore`.
- `src/render/handleRenderToolRequest.ts` — wraps dispatch + optional
  `captureRenderRegion`, returns `{ ok, renderId, __mcpImage? }`.
- `src/render/renderStore.ts` — `RenderEntry { renderId, kind, payload, title,
  width, background?, status }`; `kind` is currently `'html' | 'component'`.
- `src/render/componentRegistry.ts` — allow-list (`WorkspaceSquircle` seed).
- `src/render/captureRenderRegion.ts` — paint-settle + `capturePage` path.
- MCP wiring: `electron/swarm-mcp-server.ts` (server), `swarmMcpHost.ts` +
  `swarmMcpConfig.ts` (host/socket/config), attached to the chat session in
  `electron/services/claude.ts`.

## Framework Deltas (shared — do once, before any tier)

**A. Add `target` to the tool def.** Extend `SaiToolDef` with
`target: 'renderer' | 'main'` (default `'renderer'` for back-compat). Route in
the host: `target: 'main'` tools skip the renderer round-trip and run a handler
in Electron main. This is the v1 design's intent; it was only ever exercised for
renderer tools. Required before Tier 2's main-target tools.

**B. Generalize `renderStore.kind`.** Today `'html' | 'component'`. Tier 1 adds
render kinds (`'chart'`, `'mermaid'`, `'diff'`, `'theme'`). Either widen `kind`
or — cleaner — keep `kind` as the render *primitive* and let several tools map
onto `kind: 'html'` by generating HTML in the dispatcher. **Decision:** Tier 1
tools generate HTML/SVG in the dispatcher and reuse `kind: 'html'`; no
`renderStore` change needed. Re-evaluate only if a tool needs bespoke React.

**C. Bidirectional result channel (Tier 3 only).** Add an optional
`__mcpValue` alongside `__mcpImage` in the render-tool result, and a
`postMessage`-back path from the sandboxed iframe → dispatcher → resolves the
pending tool call. Designed in Tier 3; listed here so the contract change is
visible up front.

---

## Tier 1 — Pure renderer tools (no new plumbing) ★ recommended start

Each is a registry entry whose handler builds a self-contained HTML/SVG string
and reuses the existing `kind: 'html'` render + capture path. Lowest risk,
exercises the shipped path, immediately useful.

### `render_chart`
JSON data → chart, screenshot back. Lets the agent *show* metrics, benchmarks,
swarm timings instead of describing them.
```jsonc
{ "type": "object",
  "properties": {
    "kind": "string  // 'bar' | 'line' | 'pie' | 'scatter'",
    "data": "object  // series/points; shape per kind",
    "title": "string?", "width": "number?", "background": "string?" },
  "required": ["kind", "data"] }
```
Handler emits an HTML snippet using a tiny inline chart renderer (inline SVG or a
vendored micro-lib — no network, per CSP). Captured like any mock.

### `render_mermaid`
Mermaid text → flowchart/sequence/architecture diagram. Ideal for the agent
explaining a design or a swarm task graph.
```jsonc
{ "type": "object",
  "properties": { "diagram": "string  // mermaid source",
    "title": "string?", "width": "number?", "background": "string?" },
  "required": ["diagram"] }
```
Renders mermaid → SVG inside the sandboxed surface; capture the SVG region.

### `render_diff`
Two variants side-by-side in one capture — old vs new props, or two CSS
variants. A/B for "make this stylish."
```jsonc
{ "type": "object",
  "properties": {
    "before": "object  // { html } or { component, props }",
    "after":  "object  // { html } or { component, props }",
    "layout": "string?  // 'side-by-side' | 'stacked'",
    "title": "string?", "width": "number?" },
  "required": ["before", "after"] }
```
Composes two render regions in one surface; single `capturePage` of the pair.

### `render_theme`
Apply candidate CSS variables / theme to **real** registered components and
screenshot, so theme proposals are seen on actual UI, not mocks.
```jsonc
{ "type": "object",
  "properties": {
    "vars": "object  // CSS custom properties to apply",
    "components": "string[]?  // registry keys to preview (default: a sample set)",
    "title": "string?", "width": "number?" },
  "required": ["vars"] }
```
Wraps the mounted registered components in a scope with the supplied custom
properties; reuses `render_component` mount + capture.

---

## Tier 2 — New capture / main-target tools

Needs Framework Delta A (the `target: 'main'` route) and frame-timed capture.
Higher utility for building SAI itself.

### `capture_app`  *(target: main)*
Screenshot the **live current app view** (not a mock) so the agent sees real
runtime state. `capturePage` on the main window / a named region.
```jsonc
{ "type": "object",
  "properties": { "region": "string?  // named region or selector; default full window" } }
```

### `inspect_element`  *(target: main)*
Return the computed box/style of a real element. Directly encodes the
"UI not rendering? inspect the element first" workflow — the agent reads actual
computed style instead of guessing about stale builds/HMR.
```jsonc
{ "type": "object",
  "properties": { "selector": "string  // CSS selector in the live app",
    "props": "string[]?  // computed style props to return; default a useful set" },
  "required": ["selector"] }
```
Returns `{ rect, computed: {…}, found: boolean }` as a text/JSON result.

### `read_app_state`  *(target: main or renderer)*
Query live stores (workspace status, render store, active swarm tasks) so the
agent reasons about real runtime state, not source. Read-only, allow-listed
store keys.
```jsonc
{ "type": "object",
  "properties": { "store": "string  // allow-listed store name",
    "path": "string?  // optional dot-path into the store" },
  "required": ["store"] }
```

### `freezeAtMs` / filmstrip capture
Already flagged as future work in v1. Capture a specific animation frame, or N
frames as a strip, so the agent can iterate on motion, not a static pose.
Extends `captureRenderRegion` with timed capture; an optional `freezeAtMs` /
`frames` input on the existing render tools rather than a new tool.

### Native interaction tools  *(target: main)*
Small main-process tools that either surface OS-native UI or perform a host
action. Each is a single registry entry once Framework Delta A lands. Grouped
here because they share the same `target: 'main'` route as the capture tools.

- **`pick_file`** — open the native open/save dialog; returns the chosen path(s)
  or null on cancel. `{ mode?: 'open'|'save'|'directory', filters?, multi? }`.
- **`pick_color`** — show a color picker; returns the chosen CSS color. Useful
  mid-design ("pick the accent") instead of the agent guessing a hex.
- **`pick_region`** — let the user drag-select a screen/window region; returns
  the rect (and optionally a capture of it). Pairs with `capture_app`.
- **`notify`** — fire an OS/in-app toast or notification. `{ title, body?,
  level?: 'info'|'warn'|'error' }`. Fire-and-forget; no value returned.
- **`clipboard`** — read or write the clipboard. `{ action: 'read'|'write',
  text? }`; returns the text on read. Read is the agent grabbing what the user
  just copied; write hands the user a result to paste.

These are the first tools where the *user* hands a value to the agent through a
**native** affordance rather than rendered HTML — a lighter-weight cousin of the
Tier 3 bidirectional channel. `notify` and `clipboard:write` are output-only;
the pickers and `clipboard:read` are input. All are allow-listed, no arbitrary
filesystem/shell access beyond what the chosen dialog returns.

---

## Tier 3 — Bidirectional keystone (the novel one)

Today the surface is one-way. This tier makes values **flow back from the
user**, turning SAI into a place where the agent asks rich, visual questions
instead of plain text. Needs Framework Delta C. Its own plan.

### `render_form` / `ask_ui`
Agent renders real inputs (sliders, pickers, a multiple-choice card, draggable
sizing handle); the tool result is **what the user entered/clicked**, not a
screenshot.
```jsonc
{ "type": "object",
  "properties": {
    "html": "string  // form UI; posts values back via a provided submit() bridge",
    "schema": "object?  // expected shape of the returned value (for validation)",
    "title": "string?", "width": "number?", "timeoutMs": "number?" },
  "required": ["html"] }
```
Flow: render in the sandboxed iframe (now with a narrow `postMessage` submit
bridge) → user interacts → on submit, dispatcher resolves the pending MCP call
with `__mcpValue` (validated against `schema`). The tool call **blocks** until
submit/timeout — a real human-in-the-loop input channel. Reframes the whole
feature from "preview" to "interactive UI."

Security: the submit bridge is the *only* new capability added to the sandbox —
a single `postMessage` of a JSON value to the parent; no `allow-same-origin`, no
app/IPC access. Validate against `schema` before returning to the agent.

### `confirm` / `choose`
The lightweight sibling of `render_form`: a custom-UI modal that resolves to a
single decision rather than a form payload. `{ message, options?: string[],
destructive?: boolean }` → returns the chosen option (or `true`/`false` for a
plain confirm). Built on the same `__mcpValue` channel; useful for "apply this
change?" / "which of these 3?" without authoring a full form.

---

## Security / Sandboxing

- Tier 1: unchanged from v1 — `<iframe sandbox="allow-scripts">`, strict CSP,
  no network. Charts/mermaid render inline (vendored, no CDN).
- Tier 2 main-target tools run in Electron main and are **read-only**:
  `capture_app`/`inspect_element` read pixels/computed style; `read_app_state`
  is an allow-listed, read-only store accessor. No mutation tools in this spec.
- Tier 3 adds exactly one sandbox capability: a JSON-only `postMessage` submit
  bridge to the parent. Still no `allow-same-origin`, IPC, or DOM reach.

## Testing

Mirror v1's layers (vitest unit/integration + Playwright harness e2e):
- **Tier 1:** unit per handler (HTML/SVG generation is deterministic, snapshot
  it); integration through `dispatchSaiRenderTool`; one e2e per tool asserting
  the surface paints + a non-empty PNG returns.
- **Tier 2:** unit the `target: 'main'` route; mock `capturePage` /
  computed-style reads; allow-list enforcement for `read_app_state`.
- **Tier 3:** unit the submit-bridge → `__mcpValue` resolution and `schema`
  validation; e2e drives the form in the harness and asserts the resolved value
  + the timeout path.

## Key Files

| Area | Files |
|------|-------|
| Tool schema (+ `target`) | `src/lib/saiTools.ts` |
| Renderer dispatch | `src/render/saiToolDispatcher.ts` |
| Render request/capture | `src/render/handleRenderToolRequest.ts`, `captureRenderRegion.ts` |
| Render store | `src/render/renderStore.ts` |
| Component/theme registry | `src/render/componentRegistry.ts` |
| Main-target route (Tier 2) | `electron/services/swarmMcpHost.ts`, `electron/services/claude.ts` |
| MCP server/config | `electron/swarm-mcp-server.ts`, `electron/services/swarmMcpConfig.ts` |
| Inline card / panel | `src/components/Chat/RenderToolCallCard.tsx` |

## Progress / Status (updated 2026-06-09)

**Shipped to main:**
- ✅ `render_chart`, `render_diff` (`sai-render-chart-diff`)
- ✅ `inspect_element`, `capture_app` (`sai-tier2-inspect-capture`) — renderer-target; **Framework Delta A was NOT needed** (capturePage is renderer-reachable via the `sai:capture-region` IPC). Delta A stays deferred until a genuinely main-only tool (native pickers).
- ✅ `render_mermaid` (`sai-render-mermaid`) — new `mermaid` render kind; mermaid dep dynamically imported (code-split); agent capture rides the offscreen `renderCaptureHtml` path.

**Blocked / re-scoped (discovered during implementation):**
- ⛔ `read_app_state` — **parked.** Only `renderStore` is reachable from the renderer that handles tool calls (low value); `workspaceStatusStore`/`githubWatcherStore` live in the separate `src/renderer-remote/` PWA bundle, unreachable. Revisit only if a reachable, valuable store appears.
- ⛔ `render_theme` (and full-fidelity `render_component` screenshots) — **needs infrastructure.** `captureRenderRegion()` (live-region `capturePage`) is written + unit-tested but **`RenderPreviewPanel` is never mounted in the real app** (only the test harness), so component/theme renders have no on-screen region to capture. Shipping these requires integrating the preview surface into the app UI first. Component renders currently return no screenshot to the agent.

**Remaining:**
- `render_theme` (after the preview-surface integration above).
- Native interaction tools `pick_*`/`notify`/`clipboard` — need **Framework Delta A** (main-only).
- `freezeAtMs` / filmstrip capture.
- Tier 3 `render_form` / `confirm` — the bidirectional channel.

## Open Questions

- `render_theme`/component capture: integrate `RenderPreviewPanel` into the app, or add a dedicated offscreen component-render path? (The html path uses an offscreen window via `renderCaptureHtml`; components need the live React tree.)
- Tier 3: per-call timeout default and what the agent gets on timeout (null vs
  explicit "user dismissed").
