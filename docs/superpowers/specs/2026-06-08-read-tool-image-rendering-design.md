# Read Tool Image Rendering Design

**Date:** 2026-06-08
**Status:** Approved

## Problem

When the agent reads an image file via the Read tool, SAI shows nothing useful — the tool result is parsed as text and image content is silently dropped. Users cannot see images the agent read (screenshots, icons, diagrams) in the chat.

## Goals

- Render images read by the agent's Read tool inline in the tool-call card.
- Provider-agnostic rendering: any provider (or MCP tool) that can supply image data gets it rendered through one shared path.
- Verified end-to-end for Claude (the primary provider).

## Non-Goals

- Codex image support — the Codex CLI streams tool output as plain text (`aggregated_output`); there is no image content block to recover. Codex behavior is unchanged.
- Image downscaling/optimization.
- Editing images.

## Provider Feasibility (established during design)

| Provider | How reads reach SAI | Image bytes obtainable |
|----------|--------------------|------------------------|
| Claude | SAI executes `Read` locally (`electron/services/claude.ts:941-1002`, currently `fs.readFileSync(path, 'utf-8')`) | Yes — SAI controls execution; detect image → attach file ref |
| Gemini | ACP `tool_call_update` content array (`electron/services/gemini.ts:207-218, 315-328`) | Maybe — only if ACP emits image blocks; best-effort preserve |
| Codex | `exec` `aggregated_output` text (`electron/services/codex.ts:115-127`) | No — text only |

## Architecture

A single universal field on `ToolCall` carries image references. Each provider's tool-result handling populates it; one renderer consumes it.

### Data model

In `src/types.ts`:

```ts
export interface ToolResultImage {
  /** Path on disk; renderer lazily re-reads via window.sai.fsReadFileBase64. Preferred — no bytes stored. */
  filePath?: string;
  /** Inline base64 data URI; used only when there is no file to point at (e.g. stream-only images). */
  dataUrl?: string;
  /** e.g. "image/png". Optional; informational. */
  mimeType?: string;
}
```

`ToolCall` gains: `resultImages?: ToolResultImage[]`. Existing `output?: string` is unchanged and continues to carry text.

A `ToolResultImage` carries **either** `filePath` (cheap; re-read lazily) **or** `dataUrl` (base64). The renderer prefers `filePath`.

### Sourcing per provider

**Claude** — `electron/services/claude.ts` local Read execution (~line 995-1002):
- Detect image by extension allow-list: `png, jpg, jpeg, gif, webp, svg, bmp, ico` (case-insensitive).
- For an image: set the tool-result `content` text to a short placeholder, e.g. `[image: <basename>]`, so the model context is not fed garbage UTF-8, and attach an image reference by file path. The emitted `tool_result` content becomes an array:
  ```
  content: [
    { type: 'text', text: '[image: foo.png]' },
    { type: 'image', source: { type: 'sai-file', path: '<abs path>', media_type: '<mime>' } },
  ]
  ```
  (`source.type: 'sai-file'` is a SAI-internal marker meaning "renderer re-reads this path"; it avoids embedding base64 in the stream or session.)
- Non-image reads: unchanged (UTF-8 text).

**Gemini** — `electron/services/gemini.ts` (`renderToolContent` + `translateAcpEvent`, lines 207-218 / 315-328):
- When the ACP `content` array contains an image block, map it to an Anthropic-style image block: `{ type: 'image', source: { type: 'base64', media_type, data } }`.
- Text content continues to be joined into the text string as today.
- Best-effort: if no image block is present, behavior is unchanged.

**Codex** — unchanged.

### Convergence: ChatPanel parsing

`src/components/Chat/ChatPanel.tsx:782-817` is where all providers' tool results are normalized. Currently it filters `block.content` to text only. Change it to split content blocks:

- Text blocks → joined into `output` (as today).
- Image blocks → mapped into `resultImages`:
  - `source.type === 'sai-file'` → `{ filePath: source.path, mimeType: source.media_type }`
  - `source.type === 'base64'` → `{ dataUrl: 'data:' + source.media_type + ';base64,' + source.data, mimeType: source.media_type }`
- Attach `resultImages` to the matching `ToolCall` alongside `output`.

This keeps all image handling in one place and makes any future image-returning tool (e.g. MCP screenshot tools) work automatically.

## Rendering

A new component `src/components/Chat/ToolResultImagePreview.tsx`:

- Props: `image: ToolResultImage`.
- If `image.filePath`: lazy-load via `window.sai.fsReadFileBase64(filePath)` (mirrors `ImageViewer.tsx:61-65`), with loading and error states. If `image.dataUrl`: use directly.
- Renders `<img>` capped at `max-height: 140px; width: auto`, rounded corners, subtle border, fade-in on load.
- On failure (file missing/changed/unreadable): render a small muted "image unavailable" line — never a broken-image icon.
- Click opens a minimal lightbox overlay (fixed, full-viewport, dimmed backdrop; click-anywhere or Escape to dismiss) showing the image at natural size (bounded by viewport).

In `ToolCallCard` (`src/components/Chat/ToolCallCard.tsx`):

- When `toolCall.resultImages?.length`, render a thumbnail strip directly under the card header — **always visible, even when the card is collapsed**. Multiple images wrap.
- The existing text `output` continues to render in the expand body unchanged; the image preview is additive.

### Scroll stability

The thumbnail container reserves a fixed `max-height` and images fade in on load so bytes arriving late do not cause layout jump.

## Edge cases

- **Persistence:** sessions persist to IndexedDB. Claude reads store only `filePath` → negligible storage; image re-reads on demand. Stream-only images store `dataUrl` (unavoidable, no file to reference).
- **File missing/changed at render:** `fsReadFileBase64` rejects → "image unavailable" fallback. Accepted limitation of cheap-storage; `dataUrl` path is immune.
- **Non-image files:** extension allow-list only; everything else is text exactly as today.
- **Large images:** bounded by CSS `max-height`; no downscaling.
- **SVG:** renders as a data URI via `<img>`; no special-casing.
- **Text + image together:** both shown — text in expand body, image in preview strip.

## Testing

**Component tests (Playwright via test-harness):**
- New story `tool-call-card` rendering `ToolCallCard` with `resultImages`.
- Assert: preview `<img>` visible while card collapsed; clicking opens lightbox; Escape/click-out dismisses; no `resultImages` → no preview; failed source → "image unavailable" fallback.

**Unit tests (vitest):**
- ChatPanel content-split: mixed text+image blocks → `output` gets text, `resultImages` gets refs; text-only → `resultImages` undefined; `sai-file` source → `filePath`; `base64` source → `dataUrl`.
- Claude image-extension helper: image path → placeholder text + `resultImages: [{filePath}]`; non-image → text only.
- Gemini best-effort mapping: sample ACP image block → image ref.

**Manual verification:**
- Run the real app, have Claude read a PNG, confirm inline preview appears.

**Optional full-stack e2e:** inject a tool call with an image via the `__saiTest` bridge and assert the preview renders in the real chat. Not required (component + unit cover the logic) but available if full-stack coverage is wanted.

## Files Touched

- `src/types.ts` — add `ToolResultImage`, `ToolCall.resultImages`.
- `electron/services/claude.ts` — image-aware local Read execution.
- `electron/services/gemini.ts` — best-effort image block preservation.
- `src/components/Chat/ChatPanel.tsx` — split tool-result content into text + images.
- `src/components/Chat/ToolResultImagePreview.tsx` — new preview + lightbox component.
- `src/components/Chat/ToolCallCard.tsx` — render preview strip.
- `src/test-harness/stories/` + tests — coverage.
