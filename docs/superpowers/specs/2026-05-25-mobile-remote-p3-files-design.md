# Mobile Remote — Phase 3: Files (read-only) Design

Status: design spec. Implementation plan follows.

Parent roadmap: `2026-05-25-mobile-remote-roadmap.md`.
P0 (foundation), P1 (chat + approvals), P2 (workspaces + overrides) are all merged.

## Scope

Phase 3 adds a read-only **Files** surface to the phone PWA so you can:

1. Review the agent's pending changes (modified/added/deleted files + per-file diffs) — the primary use case
2. Browse the workspace's file tree and view file contents with syntax highlighting
3. Switch repos within meta workspaces via a per-repo chip strip

No editing, no git operations, no commit/branch history viewing — those are later phases.

## Goals

1. From the phone, opening **Files → Changes** lists every modified file in the active workspace within ~500ms.
2. Tapping a modified file shows a unified diff with Shiki syntax-colored +/- gutters.
3. Tapping a clean file in **Browse** shows its content with the same Shiki theme the desktop uses.
4. Meta workspaces show member-repo chips; selecting a chip narrows all four operations (list/read/status/diff) to that member's repo.
5. Files larger than 64KB or non-text MIME types are served via a signed single-use HTTP URL instead of inlined into a WS frame.

## Non-goals

- Editing (Phase 6 — Monaco on touch)
- Git operations from phone — stage, commit, push (Phase 4)
- File search
- Diff between branches / by commit
- Renderer-proxy detour — main has direct fs/git access, no IPC roundtrip needed

## Architecture

```
phone PWA
   ⇄ WS
electron/services/remote/bridge-server.ts
   ├─ new inbound: files.list, files.read, files.status, files.diff
   ├─ new outbound: *.result frames carrying reqId
   └─ delegates to extracted impls from fs.ts + git.ts

electron/services/fs.ts (modify)
   ├─ extract: readDirImpl, readFileImpl, statFileImpl
   └─ existing ipcMain.handle bodies become one-liners (P1 pattern)

electron/services/git.ts (modify)
   ├─ extract: gitStatusImpl, gitDiffImpl
   └─ same one-liner refactor for ipcMain handlers

electron/services/remote/blob-server.ts (new)
   ├─ HMAC + nonce signed single-use URLs (port of P0 screenshot-urls.ts
   │  with broader scope: file blobs of any MIME)
   └─ bridge-server.ts gains a GET /blob/<id>?... route

src/renderer-remote/files/ (new)
   ├─ Files.tsx          orchestrator (sub-tabs: Changes | Browse, repo chips)
   ├─ ChangesView.tsx    modified files list + DiffViewer
   ├─ BrowseView.tsx     lazy tree + FileViewer
   ├─ FileViewer.tsx     Shiki-highlighted text or image preview
   ├─ DiffViewer.tsx     unified +/- with green/red gutters
   ├─ RepoPicker.tsx     horizontal chip strip for meta workspaces
   └─ shiki.ts           lazy-loaded singleton highlighter

src/renderer-remote/chat/Tabs.tsx (new)
   └─ Chat / Files segmented control at the very top

src/renderer-remote/App.tsx (modify)
   └─ routes between Chat and Files based on tab state
```

## Wire protocol

All client→server frames carry `reqId`. Server replies correlate via the existing `wire.ts` pendingReq dispatcher (extended for the new `.result` types).

### Client → Server

```jsonc
{ "type": "files.list",   "cwd": "/path/to/repo", "path": "src/components", "reqId": "..." }
{ "type": "files.read",   "cwd": "/path/to/repo", "path": "src/App.tsx",    "reqId": "..." }
{ "type": "files.status", "cwd": "/path/to/repo",                            "reqId": "..." }
{ "type": "files.diff",   "cwd": "/path/to/repo", "path": "src/App.tsx",
                          "staged": false,                                   "reqId": "..." }
```

`cwd` semantics:
- Plain workspace: `activeWorkspace.projectPath`
- Meta workspace: the **member project path** of whichever chip the user picked. The Files orchestrator owns this state; the active workspace's projectPath only seeds the initial repo chip selection.

### Server → Client

