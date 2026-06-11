# Render Region Sizing + Themed Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render-tool mocks grow to their natural content width (grow-only, column-capped) and sit on the themed surface instead of a white iframe backdrop, in both the chat card and the headless screenshot path.

**Architecture:** A new pure module `src/render/renderSizing.ts` owns the grow-only width clamp, CSS-color sanitizer, and themed-surface resolver. The sandboxed iframe's injected reporter posts width alongside height; `RenderRegion` holds grow-only width state. The same background + width-growth logic mirrors into `electron/main.ts`'s `render:captureHtml`, with `background` plumbed through preload and the App.tsx capture deps.

**Tech Stack:** TypeScript, React, Electron, Vitest (config caps workers at 2 — do not raise).

**Spec:** `docs/superpowers/specs/2026-06-11-render-region-sizing-background-design.md`

**Setup:** Work on a fresh branch off `main`: `git checkout -b render-region-sizing`

---

### Task 1: Pure helpers — `nextRenderWidth`, `sanitizeCssColor`, `resolveThemedSurface`

**Files:**
- Create: `src/render/renderSizing.ts`
- Test: `tests/unit/render/renderSizing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/render/renderSizing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextRenderWidth, sanitizeCssColor, resolveThemedSurface } from '../../../src/render/renderSizing';

describe('nextRenderWidth', () => {
  it('grows to a larger reported width', () => {
    expect(nextRenderWidth(360, 460, 360)).toBe(460);
  });
  it('never shrinks below the current width', () => {
    expect(nextRenderWidth(460, 380, 360)).toBe(460);
  });
  it('never goes below the requested minimum', () => {
    expect(nextRenderWidth(360, 100, 360)).toBe(360);
  });
  it('ignores non-finite and non-positive reports', () => {
    expect(nextRenderWidth(360, NaN, 360)).toBe(360);
    expect(nextRenderWidth(360, 0, 360)).toBe(360);
    expect(nextRenderWidth(360, -5, 360)).toBe(360);
  });
  it('rounds fractional reports up', () => {
    expect(nextRenderWidth(360, 400.2, 360)).toBe(401);
  });
});

describe('sanitizeCssColor', () => {
  it('accepts hex, rgb(), named colors, and color-mix()', () => {
    expect(sanitizeCssColor('#0a0c0e')).toBe('#0a0c0e');
    expect(sanitizeCssColor('rgb(10, 12, 14)')).toBe('rgb(10, 12, 14)');
    expect(sanitizeCssColor('rebeccapurple')).toBe('rebeccapurple');
    expect(sanitizeCssColor('color-mix(in srgb, red 50%, blue)')).toBe('color-mix(in srgb, red 50%, blue)');
  });
  it('trims whitespace', () => {
    expect(sanitizeCssColor('  #fff  ')).toBe('#fff');
  });
  it('rejects style-attribute breakouts', () => {
    expect(sanitizeCssColor('red;background-image:url(x)')).toBeNull();
    expect(sanitizeCssColor('red" onload="alert(1)')).toBeNull();
    expect(sanitizeCssColor('</style><script>1</script>')).toBeNull();
  });
  it('rejects url() even though its characters pass the charset', () => {
    expect(sanitizeCssColor('url(data:image/svg+xml,x)')).toBeNull();
  });
  it('rejects empty and oversized values', () => {
    expect(sanitizeCssColor('')).toBeNull();
    expect(sanitizeCssColor('a'.repeat(65))).toBeNull();
  });
});

describe('resolveThemedSurface', () => {
  it('falls back to #1a1a1a when --sai-surface is unset', () => {
    expect(resolveThemedSurface()).toBe('#1a1a1a');
  });
  it('returns the documentElement --sai-surface value when set', () => {
    document.documentElement.style.setProperty('--sai-surface', '#101418');
    try {
      expect(resolveThemedSurface()).toBe('#101418');
    } finally {
      document.documentElement.style.removeProperty('--sai-surface');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/render/renderSizing.test.ts`
