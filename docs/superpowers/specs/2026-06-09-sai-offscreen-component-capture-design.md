# SAI Offscreen Component/Theme Capture + `render_theme` — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm) — pending implementation plan
**Builds on:** `2026-06-09-sai-mcp-tools-v2-design.md` (Tier 1 `render_theme`; the deferred "Approach B" offscreen render window)

## Summary

Give component-based SAI renders (`render_component`, and the new `render_theme`)
a faithful **screenshot back to the agent**, using a dedicated **offscreen
`BrowserWindow`** that loads the app bundle at a minimal render-only route and
`capturePage`s the real React component with real CSS. This mirrors the shipped
offscreen html-capture path (`render:captureHtml`) but for components, which need
the React tree (html mocks don't).

This one design delivers two things:
1. **Fixes a real gap:** `render_component` currently returns **no** screenshot
   to the agent (only html-based tools do). It renders live in the chat card but
   the agent can't self-correct.
2. **Ships `render_theme`:** apply candidate CSS custom properties to real
   registered components and screenshot the result.

## Goals

- `render_component` and `render_theme` return a faithful PNG to the agent via
  `__mcpImage`, reusing the existing image tool-result plumbing.
- No on-screen flicker (offscreen, off-display window — the html path's pattern).
- The chat card continues to show these renders live (already works for
  components; extended to themed components).
- `render_theme` previews real components under supplied CSS variables.

## Non-Goals

- Reusing/pooling the offscreen window across captures (new window per capture,
  matching `render:captureHtml`; optimize later if needed).
- Arbitrary component import paths (allow-list `componentRegistry` only — unchanged).
- Capturing the live on-screen chat card region (rejected: renderId/timing
  coupling; the offscreen window is cleaner and isolated).
- Network access from rendered components.

## Background / Current State (verified)

- **Offscreen html capture exists:** `electron/main.ts` `render:captureHtml`
  spawns a hidden `BrowserWindow` parked at `x:-32000,y:-32000` (`show:false`),
  loads a `data:text/html` doc, waits ~320ms, measures `scrollHeight`,
  `setContentSize`, `capturePage`, returns base64, destroys in `finally`.
- **App URL:** main window loads `process.env.VITE_DEV_SERVER_URL` (dev) or
  `loadFile(dist/index.html)` (prod). (`electron/main.ts:408-411`)
- **Routing:** `src/main.tsx` mounts `<TestHarness>` when
  `import.meta.env.DEV && location.pathname.startsWith('/test-harness')`, else
  `<App>` in `<StrictMode>`. The harness is **dev-only**.
- **Component renders show live but uncaptured:** `RenderToolCallCard` →
  `entryFromToolCall` handles `sai_render_component` → `kind:'component'` →
  `MountComponent` (real component inline). But `App.tsx`'s capture block only
  builds `htmlInput`/deps for html-family tools, so component renders pass
  `deps={}` → `handleRenderToolRequest` returns no `__mcpImage`.
- **Registry:** `src/render/componentRegistry.ts` (`getRegisteredComponent`,
  `registeredComponentKeys`) — prod-safe allow-list (seeded `WorkspaceSquircle`).
- **Capture result plumbing:** `electron/swarm-mcp-server.ts:140-147` turns a
  result's `__mcpImage:{base64,mimeType}` into an MCP image block.

## Architecture

```
agent → render_theme / render_component  (MCP)
  → renderer onSwarmToolRequest → handleRenderToolRequest
       │  dispatcher upserts renderStore (chat card shows it live)
       │  deps.captureRenderRegion = () => sai.renderCaptureComponent({component|components, props, vars, width})
       ▼
  preload renderCaptureComponent → ipc 'render:captureComponent'
       ▼
  electron main: hidden off-display BrowserWindow
       │  loadURL/loadFile  <app>/render-host?component=…&props=…&vars=…
       ▼
  renderer (main.tsx): path '/render-host' → mount <RenderHost/> ONLY (no App, no StrictMode)
       │  reads params → <ThemedComponents components vars/> via componentRegistry
       │  on paint-settle sets window.__renderReady = true
       ▼
  main: poll executeJavaScript('window.__renderReady'), measure, capturePage → base64
       ▼
  __mcpImage back up the chain → agent sees it
```

## Components

### 1. `ThemedComponents` (shared) — `src/render/ThemedComponents.tsx`
`<ThemedComponents components={string[]} vars={Record<string,string>} />`: renders
each registered component (looked up via `getRegisteredComponent`) inside a
wrapper `<div style={{ ...vars-as-custom-properties }}>`. Unknown keys render a
small error label (reuse the `MountComponent` pattern). Used by **both** the
chat card (`RenderRegion`) and the offscreen `RenderHost`, so live and captured
output match. CSS custom properties are applied by spreading `vars` (keys like
`--accent`) into the wrapper's inline `style`.

### 2. `RenderHost` route — `src/render/RenderHost.tsx` + `src/main.tsx`
- `src/main.tsx`: **before** the harness/App branches, add a **non-dev-gated**
  check: `if (location.pathname.startsWith('/render-host'))` → lazy-import and
  mount `<RenderHost/>` into root **without `StrictMode`** (StrictMode's
  double-invoke can disturb a one-shot ready signal — see
  `feedback_strictmode_force_completes_imperative_animations`).
- `RenderHost` parses `component` (single key, for `render_component`) **or**
  `components` (JSON array, for `render_theme`), `props` (JSON), `vars` (JSON)
  from `location.search`, renders `<ThemedComponents>` (a single-element array
  when `component` is given), then after `requestAnimationFrame` + `document.fonts.ready`
  sets `window.__renderReady = true`. Minimal tree — no app chrome/stores.

### 3. `render:captureComponent` IPC — `electron/main.ts`
Sibling to `render:captureHtml`. Input `{ component?, components?, props?, vars?, width? }`.
- Spawn the hidden off-display window (same options as `render:captureHtml`).
- Build the URL: dev `${VITE_DEV_SERVER_URL}/render-host?…`; prod
  `loadFile(dist/index.html, { search: '?…', hash: undefined })` with the path
  signalled via a query param the renderer reads (prod `file://` has no path
  routing, so RenderHost also accepts a `?render-host=1` flag; `main.tsx` checks
  both `pathname.startsWith('/render-host')` and `searchParams.has('render-host')`).
- Poll `executeJavaScript('window.__renderReady === true')` every ~50ms up to a
  timeout (~3s); then measure root `scrollHeight`, `setContentSize`, one more
  frame, `capturePage`, return base64. `try/catch` → null; `finally` destroys.

### 4. preload — `electron/preload.ts`
`renderCaptureComponent: (a: { component?: string; components?: string[]; props?: object; vars?: object; width?: number }) => Promise<string | null>`
→ `ipcRenderer.invoke('render:captureComponent', a)`.

### 5. `App.tsx` wiring
In `onSwarmToolRequest`, extend the render block so `render_component` and
`render_theme` build `deps.captureRenderRegion` calling
`sai.renderCaptureComponent(...)` (passing the tool's `component`/`components`/
`props`/`vars`/`width`). This fixes `render_component`'s missing screenshot and
enables `render_theme`. Also add `sai_render_theme` to the `renderToolCall`
card guard.

### 6. `render_theme` tool
- **Schema** (`saiTools.ts`): `render_theme`, toolset `chat`, required `['vars']`,
  optional `components` (string[]), `title`, `width`, `background`.
- **Dispatcher** (`saiToolDispatcher.ts`): validate `vars` is an object; upsert
  `kind:'theme'`, `payload:{ components, vars }` (default `components` =
  `registeredComponentKeys()`), default title 'Theme'.
- **renderStore**: add `'theme'` to `RenderKind`.
- **RenderRegion** (`RenderToolCard.tsx`): `kind:'theme'` → `<ThemedComponents>`.
- **Card redisplay** (`RenderToolCallCard.tsx`): `entryFromToolCall` branch for
  `sai_render_theme` → `kind:'theme'` entry; code pane shows the vars JSON.

## Error Handling

- Unknown component key → `ThemedComponents` renders an inline error label
  (live), and the capture still returns whatever painted; the agent sees the
  error visually. The dispatcher also validates required inputs and rejects with
  `{ok:false,error}` (no upsert) for missing `vars`.
- Offscreen capture failure (load error, timeout, no ready signal) →
  `render:captureComponent` returns `null`; `App.tsx`'s capture dep throws
  `capture returned no image`; `handleRenderToolRequest` swallows capture errors
  (the render itself still succeeded) and returns `{ok:true, renderId}` without
  an image — consistent with the html path's best-effort capture.

## Security

- The offscreen window loads the **app's own bundle** (same origin as the app),
  not arbitrary content. It mounts only allow-listed registry components with
  JSON-serializable props/vars — no arbitrary import paths.
- `webPreferences` mirror the html-capture window (`sandbox:true`). RenderHost
  does not expose `window.sai`/IPC (it's a minimal mount; preload may still be
  attached, but RenderHost makes no privileged calls).
- `vars` are CSS custom-property strings applied as inline style; no HTML
  injection (components are React, props are JSON).

## Testing

- **Unit:** `ThemedComponents` (jsdom) — mounts registered components, applies
  vars to the wrapper, error label for unknown keys. `render_theme` dispatcher
  cases (valid/invalid `vars`, default components). `renderStore` kind. Schema
  registration. `entryFromToolCall` theme branch.
- **Integration:** the `render:captureComponent` URL/param builder (pure
  function extracted from the IPC handler) — correct query for dev vs prod and
  single-component vs theme.
- **E2e (harness):** a `render-tool-call-card` story `kind:'theme'` asserting the
  themed components mount in the card. (Offscreen `capturePage` itself is
  Electron-only; covered by a thin main-process test mocking `capturePage`, like
  the existing `capturePage.test.ts`.)

## Key Files

| Area | Files |
|------|-------|
| Shared themed mount | `src/render/ThemedComponents.tsx` (new) |
| Offscreen route | `src/render/RenderHost.tsx` (new), `src/main.tsx` |
| Capture IPC + URL builder | `electron/main.ts`, a small `electron/renderHostUrl.ts` (new, testable) |
| preload | `electron/preload.ts` |
| Renderer wiring | `src/App.tsx` |
| render_theme tool | `src/lib/saiTools.ts`, `src/render/saiToolDispatcher.ts`, `src/render/renderStore.ts` |
| Card surfaces | `src/components/Chat/RenderToolCard.tsx`, `RenderToolCallCard.tsx` |

## Open Questions / Future Work

- Pool/reuse a single hidden RenderHost window across captures to avoid
  per-call bundle load (perf optimization; out of scope for v1).
- Expand `componentRegistry` with more presentational components to make
  `render_theme` more useful (separate, additive change).
- `freezeAtMs` for component animations (out of scope).