```jsonc
{ "v": 1, "type": "files.list.result", "reqId": "...",
  "entries": [
    { "name": "App.tsx", "kind": "file", "size": 12345, "ignored": false },
    { "name": "components", "kind": "dir" }
  ]
}

// Text file, inlined when size <= 64KB and decodable as UTF-8
{ "v": 1, "type": "files.read.result", "reqId": "...",
  "content": "...", "encoding": "text", "size": 1234, "lang": "tsx" }

// Binary OR text > 64KB: phone fetches via signedUrl
{ "v": 1, "type": "files.read.result", "reqId": "...",
  "signedUrl": "/blob/<id>?exp=...&nonce=...&sig=...",
  "encoding": "binary", "size": 524288, "mime": "image/png" }

{ "v": 1, "type": "files.status.result", "reqId": "...",
  "entries": [
    { "path": "src/App.tsx", "status": "modified", "staged": false },
    { "path": "new.txt",      "status": "added",    "staged": true  }
  ]
}

{ "v": 1, "type": "files.diff.result", "reqId": "...",
  "diff": "--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ ...",
  "lang": "tsx"
}

// Generic error reply (existing P1 frame; reused)
{ "v": 1, "type": "error", "reqId": "...?", "code": "path_escape" | "not_a_repo" | "read_failed", "message": "..." }
```

Status values match git porcelain: `modified | added | deleted | renamed | copied | untracked | unmerged`.

### Blob endpoint

```
GET /blob/<id>?exp=<unix>&nonce=<rand>&sig=<hmac>
```

Validated by the BlobUrlSigner (~ScreenshotUrlSigner with broader scope). Single-use; second fetch returns 401. TTL 60s. Server resolves `<id>` to a `{ cwd, path }` pair via an in-memory map populated when `files.read.result` returns a signedUrl, then streams the bytes back with the correct `Content-Type`. Path-traversal guard same as the static asset route.

## Main-process integration

### `electron/services/fs.ts`

Extract these from the existing IPC handler bodies:

```ts
export async function readDirImpl(dirPath: string): Promise<{ name: string; kind: 'file' | 'dir'; size?: number }[]> { ... }
export async function readFileImpl(filePath: string): Promise<string> { ... }
export async function readFileBufImpl(filePath: string): Promise<Buffer> { ... }
export async function statFileImpl(filePath: string): Promise<{ size: number; isDir: boolean; mtime: number }> { ... }
```

The existing `ipcMain.handle('fs:readDir', ...)` etc. become one-liners that call the impl. Same refactor pattern as P1's `sendImpl` extraction.

### `electron/services/git.ts`

Same pattern:

```ts
export async function gitStatusImpl(cwd: string): Promise<{ path: string; status: string; staged: boolean }[]> { ... }
export async function gitDiffImpl(cwd: string, filepath: string, staged: boolean): Promise<string> { ... }
```

`git:status` and `git:diff` IPC handlers become one-liners.

### `electron/services/remote/blob-server.ts` (new, ~80 LOC)

Two responsibilities:

1. Sign a fresh URL for `{ cwd, path }`. Stores the pair under a random `id` in an in-memory `Map`. Returns the URL `/blob/<id>?exp=&nonce=&sig=`.
2. Verify + resolve a URL on incoming GET request. Returns the `{ cwd, path }` or `null`. Deletes the entry (single-use).

The crypto is identical to `screenshot-urls.ts`. Cleanest approach: rename `screenshot-urls.ts` → `blob-urls.ts` and re-export both class names so any P0/Phase 3 code can use whichever name. Or just keep `ScreenshotUrlSigner` as the underlying class and add a thin `BlobStore` that maps `id → { cwd, path }`.

**Decision**: keep ScreenshotUrlSigner as the crypto primitive (signs an opaque id). Add `BlobStore` separately:

```ts
export class BlobStore {
  private map = new Map<string, { cwd: string; path: string; expiresAt: number }>();
  register(cwd: string, path: string, ttlMs = 60_000): string { /* returns id */ }
  consume(id: string): { cwd: string; path: string } | null { /* removes + returns or null */ }
}
```

### `electron/services/remote/bridge-server.ts`

Extend `BridgeServerOpts` with four callbacks + a `loadBlob` for the GET route:

```ts
listFiles?:   (cwd: string, path: string) => Promise<FileEntry[]>;
readFile?:    (cwd: string, path: string) => Promise<ReadResult>;
statusFiles?: (cwd: string) => Promise<StatusEntry[]>;
diffFile?:    (cwd: string, path: string, staged: boolean) => Promise<DiffResult>;
loadBlob?:    (id: string) => Promise<{ buffer: Buffer; mime: string } | null>;
```

