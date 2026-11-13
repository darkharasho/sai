# 3D model viewer — design

Date: 2026-11-13
Status: draft, awaiting approval (builder check done)

## Intent

When an agent works on a 3D model (today: OpenSCAD), the user wants to **judge the
model by spinning it around** inside SAI. Today they can't: the OpenSCAD flatpak's
offscreen renderer fails on this machine, so the agent falls back to checking the
mesh numerically in Python and the user sees nothing.

OpenSCAD's STL *export* works fine — only its image rendering is broken. So SAI
renders exported meshes itself.

The view is primarily for the user's eyes (interactive orbit/zoom). The agent
getting a screenshot back to sanity-check its own output is a secondary benefit.

## Goals

- Open `.stl`, `.3mf`, `.obj` files in the code panel as an interactive 3D view.
- That view **live-reloads when the file changes on disk** and **keeps the user's
  camera angle**, so iterating ("thicker wall", "round that edge") shows exactly
  what changed from where they were looking.
- A new agent tool `render_model` that, given a file path, drops an interactive
  3D card into chat (one card per version, so history is scrollable/comparable),
  optionally opens the file in the code panel, and returns a screenshot to the
  agent like other render tools.

## Non-goals

- Rendering `.scad` directly (no openscad-wasm). Agent keeps exporting via the
  OpenSCAD CLI. Can be layered on later, reusing this viewer.
- Editing meshes, measuring tools, slicing, cross-sections.
- glTF/STEP/other formats (glTF is cheap to add later; STEP is not).

## Anti-goals (failure even if it "works")

- A viewer that resets the camera on every reload — defeats the iteration loop.
- Chat cards that keep heavy WebGL contexts alive for every historical version
  (browsers cap live WebGL contexts at ~16; long OpenSCAD sessions would blow it
  and silently blank older cards, or bloat memory — see idle-memory work).
- Inline-embedding model bytes in chat records (same class of bug as the
  inline-screenshot IDB clone OOM). Cards reference the file by path.

## Constraints / what exists today

- Render tools: schema in `src/lib/saiTools.ts`; dispatch in
  `src/render/saiToolDispatcher.ts`; live card in `src/components/Chat/RenderToolCard.tsx`
  (switch on `entry.kind`, e.g. `mermaid`); chat-history card rebuilt from the tool
  call in `src/components/Chat/RenderToolCallCard.tsx` (`entryFromToolCall`).
  **Both paths must handle the new kind.**
- Screenshot: `captureRenderRegion` waits for `[data-render-region=<id>]` then main
  captures the screen region — so WebGL output is captured at compositor level
  (no `preserveDrawingBuffer` needed), but the model must be loaded and drawn
  before capture; the region needs a "ready" signal or stable-wait.
- File reads: `fs:readFileBase64` (electron/services/fs.ts) exists; a binary read
  returning an ArrayBuffer is preferable for meshes. Render paths are restricted
  by `renderAllowedRoots` in `electron/main.ts` (includes meta-workspace symlink
  roots) — model paths go through the same containment check.
- Code panel picks a viewer by file type (`isImageFile` → `ImageViewer` in
  `CodePanel.tsx`); add a parallel `isModelFile` → `ModelViewer` branch.
- No file watcher exists in electron yet; a new one is needed.
- Paths: `/home/mstephens` is a symlink to `/var/home/mstephens` — never compare
  paths by string equality (realpath both sides).
- New MCP tools aren't live until SAI restarts; verify via e2e harness or restart.
- **SAI disables the GPU on Linux** (`electron/main.ts`, `disable-gpu`, because
  of EGL context-loss freezes). WebGL therefore always runs on SwiftShader
  (software). Electron 36 still allows that, but newer Chromium gates it behind
  `--enable-unsafe-swiftshader`. *(Call: add that switch on Linux alongside
  `disable-gpu`, so an Electron upgrade can't silently blank the viewer. Keep
  the GPU off; turning it back on is out of scope.)* Verify early that a real
  OpenSCAD mesh rotates acceptably in software.

## Approaches considered

1. **three.js viewer inside SAI for exported meshes (CHOSEN).** One React
   component used by both the code panel and chat cards. Fixes the problem fully
   because export already works; no external renderer involved.
2. Option 1 + openscad-wasm to render `.scad` directly. Rejected for now: heavy
   download, lags desktop OpenSCAD, can't see user-installed libraries (BOSL2…),
   OpenSCAD-only. Can be added later on top of option 1.
