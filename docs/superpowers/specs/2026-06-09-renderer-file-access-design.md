# In-App Renderer: File Access ("render like HTML sites")

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan

## Problem

The in-app renderer (`sai_render_html` and the `RenderToolCallCard` →
`RenderedHtml` path) embeds HTML as `srcDoc` in an opaque-origin sandbox
(`sandbox="allow-scripts"`) with a strict CSP:

```
default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;
```

This deliberately blocks **all** file and network access. Relative references
(`<link href="styles.css">`, `<img src="logo.png">`, `<script src="app.js">`)
fail, so only a single self-contained string can render — not a real
multi-file site.

Goal: let the renderer load real HTML sites from disk, resolving their CSS / JS
/ image assets, so it renders "like an HTML site."

## Decisions (from brainstorming)

- **Source:** support **both** a `path` (file/folder on disk) and **inline
  HTML** that can pull in local assets.
- **File-access scope:** the **current workspace** — renders may read files
  under the active workspace root, nothing outside.
- **Network:** **allowed** — rendered sites may load CDN scripts, fonts, call
  APIs, etc.
- **Approach:** **custom Electron protocol** (`sai-render://`) — rejected
  `file://`+`allow-same-origin` (can't bound to workspace) and inline-bundling
  (breaks runtime fetch / dynamic imports).

### Accepted residual risk

"Allow network" + "workspace scope" together mean rendered JS can read any
workspace file **and** send it over the network. This is inherent to those two
choices and will be documented at the tool boundary so it is a conscious call.

## Architecture

### Two rendering modes, chosen automatically

- **Inline-only (unchanged):** `sai_render_html({ html })` with no file access
  keeps today's behavior exactly — opaque-origin `srcDoc` sandbox, strict CSP,
  auto-height (`HEIGHT_REPORTER`), submit bridge. Fully backward compatible.
- **File-backed (new):** triggered when the call includes `path` **or**
  `baseDir`. Routes through the `sai-render://` custom protocol.

### File-backed data flow

1. `entryFromToolCall` (`src/components/Chat/RenderToolCallCard.tsx`) detects
   `path` / `baseDir` and builds a `mode: 'file'` entry carrying
   `{ path?, html?, baseDir?, height? }`. Stays **synchronous** — no IPC here.
2. `RenderedHtml` (`src/components/Chat/RenderToolCard.tsx`) sees `mode: 'file'`
   and calls a new IPC `window.sai.renderMintFileUrl(payload)` on mount.
3. Main process validates the path is inside the **active workspace root**,
   mints a crypto-random `<token>`, stores `{ root, inlineHtml? }` in a token
   map, and returns `sai-render://<token>/<entry>`.
4. The iframe renders with `src={url}` (instead of `srcDoc`). The protocol
   handler serves every asset request, re-checking workspace containment per
   request.

The protocol handler is the **single chokepoint** for the workspace boundary;
entry-building stays sync while token-minting is async on mount.

## Security model

**Protocol registration:** register `sai-render` via
`protocol.registerSchemesAsPrivileged` **before** app-ready as
`{ standard: true, secure: true, supportFetchAPI: true, stream: true }`, then
`protocol.handle('sai-render', …)` after ready.

**Workspace containment (per request):**

- Resolve the requested path against the token's stored `root`:
  `path.resolve(root, relPath)`.
- `fs.realpathSync` both the candidate and `root`, then require the real
  candidate to equal `root` or start with `root + path.sep`. Realpath-then-check
  defeats `../` traversal **and** symlink escapes.
- Reject (403/404) anything outside the root, any request whose token root is
  unknown, and any unknown token.

**Origin & sandbox:** the iframe origin becomes `sai-render://<token>` — a
distinct origin, **not** the app's. Sandbox is
`allow-scripts allow-same-origin`. `allow-same-origin` lets the page `fetch()`
its own assets; because the origin is not the app's, rendered JS still cannot
touch the app DOM, storage, or IPC. File reads remain bounded by the handler.

**CSP** (set as a **response header** by the handler, since `src` mode cannot
use the srcDoc `<meta>`):

```
default-src 'self' sai-render:;
script-src 'self' sai-render: https: 'unsafe-inline';
style-src 'self' sai-render: https: 'unsafe-inline';
img-src 'self' sai-render: https: data:;
font-src 'self' sai-render: https: data:;
connect-src 'self' sai-render: https:;
```

No `file:`.

**Token lifecycle:** crypto-random tokens in an in-memory `Map`, evicted when
the render unmounts and on a TTL sweep, with a max-entries cap so a long session
cannot accumulate roots.

## Tool schema changes

`sai_render_html` (`src/lib/saiTools.ts`) gains three optional fields:

- `path` (string) — file or folder in the workspace to render. A folder
  resolves to its `index.html`.
- `baseDir` (string) — for inline `html`, the workspace dir that relative assets
  resolve against.
- `height` (number) — viewport height in px for file-backed renders.

**Validation / precedence:**

- `path` alone → real site.
- `html` + `baseDir` → inline with assets.
- `html` alone → today's behavior (unchanged).
- If both `path` and `html` are given, **`path` wins**.
- All paths are workspace-relative or absolute-within-workspace; anything
  outside is rejected at mint time with a clear error shown on the card.

## Viewport / height

Auto-height (the `HEIGHT_REPORTER` postMessage trick) only works when we control
the document, i.e. inline mode. File-backed (`path`) renders serve files
verbatim, so they use `height` (default **480**) and rely on the existing
**pop-out** and **Open ↗** for a bigger view.

`Open ↗` for a `path` render opens the real entry file URL in the system browser
rather than writing a temp copy. Inline renders keep the existing temp-file
behavior.

## Components touched

- `electron/main.ts` (or new `electron/services/renderProtocol.ts`) — scheme
  registration, `protocol.handle`, token map, containment guard, `render:mintFileUrl`
  IPC, extended `render:openInBrowser`.
- `electron/preload.ts` — expose `renderMintFileUrl`.
- `src/components/Chat/RenderToolCallCard.tsx` — `entryFromToolCall` produces
  `mode:'file'` entries.
- `src/components/Chat/RenderToolCard.tsx` — `RenderedHtml` chooses `src` vs
  `srcDoc`; async URL mint on mount for file mode.
- `src/render/renderStore.ts` — `RenderEntry` payload gains the file-mode shape.
- `src/lib/saiTools.ts` — schema fields + boundary doc.
- `src/test-harness/stories/render-tool-call-card.tsx` — file-backed story.

## Testing

**Unit (vitest, `--maxWorkers=2`):**

- *Protocol handler containment* (security core): `../` traversal, absolute
  paths outside root, symlink-escape (realpath check), unknown token, unknown
  root all rejected; in-bounds asset served with correct content-type + CSP
  header.
- *Token lifecycle*: mint returns a scoped URL; eviction on unmount; TTL /
  max-cap sweep.
- *`entryFromToolCall`*: `path` → `mode:'file'`; `html`+`baseDir` →
  `mode:'file'` with inline; `html` alone → unchanged inline path; `path` wins
  over `html`.
- *`RenderedHtml`*: `mode:'file'` renders `src=` + `allow-same-origin`; inline
  stays `srcDoc` opaque.

**E2E (`tests/e2e/sai-render.spec.ts`):** a fixture mini-site (`index.html` +
`style.css` + `script.js` + an image) driven through the harness; assert the
stylesheet applies, the script runs, and the image loads (multi-file
resolution). Plus a negative case: a render whose HTML tries to fetch a path
outside the workspace is blocked.

**Test-harness story:** add a file-backed render story so it is visible in the
harness.