Expected: FAIL — cannot resolve `src/render/renderSizing`.

- [ ] **Step 3: Write the implementation**

Create `src/render/renderSizing.ts`:

```ts
// Conservative CSS-color charset: hex, rgb()/hsl(), named colors, color-mix().
// Excludes quotes, semicolons, angle brackets, slashes — anything that could
// break out of an inline style attribute it gets interpolated into.
const CSS_COLOR_RE = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/;

/** Validate a user-supplied CSS color before interpolating it into an inline
 *  style attribute. Returns the trimmed value, or null when rejected. */
export function sanitizeCssColor(value: string): string | null {
  const v = value.trim();
  if (!v || !CSS_COLOR_RE.test(v) || /url\s*\(/i.test(v)) return null;
  return v;
}

/** Grow-only width clamp for render regions: never below the requested
 *  minimum, never below the current width, grows to a valid larger report. */
export function nextRenderWidth(current: number, reported: number, min: number): number {
  const floor = Math.max(current, min);
  if (!Number.isFinite(reported) || reported <= 0) return floor;
  return Math.max(floor, Math.ceil(reported));
}

/** Resolve the app's surface color to a concrete value for painting into an
 *  iframe body (the iframe backdrop is opaque white; CSS vars don't cross the
 *  boundary). --sai-surface is defined at :root. */
export function resolveThemedSurface(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sai-surface').trim();
    return (v && sanitizeCssColor(v)) || '#1a1a1a';
  } catch {
    return '#1a1a1a';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/render/renderSizing.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/renderSizing.ts tests/unit/render/renderSizing.test.ts
git commit -m "feat(render): sizing/sanitizing helpers for render regions"
```

---

### Task 2: Chat iframe — size reporter + grow-only region + themed body

**Files:**
- Modify: `src/components/Chat/RenderToolCard.tsx` (RenderRegion lines 51–78, HEIGHT_REPORTER lines 92–99, RenderedHtml lines 101–144)
- Test: `tests/unit/render/renderRegionSizing.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/render/renderRegionSizing.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { RenderRegion } from '../../../src/components/Chat/RenderToolCard';

const htmlEntry = (over: Record<string, unknown> = {}) => ({
  renderId: 'r1', kind: 'html', status: 'ready', width: 360,
  payload: { html: '<b>hi</b>' },
  ...over,
} as any);

function postSize(iframe: HTMLIFrameElement, size: { height?: number; width?: number }) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { __saiRender: 1, height: 100, ...size },
      source: iframe.contentWindow,
    }));
  });
}

describe('RenderRegion sizing + background', () => {
  it('paints the themed surface into the iframe body by default', () => {
    document.documentElement.style.setProperty('--sai-surface', '#101418');
    try {
      const { container } = render(<RenderRegion entry={htmlEntry()} />);
      const iframe = container.querySelector('iframe')!;
      expect(iframe.getAttribute('srcdoc')).toContain('background:#101418');
    } finally {
      document.documentElement.style.removeProperty('--sai-surface');
    }
  });

  it('uses an explicit background over the theme', () => {
    const { container } = render(<RenderRegion entry={htmlEntry({ background: '#0a0c0e' })} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toContain('background:#0a0c0e');
  });

  it('falls back to the theme when the explicit background fails sanitization', () => {
    const { container } = render(
      <RenderRegion entry={htmlEntry({ background: 'red" onload="x' })} />,
    );
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toContain('background:#1a1a1a');
    expect(iframe.getAttribute('srcdoc')).not.toContain('onload');
  });

  it('injects a reporter that posts width as well as height', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain('scrollWidth');
    expect(srcdoc).toContain('width:w()');
  });

  it('grows the region when the mock reports a wider natural width', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('360px');
    postSize(container.querySelector('iframe')!, { width: 460 });
    expect(region.style.width).toBe('460px');
    expect(region.style.maxWidth).toBe('100%');
  });

  it('never shrinks after growing', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    const iframe = container.querySelector('iframe')!;
    postSize(iframe, { width: 500 });
    postSize(iframe, { width: 380 });
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('500px');
  });

  it('ignores width reports below the requested width', () => {
    const { container } = render(<RenderRegion entry={htmlEntry()} />);
    postSize(container.querySelector('iframe')!, { width: 120 });
    const region = container.querySelector('[data-render-region]') as HTMLElement;
    expect(region.style.width).toBe('360px');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/render/renderRegionSizing.test.tsx`
