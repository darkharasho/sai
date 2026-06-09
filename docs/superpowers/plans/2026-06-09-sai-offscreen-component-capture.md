# Offscreen Component/Theme Capture + `render_theme` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give component-based renders (`render_component`, new `render_theme`) a faithful agent screenshot via a hidden offscreen `BrowserWindow` that loads the app at a minimal `/render-host` route and `capturePage`s the real themed components.

**Architecture:** A shared `ThemedComponents` mounts allow-listed registry components under supplied CSS vars (used by both the live chat card and the offscreen host). `main.tsx` mounts a minimal `RenderHost` (no `App`, no `StrictMode`) when the URL carries a `render-host` flag. A new `render:captureComponent` IPC spawns the hidden window (mirroring `render:captureHtml`), loads `/render-host?…`, waits for `window.__renderReady`, and captures. `App.tsx` wires the capture dep for component/theme tools.

**Tech Stack:** TypeScript, React, Electron, Vitest (`--maxWorkers=2`), Playwright harness.

**Spec:** `docs/superpowers/specs/2026-06-09-sai-offscreen-component-capture-design.md`

---

## File Structure

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `src/render/ThemedComponents.tsx` | Mount registered components under CSS vars (shared card + host). | New |
| `electron/renderHostUrl.ts` | Pure `renderHostSearch(params)` query builder. | New |
| `src/render/renderHostParams.ts` | Pure `parseRenderHostParams(search)`. | New |
| `src/render/RenderHost.tsx` | Minimal route component: parse params → `ThemedComponents` → ready flag. | New |
| `src/main.tsx` | Mount `RenderHost` on the `render-host` flag (no StrictMode). | Mod |
| `electron/main.ts` | `render:captureComponent` IPC (hidden window + capture). | Mod |
| `electron/preload.ts` | `renderCaptureComponent` bridge. | Mod |
| `src/render/renderStore.ts` | Add `'theme'` kind. | Mod |
| `src/render/saiToolDispatcher.ts` | `render_theme` case. | Mod |
| `src/lib/saiTools.ts` | `render_theme` schema. | Mod |
| `src/components/Chat/RenderToolCard.tsx` | `RenderRegion` theme branch. | Mod |
| `src/components/Chat/RenderToolCallCard.tsx` | `entryFromToolCall` theme branch + lang. | Mod |
| `src/App.tsx` | Capture deps for component/theme + card guard. | Mod |
| `src/test-harness/stories/render-tool-call-card.tsx` | `kind:'theme'` story. | Mod |
| `tests/e2e/render-tool-call-card.spec.ts` | theme e2e. | Mod |

**Naming contract:** `ThemedComponents({components: string[], vars: Record<string,string>, props?: Record<string,unknown>})`; `renderHostSearch(p)`; `parseRenderHostParams(search)`; bare tool `render_theme` / prefixed `sai_render_theme`; preload `renderCaptureComponent`.

---

## Task 1: `ThemedComponents` shared mount

**Files:** Create `src/render/ThemedComponents.tsx`; Test `tests/unit/render/ThemedComponents.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/render/ThemedComponents.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemedComponents } from '../../../src/render/ThemedComponents';

describe('ThemedComponents', () => {
  it('mounts a registered component', () => {
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle']} vars={{}} props={{ state: 'busy-done' }} />);
    expect(container.querySelector('.ws-sq')).not.toBeNull();
  });

  it('applies vars as CSS custom properties on the wrapper', () => {
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle']} vars={{ '--accent': '#6aa9ff' }} props={{ state: 'busy-done' }} />);
    const wrap = container.querySelector('[data-themed-wrap]') as HTMLElement;
    expect(wrap.style.getPropertyValue('--accent')).toBe('#6aa9ff');
  });

  it('renders an error label for an unknown component key', () => {
    const { getByText } = render(<ThemedComponents components={['Nope']} vars={{}} />);
    expect(getByText(/unknown component: Nope/)).toBeTruthy();
  });

  it('mounts multiple components', () => {
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle', 'WorkspaceSquircle']} vars={{}} props={{ state: 'idle' }} />);
    expect(container.querySelectorAll('.ws-sq').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/ThemedComponents.test.tsx --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/render/ThemedComponents.tsx
import type { CSSProperties } from 'react';
import { getRegisteredComponent } from './componentRegistry';

export function ThemedComponents({
  components,
  vars,
  props,
}: {
  components: string[];
  vars: Record<string, string>;
  props?: Record<string, unknown>;
}) {
  // CSS custom properties go through inline style; cast because React's
  // CSSProperties doesn't type arbitrary `--*` keys.
  const wrapStyle = { display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, ...vars } as CSSProperties;
  return (
    <div data-themed-wrap style={wrapStyle}>
      {components.map((key, i) => {
        const reg = getRegisteredComponent(key);
        if (!reg) {
          return <div key={i} className="sai-render-card__err">unknown component: {key}</div>;
        }
        const Cmp = reg.component;
        return <Cmp key={i} {...(props ?? {})} />;
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/ThemedComponents.test.tsx --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/ThemedComponents.tsx tests/unit/render/ThemedComponents.test.tsx
git commit -m "feat(render): add ThemedComponents shared mount"
```

