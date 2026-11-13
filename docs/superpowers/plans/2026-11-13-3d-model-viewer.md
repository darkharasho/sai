# 3D Model Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive 3D viewing of `.stl`/`.3mf`/`.obj` in SAI: a live-reloading code-panel viewer that keeps the camera, plus a `render_model` agent tool that drops per-version chat cards and returns a screenshot.

**Architecture:** One lazy-loaded three.js `ModelViewer` component serves both surfaces. Electron main adds a binary read, a file watcher, and a content-addressed version cache (`userData/model-cache/`). The tool snapshots the file in main at call time and puts a `versionKey` in the tool result. The chat card rebuilds from `versionKey` + the screenshot already stored as `tc.resultImages[0]`.

**Tech Stack:** Electron 36, React, TypeScript, three.js (`three`, `three/examples/jsm` loaders + OrbitControls), vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-3d-model-viewer-design.md`

## Global Constraints

- Supported extensions: `.stl`, `.3mf`, `.obj` (case-insensitive). Nothing else.
- three.js is dynamically imported; it must not land in the startup chunk.
- Linux: keep `disable-gpu`; add `enable-unsafe-swiftshader` next to it.
- Render on demand only. No continuous `requestAnimationFrame` loop.
- At most one interactive chat model card app-wide. The code-panel viewer is not counted.
- Model bytes are never inlined into chat records or IndexedDB. They are referenced by `versionKey`.
- Version cache: `userData/model-cache/<versionKey>.<ext>`, `versionKey` = first 32 hex chars of sha256 of the bytes, LRU cap 200 MB (by atime/mtime of the cache file), and launch-time prune of keys no surviving chat references.
- The containment check (`renderAllowedRoots` + cwd) applies to the `render_model` tool only, never to the code panel.
- Never compare paths by string equality. `/home/mstephens` → `/var/home/mstephens` is a symlink; use realpath or basename.
- Watcher reload debounce: 300 ms.
- vitest: `--maxWorkers=2` (the config already sets this; respect it).

## Review Focus

1. **A partially written file mid-export** (OpenSCAD writes in chunks or renames atomically). The viewer keeps the last good mesh and shows an error badge, and the next change retries. Test in Task 4 (`keeps last good mesh when reload fails`).
2. **Atomic rename-on-write** (the file is replaced, not modified). The watcher still fires and keeps firing for later writes. Test in Task 2 (`fires after atomic rename and keeps watching`).
3. **The symlinked home path**: a tool `path` under `/home/mstephens/...` while cwd is `/var/home/mstephens/...`. Containment passes. Test in Task 3 (`accepts path via symlinked home`).
4. **ASCII vs binary STL, and empty or garbage files.** Both STL forms parse. Garbage gives a clean error, not a throw that escapes. Test in Task 1 (`parses ascii and binary stl`, `rejects garbage`).
5. **A history card whose cached version was evicted or pruned.** It shows "older version unavailable" with "open current file" instead of a blank or broken card. Test in Task 7 (`shows unavailable state when cache miss`).

---

### Task 1: three.js dependency + model parsing core

**Files:**
- Modify: `package.json` (add `three`, `@types/three`)
- Create: `src/model3d/modelFiles.ts`
- Create: `src/model3d/parseModel.ts`
- Test: `tests/unit/model3d/parseModel.test.ts`, `tests/unit/model3d/modelFiles.test.ts`
- Fixtures: `tests/fixtures/model3d/cube-ascii.stl`, `cube-binary.stl` (generate binary in the test via a helper, or commit a 12-triangle file), `cube.obj`

**Interfaces:**
- Produces:
  - `type ModelExt = 'stl' | '3mf' | 'obj'`
  - `isModelFile(path: string): boolean`
  - `modelExt(path: string): ModelExt | null`
  - `interface ParsedModel { object: THREE.Object3D; triangles: number; size: { x: number; y: number; z: number }; box: THREE.Box3 }`
  - `parseModel(buf: ArrayBuffer, ext: ModelExt): Promise<ParsedModel>`. It imports `three` and loaders dynamically, and throws `Error('invalid model: <reason>')` on empty or unparseable input.

- [ ] **Step 1:** `npm i three && npm i -D @types/three`
- [ ] **Step 2: Write failing tests**
  - `isModelFile`: `'a.STL'`→true, `'a.3mf'`→true, `'a.obj'`→true, `'a.step'`→false, `'stl'`→false.
  - `parses ascii and binary stl`: cube → `triangles === 12`, `size` ≈ `{x:10,y:10,z:10}` (fixture is a 10 mm cube).
  - `parses obj`: same cube → 12 triangles.
  - `rejects garbage`: `parseModel(new TextEncoder().encode('hello').buffer,'stl')` rejects with `/invalid model/`. Also an empty buffer rejects.
- [ ] **Step 3:** Run `npx vitest run tests/unit/model3d` → FAIL (module missing).
- [ ] **Step 4:** Implement. Use STLLoader/3MFLoader/OBJLoader `.parse()`. Material: `MeshStandardMaterial({ color: 0xb8c4d0, metalness: 0.1, roughness: 0.6, flatShading: false })` on STL geometry, after `computeVertexNormals()` if normals are missing. Count triangles over all meshes (indexed: `index.count/3`, else `position.count/3`). Treat 0 triangles as invalid.
- [ ] **Step 5:** Tests pass.
- [ ] **Step 6:** Check that three is not in the startup chunk: `npx vite build` and confirm `three` appears only in a separate chunk (grep the build manifest or chunk names). Skip if the system load is high, and note it for Task 8.
- [ ] **Step 7:** Commit `feat(model3d): three.js model parsing core`.

### Task 2: Electron binary read, file watcher, SwiftShader switch

**Files:**
- Create: `electron/services/fileWatch.ts`
- Modify: `electron/services/fs.ts` (register IPC), `electron/preload.ts`, `src/vite-env.d.ts` or wherever `window.sai` is typed, `electron/main.ts:162-164`
- Test: `tests/unit/electron/fileWatch.test.ts`

**Interfaces:**
- Produces (main):
  - `createFileWatchRegistry(onChange: (absPath: string) => void, opts?: { debounceMs?: number }): { watch(p: string): void; unwatch(p: string): void; disposeAll(): void }`. Watches the **parent dir** with `fs.watch` and filters by basename. Ref-counted per realpath'd parent+basename. Debounce default 300.
- Produces (IPC / `window.sai`):
  - `fsReadFileBuffer(path: string): Promise<ArrayBuffer>` (`fs:readFileBuffer`)
  - `fsWatchFile(path: string): Promise<void>` / `fsUnwatchFile(path: string): Promise<void>`
  - `onFsFileChanged(cb: (path: string) => void): () => void` (event `fs:fileChanged`, path = the path originally passed to `watch`)
  - Watches are tied to the sender webContents and are disposed on `destroyed`.

- [ ] **Step 1: Failing tests** (real tmp dir, `debounceMs: 50`):
  - `fires once for a burst of writes` (3 writes within 20 ms → 1 call).
  - `fires after atomic rename and keeps watching` (write `x.tmp` then rename over `x.stl` → fires; repeat → fires again).
  - `ignores sibling files` (writing `y.stl` → no call).
  - `ref-counted unwatch` (watch twice, unwatch once → still fires; unwatch again → no call).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the registry, IPC, preload and typings. In `main.ts`, add `app.commandLine.appendSwitch('enable-unsafe-swiftshader')` inside the existing linux block, with a comment that WebGL runs on SwiftShader because the GPU is disabled.
- [ ] **Step 4:** Tests pass. Also run `tests/unit/preload.test.ts`.
- [ ] **Step 5:** Commit `feat(fs): binary read + debounced file watcher; keep swiftshader WebGL on linux`.

### Task 3: Model version cache (main)

**Files:**
- Create: `electron/services/modelCache.ts`
- Modify: `electron/services/renderProtocol.ts` (export `resolveContained`), `electron/main.ts` (IPC registration next to `renderAllowedRoots`), `electron/preload.ts`, typings
- Test: `tests/unit/electron/modelCache.test.ts`

**Interfaces:**
- Produces (main, pure-ish with injectable `dir`):
  - `snapshotModel(opts: { cwd: string; path: string; allowedRoots: string[]; dir: string; capBytes?: number }): { ok: true; versionKey: string; ext: ModelExt; absPath: string; bytes: number } | { ok: false; error: string }`. Errors: `path not found: …`, `path escapes workspace: …`, `unsupported model type: …`. Paths are resolved against cwd when relative.
  - `readCachedModel(versionKey: string, dir: string): Buffer | null`. `versionKey` must match `/^[0-9a-f]{32}$/`, otherwise null.
  - `pruneModelCache(referencedKeys: string[], dir: string): { deleted: number; freedBytes: number }`
  - `enforceCap(dir: string, capBytes: number): void`. Evicts oldest by mtime; snapshot touches the mtime on a cache hit.
- IPC / `window.sai`: `modelSnapshot({cwd, path})` (`model:snapshot`), `modelReadCached(versionKey): Promise<ArrayBuffer | null>`, `pruneModelCache(keys: string[])`.

- [ ] **Step 1: Failing tests** (tmp dirs):
  - `snapshots and dedupes by content` (same bytes twice → same key, one file).
  - `rejects path outside roots` → `/escapes workspace/`.
  - `accepts path via symlinked home`: create `real/` plus a symlink `link → real`, cwd = `real`, path = `link/m.stl` → ok.
  - `rejects unsupported ext` (`.step`).
  - `readCachedModel rejects malformed key` (`'../x'` → null).
  - `prune keeps referenced, deletes rest`.
  - `enforceCap evicts oldest first`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Reuse `resolveContained` (export it). Cap default `200 * 1024 * 1024`. Wire IPC with `dir = path.join(app.getPath('userData'), 'model-cache')` and `allowedRoots = renderAllowedRoots(cwd)`.
- [ ] **Step 4:** Tests pass. Also run `tests/unit/electron/renderProtocol.test.ts`.
- [ ] **Step 5:** Commit `feat(model3d): content-addressed model version cache`.

### Task 4: `ModelViewer` component

**Files:**
- Create: `src/model3d/viewState.ts` (pure camera math), `src/model3d/ModelViewer.tsx`, `src/model3d/ModelViewer.css`
- Test: `tests/unit/model3d/viewState.test.ts`, `tests/unit/components/ModelViewer.test.tsx`

**Interfaces:**
- Consumes: `parseModel`, `ParsedModel`, `ModelExt` (Task 1).
- Produces:
  - `viewState.ts`:
    - `type Preset = 'iso' | 'front' | 'top' | 'right'`
    - `framingFor(box: {min:V3,max:V3}, preset: Preset, fovDeg: number): { position: V3; target: V3; near: number; far: number }`
    - `nextView(prev: { position: V3; target: V3 } | null, box): 'fit' | 'keep'`. Returns `'fit'` only when `prev` is null.
  - `ModelViewer` props: `{ load: () => Promise<{ buf: ArrayBuffer; ext: ModelExt }>; reloadToken?: number; interactive?: boolean (default true); toolbar?: boolean (default true); onReady?: (info: { triangles: number; size: {x,y,z} }) => void; onError?: (msg: string) => void; height?: number | '100%' }`.
  - A change in `reloadToken` re-runs `load`, swaps the geometry and keeps the camera. On failure it keeps the previous mesh and shows `.model-viewer-error` with the message.
  - When the first frame is drawn it sets `data-render-ready="true"` on its root element.
  - When WebGL can't start, it renders `<div class="model-viewer-unavailable">3D view unavailable (WebGL could not start)</div>`.
  - Toolbar: Reset view, Iso/Front/Top/Right, Wireframe toggle. Status line: `{triangles} triangles · {x}×{y}×{z} mm`, numbers to 1 decimal. Match the `ImageViewer` toolbar styling (`zoomBtnStyle` look, lucide icons).
  - Scene: HemisphereLight + DirectionalLight that follows the camera, GridHelper sized to about 2× the max footprint at z-min, theme background from `var(--sai-surface)`. Use the Z-up convention for STL/3MF (`camera.up = (0,0,1)`, rotate the grid to the XY plane). OBJ is Y-up: rotate the OBJ object +90° about X to match.

- [ ] **Step 1: Failing tests**
  - `viewState`: `nextView(null, box) === 'fit'`. `nextView(prev, box) === 'keep'`. `framingFor(cube10, 'top')` has `target` = box center, and the position lies along +Z from the center at a distance where the whole box fits the fov.
  - `ModelViewer` (jsdom, with `three`'s `WebGLRenderer` mocked to throw) → renders the unavailable text.
  - `keeps last good mesh when reload fails`: mock the renderer (no-op `render`). First `load` resolves to the cube. Bump `reloadToken` with a `load` that rejects. Assert `.model-viewer-error` is shown, `onReady` was called exactly once, and the status line still shows `12 triangles`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Redraw on OrbitControls `change`, on resize (ResizeObserver) and on load. Never start a loop. Dispose the geometry, materials, renderer and controls on unmount. Guard against the StrictMode double effect with a self-guard (see memory `feedback_strictmode_force_completes_imperative_animations`). `interactive=false` means no controls are attached.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(model3d): interactive ModelViewer`.