Expected: FAIL — srcdoc has no `background:`, no `width:w()`, region width never changes.

(jsdom materializes `contentWindow` for attached iframes, so `source: iframe.contentWindow` satisfies the handler's `e.source === win` guard. If a grow test fails, debug the event source matching — do NOT weaken the production guard to accept null sources.)

- [ ] **Step 3: Implement**

In `src/components/Chat/RenderToolCard.tsx`:

3a. Add the import (top of file, next to the other `../../render/` imports):

```ts
import { nextRenderWidth, sanitizeCssColor, resolveThemedSurface } from '../../render/renderSizing';
```

3b. Add `useCallback` to the existing react import:

```ts
import { useSyncExternalStore, useEffect, useRef, useState, useCallback } from 'react';
```

3c. Replace `RenderRegion` (lines 51–78) with:

```tsx
export function RenderRegion({ entry }: { entry: RenderEntry }) {
  // Grow-only natural width: starts at the requested width, widens when the
  // sandboxed mock reports a larger scrollWidth, and is capped to the message
  // column by maxWidth. Never shrinks (see renderSizing.nextRenderWidth).
  const [displayWidth, setDisplayWidth] = useState(entry.width);
  useEffect(() => {
    setDisplayWidth((w) => Math.max(w, entry.width));
  }, [entry.width]);
  const onNaturalWidth = useCallback((reported: number) => {
    setDisplayWidth((w) => nextRenderWidth(w, reported, entry.width));
  }, [entry.width]);
  const style: CSSProperties = {
    width: displayWidth,
    maxWidth: '100%',
    background: entry.background ?? 'var(--sai-surface, #1a1a1a)',
    display: 'inline-block',
  };
  return (
    <div data-render-region={entry.renderId} data-testid="render-region" style={style}>
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} onNaturalWidth={onNaturalWidth} />
      ) : entry.kind === 'mermaid' ? (
        <MermaidRender diagram={String((entry.payload as { diagram: string }).diagram)} />
      ) : entry.kind === 'theme' ? (
        <ThemedComponents
          components={(entry.payload as { components: string[] }).components}
          vars={(entry.payload as { vars: Record<string, string> }).vars}
          props={(entry.payload as { props?: Record<string, unknown> }).props}
        />
      ) : entry.kind === 'form' ? (
        <RenderedHtml entry={entry} enableSubmit onNaturalWidth={onNaturalWidth} />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
    </div>
  );
}
```

3d. Replace the `HEIGHT_REPORTER` constant (lines 92–99) with a size reporter (keep the explanatory comment above it, updating "content height" to "content size"):

```ts
const SIZE_REPORTER =
  '<script>(function(){' +
  'function h(){return Math.ceil(Math.max(document.documentElement.scrollHeight,(document.body?document.body.scrollHeight:0)));}' +
  'function w(){return Math.ceil(Math.max(document.documentElement.scrollWidth,(document.body?document.body.scrollWidth:0)));}' +
  "function post(){try{parent.postMessage({__saiRender:1,height:h(),width:w()},'*');}catch(e){}}" +
  "window.addEventListener('load',post);window.addEventListener('resize',post);" +
  'try{if(window.ResizeObserver){new ResizeObserver(post).observe(document.documentElement);}}catch(e){}' +
  'post();setTimeout(post,50);setTimeout(post,300);' +
  '})();<\/script>';
```

3e. In `RenderedHtml` (lines 101–144):

- Signature becomes:

```tsx
function RenderedHtml({ entry, enableSubmit, onNaturalWidth }: {
  entry: RenderEntry; enableSubmit?: boolean; onNaturalWidth?: (w: number) => void;
}) {
```

- The `doc` composition becomes (resolving the body background; `SIZE_REPORTER` replaces `HEIGHT_REPORTER`):

```tsx
  const bodyBg = (entry.background && sanitizeCssColor(entry.background)) || resolveThemedSurface();
  const doc =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head>` +
    `<body style="margin:0;background:${bodyBg}">${userHtml}${bridge}${SIZE_REPORTER}</body></html>`;
```

- In the `onMessage` handler, the `__saiRender` branch becomes:

```tsx
      if (data.__saiRender) {
        const h = Number(data.height);
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(2000, Math.max(40, Math.ceil(h))));
        const wRep = Number((data as { width?: number }).width);
        if (Number.isFinite(wRep) && wRep > 0) onNaturalWidth?.(wRep);
      } else if (enableSubmit && data.__saiFormSubmit && !submittedRef.current) {
```

- The effect dependency array becomes `[enableSubmit, onNaturalWidth]`.

- [ ] **Step 4: Run the new tests and the existing render suites**

Run: `npx vitest run --project unit tests/unit/render/`
Expected: PASS, including the pre-existing `renderedHtmlFileMode` tests (file mode is untouched — early return before the iframe path).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx tests/unit/render/renderRegionSizing.test.tsx
git commit -m "feat(render): grow-only region width + themed iframe background"
```

---

### Task 3: Headless capture — background param + natural-width growth

**Files:**
- Modify: `electron/main.ts:939-977` (the `render:captureHtml` handler)

- [ ] **Step 1: Add the import**

In `electron/main.ts`, next to the existing `import { formTimeoutMs } from '../src/render/formTimeout';` (line ~87), add:

```ts
import { sanitizeCssColor } from '../src/render/renderSizing';
```

- [ ] **Step 2: Replace the handler**

Replace the `render:captureHtml` handler (lines 939–977) with:

```ts
  ipcMain.handle('render:captureHtml', async (_event, args: { html?: string; width?: number; background?: string }) => {
    const html = typeof args?.html === 'string' ? args.html : '';
    if (!html) return null;
    const minWidth = Math.min(Math.max(Math.round(args?.width || 480), 80), 2000);
    const background = (typeof args?.background === 'string' && sanitizeCssColor(args.background)) || '#1a1a1a';
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width: minWidth,
        height: 1200,
        show: false,
        // Park it far off any display so it never flashes on screen.
        x: -32000,
        y: -32000,
        frame: false,
        skipTaskbar: true,
        webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false },
      });
      const doc =
        `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">` +
        `</head><body style="margin:0;background:${background}">${html}</body></html>`;
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
      // Let layout, fonts and any inline scripts settle before measuring.
      await new Promise((r) => setTimeout(r, 320));
      // Grow-only width: widen to the content's natural width (capped) so the
      // screenshot matches the in-chat region instead of clipping/scrolling.
      const naturalW = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)) || 0',
      )) as number;
      const width = Math.min(Math.max(minWidth, Math.round(naturalW) || 0), 2000);
      if (width > minWidth) {
        win.setContentSize(width, 1200);
        await new Promise((r) => setTimeout(r, 60));
      }
      const h = (await win.webContents.executeJavaScript(
        'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) || 200',
      )) as number;
      const height = Math.min(Math.max(Math.round(h), 40), 4000);
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return image.toPNG().toString('base64');
    } catch (err) {
      console.error('[render] captureHtml failed:', err);
      return null;
    } finally {
      try { win?.destroy(); } catch { /* noop */ }
    }
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (This handler has no unit harness — `ipcMain` handlers aren't covered by the unit project; verification is the Task 6 manual pass.)

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(render): captureHtml honors background and grows to natural width"
```

---

### Task 4: Plumbing — preload type + App.tsx capture deps pass background

**Files:**
- Modify: `electron/preload.ts:285-286`
- Modify: `src/App.tsx` (`render_mermaid` branch ~1460-1485 and generic `render_*` branch ~1545-1615; line numbers may have drifted slightly — locate by the quoted code)

- [ ] **Step 1: Preload type**

In `electron/preload.ts` (line ~285), change:

```ts
  renderCaptureHtml: (args: { html: string; width?: number }): Promise<string | null> =>
    ipcRenderer.invoke('render:captureHtml', args),
```

to:

```ts
  renderCaptureHtml: (args: { html: string; width?: number; background?: string }): Promise<string | null> =>
    ipcRenderer.invoke('render:captureHtml', args),
```

- [ ] **Step 2: App.tsx — import and helper**

Add to the imports near `import { handleRenderToolRequest } from './render/handleRenderToolRequest';`:

```ts
import { resolveThemedSurface } from './render/renderSizing';
```

- [ ] **Step 3: App.tsx — `render_mermaid` branch**

In the `onSwarmToolRequest` handler's `render_mermaid` branch, update the inline type and the call. The type annotation becomes:

```ts
        const saiAny = sai as { renderCaptureHtml?: (a: { html: string; width?: number; background?: string }) => Promise<string | null> };
```

and the `renderCaptureHtml` call gains a background argument:

```ts
                const b64 = await saiAny.renderCaptureHtml!({
                  html: svg,
                  width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                  background: typeof req.input?.background === 'string' ? req.input.background : resolveThemedSurface(),
                });
```

- [ ] **Step 4: App.tsx — generic `render_*` branch**

In the generic `render_*` branch, update the inline type annotation the same way:

```ts
          renderCaptureHtml?: (a: { html: string; width?: number; background?: string }) => Promise<string | null>;
```

and the `renderCaptureHtml` call inside the `htmlInput` deps:

```ts
              const b64 = await saiAny.renderCaptureHtml!({
                html: htmlInput,
                width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                background: typeof req.input?.background === 'string' ? req.input.background : resolveThemedSurface(),
              });
```

(The file-mode `renderCaptureFile` path is intentionally untouched — spec §4.)

- [ ] **Step 5: Typecheck + unit suite**

Run: `npx tsc --noEmit && npx vitest run --project unit`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts src/App.tsx
git commit -m "feat(render): pass background through capture plumbing"
```

---

### Task 5: Tool descriptions — `width` is now initial/minimum

**Files:**
- Modify: `src/lib/saiTools.ts`

- [ ] **Step 1: Update the six width descriptions**

In `src/lib/saiTools.ts`, for the tools `render_html`, `render_chart`, `render_diff`, `render_mermaid`, `render_theme`, and `render_form`, change each width property description from:

```ts
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
```

to:

```ts
        width: { type: 'number', description: 'Initial/minimum viewport width in px (default 360); the canvas grows to fit wider content.' },
```

(`render_component`'s width description stays as-is — component mounts don't use the iframe reporter. Per spec §4.)

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/saiTools.ts
git commit -m "docs(render): width param documented as initial/minimum viewport"
```

---

### Task 6: Full verification + manual render check

- [ ] **Step 1: Full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass (vitest config caps workers at 2 — do not override upward).

- [ ] **Step 2: PWA build sanity**

Run: `npx vite build --config vite.config.pwa.ts`
Expected: builds (renderer-remote doesn't use RenderToolCard, but the shared import graph must stay clean).

- [ ] **Step 3: Manual verification (requires app restart for main.ts changes)**

In the dev app, ask SAI to render a wide mock (or re-render the GitHub-watcher-card HTML from chat history). Expected: the mock sits on the dark themed canvas (no white box), the region widens to the content's natural width (~460px for the watcher pipeline) with zero scrollbars, and the returned screenshot matches. Renderer-side changes appear under HMR; the screenshot path needs the restart.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "test(render): sizing/background verification fixups"
```

(Skip if the tree is clean.)
