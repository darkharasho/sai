# Read Tool Image Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render images the agent reads via the Read tool inline in the tool-call card, through one provider-agnostic path, verified for Claude.

**Architecture:** A new optional `resultImages` field on `ToolCall` carries image references (a `filePath` to re-read lazily, or an inline `dataUrl`). Each provider's tool-result handling populates it; the `ToolCallCard` renders an always-visible thumbnail strip with a click-to-zoom lightbox. Claude's local Read execution is made image-aware; Gemini preserves image blocks best-effort; Codex is unchanged.

**Tech Stack:** React 18, TypeScript, Electron (Node), Vitest + React Testing Library, Playwright.

---

## File Structure

**Created:**
- `src/lib/imageFiles.ts` — renderer-side image-extension allow-list + helpers (`isImagePath`, `mimeForImagePath`).
- `electron/services/imageFiles.ts` — electron-side equivalent + `imageReadResult(filePath)` pure helper.
- `src/lib/toolResultContent.ts` — `parseToolResultBlocks(content)` pure helper splitting text vs image blocks.
- `src/components/Chat/ToolResultImagePreview.tsx` — preview thumbnail + lightbox component.
- `src/components/Chat/ToolResultImagePreview.css` — styles for the strip, thumbnail, lightbox.
- `src/test-harness/stories/tool-result-image.tsx` — harness story for the preview component.

**Modified:**
- `src/types.ts` — add `ToolResultImage`, `ToolCall.resultImages`.
- `src/components/Chat/ChatPanel.tsx` — split tool-result content into text + images (use the helper).
- `electron/services/claude.ts` — image-aware local Read execution.
- `electron/services/gemini.ts` — best-effort image-block preservation.
- `src/components/Chat/ToolCallCard.tsx` — render the always-visible preview strip.
- `src/test-harness/stories.ts` — register the new story.

---

### Task 1: Image-file helpers and types

**Files:**
- Create: `src/lib/imageFiles.ts`
- Create: `electron/services/imageFiles.ts`
- Modify: `src/types.ts` (after line 96, the end of the `ToolCall` interface)
- Test: `tests/unit/lib/imageFiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/imageFiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isImagePath, mimeForImagePath } from '../../../src/lib/imageFiles';

describe('imageFiles', () => {
  it('recognizes image extensions case-insensitively', () => {
    expect(isImagePath('/a/b/foo.png')).toBe(true);
    expect(isImagePath('/a/b/FOO.JPG')).toBe(true);
    expect(isImagePath('/a/b/icon.svg')).toBe(true);
    expect(isImagePath('/a/b/pic.webp')).toBe(true);
  });

  it('rejects non-image extensions', () => {
    expect(isImagePath('/a/b/notes.txt')).toBe(false);
    expect(isImagePath('/a/b/code.ts')).toBe(false);
    expect(isImagePath('/a/b/noext')).toBe(false);
  });

  it('maps extensions to mime types', () => {
    expect(mimeForImagePath('/x/a.png')).toBe('image/png');
    expect(mimeForImagePath('/x/a.jpeg')).toBe('image/jpeg');
    expect(mimeForImagePath('/x/a.svg')).toBe('image/svg+xml');
    expect(mimeForImagePath('/x/a.unknown')).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/imageFiles.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module `src/lib/imageFiles`.

- [ ] **Step 3: Create the renderer helper**

Create `src/lib/imageFiles.ts`:

```ts
// Image-file detection shared across the renderer (ChatPanel, ToolCallCard,
// ToolResultImagePreview). The electron side has a parallel copy in
// electron/services/imageFiles.ts (kept in sync; the two build contexts do
// not share modules).

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0 || dot === filePath.length - 1) return '';
  return filePath.slice(dot + 1).toLowerCase();
}

export function isImagePath(filePath: string): boolean {
  return extOf(filePath) in MIME_BY_EXT;
}