---

## Task 2: `'theme'` render kind + dispatcher

**Files:** Modify `src/render/renderStore.ts:1`, `src/render/saiToolDispatcher.ts`; Test `tests/unit/render/saiToolDispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append inside describe('dispatchSaiRenderTool', ...) in tests/unit/render/saiToolDispatcher.test.ts
it('render_theme upserts a theme entry with components + vars', () => {
  const res = dispatchSaiRenderTool('render_theme', { vars: { '--accent': '#f00' }, components: ['WorkspaceSquircle'], title: 'T' }, 'rid-th');
  expect(res.ok).toBe(true);
  const e = renderStore.get('rid-th');
  expect(e?.kind).toBe('theme');
  expect(e?.payload).toEqual({ components: ['WorkspaceSquircle'], vars: { '--accent': '#f00' } });
  expect(e?.title).toBe('T');
});

it('render_theme defaults components to the full registry when omitted', () => {
  const res = dispatchSaiRenderTool('render_theme', { vars: { '--accent': '#f00' } }, 'rid-th2');
  expect(res.ok).toBe(true);
  const e = renderStore.get('rid-th2');
  expect((e?.payload as { components: string[] }).components).toContain('WorkspaceSquircle');
});

it('render_theme rejects a missing/non-object vars', () => {
  const res = dispatchSaiRenderTool('render_theme', { vars: 'nope' }, 'rid-th3');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/vars/i);
  expect(renderStore.get('rid-th3')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: FAIL — `unknown tool: render_theme`.

- [ ] **Step 3: Write minimal implementation**

In `src/render/renderStore.ts` line 1:

```ts
export type RenderKind = 'html' | 'component' | 'mermaid' | 'theme';
```

In `src/render/saiToolDispatcher.ts`, add the import at the top:

```ts
import { registeredComponentKeys } from './componentRegistry';
```

Add this case inside `switch (name)` before `default:`:

```ts
    case 'render_theme': {
      if (!inp.vars || typeof inp.vars !== 'object' || Array.isArray(inp.vars)) {
        return { ok: false, error: 'render_theme requires a "vars" object of CSS custom properties' };
      }
      const components = Array.isArray(inp.components) && inp.components.length > 0
        ? (inp.components as unknown[]).filter((c): c is string => typeof c === 'string')
        : registeredComponentKeys();
      renderStore.upsert({ renderId, kind: 'theme', payload: { components, vars: inp.vars }, title: title || 'Theme', width, background, status: 'rendering' });
      return { ok: true };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderStore.ts src/render/saiToolDispatcher.ts tests/unit/render/saiToolDispatcher.test.ts
git commit -m "feat(render): add theme render kind + dispatch render_theme"
```

---

## Task 3: Register `render_theme` schema

**Files:** Modify `src/lib/saiTools.ts`; Test `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('render_theme tool', () => {
  it('registers render_theme as a chat tool requiring vars', () => {
    expect(SAI_TOOL_NAMES.has('render_theme')).toBe(true);
    const t = SAI_TOOL_SCHEMA.find((x) => x.name === 'render_theme')!;
    expect(t.toolset).toBe('chat');
    expect(t.input_schema.required).toContain('vars');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to `SAI_TOOL_SCHEMA` in `src/lib/saiTools.ts`, after the `render_mermaid` entry:

```ts
  {
    name: 'render_theme',
    description:
      'Apply candidate CSS custom properties to real registered SAI components and return a screenshot. ' +
      'USE THIS to preview a theme/color change on ACTUAL components (not a mock) so the user sees the ' +
      'real effect. Pass `vars` (CSS custom properties); optionally limit to specific `components`.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        vars: { type: 'object', description: 'CSS custom properties, e.g. {"--accent":"#6aa9ff"}.' },
        components: { type: 'array', items: { type: 'string' }, description: 'Registry keys to preview; omit for all registered.' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the preview.' },
      },
      required: ['vars'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): register render_theme tool schema"
```

---

## Task 4: Card surfaces for `theme`

**Files:** Modify `src/components/Chat/RenderToolCard.tsx`, `src/components/Chat/RenderToolCallCard.tsx`. Verify via typecheck.

- [ ] **Step 1: `RenderRegion` theme branch**

In `src/components/Chat/RenderToolCard.tsx`:

1. Add import:
```ts
import { ThemedComponents } from '../../render/ThemedComponents';
```
2. In `RenderRegion`, extend the kind branches. After the `mermaid` branch and before the component fallback, add a `theme` branch so it reads:
```tsx
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} />
      ) : entry.kind === 'mermaid' ? (
        <MermaidRender diagram={String((entry.payload as { diagram: string }).diagram)} />
      ) : entry.kind === 'theme' ? (
        <ThemedComponents
          components={(entry.payload as { components: string[] }).components}
          vars={(entry.payload as { vars: Record<string, string> }).vars}
        />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
```

- [ ] **Step 2: `entryFromToolCall` theme branch + lang**

In `src/components/Chat/RenderToolCallCard.tsx`:

1. After the `sai_render_mermaid` branch and before `// default: html`, insert:
```ts
  if (name.endsWith('sai_render_theme')) {
    const vars = input.vars && typeof input.vars === 'object' ? (input.vars as Record<string, string>) : null;
    if (!vars) return null;
    const components = Array.isArray(input.components) && input.components.length > 0
      ? (input.components as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    return {
      entry: { renderId, kind: 'theme', payload: { components, vars }, title: title || 'Theme', width, background, status: 'ready' },
      code: JSON.stringify(vars, null, 2),
    };
  }
```
Note: the card redisplay uses whatever `components` were in the tool input (it does not re-derive the full registry default — that default is applied at capture time; an untitled-components theme card shows the wrapper with no components, which is acceptable for a history redisplay).

2. Update the lang computation to include theme (its code pane shows JSON vars). Change:
```ts
  const lang = entry.kind === 'component' ? 'json' : entry.kind === 'mermaid' ? 'text' : 'html';
```
to:
```ts
  const lang = entry.kind === 'component' || entry.kind === 'theme' ? 'json' : entry.kind === 'mermaid' ? 'text' : 'html';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx src/components/Chat/RenderToolCallCard.tsx
git commit -m "feat(render): theme render kind in card surfaces"
```

---

## Task 5: Pure URL helpers (`renderHostSearch` + `parseRenderHostParams`)

**Files:** Create `electron/renderHostUrl.ts`, `src/render/renderHostParams.ts`; Tests `tests/unit/electron/renderHostUrl.test.ts`, `tests/unit/render/renderHostParams.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/electron/renderHostUrl.test.ts
import { describe, it, expect } from 'vitest';
import { renderHostSearch } from '../../../electron/renderHostUrl';

describe('renderHostSearch', () => {
  it('always sets the render-host flag', () => {
    expect(renderHostSearch({})).toContain('render-host=1');
  });
  it('encodes a single component + props', () => {
    const s = new URLSearchParams(renderHostSearch({ component: 'WorkspaceSquircle', props: { state: 'busy-done' } }));
    expect(s.get('component')).toBe('WorkspaceSquircle');
    expect(JSON.parse(s.get('props')!)).toEqual({ state: 'busy-done' });
  });
  it('encodes components[] + vars + width', () => {
    const s = new URLSearchParams(renderHostSearch({ components: ['A', 'B'], vars: { '--x': '1' }, width: 400 }));
    expect(JSON.parse(s.get('components')!)).toEqual(['A', 'B']);
    expect(JSON.parse(s.get('vars')!)).toEqual({ '--x': '1' });
    expect(s.get('width')).toBe('400');
  });
});
```

```ts
// tests/unit/render/renderHostParams.test.ts
import { describe, it, expect } from 'vitest';
import { parseRenderHostParams } from '../../../src/render/renderHostParams';

describe('parseRenderHostParams', () => {
  it('reads a single component into a one-element array + props', () => {
    const p = parseRenderHostParams('?render-host=1&component=WorkspaceSquircle&props=' + encodeURIComponent('{"state":"idle"}'));
    expect(p.components).toEqual(['WorkspaceSquircle']);
    expect(p.props).toEqual({ state: 'idle' });
  });
  it('reads components[] + vars + width', () => {
    const p = parseRenderHostParams('?render-host=1&components=' + encodeURIComponent('["A","B"]') + '&vars=' + encodeURIComponent('{"--x":"1"}') + '&width=400');
    expect(p.components).toEqual(['A', 'B']);
    expect(p.vars).toEqual({ '--x': '1' });
    expect(p.width).toBe(400);
  });
  it('tolerates malformed json (returns empties)', () => {
    const p = parseRenderHostParams('?render-host=1&components=oops&props=oops&vars=oops');
    expect(p.components).toEqual([]);
    expect(p.props).toEqual({});
    expect(p.vars).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/electron/renderHostUrl.test.ts tests/unit/render/renderHostParams.test.ts --maxWorkers=2`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write the implementations**

```ts
// electron/renderHostUrl.ts
export interface RenderHostParams {
  component?: string;
  components?: string[];
  props?: Record<string, unknown>;
  vars?: Record<string, string>;
  width?: number;
}

/** Build the query string (incl. the render-host flag) for the offscreen window. */
export function renderHostSearch(p: RenderHostParams): string {
  const sp = new URLSearchParams();
  sp.set('render-host', '1');
  if (p.component) sp.set('component', p.component);
  if (p.components) sp.set('components', JSON.stringify(p.components));
  if (p.props) sp.set('props', JSON.stringify(p.props));
  if (p.vars) sp.set('vars', JSON.stringify(p.vars));
  if (typeof p.width === 'number') sp.set('width', String(p.width));
  return sp.toString();
}
```

```ts
// src/render/renderHostParams.ts
export interface ParsedRenderHost {
  components: string[];
  props: Record<string, unknown>;
  vars: Record<string, string>;
  width?: number;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Parse the offscreen render-host query into mount params. Tolerant of junk. */
export function parseRenderHostParams(search: string): ParsedRenderHost {
  const sp = new URLSearchParams(search);
  const single = sp.get('component');
  const components = single
    ? [single]
    : safeJson<string[]>(sp.get('components'), []).filter((c) => typeof c === 'string');
  const props = safeJson<Record<string, unknown>>(sp.get('props'), {});
  const vars = safeJson<Record<string, string>>(sp.get('vars'), {});
  const w = Number(sp.get('width'));
  return { components, props, vars, width: Number.isFinite(w) && w > 0 ? w : undefined };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/electron/renderHostUrl.test.ts tests/unit/render/renderHostParams.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/renderHostUrl.ts src/render/renderHostParams.ts tests/unit/electron/renderHostUrl.test.ts tests/unit/render/renderHostParams.test.ts
git commit -m "feat(render): pure render-host url + param helpers"
```

---

## Task 6: `RenderHost` route + `main.tsx` mount

**Files:** Create `src/render/RenderHost.tsx`; Modify `src/main.tsx`. Verify via typecheck.

- [ ] **Step 1: Implement `RenderHost`**

```tsx
// src/render/RenderHost.tsx
import { useEffect } from 'react';
import { ThemedComponents } from './ThemedComponents';
import { parseRenderHostParams } from './renderHostParams';

declare global {
  interface Window { __renderReady?: boolean }
}

export function RenderHost() {
  const { components, props, vars } = parseRenderHostParams(window.location.search);
  useEffect(() => {
    let done = false;
    const signal = () => { if (!done) { done = true; window.__renderReady = true; } };
    // One frame for layout, then wait for fonts, then signal ready for capture.
    requestAnimationFrame(() => {
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fonts?.ready) fonts.ready.then(signal, signal);
      else signal();
    });
  }, []);
  return (
    <div id="render-host-root" style={{ display: 'inline-block' }}>
      <ThemedComponents components={components} vars={vars} props={props} />
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `src/main.tsx`**

Replace the routing block so the render-host flag is checked first (NOT dev-gated, NO StrictMode):

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts';
import './styles/globals.css';

const root = document.getElementById('root')!;
const params = new URLSearchParams(window.location.search);

if (window.location.pathname.startsWith('/render-host') || params.has('render-host')) {
  // Offscreen capture host: minimal tree, no StrictMode (a one-shot ready flag
  // must not be double-invoked).
  import('./render/RenderHost').then(({ RenderHost }) => {
    ReactDOM.createRoot(root).render(<RenderHost />);
  });
} else if (import.meta.env.DEV && window.location.pathname.startsWith('/test-harness')) {
  import('./test-harness').then(({ TestHarness }) => {
    ReactDOM.createRoot(root).render(<TestHarness />);
  });
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/render/RenderHost.tsx src/main.tsx
git commit -m "feat(render): minimal RenderHost route for offscreen capture"
```

---

## Task 7: `render:captureComponent` IPC + preload

**Files:** Modify `electron/main.ts`, `electron/preload.ts`. Verify via typecheck + build of electron.

- [ ] **Step 1: Add the IPC handler**

In `electron/main.ts`, add the import near the top with the other electron-service imports:

```ts
import { renderHostSearch, type RenderHostParams } from './renderHostUrl';
```

Add this handler next to the `render:captureHtml` handler (after it):

```ts
  ipcMain.handle('render:captureComponent', async (_event, params: RenderHostParams): Promise<string | null> => {
    const width = typeof params?.width === 'number' && params.width > 0 ? Math.min(Math.round(params.width), 2000) : 360;
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        width,
        height: 1200,
        show: false,
        x: -32000,
        y: -32000,
        frame: false,
        skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, javascript: true, backgroundThrottling: false },
      });
      const search = renderHostSearch({ ...params, width });
      if (process.env.VITE_DEV_SERVER_URL) {
        await win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/render-host?${search}`);
      } else {
        await win.loadFile(path.join(__dirname, '../dist/index.html'), { search });
      }
      // Poll for the host's ready flag (set after layout + fonts), max ~3s.
      const deadline = Date.now() + 3000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const ready = (await win.webContents.executeJavaScript('window.__renderReady === true').catch(() => false)) as boolean;
        if (ready) break;
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const h = (await win.webContents.executeJavaScript(
        "(function(){var el=document.getElementById('render-host-root');return el?Math.ceil(el.getBoundingClientRect().height):0;})() || 200",
      )) as number;
      const height = Math.min(Math.max(Math.round(h), 40), 4000);
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return image.toPNG().toString('base64');
    } catch (err) {
      console.error('[render] captureComponent failed:', err);
      return null;
    } finally {
      try { win?.destroy(); } catch { /* noop */ }
    }
  });