### Task 5: Code panel integration with live reload

**Files:**
- Create: `src/model3d/useFileWatch.ts`
- Modify: `src/components/CodePanel/CodePanel.tsx:319` (add a branch before/after the image branch)
- Test: `tests/unit/model3d/useFileWatch.test.ts`, extend an existing CodePanel test if one exists (else `tests/unit/components/CodePanel.model.test.tsx`)

**Interfaces:**
- Consumes: `fsReadFileBuffer`, `fsWatchFile`, `fsUnwatchFile`, `onFsFileChanged` (Task 2); `ModelViewer`, `isModelFile`, `modelExt`.
- Produces: `useFileWatch(path: string | null): number`. Returns a counter that increments on each change event for `path`. It watches on mount or path change and unwatches on cleanup.

- [ ] **Step 1: Failing tests:** `useFileWatch` increments when the mocked `onFsFileChanged` fires with the same path, ignores other paths, and calls `fsUnwatchFile` on unmount. CodePanel with an active file `part.stl` (editor viewMode) renders `ModelViewer` (it can be mocked) and not Monaco.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Render `<ModelViewer load={() => fsReadFileBuffer(path).then(buf => ({buf, ext}))} reloadToken={useFileWatch(path)} height="100%" />`. No containment check.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(code-panel): open stl/3mf/obj in live-reloading 3D viewer`.

### Task 6: `render_model` tool (live path)

**Files:**
- Modify: `src/lib/saiTools.ts` (schema after `render_mermaid`), `src/render/renderStore.ts` (`RenderKind` += `'model'`), `src/App.tsx` (route `render_model` before the generic `render_` branch, near line 738)
- Create: `src/render/renderModelTool.ts`, `src/model3d/renderThumbnail.ts`
- Test: `tests/unit/render/renderModelTool.test.ts`

**Interfaces:**
- Consumes: `modelSnapshot`, `modelReadCached` (Task 3); `parseModel` (Task 1); `framingFor` (Task 4).
- Produces:
  - Schema `render_model`, toolset `'chat'`, input `{ path: string (required), title?: string, openInPanel?: boolean (default true), height?: number }`. The description is copied verbatim:
    > "Show a 3D model (.stl, .3mf, .obj) as an interactive, rotatable view inside SAI and return a screenshot. USE THIS for any 3D/CAD work instead of describing the mesh or rendering images with external tools. For OpenSCAD: export first (`openscad -o part.stl part.scad`), then call this with the .stl path. Re-export to the same path to update the open panel view; call again to add a new version card to the chat."
  - `renderModelThumbnail(buf: ArrayBuffer, ext: ModelExt, opts?: { width?: number; height?: number }): Promise<{ base64: string; triangles: number; size: {x,y,z} }>`. Uses an offscreen `WebGLRenderer({ preserveDrawingBuffer: true })` on a detached canvas, iso framing, 640×480 by default, then disposes everything.
  - `handleRenderModelRequest(req: { input: any; renderId: string; cwd: string }, deps: { snapshot: typeof window.sai.modelSnapshot; readCached: …; thumbnail: typeof renderModelThumbnail; openInPanel: (absPath: string) => void }): Promise<RenderModelResult>`, where
    `RenderModelResult = { ok: true; renderId: string; model: { versionKey: string; path: string; triangles: number; size: {x,y,z} }; __mcpImage?: CapturedImage } | { ok: false; error: string }`.
  - On success it upserts the renderStore entry `{ kind: 'model', payload: { path: absPath, versionKey, ext }, title: title || basename(path), width: 480, height: height ?? 360, status: 'ready' }`.
  - A thumbnail failure is best-effort: the result is still ok, without `__mcpImage`, and `triangles`/`size` come from `parseModel` if that worked.

- [ ] **Step 1: Failing tests** (deps mocked):
  - The happy path returns the `model.versionKey` and `__mcpImage` from deps, upserts the store with kind `model`, and calls `openInPanel` with `absPath` exactly once.
  - `openInPanel: false` means it is never called.
  - A snapshot error is passed through as `{ ok:false, error }` and nothing is upserted.
  - When the thumbnail throws, the result is ok with no `__mcpImage`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. In `App.tsx`, `openInPanel` calls `handleFileOpen` through a ref (`handleFileOpenRef.current`), because `handleFileOpen` is declared after the tool-request effect. Pass `cwd = activeProjectPathRef.current ?? ''`. Check whether a test asserts on the `SAI_TOOL_SCHEMA` tool list (`grep -rn "render_mermaid" tests`) and update it.
- [ ] **Step 4:** Tests pass. Also run `tests/unit/render` and `tests/unit/electron/jsonSchemaToZod.test.ts`.
- [ ] **Step 5:** Commit `feat(render): render_model tool with version snapshot + screenshot`.

### Task 7: Chat model card (history path, one-live budget, prune)

**Files:**
- Create: `src/model3d/activeModelCard.ts`, `src/components/Chat/ModelCard.tsx`
- Modify: `src/components/Chat/RenderToolCallCard.tsx` (`entryFromToolCall` + the code-tab lang), `src/components/Chat/RenderToolCard.tsx` (`RenderRegion` branch for `kind === 'model'`), `src/App.tsx:3281-3293` (add `n.endsWith('sai_render_model')`), `src/chatDb.ts` (add `dbCollectReferencedModelKeys`), `src/App.tsx:~113` (prune alongside `pruneOrphanToolImages`)
- Test: `tests/unit/render/renderToolCallCard.entry.test.ts` (extend), `tests/unit/components/ModelCard.test.tsx`, `tests/unit/model3d/activeModelCard.test.ts`, `tests/unit/chatDb.test.ts` (extend)

**Interfaces:**
- Consumes: `ModelViewer` (Task 4), `modelReadCached` (Task 3), `RenderModelResult` shape in `tc.output` (Task 6).
- Produces:
  - `extractModelResult(output: string | undefined): { versionKey: string; path: string } | null`. It parses the JSON tool output and, failing that, falls back to the regex `/"versionKey"\s*:\s*"([0-9a-f]{32})"/`.
  - `entryFromToolCall` for `sai_render_model` → `{ kind: 'model', payload: { path, versionKey, ext, thumbnailPath: tc.resultImages?.[0]?.filePath }, title, width: 480, height }`. It returns null if the input has no `path`. A missing `versionKey` (tool still running or failed) gives `versionKey: null`.
  - `activeModelCard`: `claim(renderId)`, `release(renderId)`, `useIsActiveModelCard(renderId): boolean`. Module-level, single active id, subscribe-based. A new claim demotes the previous card.
  - `ModelCard` props `{ renderId; path; versionKey: string | null; ext; thumbnailPath?: string; height: number; isNewest: boolean }`. The newest card claims on mount. When active it renders `ModelViewer` with `load = modelReadCached(versionKey)`. When inactive it renders the thumbnail `<img>` (via `fsReadFileBase64(thumbnailPath)`) with a "Click to rotate" overlay, and clicking claims. On a cache miss it shows `Older version unavailable` plus an `Open current file` button that calls the app's file-open (pass it through the existing card props or context; follow how cards open files today if they do, otherwise add an `onOpenFile` prop threaded from `renderToolCall`).
  - `dbCollectReferencedModelKeys(): Promise<string[]>`. Scans `toolCalls` whose name ends in `sai_render_model` and runs `extractModelResult(tc.output)` on each.
  - "Newest": a card counts as newest if its `tc` is the last `sai_render_model` call in its chat. Compute this in `ChatPanel`/`renderToolCall` if it's cheap. Otherwise use the simpler rule: a card claims on mount only if no claim happened in the last 2 s of app time *and* it was created this session (`tc.startedAt` > app start). Pick one and note it in the commit.

- [ ] **Step 1: Failing tests**
  - entry: input `{path:'a.stl'}` + output `{"ok":true,"model":{"versionKey":"<32hex>",...}}` + resultImages `[{filePath:'/x/y.png'}]` → kind `model`, payload has the key and the thumbnailPath.
  - `activeModelCard`: claim A, claim B → A inactive, B active. Release B → none active.
  - `ModelCard`: `shows unavailable state when cache miss` (`modelReadCached` → null) shows the text and the button. Inactive with a thumbnail renders an `img` and no ModelViewer. Clicking it renders ModelViewer (mocked).
  - `dbCollectReferencedModelKeys` returns the keys from stored render_model calls and ignores other tools.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Prune in App: `pruneModelCache(await dbCollectReferencedModelKeys())` in the same once-per-launch spot, *after* `dbPurgeExpired`.
- [ ] **Step 4:** Tests pass. Also run `npx vitest run tests/unit/render tests/unit/model3d tests/unit/components`.
- [ ] **Step 5:** Commit `feat(chat): per-version 3D model cards with one-live WebGL budget`.

### Task 8: Typecheck, build, live verification

- [ ] **Step 1:** `npx tsc --noEmit -p .` (and the electron tsconfig if separate) → no errors.
- [ ] **Step 2:** `npx vitest run` → all pass (the config caps workers at 2). If the system load guard reports WARNING, run only the touched dirs and say so.
- [ ] **Step 3:** `npx vite build`: check three.js is in its own chunk, not the entry chunk.
- [ ] **Step 4 (live, needs the app restarted for the new MCP tool):** Make a test part: `flatpak run org.openscad.OpenSCAD -o /tmp/part.stl part.scad` (any small .scad). Open `/tmp/part.stl` in the code panel and confirm it rotates smoothly under SwiftShader. Re-export with a change and confirm it reloads and the camera angle stays. Call `render_model` twice with different versions and confirm two cards: the newest is live and the older shows a thumbnail, clicking the older swaps which one is live, and each shows its own version. Restart SAI and confirm the history cards still show their versions.
- [ ] **Step 5:** Record the results (pass/fail per item) in the PR description. Don't claim live verification that didn't happen.