3. Agent uses `render_html` with three.js from a CDN. Rejected: no file panel,
   no live reload, CDN/offline fragility.
4. Google `<model-viewer>`. Rejected: glTF-only, STL would need conversion.

## Design

### Shared `ModelViewer` component (`src/components/ModelViewer/`)
- three.js + `OrbitControls` + `STLLoader` / `3MFLoader` / `OBJLoader`
  (from `three/examples/jsm`). Lazy-loaded (dynamic import) so three.js isn't in
  the startup bundle.
- Scene: neutral material with clear shading (hemisphere + directional light so
  edges read), ground grid sized to the model, optional axes; theme-aware
  background.
- Controls: drag rotate, right-drag/shift pan, scroll zoom; toolbar with reset
  view, preset views (iso/front/top/side), wireframe toggle; status line with
  triangle count and bounding-box dimensions (mm, assuming STL units).
- Fit camera to bounding box on **first** load only. On reload, swap geometry and
  **preserve camera + controls target**.
- Handles load errors (bad/partial file — common mid-export) by keeping the last
  good mesh and showing a small error badge, retrying on next change.
- **Render on demand only** (redraw on control change / reload; no continuous
  animation loop). Essential under software rendering.
- If WebGL context creation fails, show a clear "3D view unavailable (WebGL)"
  message in place of the canvas. No fallback renderer.
- Disposes geometry/materials/renderer on unmount.

### Code panel
- `isModelFile()` in `src/utils/` (`.stl`, `.3mf`, `.obj`); `CodePanel.tsx`
  renders `ModelViewer` for these.
- The panel does **not** apply the `renderAllowedRoots` containment check: the
  user opened the file themselves, same as images (e.g. an STL in ~/Downloads).
  Only the agent tool is contained.
- Subscribes to a file watcher for the open path; on change → debounce (~300ms,
  exports write in chunks) → reload preserving camera.

### File watcher (electron)
- New IPC: `fs:watchFile(path)` / `fs:unwatchFile(path)` + `fs:fileChanged`
  event. `fs.watch` on the parent directory filtered by basename (survives
  atomic rename-on-write, which OpenSCAD and many tools use). Ref-counted per
  path; cleaned up when the renderer/window goes away.

### `render_model` tool
- Schema in `saiTools.ts`: `{ path: string, title?: string, openInPanel?: boolean (default true), height?: number }`.
- Validate path exists, extension supported, and inside `renderAllowedRoots`.
- **Version snapshot is taken by main at tool-call time** (not by the card):
  main copies the file into a version cache (`userData/model-cache/`, key =
  content hash) before returning, and puts `{ versionKey, triangles, bbox }` in
  the tool result. So a version is never lost even if the file changes before
  the card mounts or the card never mounts (other workspace in view).
- The cache **persists across restarts**, is cleared when the chat is deleted,
  and has an LRU cap (~200MB). If a version was evicted, the card shows "older
  version unavailable" with an "open current file" action.
- Live card: new render kind `model`, payload `{ path, versionKey }`. It shows
  **that version** and does not live-reload (history semantics). Live reload is
  the code panel's job.
- History card path (`entryFromToolCall`) rebuilds the same entry from the tool
  input + `versionKey` in the tool result.
- **WebGL context budget:** at most **one interactive chat card app-wide**. The
  newest card starts interactive. Other cards show a static thumbnail with a
  "click to rotate" overlay; clicking one makes it interactive and demotes the
  previous one. The thumbnail is the same iso screenshot captured for the agent,
  saved next to the cached mesh as `<versionKey>.png`, so cards rebuilt after a
  restart have an image without drawing anything. The code panel viewer has its
  own context and isn't counted.
- Screenshot: after the mesh is drawn (viewer sets `data-render-ready` on the
  region), `captureRenderRegion` captures it, iso view. It is returned to the
  agent and saved as the version thumbnail.
- `openInPanel` opens the file via the existing `handleFileOpen` path.

### Agent guidance
- Tool description tells agents: for 3D work, export to STL/3MF (e.g.
  `openscad -o out.stl in.scad`) and call `render_model`; re-export to the same
  path to update the panel view.

## Left to the builder

- Exact lighting/material values, toolbar look (match existing ImageViewer
  toolbar styling).
- Exact preset camera angles and thumbnail size.
- Test strategy: unit tests for `isModelFile`, watcher debounce, tool validation,
  `entryFromToolCall`; one e2e story rendering a fixture STL. vitest with
  `--maxWorkers=2`.
