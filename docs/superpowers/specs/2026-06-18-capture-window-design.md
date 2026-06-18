# `capture_window` — Capture the External App Under Development

**Date:** 2026-06-18
**Status:** Design — pending user review

## Problem

SAI is a generic dev assistant: users run it to build *other* apps. Its existing
`capture_app` tool screenshots SAI's **own** window (`mainWindow.webContents.capturePage()`
in `electron/main.ts`). That was the deliberate, scoped intent when the tool shipped
(2026-06-09, plan `docs/superpowers/plans/2026-06-09-sai-tier2-inspect-capture.md`):
let the chat agent see SAI's real UI instead of a mock. External-app capture was
explicitly deferred there ("Delta A stays deferred to the future native-picker tools").

The consequence today: when a user asks SAI to "screenshot the app we're working on,"
they get a picture of **SAI itself**, which is useless during real work. This spec
builds the deferred capability as a new tool.

## Goals

- Add a `capture_window` tool that screenshots the **external** app under development
  (a specific window or a whole display) and returns a PNG.
- **Never** capture SAI's own window — SAI is always excluded from candidates.
- Infer the right window from project context when possible; allow an explicit override.
- Work **cross-platform** (Windows, macOS, Linux/X11, Linux/Wayland) since SAI ships releases.
- Leave `capture_app` untouched (still the SAI-self shooter).

## Non-Goals

- Continuous/streaming capture or video. Single still PNG only.
- Region-within-a-window cropping by CSS selector (that's `capture_app`'s DOM-aware job
  on SAI itself; external apps expose no DOM to us).
- Interactive OS picker UIs as the *primary* path (we infer; picker-style fallback is
  only the desktopCapturer source list surfaced back to the agent as titles).

## Tool Schema

In `src/lib/saiTools.ts`, toolset `chat`, read-only:

```ts
{
  name: 'capture_window',
  description:
    'Screenshot the EXTERNAL app you are developing (a window or a whole display) and ' +
    'return the image. Never captures SAI itself. Omit args to auto-detect the project ' +
    "window; pass `target` to disambiguate. Use this to SEE the app under development. Read-only.",
  toolset: 'chat',
  input_schema: {
    type: 'object',
    properties: {
      target:  { type: 'string', description: 'Optional window title / app-name substring to match (case-insensitive).' },
      display: { type: 'boolean', description: 'Capture the whole monitor instead of a single window.' },
    },
  },
}
```

The MCP-exposed name is `sai_capture_window`; the main process forwards the bare name
`capture_window` to the renderer, matching the existing `capture_app` / `render_html` convention.

## Architecture

New module directory `electron/capture/` with clear unit boundaries:

| Unit | Responsibility | Testable without display? |
|------|----------------|---------------------------|
| `backends/types.ts` | `CaptureBackend` interface: `listWindows()`, `captureWindow(id\|title)`, `captureDisplay()`, `isAvailable(env)`. | n/a (types) |
| `backends/desktopCapturer.ts` | Electron `desktopCapturer.getSources({types,thumbnailSize})` → full-res `NativeImage` → PNG. Primary on Win/macOS/X11. | No (needs Electron) |
| `backends/spectacle.ts` | KDE Wayland: shell `spectacle -b -a -n -o <tmp>`. | Logic yes (arg build); spawn no |
| `backends/grim.ts` | wlroots Wayland: shell `grim` (+ optional window geometry). | Logic yes; spawn no |
| `backends/screencapture.ts` | macOS fallback: shell `screencapture`. | Logic yes; spawn no |
| `selectBackend.ts` | Pick ordered backend chain from `process.platform`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, and `PATH` probes. | **Yes** |
| `blankFrame.ts` | Heuristic: is a captured PNG all-black / all-transparent? Triggers fallback. | **Yes** (operate on raw RGBA buffer) |
| `inferWindow.ts` | Given candidate window titles + project context + optional `target`, pick the window; exclude SAI; return `{ pick }` or `{ candidates }`. | **Yes** |
| `captureWindow.ts` | Orchestrator: enumerate → infer → capture via backend chain → blank-detect → fall back → return PNG base64 or candidate list. | Orchestration mocked |

### Capture backend chain (per platform)

Resolved by `selectBackend.ts`:

- **Windows** → `[desktopCapturer]`
- **macOS** → `[desktopCapturer, screencapture]` (screencapture if desktopCapturer frame is blank — Screen Recording permission not granted)
- **Linux X11** (`XDG_SESSION_TYPE=x11`) → `[desktopCapturer]`
- **Linux Wayland + KDE** (`XDG_CURRENT_DESKTOP` contains `KDE`) → `[desktopCapturer, spectacle]`
- **Linux Wayland + wlroots/other** → `[desktopCapturer, grim]`

The orchestrator tries each backend in order; if a backend throws *or* the
blank-frame detector flags the result, it advances to the next. This self-heals:
the same code path produces a real frame whether desktopCapturer works (X11) or
returns black (Wayland → spectacle/grim).

