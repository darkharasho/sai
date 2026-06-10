# SAI MCP + In-App HTML/Component Renderer — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorm) — pending implementation plan

## Summary

Give SAI a way to expose **its own MCP tools** to the in-app chat agent, and
ship the first such tools: an **HTML/component renderer** that lets the agent
render a mock (or a real project component) inside the app, see a faithful
screenshot of the result, and iterate with the user. This turns the manual
loop we ran for the `WorkspaceSquircle` (render in the harness → screenshot →
feedback) into a native, agent-driven capability.

This is **one spec** covering two coupled pieces:

1. A small **SAI-native tool-registration layer** (`SaiToolRegistry`) plus the
   generalization of the existing swarm MCP server into a SAI MCP server.
2. The **renderer** as the first two tools on top of it: `render_html` and
   `render_component`.

## Goals

- The in-app chat agent can call a tool to render arbitrary model-authored
  HTML/CSS/JS **or** a registered real project component with props.
- The rendered result appears **live** in the chat tool-call card, with a
  **pop-out to a dedicated preview panel**.
- A faithful **screenshot** of the render is returned to the agent as a
  `ToolResultImage`, so the agent can self-correct; the user can also steer.
- Adding future SAI-native tools is a one-entry-in-the-registry change, not new
  process wiring.

## Non-Goals (v1)

- Mounting components by arbitrary import path (allow-list registry only).
- Capturing specific animation keyframes (`freezeAtMs` is a noted later add).
- A second offscreen render process for isolation (Approach B) — deferred as a
  later hardening step.
- Network access from mocks.

## Background / Current State

- **SAI already runs its own MCP server.** `electron/swarm-mcp-server.ts`
  speaks MCP over stdio (`@modelcontextprotocol/sdk`) and routes tool calls
  back into the Electron main process over a local socket
  (`electron/services/swarmMcpHost.ts`). It currently exposes only swarm tools
  (`spawn_task`, `land`, …), defined in `src/lib/swarmOrchestratorTools.ts` and
  dispatched via `src/lib/swarmOrchestratorDispatcher.ts`. This MCP config is
  attached only to **orchestrator** Claude CLI sessions today.
- **A dev-only story renderer exists.** `/test-harness?story=…` (mounted in
  `src/main.tsx`, registry in `src/test-harness/stories.ts`) renders a React
  component with parsed props. This is exactly what we used for the squircle.
  It is gated on `import.meta.env.DEV`.
- **Chat has no arbitrary-HTML surface.** `ToolCallCard.tsx` renders code via
  Shiki and markdown via `react-markdown`; no iframe/sandbox, no DOMPurify.
- **Image tool-results already plumbed.** `ToolResultImage` +
  `ToolResultImagePreview.tsx` (shipped 2026-06-08) render images returned from
  tools, both `filePath` and `dataUrl` variants.

## Chosen Approach (A): Renderer-mounted, real-pixel capture

Rejected alternatives:

- **B — dedicated offscreen render `BrowserWindow`/`BrowserView`:** strongest
  isolation and a uniform path for mocks vs components, but adds a second
  renderer process and re-plumbs component imports into it. Overkill for v1;
  kept as a future hardening option.
- **C — reuse `/test-harness` as a render service:** least new code, but bends
  a test-only, story-shaped surface into a product feature and shortchanges the
  tool-framework half of the spec.

A key technical constraint drove the choice: faithful capture. The squircle
uses a CSS `mask`; JS DOM-to-canvas rasterizers (`html2canvas`) mangle
masks/`backdrop-filter`/custom fonts. We therefore capture with Electron's
real-pixel `webContents.capturePage()`.

### Data flow

```
Chat agent (claude CLI session)
  │  calls "render_html" / "render_component"  (MCP over stdio)
  ▼
SAI MCP server  ── generalized from electron/swarm-mcp-server.ts
  │  reads SaiToolRegistry to list tools; forwards calls over the local socket
  ▼
SAI MCP host (electron/services/swarmMcpHost.ts, extended)
  │  onToolCall → routes by tool target
  ▼
Electron main  ── routes renderer-targeted tools to the renderer (existing bridge)
  ▼
Renderer: SaiToolDispatcher (sibling to swarmOrchestratorDispatcher.ts)
  │  updates renderStore → React renders into card + panel
  │  waits for paint, reports render-region rect back to main
  ▼
Electron main: webContents.capturePage(rect) → PNG
  ▼
returned up the same chain as the tool_result (image) → agent sees it
```

## Components

### 1. `SaiToolRegistry` (framework)

- Location: `src/lib/saiTools.ts` (schema/registry) + dispatch glue.
- Each tool declared once as:
  `{ name, description, input_schema, target: 'renderer' | 'main', handler }`.
- The SAI MCP server lists the registry; the host/dispatch routes a call by its
  `target`. `render_html` and `render_component` are the first two entries.
- Adding a future tool = one registry entry + a handler. No new process wiring.

### 2. SAI MCP server + session attachment

- Generalize `electron/swarm-mcp-server.ts` so its tool list comes from the
  registry (swarm tools remain registered entries).
- **Integration point:** extend `electron/services/claude.ts` so the **main
  chat session** is launched with `--mcp-config` pointing at the SAI MCP server
  (today only orchestrator sessions get it). This is what gives the in-app chat
  agent these tools.

### 3. Tools

**`render_html`** — render a self-contained mock.

```jsonc
{
  "name": "render_html",
  "input_schema": {
    "html":  "string  // full snippet; may include <style> and <script>",
    "title": "string?  // label shown on the card/panel tab",
    "width": "number?  // viewport width for the render, default 360",
    "background": "string?  // canvas bg behind the mock, default app surface color"
  }
}
```