export function mimeForImagePath(filePath: string): string {
  return MIME_BY_EXT[extOf(filePath)] ?? 'application/octet-stream';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/imageFiles.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the electron helper**

Create `electron/services/imageFiles.ts`:

```ts
// Image-file detection for the electron main process. Parallel copy of
// src/lib/imageFiles.ts (the renderer and main build contexts do not share
// modules; keep the extension list in sync).
import path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

function extOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

export function isImagePath(filePath: string): boolean {
  return extOf(filePath) in MIME_BY_EXT;
}

export function mimeForImagePath(filePath: string): string {
  return MIME_BY_EXT[extOf(filePath)] ?? 'application/octet-stream';
}

/**
 * Build a Read tool result for an image file: a short placeholder text (so the
 * model context is not fed garbage bytes) plus an image reference by file path.
 * Returns null for non-image paths.
 */
export function imageReadResult(filePath: string): { text: string; image: { path: string; media_type: string } } | null {
  if (!isImagePath(filePath)) return null;
  return {
    text: `[image: ${path.basename(filePath)}]`,
    image: { path: filePath, media_type: mimeForImagePath(filePath) },
  };
}
```

- [ ] **Step 6: Add the types**

In `src/types.ts`, immediately after the `ToolCall` interface (which ends at line 96 with `}`), add:

```ts
export interface ToolResultImage {
  /** Path on disk; the renderer lazily re-reads via window.sai.fsReadFileBase64. Preferred — no bytes stored. */
  filePath?: string;
  /** Inline base64 data URI; used when there is no file to point at (stream-only images). */
  dataUrl?: string;
  /** e.g. "image/png". Optional, informational. */
  mimeType?: string;
}
```

And add the field to `ToolCall` — change line 93 area so the interface reads:

```ts
export interface ToolCall {
  id?: string;
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'file_search' | 'web_fetch' | 'todo' | 'agent' | 'notebook' | 'question' | 'plan' | 'worktree' | 'skill' | 'schedule' | 'task' | 'mcp' | 'other';
  name: string;
  input: string;
  output?: string;
  resultImages?: ToolResultImage[];
  startedAt?: number;
  durationMs?: number;
}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/imageFiles.ts electron/services/imageFiles.ts src/types.ts tests/unit/lib/imageFiles.test.ts
git commit -m "feat: add image-file helpers and ToolResultImage type"
```

---

### Task 2: Parse tool-result content into text + images (ChatPanel)

**Files:**
- Create: `src/lib/toolResultContent.ts`
- Modify: `src/components/Chat/ChatPanel.tsx:781-817`
- Test: `tests/unit/lib/toolResultContent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/toolResultContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseToolResultBlocks } from '../../../src/lib/toolResultContent';

describe('parseToolResultBlocks', () => {
  it('returns string content as text with no images', () => {
    expect(parseToolResultBlocks('hello')).toEqual({ text: 'hello', images: undefined });
  });

  it('joins text blocks and ignores non-image/non-text', () => {
    const content = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
    expect(parseToolResultBlocks(content)).toEqual({ text: 'ab', images: undefined });
  });

  it('maps a sai-file image source to a filePath ref', () => {
    const content = [
      { type: 'text', text: '[image: foo.png]' },
      { type: 'image', source: { type: 'sai-file', path: '/p/foo.png', media_type: 'image/png' } },
    ];
    expect(parseToolResultBlocks(content)).toEqual({
      text: '[image: foo.png]',
      images: [{ filePath: '/p/foo.png', mimeType: 'image/png' }],
    });
  });

  it('maps a base64 image source to a dataUrl ref', () => {
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];
    expect(parseToolResultBlocks(content)).toEqual({
      text: '',
      images: [{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/toolResultContent.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create the helper**

Create `src/lib/toolResultContent.ts`:

```ts
import type { ToolResultImage } from '../types';

/**
 * Split a tool_result `content` (string OR array of content blocks) into joined
 * text and image references. Image blocks use Anthropic-style `source`:
 *   - { type: 'sai-file', path, media_type }  → { filePath, mimeType }
 *   - { type: 'base64', media_type, data }    → { dataUrl, mimeType }
 */
export function parseToolResultBlocks(content: unknown): { text: string; images?: ToolResultImage[] } {
  if (typeof content === 'string') return { text: content, images: undefined };
  if (!Array.isArray(content)) return { text: '', images: undefined };

  let text = '';
  const images: ToolResultImage[] = [];
  for (const block of content as any[]) {
    if (block?.type === 'text') {
      text += block.text ?? '';
    } else if (block?.type === 'image' && block.source) {
      const src = block.source;
      if (src.type === 'sai-file' && src.path) {
        images.push({ filePath: src.path, mimeType: src.media_type });
      } else if (src.type === 'base64' && src.data) {
        images.push({ dataUrl: `data:${src.media_type};base64,${src.data}`, mimeType: src.media_type });
      }
    }
  }
  return { text, images: images.length ? images : undefined };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/toolResultContent.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper into ChatPanel**

In `src/components/Chat/ChatPanel.tsx`, add the import near the other imports at the top of the file (alongside existing `../../types` or lib imports):

```ts
import { parseToolResultBlocks } from '../../lib/toolResultContent';
```

Then replace the block at lines 783-814 (from `const results:` through the `setMessages` mapping) with:

```ts
        const results: Array<{ tool_use_id: string; output: string; images?: import('../../types').ToolResultImage[] }> = [];
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const { text, images } = parseToolResultBlocks(block.content);
            results.push({ tool_use_id: block.tool_use_id, output: text, images });
          }
        }
        if (results.length > 0) {
          setPendingApproval(null);
          setMessages(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const msg = next[i];
              if (msg.role === 'assistant' && msg.toolCalls) {
                let updated = false;
                const now = Date.now();
                const newToolCalls = msg.toolCalls.map(tc => {
                  const result = results.find(r => r.tool_use_id === tc.id);
                  if (result) {
                    updated = true;
                    const durationMs = typeof tc.startedAt === 'number' ? now - tc.startedAt : undefined;
                    return {
                      ...tc,
                      output: result.output,
                      ...(result.images ? { resultImages: result.images } : {}),
                      ...(durationMs != null ? { durationMs } : {}),
                    };
                  }
                  return tc;
                });
                if (updated) { next[i] = { ...msg, toolCalls: newToolCalls }; }
              }
            }
            return next;
          });
          nextSegmentStartRef.current = Date.now();
        }
        return;
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/toolResultContent.ts src/components/Chat/ChatPanel.tsx tests/unit/lib/toolResultContent.test.ts
git commit -m "feat: preserve image blocks from tool results in ChatPanel"
```

---

### Task 3: Make Claude's local Read execution image-aware

**Files:**
- Modify: `electron/services/claude.ts:942-1023`
- Test: `tests/unit/electron/imageReadResult.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/electron/imageReadResult.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageReadResult } from '../../../electron/services/imageFiles';

describe('imageReadResult', () => {
  it('returns a placeholder + image ref for an image path', () => {
    expect(imageReadResult('/proj/assets/logo.png')).toEqual({
      text: '[image: logo.png]',
      image: { path: '/proj/assets/logo.png', media_type: 'image/png' },
    });
  });

  it('returns null for a non-image path', () => {
    expect(imageReadResult('/proj/src/main.ts')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run tests/unit/electron/imageReadResult.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS immediately — `imageReadResult` already exists from Task 1. (This test locks the behavior the claude.ts change depends on.)

- [ ] **Step 3: Add the import to claude.ts**

In `electron/services/claude.ts`, add near the top with the other `./` service imports:

```ts
import { imageReadResult } from './imageFiles';
```

- [ ] **Step 4: Declare the resultImages accumulator**

In `electron/services/claude.ts`, find the local-tool-execution block that begins at line 941 (`// --- Local tool execution (Bash, Write, Edit, Read) ---`). Immediately below the existing `let result = '';` and `let isError = false;` (lines 942-943), add:

```ts
  let resultImages: Array<{ path: string; media_type: string }> | null = null;
```

- [ ] **Step 5: Make the Read branch image-aware**

Replace the Read branch (currently lines 995-1002):

```ts
    } else if (pending.toolName === 'Read') {
      const filePath = pending.input.file_path;
      if (!fs.existsSync(filePath)) {
        result = `File not found: ${filePath}`;
        isError = true;
      } else {
        result = fs.readFileSync(filePath, 'utf-8');
      }
    }
```

with:

```ts
    } else if (pending.toolName === 'Read') {
      const filePath = pending.input.file_path;
      if (!fs.existsSync(filePath)) {
        result = `File not found: ${filePath}`;
        isError = true;
      } else {
        const img = imageReadResult(filePath);
        if (img) {
          result = img.text;
          resultImages = [img.image];
        } else {
          result = fs.readFileSync(filePath, 'utf-8');
        }
      }
    }
```

- [ ] **Step 6: Emit array content when there are images**

Replace the `emitChatMessage` call that sends the tool result (currently lines 1010-1023) with:

```ts
  const toolResultContent = resultImages
    ? [
        { type: 'text', text: result },
        ...resultImages.map(im => ({ type: 'image', source: { type: 'sai-file', path: im.path, media_type: im.media_type } })),
      ]
    : result;

  // Send the real tool result to the renderer as if the CLI produced it
  emitChatMessage({
    type: 'user',
    projectPath: ws.projectPath,
    scope: effectiveScope,
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: pending.toolUseId,
        content: toolResultContent,
        is_error: isError,
      }],
    },
  });
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add electron/services/claude.ts tests/unit/electron/imageReadResult.test.ts
git commit -m "feat: emit image refs from Claude local Read of image files"
```

---

### Task 4: Gemini best-effort image-block preservation

**Files:**
- Modify: `electron/services/gemini.ts:207-218` (`renderToolContent`) and `:315-328` (tool_call_update translation)
- Test: `tests/unit/electron/geminiAcpImages.test.ts`

> **Context:** The exact ACP image-block shape is unverified. This task handles the plausible shape `{ type: 'content', content: { type: 'image', mimeType, data } }` and is a no-op if absent (best-effort, per the spec). If runtime inspection later reveals a different shape, only `acpContentToToolResult` changes.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/electron/geminiAcpImages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { acpContentToToolResult } from '../../../electron/services/gemini';

describe('acpContentToToolResult', () => {
  it('returns a plain string when there are no images', () => {
    const content = [{ type: 'content', content: { type: 'text', text: 'hello' } }];
    expect(acpContentToToolResult(content)).toBe('hello');
  });

  it('returns an array with text + image block when an image is present', () => {
    const content = [
      { type: 'content', content: { type: 'text', text: 'see:' } },
      { type: 'content', content: { type: 'image', mimeType: 'image/png', data: 'AAAA' } },
    ];
    expect(acpContentToToolResult(content)).toEqual([
      { type: 'text', text: 'see:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/geminiAcpImages.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `acpContentToToolResult` is not exported.

- [ ] **Step 3: Add the exported helper**

In `electron/services/gemini.ts`, directly below the existing `renderToolContent` function (which ends at line 218), add:

```ts
/**
 * Convert an ACP tool-call content array into a tool_result `content` value.
 * Returns a plain string when there are no images (unchanged behavior); returns
 * an array of text + Anthropic-style image blocks when image content is present.
 * Best-effort: only the known image shape is recognized.
 */
export function acpContentToToolResult(content: any[] | undefined): string | any[] {
  if (!Array.isArray(content) || content.length === 0) return '';
  const images: Array<{ media_type: string; data: string }> = [];
  for (const item of content) {
    const inner = item?.content;
    if (item?.type === 'content' && inner?.type === 'image' && inner.data) {
      images.push({ media_type: inner.mimeType || 'application/octet-stream', data: inner.data });
    }
  }
  if (images.length === 0) return renderToolContent(content);
  return [
    { type: 'text', text: renderToolContent(content) },
    ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
  ];
}
```

- [ ] **Step 4: Use the helper in the tool_call_update translation**

In `electron/services/gemini.ts`, within the `tool_call_update` branch (around line 315-328), change the line that sets `content: renderToolContent(update.content)` to:

```ts
        content: acpContentToToolResult(update.content),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/geminiAcpImages.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/services/gemini.ts tests/unit/electron/geminiAcpImages.test.ts
git commit -m "feat: preserve Gemini ACP image blocks in tool results (best-effort)"
```

---

### Task 5: ToolResultImagePreview component + harness story

**Files:**
- Create: `src/components/Chat/ToolResultImagePreview.tsx`
- Create: `src/components/Chat/ToolResultImagePreview.css`
- Create: `src/test-harness/stories/tool-result-image.tsx`
- Modify: `src/test-harness/stories.ts`
- Test: `tests/e2e/tool-result-image.spec.ts`

- [ ] **Step 1: Create the component**

Create `src/components/Chat/ToolResultImagePreview.tsx`:

```tsx
import { useEffect, useState } from 'react';
import './ToolResultImagePreview.css';
import type { ToolResultImage } from '../../types';

export function ToolResultImagePreview({ image }: { image: ToolResultImage }) {
  const [url, setUrl] = useState<string | null>(image.dataUrl ?? null);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (image.dataUrl) { setUrl(image.dataUrl); return; }
    if (!image.filePath || !(window as any).sai?.fsReadFileBase64) { setFailed(true); return; }
    let cancelled = false;
    (window as any).sai.fsReadFileBase64(image.filePath)
      .then((u: string) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [image.filePath, image.dataUrl]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (failed) return <span className="tool-result-image-missing">image unavailable</span>;
  if (!url) return <span className="tool-result-image-loading">Loading…</span>;

  return (
    <>
      <img
        className="tool-result-image-thumb"
        data-testid="tool-result-image-thumb"
        src={url}
        alt=""
        onClick={(e) => { e.stopPropagation(); setLightbox(true); }}
      />
      {lightbox && (
        <div
          className="tool-result-image-lightbox"
          data-testid="tool-result-image-lightbox"
          onClick={() => setLightbox(false)}
        >
          <img src={url} alt="" />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Create the styles**

Create `src/components/Chat/ToolResultImagePreview.css`:

```css
.tool-result-image-thumb {
  max-height: 140px;
  width: auto;
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border-hairline);
  cursor: zoom-in;
  display: block;
  animation: tool-result-image-fade 160ms ease-out;
}
@keyframes tool-result-image-fade { from { opacity: 0; } to { opacity: 1; } }
.tool-result-image-missing,
.tool-result-image-loading {
  font-size: 12px;
  color: var(--text-muted);
}
.tool-result-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
.tool-result-image-lightbox img {
  max-width: 92vw;
  max-height: 92vh;
}
```

- [ ] **Step 3: Create the harness story**

Create `src/test-harness/stories/tool-result-image.tsx`:

```tsx
import { ToolResultImagePreview } from '../../components/Chat/ToolResultImagePreview';

// A visible solid-red square as an inline data URI (no window.sai needed).
const RED_SQUARE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23e0392b'/%3E%3C/svg%3E";

function ToolResultImageHarness({ variant }: { variant: string }) {
  if (variant === 'missing') {
    return <ToolResultImagePreview image={{ filePath: '/nope/missing.png' }} />;
  }
  return <ToolResultImagePreview image={{ dataUrl: RED_SQUARE }} />;
}

export const toolResultImageStory = {
  component: ToolResultImageHarness,
  parseProps: (params: URLSearchParams) => ({ variant: params.get('variant') ?? 'dataurl' }),
};
```

- [ ] **Step 4: Register the story**

In `src/test-harness/stories.ts`, add the import and registry entry:

```ts
import { toolResultImageStory } from './stories/tool-result-image';
```

and add to the `stories` record:

```ts
  'tool-result-image': toolResultImageStory,
```

- [ ] **Step 5: Write the Playwright component tests**

Create `tests/e2e/tool-result-image.spec.ts`:

```ts
import { test, expect } from './test';

test('image preview renders from a data URL', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'dataurl' });
  await expect(el.locator('[data-testid="tool-result-image-thumb"]')).toBeVisible();
});

test('clicking the thumbnail opens and Escape closes the lightbox', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'dataurl' });
  await el.locator('[data-testid="tool-result-image-thumb"]').click();
  await expect(el.page().locator('[data-testid="tool-result-image-lightbox"]')).toBeVisible();
  await el.page().keyboard.press('Escape');
  await expect(el.page().locator('[data-testid="tool-result-image-lightbox"]')).toHaveCount(0);
});

test('missing file shows the unavailable fallback', async ({ harness }) => {
  const el = await harness.render('tool-result-image', { variant: 'missing' });
  await expect(el.locator('.tool-result-image-missing')).toBeVisible();
});
```

- [ ] **Step 6: Run the component tests**

Run: `npx playwright test tests/e2e/tool-result-image.spec.ts --retries=0`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ToolResultImagePreview.tsx src/components/Chat/ToolResultImagePreview.css src/test-harness/stories/tool-result-image.tsx src/test-harness/stories.ts tests/e2e/tool-result-image.spec.ts
git commit -m "feat: add ToolResultImagePreview with lightbox + harness tests"
```

---

### Task 6: Render the always-visible preview strip in ToolCallCard

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx` (import near top; strip after line 1130)
- Test: `tests/unit/components/ToolCallCardImage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/ToolCallCardImage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/test-utils';
import ToolCallCard from '../../../src/components/Chat/ToolCallCard';
import type { ToolCall } from '../../../src/types';

describe('ToolCallCard image strip', () => {
  it('renders an image preview while the card is collapsed', () => {
    const toolCall: ToolCall = {
      id: 't1',
      type: 'file_read',
      name: 'Read',
      input: JSON.stringify({ file_path: '/p/foo.png' }),
      output: '[image: foo.png]',
      resultImages: [{ dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }],
    };
    renderWithProviders(<ToolCallCard toolCall={toolCall} defaultExpanded={false} />);
    expect(screen.getByTestId('tool-result-image-thumb')).toBeInTheDocument();
  });

  it('renders no preview when there are no resultImages', () => {
    const toolCall: ToolCall = {
      id: 't2', type: 'file_read', name: 'Read',
      input: JSON.stringify({ file_path: '/p/notes.txt' }),
      output: 'plain text',
    };
    renderWithProviders(<ToolCallCard toolCall={toolCall} defaultExpanded={false} />);
    expect(screen.queryByTestId('tool-result-image-thumb')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/ToolCallCardImage.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — no `tool-result-image-thumb` found.

- [ ] **Step 3: Add the import**

In `src/components/Chat/ToolCallCard.tsx`, add near the other component imports at the top:

```ts
import { ToolResultImagePreview } from './ToolResultImagePreview';
```

- [ ] **Step 4: Render the strip after the header**

In `src/components/Chat/ToolCallCard.tsx`, the header `</div>` is at line 1130, immediately followed by `<AnimatePresence initial={false}>` (line 1131). Insert the strip between them so it shows regardless of expand state:

```tsx
        </div>
        {toolCall.resultImages?.length ? (
          <div className="tool-call-image-strip" onClick={(e) => e.stopPropagation()}>
            {toolCall.resultImages.map((img, i) => (
              <ToolResultImagePreview key={i} image={img} />
            ))}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
```

- [ ] **Step 5: Add strip styling**

Append to `src/components/Chat/ToolResultImagePreview.css`:

```css
.tool-call-image-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px 4px;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/ToolCallCardImage.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full unit + e2e image suites for regressions**

Run: `npx vitest run tests/unit/lib/imageFiles.test.ts tests/unit/lib/toolResultContent.test.ts tests/unit/components/ToolCallCardImage.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: all pass.

Run: `npx playwright test tests/e2e/tool-result-image.spec.ts --retries=0`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx src/components/Chat/ToolResultImagePreview.css tests/unit/components/ToolCallCardImage.test.tsx
git commit -m "feat: show always-visible image preview strip in tool-call card"
```

---

### Task 7: Manual end-to-end verification (Claude)

**Files:** none (verification only)

- [ ] **Step 1: Launch the app and read an image**

Use the project `/run` flow (or `npm run dev`) to launch SAI. In a workspace containing an image (e.g. a PNG under the project), ask the agent (Claude provider) to "read <that image>". Approve the Read tool call.

- [ ] **Step 2: Confirm the preview**

Expected: the Read tool-call card shows an inline thumbnail of the image (visible without expanding). Clicking it opens the lightbox; Escape closes it. The card text shows `[image: <name>]` rather than garbage bytes.

- [ ] **Step 3: Confirm non-images are unchanged**

Read a normal text file. Expected: no image strip; text output renders exactly as before.
