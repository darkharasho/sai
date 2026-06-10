# Renderer File Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the in-app renderer load real multi-file HTML sites from the workspace (resolving CSS/JS/image assets and reaching the network), while keeping today's inline-only `srcDoc` render unchanged.

**Architecture:** A new privileged Electron protocol `sai-render://<token>/<path>` serves files through a single containment-checked chokepoint. File-backed renders (any call with `path` or `baseDir`) mint a token via IPC on mount and point the iframe `src` at the protocol; inline-only renders keep the opaque `srcDoc` sandbox. The renderer supplies the active workspace root (`cwd`); main enforces that every served file stays inside it via realpath containment.

**Tech Stack:** Electron (`protocol.handle`, `registerSchemesAsPrivileged`), TypeScript, React, Vitest (`--maxWorkers=2`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-09-renderer-file-access-design.md`

---

## File Structure

- `electron/services/renderProtocol.ts` (**create**) — token store, containment guard, asset resolution, CSP header, content-type map. Pure/testable; no direct `protocol.handle` side effects beyond a thin `installRenderProtocol(protocol)` adapter.
- `electron/main.ts` (**modify**) — register the scheme as privileged before app-ready; call `installRenderProtocol`; add `render:mintFileUrl` IPC; extend `render:openInBrowser` to accept a path.
- `electron/preload.ts` (**modify**) — expose `renderMintFileUrl`.
- `src/lib/saiTools.ts` (**modify**) — add `path`, `baseDir`, `height` to `render_html` schema + boundary note.
- `src/render/renderStore.ts` (**modify**) — document the file-mode payload shape (no type change required; `payload` is `Record<string, unknown>`).
- `src/components/Chat/RenderToolCallCard.tsx` (**modify**) — `entryFromToolCall` detects `path`/`baseDir`, builds a file-mode html entry; thread `cwd`.
- `src/components/Chat/RenderToolCard.tsx` (**modify**) — `RenderedHtml` chooses `src` vs `srcDoc`, mints URL on mount for file mode.
- `src/App.tsx` (**modify**) — pass active `projectPath` as `cwd` to `RenderToolCallCard`.
- `src/test-harness/stories/render-tool-call-card.tsx` (**modify**) — file-backed story.
- `tests/unit/electron/renderProtocol.test.ts` (**create**) — containment + lifecycle + content-type unit tests.
- `tests/unit/render/renderToolCallCard.entry.test.ts` (**modify**) — file-mode entry-building tests.
- `tests/e2e/sai-render.spec.ts` (**modify**) + `tests/e2e/fixtures/mini-site/` (**create**) — multi-file load + negative case.

---

## Task 1: Render protocol module — containment guard & token store

**Files:**
- Create: `electron/services/renderProtocol.ts`
- Test: `tests/unit/electron/renderProtocol.test.ts`

This is the security core. Implement as pure functions over an injectable store so tests run without a live Electron protocol. Uses the real filesystem for realpath/symlink checks.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/renderProtocol.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createRenderProtocolStore,
  mintRenderToken,
  resolveRenderAsset,
  RENDER_CSP,
  contentTypeFor,
} from '../../../electron/services/renderProtocol';

let root: string;
let store: ReturnType<typeof createRenderProtocolStore>;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sai-rp-')));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{}');
  store = createRenderProtocolStore();
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('renderProtocol containment', () => {
  it('serves an in-bounds asset', () => {
    const token = mintRenderToken(store, { root });
    const r = resolveRenderAsset(store, token, 'assets/app.css');
    expect(r.ok).toBe(true);
    expect(r.ok && r.filePath).toBe(path.join(root, 'assets', 'app.css'));
  });

  it('rejects ../ traversal', () => {
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, '../secret').ok).toBe(false);
  });

  it('rejects absolute paths outside root', () => {
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, '/etc/passwd').ok).toBe(false);
  });

  it('rejects symlink escape', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-out-'));
    fs.writeFileSync(path.join(outside, 'leak.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'leak.txt'), path.join(root, 'link.txt'));
    const token = mintRenderToken(store, { root });
    expect(resolveRenderAsset(store, token, 'link.txt').ok).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('rejects an unknown token', () => {
    expect(resolveRenderAsset(store, 'nope', 'index.html').ok).toBe(false);
  });

  it('serves stored inline html for the entry path', () => {
    const token = mintRenderToken(store, { root, inlineHtml: '<p>inline</p>' });
    const r = resolveRenderAsset(store, token, '__sai_inline__');
    expect(r.ok && r.inlineHtml).toBe('<p>inline</p>');
  });
});

describe('renderProtocol helpers', () => {
  it('CSP allows sai-render + https, not file', () => {
    expect(RENDER_CSP).toContain('sai-render:');
    expect(RENDER_CSP).toContain('https:');
    expect(RENDER_CSP).not.toContain('file:');
  });

  it('maps content types', () => {
    expect(contentTypeFor('a.css')).toBe('text/css');
    expect(contentTypeFor('a.js')).toBe('text/javascript');
    expect(contentTypeFor('a.html')).toBe('text/html');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/renderProtocol.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `renderProtocol`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/renderProtocol.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const INLINE_ENTRY = '__sai_inline__';

// Set as a response header (src-mode iframes can't use the srcDoc <meta> CSP).
// File access is bounded by the protocol handler; network is allowed per design.
export const RENDER_CSP =
  "default-src 'self' sai-render:; " +
  "script-src 'self' sai-render: https: 'unsafe-inline'; " +
  "style-src 'self' sai-render: https: 'unsafe-inline'; " +
  "img-src 'self' sai-render: https: data:; " +
  "font-src 'self' sai-render: https: data:; " +
  "connect-src 'self' sai-render: https:;";

const TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ENTRIES = 200;

export interface RenderTokenEntry {
  root: string; // realpath'd workspace root
  inlineHtml?: string;
  createdAt: number;
}

export interface RenderProtocolStore {
  tokens: Map<string, RenderTokenEntry>;
}

export function createRenderProtocolStore(): RenderProtocolStore {
  return { tokens: new Map() };
}

function now(): number {
  // Date.now is fine in Electron main (not a workflow script).
  return Date.now();
}

export function mintRenderToken(
  store: RenderProtocolStore,
  opts: { root: string; inlineHtml?: string },
): string {
  sweep(store);
  if (store.tokens.size >= MAX_ENTRIES) {
    // Evict oldest.
    const oldest = [...store.tokens.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    )[0];
    if (oldest) store.tokens.delete(oldest[0]);
  }
  const realRoot = fs.realpathSync(opts.root);
  const token = crypto.randomBytes(16).toString('hex');
  store.tokens.set(token, {
    root: realRoot,
    inlineHtml: opts.inlineHtml,
    createdAt: now(),
  });
  return token;
}

export function evictRenderToken(store: RenderProtocolStore, token: string): void {
  store.tokens.delete(token);
}

function sweep(store: RenderProtocolStore): void {
  const cutoff = now() - TTL_MS;
  for (const [t, e] of store.tokens) {
    if (e.createdAt < cutoff) store.tokens.delete(t);
  }
}

export type ResolveResult =
  | { ok: true; filePath: string; inlineHtml?: undefined }
  | { ok: true; inlineHtml: string; filePath?: undefined }
  | { ok: false; status: number };

export function resolveRenderAsset(
  store: RenderProtocolStore,
  token: string,
  rawPath: string,
): ResolveResult {
  const entry = store.tokens.get(token);
  if (!entry) return { ok: false, status: 404 };

  const rel = decodeURIComponent(rawPath).replace(/^\/+/, '');
  if (rel === INLINE_ENTRY && entry.inlineHtml != null) {
    return { ok: true, inlineHtml: entry.inlineHtml };
  }
  if (path.isAbsolute(rel)) return { ok: false, status: 403 };

  const candidate = path.resolve(entry.root, rel || 'index.html');
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return { ok: false, status: 404 };
  }
  if (
    realCandidate !== entry.root &&
    !realCandidate.startsWith(entry.root + path.sep)
  ) {
    return { ok: false, status: 403 };
  }
  return { ok: true, filePath: realCandidate };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(p: string): string {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/renderProtocol.test.ts --maxWorkers=2`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add electron/services/renderProtocol.ts tests/unit/electron/renderProtocol.test.ts
git commit -m "feat(render): workspace-bounded sai-render protocol store + guard"
```

---

## Task 2: Resolve entry path & folder→index.html (unit-level)

**Files:**
- Modify: `electron/services/renderProtocol.ts`
- Test: `tests/unit/electron/renderProtocol.test.ts`

Add `prepareRenderTarget` — given `{ cwd, path?, html?, baseDir? }`, decide the root, the entry sub-path, and any inline html, validating the path is inside `cwd`. This is what the IPC handler will call.

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```ts
import { prepareRenderTarget } from '../../../electron/services/renderProtocol';

describe('prepareRenderTarget', () => {
  it('path to a file → root is its dir, entry is the file name', () => {
    const t = prepareRenderTarget({ cwd: root, path: 'index.html' });
    expect(t.ok && t.root).toBe(root);
    expect(t.ok && t.entry).toBe('index.html');
  });

  it('path to a folder → entry is index.html', () => {
    const t = prepareRenderTarget({ cwd: root, path: '.' });
    expect(t.ok && t.entry).toBe('index.html');
  });

  it('inline html + baseDir → root is baseDir, inline served at INLINE_ENTRY', () => {
    const t = prepareRenderTarget({ cwd: root, html: '<p>x</p>', baseDir: 'assets' });
    expect(t.ok && t.root).toBe(path.join(root, 'assets'));
    expect(t.ok && t.inlineHtml).toContain('<p>x</p>');
    expect(t.ok && t.entry).toBe('__sai_inline__');
  });

  it('path wins over html', () => {
    const t = prepareRenderTarget({ cwd: root, path: 'index.html', html: '<p>ignored</p>' });
    expect(t.ok && t.entry).toBe('index.html');
    expect(t.ok && t.inlineHtml).toBeUndefined();
  });

  it('rejects a path outside cwd', () => {
    expect(prepareRenderTarget({ cwd: root, path: '../escape' }).ok).toBe(false);
  });

  it('injects a <base> into inline html so relative assets resolve', () => {
    const t = prepareRenderTarget({ cwd: root, html: '<link href="app.css">', baseDir: 'assets' });
    expect(t.ok && t.inlineHtml).toContain('<base href="sai-render-base/">');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/renderProtocol.test.ts -t prepareRenderTarget --maxWorkers=2`
Expected: FAIL — `prepareRenderTarget` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `renderProtocol.ts`)

```ts
export type PrepareResult =
  | { ok: true; root: string; entry: string; inlineHtml?: string }
  | { ok: false; error: string };

// Relative-asset base for inline mode. The iframe loads
// sai-render://<token>/__sai_inline__, so a relative <base> keeps asset URLs
// pointing back through the protocol (resolved against the token root).
const INLINE_BASE = '<base href="sai-render-base/">';

function within(cwd: string, rel: string): string | null {
  if (path.isAbsolute(rel)) return null;
  const realCwd = fs.realpathSync(cwd);
  const resolved = path.resolve(realCwd, rel);
  if (resolved !== realCwd && !resolved.startsWith(realCwd + path.sep)) return null;
  return resolved;
}

export function prepareRenderTarget(opts: {
  cwd: string;
  path?: string;
  html?: string;
  baseDir?: string;
}): PrepareResult {
  // path wins over html.
  if (opts.path) {
    const abs = within(opts.cwd, opts.path);
    if (!abs) return { ok: false, error: `path escapes workspace: ${opts.path}` };
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return { ok: false, error: `path not found: ${opts.path}` };
    }
    if (stat.isDirectory()) {
      return { ok: true, root: abs, entry: 'index.html' };
    }
    return { ok: true, root: path.dirname(abs), entry: path.basename(abs) };
  }

  if (typeof opts.html === 'string') {
    const baseRel = opts.baseDir ?? '.';
    const abs = within(opts.cwd, baseRel);
    if (!abs) return { ok: false, error: `baseDir escapes workspace: ${opts.baseDir}` };
    const withBase = injectBase(opts.html);
    return { ok: true, root: abs, entry: INLINE_ENTRY, inlineHtml: withBase };
  }

  return { ok: false, error: 'render target requires path or html' };
}

function injectBase(html: string): string {
  if (/<base\b/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${INLINE_BASE}`);
  }
  return `${INLINE_BASE}${html}`;
}
```

Note: the inline `<base href="sai-render-base/">` is rewritten by the handler request flow because the inline doc itself lives at `__sai_inline__`. To keep relative assets resolving against the token root, the handler maps any request whose path starts with `sai-render-base/` to the root (strip that prefix). Add that to `resolveRenderAsset`:

```ts
// near the top of resolveRenderAsset, after computing `rel`:
const stripped = rel.startsWith('sai-render-base/')
  ? rel.slice('sai-render-base/'.length)
  : rel;
// then use `stripped` everywhere below instead of `rel` (except the INLINE_ENTRY check, which uses `rel`).
```

Apply that rename inside `resolveRenderAsset`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/renderProtocol.test.ts --maxWorkers=2`
Expected: PASS (Task 1 + Task 2 cases).

- [ ] **Step 5: Commit**

```bash
git add electron/services/renderProtocol.ts tests/unit/electron/renderProtocol.test.ts
git commit -m "feat(render): prepareRenderTarget resolves path/inline within workspace"
```

---

## Task 3: Register scheme + install protocol handler in main

**Files:**
- Modify: `electron/main.ts`

No new unit test (Electron `protocol` is integration-level; the logic is already covered in Tasks 1–2). Verify via typecheck + app boot.

- [ ] **Step 1: Register the scheme as privileged (before app-ready)**

Find the top-of-file region where `app` is imported and the app is set up. Add near the other top-level setup (must run before `app.whenReady`):

```ts
import { protocol } from 'electron';
import {
  createRenderProtocolStore,
  resolveRenderAsset,
  RENDER_CSP,
  contentTypeFor,
} from './services/renderProtocol';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sai-render',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const renderProtocolStore = createRenderProtocolStore();
```

- [ ] **Step 2: Install the handler after app-ready**

Inside the existing `app.whenReady().then(...)` block (or wherever ipc handlers are registered after ready), add:

```ts
import * as fs from 'node:fs';
// (fs is already imported in main.ts — reuse the existing import)

protocol.handle('sai-render', async (request) => {
  const url = new URL(request.url); // sai-render://<token>/<path>
  const token = url.hostname;
  const rawPath = url.pathname; // leading slash included
  const r = resolveRenderAsset(renderProtocolStore, token, rawPath);
  if (!r.ok) {
    return new Response('blocked', { status: r.status });
  }
  const headers = { 'Content-Security-Policy': RENDER_CSP };
  if (r.inlineHtml != null) {
    return new Response(r.inlineHtml, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/html' },
    });
  }
  const body = fs.readFileSync(r.filePath);
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Type': contentTypeFor(r.filePath) },
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit` (or the project's typecheck script — check `package.json` `scripts`).
Expected: no new errors in `electron/main.ts`.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(render): register and serve sai-render protocol in main"
```

---

## Task 4: `render:mintFileUrl` IPC + path-aware open-in-browser

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add the mint IPC handler in main**

Near the existing `render:openInBrowser` handler (around `electron/main.ts:958`), add:

```ts
import { prepareRenderTarget, mintRenderToken, evictRenderToken } from './services/renderProtocol';
// (merge with the existing import from './services/renderProtocol' added in Task 3)

ipcMain.handle(
  'render:mintFileUrl',
  async (_e, args: { cwd: string; path?: string; html?: string; baseDir?: string }) => {
    if (!args || typeof args.cwd !== 'string' || !args.cwd) {
      return { ok: false, error: 'missing cwd' };
    }
    const target = prepareRenderTarget(args);
    if (!target.ok) return { ok: false, error: target.error };
    const token = mintRenderToken(renderProtocolStore, {
      root: target.root,
      inlineHtml: target.inlineHtml,
    });
    return { ok: true, url: `sai-render://${token}/${target.entry}`, token };
  },
);

ipcMain.handle('render:releaseFileUrl', async (_e, token: string) => {
  if (typeof token === 'string') evictRenderToken(renderProtocolStore, token);
  return true;
});
```

- [ ] **Step 2: Extend `render:openInBrowser` to accept a path**

Replace the existing handler body (`electron/main.ts:958-971`) so it opens a real file URL when given `{ cwd, path }`, else keeps the temp-file behavior for inline html:

```ts
ipcMain.handle('render:openInBrowser', async (_event, arg: string | { cwd: string; path: string }) => {
  try {
    if (arg && typeof arg === 'object' && typeof arg.path === 'string') {
      const target = prepareRenderTarget({ cwd: arg.cwd, path: arg.path });
      if (!target.ok) return false;
      const file = path.join(target.root, target.entry);
      await shell.openExternal(pathToFileURL(file).toString());
      return true;
    }
    const html = arg as string;
    if (typeof html !== 'string' || !html) return false;
    const dir = path.join(app.getPath('temp'), 'sai-renders');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `render-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`);
    fs.writeFileSync(file, html, 'utf8');
    await shell.openExternal(pathToFileURL(file).toString());
    return true;
  } catch (err) {
    console.error('[render] openInBrowser failed:', err);
    return false;
  }
});
```

- [ ] **Step 3: Expose the IPC in preload**

In `electron/preload.ts`, next to `renderOpenInBrowser` (line 262), add:

```ts
  renderMintFileUrl: (args: { cwd: string; path?: string; html?: string; baseDir?: string }):
    Promise<{ ok: true; url: string; token: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('render:mintFileUrl', args),
  renderReleaseFileUrl: (token: string): Promise<boolean> =>
    ipcRenderer.invoke('render:releaseFileUrl', token),
```

And update the `renderOpenInBrowser` signature to accept the new arg shape:

```ts
  renderOpenInBrowser: (arg: string | { cwd: string; path: string }) =>
    ipcRenderer.invoke('render:openInBrowser', arg),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(render): mintFileUrl IPC + path-aware open-in-browser"
```

---

## Task 5: Tool schema — `path`, `baseDir`, `height`

**Files:**
- Modify: `src/lib/saiTools.ts`
- Test: `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/unit/lib/saiTools.test.ts`)

```ts
import { SAI_TOOL_SCHEMA } from '../../../src/lib/saiTools';

it('render_html exposes file-access fields', () => {
  const t = SAI_TOOL_SCHEMA.find((x) => x.name === 'render_html')!;
  const props = t.input_schema.properties as Record<string, unknown>;
  expect(props.path).toBeDefined();
  expect(props.baseDir).toBeDefined();
  expect(props.height).toBeDefined();
  // html is no longer required (path-only renders are valid).
  expect(t.input_schema.required ?? []).not.toContain('html');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts -t "file-access fields" --maxWorkers=2`
Expected: FAIL — `props.path` undefined.

- [ ] **Step 3: Update the schema** in `src/lib/saiTools.ts` (the `render_html` entry)

Update the description and properties, and drop the `required: ['html']` constraint:

```ts
    description:
      'Render HTML live inside the SAI app and return a screenshot. Pass `html` for a ' +
      'self-contained snippet, or `path` to render a real multi-file site from the workspace ' +
      '(its CSS/JS/images resolve). Use `baseDir` to let an inline `html` snippet load workspace ' +
      'assets. USE THIS whenever the user asks to design, mock up, build, show, preview, or iterate ' +
      'on a UI. Re-call to iterate. NOTE: file-backed renders can read workspace files AND reach the ' +
      'network — only render trusted content.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Self-contained snippet; may include <style> and <script>.' },
        path: { type: 'string', description: 'Workspace file or folder to render as a live site (folder → index.html).' },
        baseDir: { type: 'string', description: 'For inline `html`: workspace dir that relative assets resolve against.' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        height: { type: 'number', description: 'Viewport height in px for file-backed renders (default 480).' },
        background: { type: 'string', description: 'Canvas background behind the mock.' },
      },
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS (new test + existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): add path/baseDir/height to render_html schema"
```

---

## Task 6: `entryFromToolCall` builds a file-mode entry

**Files:**
- Modify: `src/components/Chat/RenderToolCallCard.tsx`
- Test: `tests/unit/render/renderToolCallCard.entry.test.ts`

A file-mode html entry carries `payload.mode === 'file'` plus `{ cwd, path?, html?, baseDir?, height? }`. The `RenderToolCallCard` component receives the active `cwd` as a prop (default `''`); `entryFromToolCall` takes `cwd` as a second arg.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/render/renderToolCallCard.entry.test.ts`)

```ts
import { entryFromToolCall } from '../../../src/components/Chat/RenderToolCallCard';

function tc(input: Record<string, unknown>) {
  return { id: 't1', name: 'mcp__swarm__sai_render_html', input: JSON.stringify(input) } as any;
}

it('path → file-mode entry carrying cwd + path', () => {
  const built = entryFromToolCall(tc({ path: 'site/index.html' }), '/work');
  expect(built?.entry.kind).toBe('html');
  expect((built?.entry.payload as any).mode).toBe('file');
  expect((built?.entry.payload as any).cwd).toBe('/work');
  expect((built?.entry.payload as any).path).toBe('site/index.html');
});

it('html + baseDir → file-mode entry', () => {
  const built = entryFromToolCall(tc({ html: '<p>x</p>', baseDir: 'assets' }), '/work');
  expect((built?.entry.payload as any).mode).toBe('file');
  expect((built?.entry.payload as any).baseDir).toBe('assets');
});

it('html alone → inline (no mode field)', () => {
  const built = entryFromToolCall(tc({ html: '<p>x</p>' }), '/work');
  expect((built?.entry.payload as any).mode).toBeUndefined();
  expect((built?.entry.payload as any).html).toBe('<p>x</p>');
});

it('path wins over html', () => {
  const built = entryFromToolCall(tc({ path: 'a.html', html: '<p>x</p>' }), '/work');
  expect((built?.entry.payload as any).mode).toBe('file');
  expect((built?.entry.payload as any).path).toBe('a.html');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts -t "file-mode" --maxWorkers=2`
Expected: FAIL — `entryFromToolCall` ignores `path`/`cwd`.

- [ ] **Step 3: Implement** — change the signature and the default `html` branch in `src/components/Chat/RenderToolCallCard.tsx`.

Change the function signature (line 30):

```ts
export function entryFromToolCall(tc: ToolCall, cwd = ''): { entry: RenderEntry; code: string } | null {
```

Replace the `// default: html` block at the end (lines 138-153) with:

```ts
  // default: html — file-backed when path or baseDir is present, else inline.
  const htmlPath = typeof input.path === 'string' ? input.path : '';
  const html = typeof input.html === 'string' ? input.html : '';
  const baseDir = typeof input.baseDir === 'string' ? input.baseDir : '';
  const height = typeof input.height === 'number' && input.height > 0 ? input.height : undefined;

  if (htmlPath || baseDir) {
    return {
      entry: {
        renderId,
        kind: 'html',
        payload: { mode: 'file', cwd, path: htmlPath || undefined, html: html || undefined, baseDir: baseDir || undefined, height },
        title: title || (htmlPath ? htmlPath : 'Site'),
        width,
        background,
        status: 'ready',
      },
      code: html || `path: ${htmlPath}`,
    };
  }

  if (!html) return null;
  return {
    entry: {
      renderId,
      kind: 'html',
      payload: { html },
      title: title || 'HTML',
      width,
      background,
      status: 'ready',
    },
    code: html,
  };
```

Then update `RenderToolCallCard` (line 185) to accept and pass `cwd`:

```ts
export function RenderToolCallCard({ tc, cwd = '' }: { tc: ToolCall; cwd?: string }) {
  const [showCode, setShowCode] = useState(false);
  const built = entryFromToolCall(tc, cwd);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCallCard.tsx tests/unit/render/renderToolCallCard.entry.test.ts
git commit -m "feat(render): entryFromToolCall builds file-mode entries"
```

---

## Task 7: `RenderedHtml` — src vs srcDoc + async mint

**Files:**
- Modify: `src/components/Chat/RenderToolCard.tsx`

`RenderedHtml` branches on `payload.mode === 'file'`: mint a URL on mount, render `src=` with `sandbox="allow-scripts allow-same-origin"` and a fixed height; release the token on unmount. Inline mode is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/render/renderedHtmlFileMode.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RenderRegion } from '../../../src/components/Chat/RenderToolCard';

beforeEach(() => {
  (window as any).sai = {
    renderMintFileUrl: vi.fn(async () => ({ ok: true, url: 'sai-render://tok/index.html', token: 'tok' })),
    renderReleaseFileUrl: vi.fn(async () => true),
  };
});

it('file-mode render mints a url and uses src + allow-same-origin', async () => {
  const entry = {
    renderId: 'r1', kind: 'html', status: 'ready', width: 360,
    payload: { mode: 'file', cwd: '/work', path: 'index.html' },
  } as any;
  const { container } = render(<RenderRegion entry={entry} />);
  await waitFor(() => {
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe('sai-render://tok/index.html');
    expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
  });
});

it('inline render still uses srcdoc without allow-same-origin', () => {
  const entry = {
    renderId: 'r2', kind: 'html', status: 'ready', width: 360,
    payload: { html: '<b>hi</b>' },
  } as any;
  const { container } = render(<RenderRegion entry={entry} />);
  const iframe = container.querySelector('iframe')!;
  expect(iframe.hasAttribute('srcdoc')).toBe(true);
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/renderedHtmlFileMode.test.tsx --maxWorkers=2`
Expected: FAIL — file-mode renders nothing / no src.

- [ ] **Step 3: Implement** — in `src/components/Chat/RenderToolCard.tsx`, add a file-mode branch to `RenderedHtml`. Replace the top of `RenderedHtml` (lines 101-110) so it detects file mode first:

```tsx
function RenderedHtml({ entry, enableSubmit }: { entry: RenderEntry; enableSubmit?: boolean }) {
  const payload = entry.payload as {
    html?: string; mode?: string; cwd?: string; path?: string; baseDir?: string; height?: number;
  };
  if (payload.mode === 'file') {
    return <FileRenderedHtml entry={entry} payload={payload} />;
  }
  const userHtml = String(payload.html ?? '');
  // ...unchanged inline body below...
```

Then add the new component below `RenderedHtml`:

```tsx
function FileRenderedHtml({
  entry,
  payload,
}: {
  entry: RenderEntry;
  payload: { cwd?: string; path?: string; html?: string; baseDir?: string; height?: number };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const height = payload.height && payload.height > 0 ? payload.height : 480;

  useEffect(() => {
    let token: string | null = null;
    let alive = true;
    const sai = (window as {
      sai?: {
        renderMintFileUrl?: (a: unknown) => Promise<{ ok: boolean; url?: string; token?: string; error?: string }>;
        renderReleaseFileUrl?: (t: string) => void;
      };
    }).sai;
    sai?.renderMintFileUrl?.({
      cwd: payload.cwd, path: payload.path, html: payload.html, baseDir: payload.baseDir,
    }).then((r) => {
      if (!alive) return;
      if (r.ok && r.url) { setUrl(r.url); token = r.token ?? null; }
      else setErr(r.error ?? 'render blocked');
    });
    return () => {
      alive = false;
      if (token) sai?.renderReleaseFileUrl?.(token);
    };
  }, [payload.cwd, payload.path, payload.html, payload.baseDir]);

  if (err) return <div className="sai-render-card__err">{err}</div>;
  if (!url) return <div style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>Loading…</div>;
  return (
    <iframe
      title={entry.title || 'render'}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      src={url}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/render/renderedHtmlFileMode.test.tsx --maxWorkers=2`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx tests/unit/render/renderedHtmlFileMode.test.tsx
git commit -m "feat(render): file-mode iframe loads via sai-render protocol"
```

---

## Task 8: Thread active workspace `cwd` into the card

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Chat/RenderToolCallCard.tsx` (already accepts `cwd` from Task 6)

- [ ] **Step 1: Pass `projectPath` to the card** in `src/App.tsx` (around line 4219):

```tsx
                      return <RenderToolCallCard tc={tc} cwd={projectPath} />;
```

(`projectPath` is already in scope — `src/App.tsx:1858 const projectPath = activeProjectPath;`.)

- [ ] **Step 2: Update the "Open ↗" handler** in `src/components/Chat/RenderToolCallCard.tsx` to open file-mode renders by path.

In `RenderToolCallCard`, replace the `openableHtml`/`openInBrowser` logic (lines 196-201) with:

```tsx
  const payload = entry.payload as { mode?: string; cwd?: string; path?: string; html?: string };
  const isFileMode = payload.mode === 'file';
  const openableHtml = entry.kind === 'html' && !isFileMode ? code : null;
  const openablePath = isFileMode && payload.path ? { cwd: payload.cwd ?? cwd, path: payload.path } : null;

  const openInBrowser = () => {
    const sai = (window as { sai?: { renderOpenInBrowser?: (a: string | { cwd: string; path: string }) => void } }).sai;
    if (openablePath && sai?.renderOpenInBrowser) sai.renderOpenInBrowser(openablePath as { cwd: string; path: string });
    else if (openableHtml && sai?.renderOpenInBrowser) sai.renderOpenInBrowser(openableHtml);
  };
```

And change the button visibility condition (line 218) from `{openableHtml && (` to `{(openableHtml || openablePath) && (`.

- [ ] **Step 3: Run the render unit suite**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Chat/RenderToolCallCard.tsx
git commit -m "feat(render): supply workspace cwd + path-aware open button"
```

---

## Task 9: Test-harness story

**Files:**
- Modify: `src/test-harness/stories/render-tool-call-card.tsx`

- [ ] **Step 1: Add a file-backed story** — append a variant that renders a `path`-mode tool call so it shows in the harness. Match the existing `makeTc` pattern in the file (read lines around 100-125 first to mirror the exact prop shape), e.g.:

```tsx
// A file-backed render (mode:'file'); window.sai.renderMintFileUrl resolves the URL.
<RenderToolCallCard
  tc={{ id: 'file1', name: 'mcp__swarm__sai_render_html', input: JSON.stringify({ path: 'index.html', title: 'Site' }) } as any}
  cwd="/tmp/sai-demo-site"
/>
```

- [ ] **Step 2: Verify the harness builds**

Run: `npx vitest run tests/unit/render --maxWorkers=2`
Expected: PASS (no story-related import breakage).

- [ ] **Step 3: Commit**

```bash
git add src/test-harness/stories/render-tool-call-card.tsx
git commit -m "test(render): file-backed render harness story"
```

---

## Task 10: E2E — multi-file site loads + negative case

**Files:**
- Create: `tests/e2e/fixtures/mini-site/index.html`
- Create: `tests/e2e/fixtures/mini-site/style.css`
- Create: `tests/e2e/fixtures/mini-site/script.js`
- Create: `tests/e2e/fixtures/mini-site/dot.png` (any tiny PNG)
- Modify: `tests/e2e/sai-render.spec.ts`

First read `tests/e2e/sai-render.spec.ts` to match its harness-driving pattern (how it injects a render tool call and queries the iframe). Mirror that exact pattern; the snippets below are the assertions to add.

- [ ] **Step 1: Create the fixture site**

```html
<!-- tests/e2e/fixtures/mini-site/index.html -->
<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">plain</h1><img id="img" src="dot.png" alt="dot">
<script src="script.js"></script></body></html>
```

```css
/* tests/e2e/fixtures/mini-site/style.css */
#t { color: rgb(0, 128, 0); }
```

```js
// tests/e2e/fixtures/mini-site/script.js
document.getElementById('t').textContent = 'scripted';
```

(`dot.png`: create any 1×1 PNG, e.g. `printf '\x89PNG...'` or copy an existing tiny fixture image in the repo.)

- [ ] **Step 2: Write the failing e2e test** — add to `tests/e2e/sai-render.spec.ts`, following the file's existing render-driving helper:

```ts
test('file-backed render loads css, js, and image from the workspace', async ({ page }) => {
  // Drive a render_html tool call with { path: 'index.html' } and cwd pointing at
  // tests/e2e/fixtures/mini-site (use the spec's existing inject helper + set the
  // active workspace to the fixture dir).
  const frame = page.frameLocator('[data-testid="render-region"] iframe');
  await expect(frame.locator('#t')).toHaveText('scripted');           // js ran
  await expect(frame.locator('#t')).toHaveCSS('color', 'rgb(0, 128, 0)'); // css applied
  await expect(frame.locator('#img')).toBeVisible();                  // image loaded
});

test('a render cannot read files outside the workspace', async ({ page }) => {
  // Render inline html (baseDir set) whose script fetches '../../etc/hosts' or similar
  // and writes the result into the DOM; assert the fetch is blocked (text stays empty
  // / shows an error), proving the containment guard rejects the escape.
  const frame = page.frameLocator('[data-testid="render-region"] iframe');
  await expect(frame.locator('#leak')).toHaveText('');
});
```

- [ ] **Step 3: Run e2e**

Run: `npx playwright test tests/e2e/sai-render.spec.ts`
Expected: initially FAIL until the inject helper is wired to set `cwd`/fixture; then PASS once the fixture path is supplied to the render call.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/fixtures/mini-site tests/e2e/sai-render.spec.ts
git commit -m "test(render): e2e multi-file site load + containment negative case"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc -p tsconfig.json --noEmit` and the project's lint script (check `package.json`).
Expected: clean.

- [ ] **Step 3: Manual smoke (Electron)**

Build/run the app, ask the assistant to `render_html` with `path` pointing at a multi-file site in the open workspace. Confirm CSS/JS/images load and `Open ↗` opens the real file. Confirm an inline `render_html({ html })` with no `path`/`baseDir` still renders exactly as before.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(render): file-access verification cleanup"
```

---

## Self-Review Notes

- **Spec coverage:** custom protocol (T1,T3), workspace containment + realpath/symlink guard (T1), token lifecycle TTL/cap/evict (T1,T4,T7), both path & inline+baseDir modes (T2,T6), `path` wins (T2,T6), CSP response header + network allow (T1,T3), sandbox `allow-same-origin` on non-app origin (T7), schema fields + boundary doc (T5), viewport/height default 480 (T6,T7), path-aware Open ↗ (T4,T8), backward-compatible inline srcDoc (T6,T7), tests unit+e2e+story (T1-T2,T6-T10). All spec sections map to a task.
- **Type consistency:** `mintRenderToken`/`evictRenderToken`/`resolveRenderAsset`/`prepareRenderTarget`/`RenderProtocolStore`/`INLINE_ENTRY`/`RENDER_CSP`/`contentTypeFor` names are used identically across main, preload, and tests. `renderMintFileUrl`/`renderReleaseFileUrl`/`renderOpenInBrowser` IPC names match between preload and `window.sai` callers. `payload.mode === 'file'` shape is identical in T6 (producer) and T7 (consumer).
- **Note for executor:** the e2e inject helper (T10) and harness story (T9) must mirror existing patterns in their files — read those files first; the plan supplies assertions, not the harness plumbing, because that plumbing is project-specific.