Mounts `html` in a **sandboxed `<iframe sandbox="allow-scripts">`** (no
`allow-same-origin`). Returns `{ renderId, capturedImage }`.

**`render_component`** — mount a registered real component.

```jsonc
{
  "name": "render_component",
  "input_schema": {
    "component": "string  // registry key, e.g. 'WorkspaceSquircle'",
    "props":     "object?  // JSON props passed to the component",
    "width":     "number?",
    "background": "string?"
  }
}
```

Looks up `component` in the component registry and mounts it in the app's React
tree (real CSS/fonts/masks). Unknown key → error result listing available keys.
Returns `{ renderId, capturedImage }`.

Both tools return `capturedImage` as a `ToolResultImage`, reusing the existing
image tool-result plumbing.

### 4. Component registry (allow-list)

- Generalize the dev-only `src/test-harness/stories.ts` into a prod-safe
  `src/render/componentRegistry.ts`: `key → { component, propsSchema? }`.
- The test-harness consumes the **same** registry, so harness stories and
  agent-renderable components stay one list.
- v1 seeds it with the existing harness components (e.g. `WorkspaceSquircle`).
  Adding more is documented.
- This is an explicit **allow-list**: only registered components are mountable.

### 5. Render surface

- **Render store** (`src/render/renderStore.ts`, zustand-style like
  `workspaceStatusStore.ts`): keyed by `renderId`, holds
  `{ kind: 'html' | 'component', payload, title, width, status }`. Single source
  of truth shared by the card and the panel.
- **Inline:** `RenderToolCard` (sibling to `ToolResultImagePreview.tsx`) renders
  the **live** iframe/component inside the tool-call card where the tool was
  invoked, plus a **"Pop out ↗"** affordance.
- **Panel:** `RenderPreviewPanel` registered alongside the existing
  code/terminal panels. Pop-out moves/mirrors the active render into the roomy
  panel; re-renders to the same `renderId` update in place (no panel-per-render
  spam).
- **Live vs snapshot:** card/panel show the live, interactive render; the
  screenshot is generated only for the agent's tool-result.

### 6. Screenshot capture & feedback

- After mount, the dispatcher waits for paint (a `requestAnimationFrame` settle
  plus a short fonts/`<img>`-ready wait), measures the render region's bounding
  rect, and asks main to `webContents.capturePage(rect)`.
- Main returns a PNG; the dispatcher packages it as a `ToolResultImage` (the
  type shipped 2026-06-08) so it flows back to the agent and into the card's
  image preview.
- **Animations:** captured at the settle point (single frame); fine for the
  squircle pulse. `freezeAtMs?` is a clean later addition (out of scope).
- **Errors:** iframe `onerror` / a render boundary around components → the tool
  returns a text result with the error (plus a screenshot if anything painted),
  so the agent can fix and retry.

## Security / Sandboxing

- `render_html` runs in `<iframe sandbox="allow-scripts">` with **no**
  `allow-same-origin` → the mock cannot reach `window.sai`, IPC, cookies, or the
  parent DOM. JS is allowed but jailed.
- The iframe gets a strict CSP (`default-src 'none'; style-src 'unsafe-inline';
  script-src 'unsafe-inline'; img-src data:`) so a mock cannot beacon out or load
  remote scripts. Inline styles, inline scripts (mocks may include JS — the
  sandbox attribute does not override CSP, so `script-src 'unsafe-inline'` is
  required to actually run them), and data-URI images only — no network.
- `render_component` runs in-app (required for real CSS) and is gated by the
  allow-list registry; props must be JSON-serializable. No arbitrary import
  paths.
- `capturePage(rect)` reads only the visible render region; the PNG is the only
  thing returned to the agent.

## Testing

Following the repo's existing layers (vitest unit/integration + Playwright e2e
via the harness):

- **Unit:** `SaiToolRegistry` (list/dispatch/unknown-tool), `renderStore`
  reducers, the rect/capture request builder.
- **Integration:** dispatcher routes `render_html`/`render_component`
  correctly; unknown component → error; props validation.
- **E2e (Playwright harness):** a story driving `RenderToolCard` with a sample
  HTML mock and a sample component; assert the iframe/component mounts and the
  pop-out panel mirrors it (same pattern as `workspace-squircle.spec.ts`).
- **Capture** is mocked in unit/integration (no real `capturePage`); one thin
  e2e asserts a non-empty PNG comes back end-to-end.

## Key Files

| Area | Files |
|------|-------|
| Tool registry/schema | `src/lib/saiTools.ts` (new) |
| SAI MCP server | `electron/swarm-mcp-server.ts` (generalize) |
| MCP host/socket | `electron/services/swarmMcpHost.ts` (extend) |
| Session attach | `electron/services/claude.ts` (add `--mcp-config` to chat session) |
| Renderer dispatch | `src/render/saiToolDispatcher.ts` (new, sibling to `swarmOrchestratorDispatcher.ts`) |
| Component registry | `src/render/componentRegistry.ts` (new; harness consumes it) |
| Render store | `src/render/renderStore.ts` (new) |
| Inline card | `src/components/Chat/RenderToolCard.tsx` (new) |
| Preview panel | `src/components/.../RenderPreviewPanel.tsx` (new) |
| Image result | reuse `src/components/Chat/ToolResultImagePreview.tsx`, `ToolResultImage` type |

## Open Questions / Future Work

- Offscreen render process (Approach B) as a later isolation hardening step.
- `freezeAtMs` for capturing a specific animation frame.
- Letting the agent register/define ad-hoc components at runtime (currently
  allow-list only).
