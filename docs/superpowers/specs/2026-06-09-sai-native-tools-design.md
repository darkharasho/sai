# SAI Native Interaction Tools (`pick_file`, `notify`, `clipboard`) — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm) — pending implementation plan
**Builds on:** `2026-06-09-sai-mcp-tools-v2-design.md` (Tier 2 native interaction tools)

## Summary

Add three native-affordance tools the in-app chat agent can call:
`pick_file` (native file dialog → chosen path), `notify` (OS notification),
and `clipboard` (write text for the user to paste). They follow the shipped
`capture_app` pattern exactly — **renderer-target** tools that call a preload
IPC bridge to the main process — so **Framework Delta A is still not needed**
(the main-only route stays deferred; these are reachable from the renderer).

## Goals

- `pick_file` opens a native open/save/directory dialog and returns the path(s)
  the user chose (or `{ cancelled: true }`).
- `notify` fires an OS notification (fire-and-forget).
- `clipboard` writes agent-provided text to the system clipboard.
- All three are read-only of the user's environment except where the user
  explicitly acts (the file dialog); no unprompted reads.

## Non-Goals (v1)

- **Clipboard read** — reading the clipboard exposes whatever the user last
  copied (passwords, tokens) without explicit per-read consent. `action:'read'`
  returns an explicit unsupported error; gated-read is a later add.
- Framework Delta A (a dedicated main-process MCP route) — unneeded; these are
  renderer-reachable via preload IPC, like `capture_app`.
- Arbitrary filesystem access — `pick_file` is user-mediated; the agent only
  learns the chosen path(s).

## Background / Current State (verified)

- **`dialog` is already imported and used** in `electron/main.ts`
  (`dialog.showOpenDialog(mainWindow!, …)` at ~lines 795, 806) — precedent for
  the file-dialog handler.
- **Notification infra exists** — `electron/services/notify.ts` uses Electron
  `Notification` (`notifyCompletion`, etc.). `notify` adds a generic handler.
- **`clipboard` is not yet wired** — Electron's `clipboard` module will be
  imported in `main.ts`.
- **The renderer-target pattern is shipped** — `inspect_element`/`capture_app`
  are handled in `App.tsx` `onSwarmToolRequest` via
  `handleSaiQueryToolRequest(req, deps)` (`src/render/saiQueryTools.ts`), calling
  preload bridges (`sai.captureRegion`). These native tools mirror that exactly.
- **Result plumbing** — `electron/swarm-mcp-server.ts` serializes a result object
  to a text block; these tools return plain JSON (no `__mcpImage`).

## Architecture

```
agent → pick_file / notify / clipboard  (MCP)
  → renderer onSwarmToolRequest (native-tool branch)
       → handleSaiNativeToolRequest(req, { pickFile, notify, clipboardWrite })
            → sai.pickFile(opts) / sai.notify(args) / sai.clipboardWrite(text)   (preload)
                 → ipc 'sai:pick-file' / 'sai:notify' / 'sai:clipboard-write'    (main)
                      → dialog.showOpenDialog|showSaveDialog / new Notification / clipboard.writeText
       → respondSwarmTool(req.id, result)
```
No render card — like `inspect_element`/`capture_app`, results are returned as
data, not a render surface.

## Components

### 1. `src/render/saiNativeTools.ts` (new)
`handleSaiNativeToolRequest(req: { tool; input }, deps): Promise<unknown | null>`
(sibling to `saiQueryTools.ts`). Returns the result object, or `null` if `tool`
isn't one of the three (so `App.tsx` can fall through).

```ts
export interface SaiNativeDeps {
  pickFile?: (opts: { mode?: 'open' | 'save' | 'directory'; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => Promise<string[] | null>;
  notify?: (args: { title: string; body?: string }) => Promise<boolean>;
  clipboardWrite?: (text: string) => Promise<boolean>;
}
```
- `pick_file`: `const paths = await pickFile(opts)`; `null` → `{ cancelled: true }`;
  else `{ paths }`.
- `notify`: requires a `title` string (else `{ ok:false, error }`); `await notify(...)`
  → `{ ok: true }`.