### Window enumeration & inference

`desktopCapturer.getSources` returns window **names** (titles) cross-platform, so the
primary path enumerates and captures from one call. Inference order in `inferWindow.ts`:

1. If `target` is provided → first window whose title contains `target` (case-insensitive).
2. Else match **project**: SAI's current workspace `package.json` `productName`, else the
   repo directory basename, against window titles (case-insensitive substring).
3. Else the **most-recently-focused non-SAI window** (desktopCapturer source order / OS focus order where available).
4. Else return `{ ok: false, candidates: [titles…] }` so the agent re-calls with `target`.

**SAI exclusion:** the orchestrator always removes SAI's own window from candidates
before inference. Identified by matching against SAI's known window title / the
`mainWindow` source id where the backend exposes it. This is the hard floor that
guarantees the tool never screenshots SAI.

The Wayland fallback (`spectacle -a`) captures the **active** window; the orchestrator
raises the inferred window to foreground first where the platform allows (best-effort;
if raising fails it captures whatever is active and notes that in the result).

## Data Flow

```
agent calls sai_capture_window {target?, display?}
  → swarm MCP server forwards bare 'capture_window' to renderer
  → App.tsx onSwarmToolRequest routes to window.sai.captureWindow(opts)
  → preload ipcRenderer.invoke('sai:capture-window', opts)
  → main.ts handler → electron/capture/captureWindow.ts orchestrator
       enumerate windows → exclude SAI → infer pick (or candidates)
       → backend chain capture → blank-detect → fallback
  → returns { ok, base64?, mimeType?, candidates? }
  → App.tsx responds via respondSwarmTool with { ok, __mcpImage } (or candidate list text)
```

## Result Shape

Identical image contract to `capture_app`, so `electron/swarm-mcp-server.ts` needs **no change**:

```ts
// success
{ ok: true, __mcpImage: { base64: '<bare base64 png>', mimeType: 'image/png' }, window: '<matched title>' }
// ambiguous / nothing matched
{ ok: false, candidates: ['Firefox — MyApp', 'MyApp (dev)'] , message: 'Multiple/zero matches; pass `target`.' }
```

## Two Render Paths

Per the project's "render tools have two paths" convention (live MCP dispatch+screenshot
AND the chat-history card via `entryFromToolCall`): during implementation, verify whether
`capture_window` needs a chat-history card entry like the other capture/render tools. If
so, add the `entryFromToolCall` branch so a replayed transcript shows the captured image.

## Error Handling

- No capture backend available for the environment → `{ ok:false, message }` listing what was probed.
- All backends produced blank frames → `{ ok:false, message: 'capture returned an empty frame (permission?)' }`
  with a platform-specific hint (macOS Screen Recording, Wayland portal).
- Spawned tool (spectacle/grim/screencapture) missing or non-zero exit → advance chain;
  if it was the last backend, surface stderr in `message`.
- SAI is the only window present → `{ ok:false, message:'no external app window found' }` (never falls back to capturing SAI).

## Testing Strategy (TDD)

Pure units get failing-test-first coverage; pixel-grab is environment-dependent.

- `inferWindow.test.ts` — target match, project match (productName then dir), focus
  fallback, SAI always excluded, candidate list when ambiguous/empty.
- `selectBackend.test.ts` — correct ordered chain per (platform, session type, desktop, PATH).
- `blankFrame.test.ts` — all-black/all-transparent buffers flagged; real-content buffer not flagged; threshold edges.
- `saiTools.test.ts` — `capture_window` registered with correct schema/toolset.
- Integration smoke (this KDE Wayland box, not CI-gated): real `spectacle` capture of a
  known window returns a non-blank PNG.

Run vitest with `--maxWorkers=2` (per machine memory constraint).

## Files Touched

| File | New/Modified |
|------|--------------|
| `electron/capture/**` (backends, selectBackend, blankFrame, inferWindow, captureWindow) | New |
| `electron/main.ts` — `sai:capture-window` IPC handler | Modify |
| `electron/preload.ts` + `window.sai` types — `captureWindow(opts)` | Modify |
| `src/lib/saiTools.ts` — `capture_window` schema | Modify |
| `src/App.tsx` — route `capture_window` in `onSwarmToolRequest` | Modify |
| `tests/unit/electron/capture/*.test.ts`, `tests/unit/lib/saiTools.test.ts` | New/Modify |

## Open Risks

- **Wayland window raising** is best-effort; spectacle captures the active window, so if
  the inferred window can't be raised the user may need to focus it. Documented in the
  tool's failure `message`.
- **macOS Screen Recording permission** can't be granted programmatically; first use may
  return blank until the user approves SAI in System Settings. Surfaced as a hint.
- **desktopCapturer thumbnail resolution** must be requested at the source's real size to
  avoid downscaled output; orchestrator queries source bounds first.