```

Note: `preload` is attached and `sandbox:false` so the dynamic-import-based renderer bundle runs; `RenderHost` makes no privileged calls. Confirm `path` and `BrowserWindow` are already imported in `main.ts` (they are — used by `render:captureHtml`).

- [ ] **Step 2: Add the preload bridge**

In `electron/preload.ts`, next to `renderCaptureHtml` (~line 257), add:

```ts
  renderCaptureComponent: (a: { component?: string; components?: string[]; props?: Record<string, unknown>; vars?: Record<string, string>; width?: number }): Promise<string | null> =>
    ipcRenderer.invoke('render:captureComponent', a),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(render): render:captureComponent offscreen IPC + preload bridge"
```

---

## Task 8: Wire capture deps in `App.tsx`

**Files:** Modify `src/App.tsx`. Verify via typecheck.

- [ ] **Step 1: Add the component/theme capture branch**

In `src/App.tsx` `onSwarmToolRequest`, BEFORE the existing `if (typeof req.tool === 'string' && req.tool.startsWith('render_'))` block, insert:

```ts
      if (req.tool === 'render_component' || req.tool === 'render_theme') {
        const saiAny = sai as { renderCaptureComponent?: (a: { component?: string; components?: string[]; props?: Record<string, unknown>; vars?: Record<string, string>; width?: number }) => Promise<string | null> };
        const deps = typeof saiAny.renderCaptureComponent === 'function'
          ? {
              captureRenderRegion: async () => {
                const b64 = await saiAny.renderCaptureComponent!({
                  component: typeof req.input?.component === 'string' ? req.input.component : undefined,
                  components: Array.isArray(req.input?.components) ? req.input.components : undefined,
                  props: req.input?.props && typeof req.input.props === 'object' ? req.input.props : undefined,
                  vars: req.input?.vars && typeof req.input.vars === 'object' ? req.input.vars : undefined,
                  width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                });
                if (!b64) throw new Error('capture returned no image');
                return { base64: b64, mimeType: 'image/png' as const };
              },
            }
          : {};
        void handleRenderToolRequest(
          { tool: req.tool, input: req.input, renderId: req.id },
          deps,
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

- [ ] **Step 2: Add `sai_render_theme` to the card guard**

Find the `renderToolCall` guard chain (`n.endsWith('sai_render_html') || ...`) and add:

```ts
                      n.endsWith('sai_render_theme') ||
```

(The existing `sai_render_component` line stays — its card render is unchanged; only its capture is newly wired above.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(render): wire component/theme offscreen capture + theme card guard"
```

---

## Task 9: e2e + regression

**Files:** Modify `src/test-harness/stories/render-tool-call-card.tsx`, `tests/e2e/render-tool-call-card.spec.ts`

- [ ] **Step 1: Add the story variant**

In `src/test-harness/stories/render-tool-call-card.tsx`:
1. Extend `Kind`: `type Kind = 'html' | 'chart' | 'diff' | 'mermaid' | 'theme';`
2. In `makeTc`, before the html fallback, add:
```ts
  if (kind === 'theme') {
    return {
      id: `tc-theme-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_theme',
      input: JSON.stringify({ title: 'Theme', width, vars: { '--accent': '#6aa9ff' }, components: ['WorkspaceSquircle'] }),
    };
  }
```
3. Broaden the `parseProps` allowed-kind guard to also accept `'theme'`.

- [ ] **Step 2: Add the e2e test**

In `tests/e2e/render-tool-call-card.spec.ts`, append:
```ts
test('render_theme card mounts the themed component', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'theme', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  // ThemedComponents wraps the registered component with the CSS vars applied.
  await expect(card.locator('[data-themed-wrap]')).toBeVisible();
  await expect(card.locator('.ws-sq')).toBeVisible();
});
```

- [ ] **Step 3: Run e2e**

Run: `npx playwright test render-tool-call-card.spec.ts --reporter=list`
Expected: all pass.

- [ ] **Step 4: Unit regression + typecheck**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts tests/unit/electron/renderHostUrl.test.ts --maxWorkers=2`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/test-harness/stories/render-tool-call-card.tsx tests/e2e/render-tool-call-card.spec.ts
git commit -m "test(render): e2e coverage for render_theme card"
```

---

## Self-Review Notes

- **Spec coverage:** `ThemedComponents` (T1), `render_theme` tool (T2/T3) + card surfaces (T4), pure url/param helpers (T5), `RenderHost` route + main.tsx (T6), `render:captureComponent` IPC + preload (T7), App wiring incl. the `render_component` screenshot fix (T8), e2e (T9). All design sections covered.
- **The `render_component` gap fix** is in T8 (its capture dep now calls `renderCaptureComponent`); its card render is unchanged.
- **Hard-to-unit-test pieces** (IPC handler, RenderHost mount) are backed by the pure, tested `renderHostSearch`/`parseRenderHostParams` (T5) + typecheck + the e2e (T9). The Electron `capturePage` itself is not unit-tested (Electron-only), consistent with the existing `render:captureHtml` having no unit test.
- **Type consistency:** `ThemedComponents` props, `RenderHostParams`, `ParsedRenderHost`, `renderHostSearch`, `parseRenderHostParams` are defined in T1/T5 and used unchanged in T6/T7/T8. `kind:'theme'` consistent across store/dispatcher/card.
- **Restart caveat:** the new `render_theme` tool + the `render:captureComponent` IPC are not live until the app restarts (memory `project_sai_tools_need_restart`).