- `clipboard`: if `input.action === 'read'` → `{ ok:false, error:'clipboard read
  not supported' }`; else requires a `text` string and `await clipboardWrite(text)`
  → `{ ok: true }`.
- Missing dep → `{ ok:false, error:'<tool> unavailable' }`.

### 2. `electron/main.ts` — three IPC handlers
- `import { clipboard } from 'electron'` (add to the existing electron import).
- `ipcMain.handle('sai:pick-file', …)`: `mode:'save'` → `dialog.showSaveDialog`;
  `mode:'directory'` → `showOpenDialog` with `properties:['openDirectory']`;
  default open → `showOpenDialog` with `['openFile']` + `['multiSelections']`
  when `multi`. Returns `string[]` of chosen paths, or `null` on cancel.
- `ipcMain.handle('sai:notify', …)`: `new Notification({ title, body }).show()`;
  return `true` (or `false` if `Notification.isSupported()` is false).
- `ipcMain.handle('sai:clipboard-write', …)`: `clipboard.writeText(text)`; return `true`.

### 3. `electron/preload.ts` — bridges
`pickFile`, `notify`, `clipboardWrite` invoking the three IPC channels (mirroring
`captureRegion`).

### 4. `src/App.tsx` — routing branch
In `onSwarmToolRequest`, BEFORE the `startsWith('render_')` block, a branch:
`if (req.tool === 'pick_file' || req.tool === 'notify' || req.tool === 'clipboard')`
→ `handleSaiNativeToolRequest(req, { pickFile: sai.pickFile, notify: sai.notify,
clipboardWrite: sai.clipboardWrite })` → respond (guard a `null` result the same
way the query branch does).

### 5. `src/lib/saiTools.ts` — schemas
Three `toolset:'chat'` entries:
- `pick_file` — `properties: { mode, filters, multi }`, no required.
- `notify` — `properties: { title, body, level }`, `required:['title']`.
- `clipboard` — `properties: { action, text }`, `required:['text']`; description
  notes write-only (read unsupported).

## Error Handling

- `pick_file` cancel → `{ cancelled: true }`; dialog errors → `{ ok:false, error }`.
- `clipboard` read → `{ ok:false, error:'clipboard read not supported' }`.
- `notify` unsupported platform → `{ ok:false, error:'notifications unavailable' }`.
- Missing preload bridge (e.g. mocks/tests) → `{ ok:false, error:'<tool> unavailable' }`.
- A `null` from `handleSaiNativeToolRequest` (unowned tool) routes to
  `respondSwarmToolError` at the call site, mirroring the query branch.

## Security

- `pick_file` is user-mediated: the native dialog requires the user to choose;
  the agent receives only the chosen path(s). No arbitrary fs traversal.
- `clipboard` is write-only — no read of potentially sensitive copied content.
- `notify` is output-only.
- No new privileged surface beyond three narrow IPC channels; no main-only MCP
  route. The renderer never exposes raw `dialog`/`clipboard` to model HTML.

## Testing

- **Unit (`tests/unit/render/saiNativeTools.test.ts`):** `handleSaiNativeToolRequest`
  with injected deps — `pick_file` returns `{ paths }` / `{ cancelled }`; `notify`
  requires title and returns `{ ok:true }`; `clipboard` write returns `{ ok:true }`,
  read returns the unsupported error; missing-dep error; `null` for an unowned tool.
- **Unit (`saiTools.test.ts`):** the three schema entries (names, toolset,
  required arrays).
- No e2e/card (no visual surface — consistent with `inspect_element`/`capture_app`).
  The Electron IPC handlers (dialog/Notification/clipboard) are main-process; the
  pure handler is fully covered with mocked deps.

## Key Files

| Area | Files |
|------|-------|
| Native tool handler | `src/render/saiNativeTools.ts` (new) |
| IPC handlers + clipboard import | `electron/main.ts` |
| preload bridges | `electron/preload.ts` |
| Renderer routing | `src/App.tsx` |
| Schemas | `src/lib/saiTools.ts` |

## Open Questions / Future Work

- Gated clipboard **read** (a one-time native "allow read?" prompt) if it proves
  needed.
- `pick_region` (drag-select a screen region) — pairs with `capture_app`; later.
- `confirm`/`choose` convenience tools on the shipped `formBridge` channel.