Four new WS message handlers (each ~10 lines, validation + delegation + reply). Plus a new HTTP route:

```ts
if (req.method === 'GET' && req.url?.startsWith('/blob/')) return this.handleBlob(req, res);
```

`handleBlob` parses the signed URL, validates via the signer, loads via `opts.loadBlob`, streams the bytes with the right `Content-Type`. 401 on bad signature, 404 if id has been consumed.

### `electron/main.ts`

Inject the new callbacks into the bridge construction:

```ts
const blobStore = new BlobStore();

listFiles: (cwd, path) => readDirImpl(safeJoin(cwd, path)),
readFile: async (cwd, path) => {
  const fp = safeJoin(cwd, path);
  const stat = await statFileImpl(fp);
  // Heuristic: text iff text-y mime AND size <= 64KB
  if (looksTexty(fp) && stat.size <= 64 * 1024) {
    const content = await readFileImpl(fp);
    return { content, size: stat.size, encoding: 'text', lang: langFromPath(fp) };
  }
  const id = blobStore.register(cwd, path);
  const signedUrl = bridge!.signScreenshotUrl(id); // BlobStore id signed by the existing signer
  return { signedUrl, size: stat.size, encoding: 'binary', mime: mimeFromPath(fp) };
},
statusFiles: (cwd) => gitStatusImpl(cwd),
diffFile: (cwd, path, staged) => gitDiffImpl(cwd, path, staged).then((diff) => ({ diff, lang: langFromPath(path) })),
loadBlob: async (id) => {
  const entry = blobStore.consume(id);
  if (!entry) return null;
  const buffer = await readFileBufImpl(safeJoin(entry.cwd, entry.path));
  return { buffer, mime: mimeFromPath(entry.path) };
},
```

`safeJoin(cwd, relPath)` resolves `relPath` against `cwd` and throws if the resolved path escapes `cwd`. Bridge wraps the four file impl calls in a try/catch that converts a `path_escape` throw into an error reply.

## Renderer changes

None. P3 is entirely main-process + PWA; no renderer-proxy needed because fs/git are accessible from main directly.

## PWA changes

### `src/renderer-remote/chat/Tabs.tsx` (new)

Small segmented control at the very top:

```tsx
[ Chat | Files ]
```

Sits above the workspace header so the workspace switcher applies to both tabs.

### `src/renderer-remote/files/` (new)

Components, all themed against SAI tokens:

- **Files.tsx** — orchestrator. State: `currentCwd` (defaults to active workspace's projectPath; meta picks via RepoPicker). Subtabs: `Changes | Browse`. Default `Changes`.
- **RepoPicker.tsx** — horizontal chip strip; hidden for plain workspaces. Each chip shows the member name with a Folder icon.
- **ChangesView.tsx** — calls `client.statusFiles(cwd)`, renders a list of entries with status icons (M/A/D/R in `--orange`/`--green`/`--red`/`--blue`). Tap an entry → calls `client.diffFile(cwd, path)` → renders DiffViewer below.
- **BrowseView.tsx** — lazy tree. Each dir node tracks its `expanded` state; on expand fetches children via `client.listFiles`. Tap a file → calls `client.readFile` → renders FileViewer below.
- **FileViewer.tsx** — Shiki-highlighted code with line numbers. For binary files with image MIME, renders `<img src={signedUrl}>`. Other binary: "Binary file (524 KB)" placeholder. Caps display at 50K characters; offers "View raw" button that opens the signed URL.
- **DiffViewer.tsx** — parses unified diff into hunks; renders each line with `+` green / `-` red / context muted; hunk headers in mono. Per-line syntax via Shiki when `lang` is provided.
- **shiki.ts** — `getHighlighter(): Promise<Highlighter>` lazy-singleton that imports Shiki at first use. Theme: SAI's existing highlight theme via `getActiveHighlightTheme()` if shared, otherwise a hardcoded dark theme acceptable for v1.

### Lazy Shiki bundle

Don't import Shiki at the top of any file — call `await import('shiki')` from `shiki.ts`'s `getHighlighter`. PWA bundle stays close to current size for the chat-only path; Shiki only loads when Files tab opens.

### Wire helper additions in `src/renderer-remote/wire.ts`

Same reqId pattern as P2:

```ts
listFiles(cwd: string, path: string): Promise<FileEntry[]>;
readFile(cwd: string, path: string): Promise<ReadResult>;
statusFiles(cwd: string): Promise<StatusEntry[]>;
diffFile(cwd: string, path: string, staged?: boolean): Promise<DiffResult>;
```

And a new reply-dispatcher branch for each `.result` type, resolving with the right field (`entries` / `content+...` / `diff+lang`).

## Persistence

- Last-used tab (`Chat` | `Files`) per device, in `localStorage['sai-remote-last-tab']`. Persists across reloads so a user who was viewing Files yesterday opens to Files today.
- Last sub-tab + last-selected file in Files, in `localStorage['sai-remote-files-state']`, keyed by `cwd`. Survives reloads; cleared on workspace change.

## Failure modes

| Condition | Behavior |
|---|---|
| File path escapes cwd | Bridge throws → error reply `code: 'path_escape'`; phone shows system bubble |
| `git:status` errors (not a git repo) | `files.status.result` returns empty `entries` + `notRepo: true`; ChangesView shows "Not a git repository" empty state |
| File > 5MB | Same as binary — `signedUrl` only, never inlined; viewer shows size + raw-fetch button |
| Image binary | FileViewer renders `<img>`; if image fails to load, falls back to placeholder |
| Blob URL already consumed | GET returns 401; FileViewer surfaces "Refresh required" with a re-request button |
| Renderer not alive | N/A; P3 has no renderer dependency |

## Testing

### Unit (`tests/unit/remote/`)

- `bridge-server-files.test.ts` (new) — each of `files.list/read/status/diff` with stubbed callbacks; verifies reqId correlation, error reply path, and the inline-vs-signed-URL branching in `files.read`
- `blob-store.test.ts` (new) — register + consume happy path, consume-twice returns null, TTL expiry returns null
- Extend existing `bridge-server-pair.test.ts` (or new file) — `GET /blob/<id>` happy path + invalid-sig 401 + consumed 404

### Integration (`tests/integration/remote/files-end-to-end.test.ts`)

Real `ws` + `fetch` + temp dir with `git init`:

1. Create a tmp dir, write `a.txt`, `git init`, commit.
2. Modify `a.txt` (staged or unstaged).
3. Pair → auth → `files.status` → expect 1 modified entry.
4. `files.diff` → expect a unified diff string.
5. `files.list` at root → expect entries.
6. `files.read` of small text file → inline content.
7. Write a 100KB binary file → `files.read` → `signedUrl` returned.
8. `GET signedUrl` → returns the bytes; second GET returns 401.

### Manual smoke

`docs/superpowers/notes/2026-05-25-mobile-remote-p3-smoke.md`:

- Switch to Files tab → Changes shows the current uncommitted edits
- Tap a modified file → diff renders with +/- coloring
- Switch to Browse → tree starts at repo root, lazy-expands on tap
- Tap a small file → Shiki-highlighted content
- Tap a >64KB or image file → loads via signed URL; second tap (after consume) prompts re-fetch
- Switch repos via the chip strip in a meta workspace → all four operations re-target to the new cwd
- Reload PWA — last tab + last file state restored

## Exit criteria

1. All vitest unit + integration tests pass (P0+P1+P2 still green; P3 new tests passing).
2. `tsc --noEmit` clean.
3. PWA build succeeds; Shiki bundle is lazy-loaded (no impact on initial chat-only load size).
4. Manual smoke walked on iPhone over Tailscale.
5. Changes view + DiffViewer correctly render at least one M / A / D file per category from a real SAI repo.

## Open questions resolved during implementation

- Exact Shiki theme to use on phone — most likely match `getActiveHighlightTheme()` from desktop; verify the desktop themes are reachable from the PWA bundle.
- `langFromPath` extension → language map — copy from `ToolCallCard.tsx`'s `detectLang` helper.
- Whether `files.list` should pre-filter `.gitignore` matches by default — current plan is YES (use the existing `fs:checkIgnored` impl). Hidden dotfiles are included; user can sort/filter later.
- BlobStore: in-memory only; tied to bridge lifetime. If bridge restarts, all signed URLs become stale. Acceptable for v1.

## Phase 4+ preview

Phase 4 (git panel) will reuse `files.status`/`files.diff` plus the RepoPicker. The blob URL infrastructure stays useful for any future image/screenshot delivery (Phase 5 terminal output → image, Phase 6 monaco file fetch).
