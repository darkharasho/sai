# `capture_window` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `capture_window` SAI tool that screenshots the external app under development (a window or display) instead of SAI itself, cross-platform.

**Architecture:** A new main-process module `electron/capture/` enumerates OS windows and captures pixels through a layered backend chain (Electron `desktopCapturer` primary; `spectacle`/`grim`/`screencapture` fallbacks chosen per platform and triggered by a blank-frame detector). Pure logic (backend selection, window inference, blank detection) lives in side-effect-free modules with unit tests. A new IPC handler exposes it; `App.tsx` routes the bare tool name to it and returns the same `{ ok, __mcpImage }` image contract as `capture_app`, so `swarm-mcp-server.ts` needs no change.

**Tech Stack:** TypeScript, Electron (main process `desktopCapturer`, `BrowserWindow.getMediaSourceId`), React, Vitest (run with `--maxWorkers=2`), Node `child_process` for fallback CLIs.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-capture-window-design.md`.
- Bare tool name `capture_window`; MCP-exposed name `sai_capture_window`; main forwards the **bare** name to the renderer (matches `capture_app` / `render_html`).
- Result image contract is identical to `capture_app`: `{ ok: true, __mcpImage: { base64: '<bare base64 png, no data: prefix>', mimeType: 'image/png' } }`. Ambiguous/empty: `{ ok: false, candidates?: string[], message: string }`.
- **SAI's own window is ALWAYS excluded** from candidates — identified by `mainWindow.getMediaSourceId()`.
- Run vitest with `--maxWorkers=2` (machine memory constraint).
- New pure modules follow the existing `electron/capturePage.ts` + `tests/unit/electron/capturePage.test.ts` pattern.
- TDD: failing test first, minimal impl, frequent commits.

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `electron/capture/blankFrame.ts` | Detect all-black / all-transparent RGBA buffers. Pure. | New |
| `electron/capture/selectBackend.ts` | Ordered backend-name chain from platform/session/desktop/PATH. Pure. | New |
| `electron/capture/inferWindow.ts` | Pick a window from candidates given project + `target`; exclude SAI; emit candidate list. Pure. | New |
| `electron/capture/cliArgs.ts` | Build argv for spectacle/grim/screencapture. Pure. | New |
| `electron/capture/backends.ts` | Side-effecting capture: desktopCapturer sources + spawn CLIs. | New |
| `electron/capture/captureWindow.ts` | Orchestrator: enumerate → exclude SAI → infer → backend chain → blank-detect → result. | New |
| `electron/main.ts` | `sai:capture-window` IPC handler. | Modify |
| `electron/preload.ts` | `captureWindow(opts)` bridge. | Modify |
| `src/vite-env.d.ts` | `window.sai.captureWindow` type. | Modify |
| `src/lib/saiTools.ts` | `capture_window` schema entry. | Modify |
| `src/App.tsx` | Route `capture_window` in `onSwarmToolRequest`. | Modify |
| `tests/unit/electron/capture/*.test.ts` | Unit tests for pure modules. | New |
| `tests/unit/lib/saiTools.test.ts` | Assert `capture_window` registered. | Modify |

---

## Task 1: Blank-frame detector

**Files:**
- Create: `electron/capture/blankFrame.ts`
- Test: `tests/unit/electron/capture/blankFrame.test.ts`

**Interfaces:**
- Produces: `isBlankFrame(rgba: Uint8Array | Buffer, opts?: { sampleStride?: number; threshold?: number }): boolean` — true when ~all sampled pixels are black (r=g=b=0) or fully transparent (a=0). `threshold` is the max fraction of non-blank pixels still considered blank (default `0.01`). `sampleStride` skips pixels for speed (default `997`, a prime, in pixel units).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/capture/blankFrame.test.ts
import { describe, it, expect } from 'vitest';
import { isBlankFrame } from '../../../../electron/capture/blankFrame';

function rgba(pixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => { out.set([r, g, b, a], i * 4); });
  return out;
}

describe('isBlankFrame', () => {
  it('flags an all-black opaque buffer as blank', () => {
    const buf = rgba(Array.from({ length: 2000 }, () => [0, 0, 0, 255] as [number, number, number, number]));
    expect(isBlankFrame(buf, { sampleStride: 1 })).toBe(true);
  });

  it('flags a fully transparent buffer as blank', () => {
    const buf = rgba(Array.from({ length: 2000 }, () => [10, 20, 30, 0] as [number, number, number, number]));
    expect(isBlankFrame(buf, { sampleStride: 1 })).toBe(true);
  });

  it('does NOT flag a buffer with real content', () => {
    const px = Array.from({ length: 2000 }, () => [0, 0, 0, 255] as [number, number, number, number]);
    for (let i = 0; i < 1000; i++) px[i] = [120, 130, 140, 255];
    expect(isBlankFrame(rgba(px), { sampleStride: 1 })).toBe(false);
  });

  it('treats an empty buffer as blank', () => {
    expect(isBlankFrame(new Uint8Array(0))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/capture/blankFrame.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `blankFrame`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/capture/blankFrame.ts
export function isBlankFrame(
  rgba: Uint8Array | Buffer,
  opts: { sampleStride?: number; threshold?: number } = {},
): boolean {
  const stride = Math.max(1, opts.sampleStride ?? 997);
  const threshold = opts.threshold ?? 0.01;
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return true;
  let sampled = 0;
  let nonBlank = 0;
  for (let p = 0; p < pixelCount; p += stride) {
    const i = p * 4;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    sampled++;
    const transparent = a === 0;
    const black = r === 0 && g === 0 && b === 0;
    if (!transparent && !black) nonBlank++;
  }
  if (sampled === 0) return true;
  return nonBlank / sampled <= threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/capture/blankFrame.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capture/blankFrame.ts tests/unit/electron/capture/blankFrame.test.ts
git commit -m "feat(capture): add blank-frame detector"
```

---

## Task 2: Backend selection

**Files:**
- Create: `electron/capture/selectBackend.ts`
- Test: `tests/unit/electron/capture/selectBackend.test.ts`

**Interfaces:**
- Produces: `type BackendName = 'desktopCapturer' | 'spectacle' | 'grim' | 'screencapture'`
- Produces: `selectBackendChain(env: CaptureEnv): BackendName[]` where
  `interface CaptureEnv { platform: NodeJS.Platform; sessionType?: string; desktop?: string; has: (bin: string) => boolean; }`
  Order: first entry is primary, rest are fallbacks tried on throw/blank.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/capture/selectBackend.test.ts
import { describe, it, expect } from 'vitest';
import { selectBackendChain, type CaptureEnv } from '../../../../electron/capture/selectBackend';

const env = (o: Partial<CaptureEnv>): CaptureEnv => ({
  platform: 'linux', sessionType: undefined, desktop: undefined, has: () => true, ...o,
});

describe('selectBackendChain', () => {
  it('windows: desktopCapturer only', () => {
    expect(selectBackendChain(env({ platform: 'win32' }))).toEqual(['desktopCapturer']);
  });

  it('macOS: desktopCapturer then screencapture', () => {
    expect(selectBackendChain(env({ platform: 'darwin' }))).toEqual(['desktopCapturer', 'screencapture']);
  });

  it('linux X11: desktopCapturer only', () => {
    expect(selectBackendChain(env({ platform: 'linux', sessionType: 'x11' }))).toEqual(['desktopCapturer']);
  });

  it('linux Wayland + KDE: desktopCapturer then spectacle', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'KDE' }))).toEqual(['desktopCapturer', 'spectacle']);
  });

  it('linux Wayland + wlroots: desktopCapturer then grim', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'sway' }))).toEqual(['desktopCapturer', 'grim']);
  });

  it('omits fallbacks whose binary is missing', () => {
    expect(selectBackendChain(env({ sessionType: 'wayland', desktop: 'KDE', has: () => false })))
      .toEqual(['desktopCapturer']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/capture/selectBackend.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `selectBackend`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/capture/selectBackend.ts
export type BackendName = 'desktopCapturer' | 'spectacle' | 'grim' | 'screencapture';

export interface CaptureEnv {
  platform: NodeJS.Platform;
  sessionType?: string;
  desktop?: string;
  has: (bin: string) => boolean;
}

export function selectBackendChain(env: CaptureEnv): BackendName[] {
  const chain: BackendName[] = ['desktopCapturer'];
  if (env.platform === 'darwin') {
    if (env.has('screencapture')) chain.push('screencapture');
    return chain;
  }
  if (env.platform === 'linux' && (env.sessionType ?? '').toLowerCase() === 'wayland') {
    const isKde = (env.desktop ?? '').toLowerCase().includes('kde');
    if (isKde && env.has('spectacle')) chain.push('spectacle');
    else if (!isKde && env.has('grim')) chain.push('grim');
  }
  return chain;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/capture/selectBackend.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capture/selectBackend.ts tests/unit/electron/capture/selectBackend.test.ts
git commit -m "feat(capture): add per-platform backend selection"
```

---

## Task 3: Window inference + SAI exclusion

**Files:**
- Create: `electron/capture/inferWindow.ts`
- Test: `tests/unit/electron/capture/inferWindow.test.ts`

**Interfaces:**
- Produces: `interface WindowCandidate { id: string; title: string }`
- Produces: `interface InferContext { target?: string; projectNames: string[]; selfSourceId?: string }`
- Produces: `type InferResult = { kind: 'pick'; window: WindowCandidate } | { kind: 'candidates'; titles: string[] } | { kind: 'none' }`
- Produces: `inferWindow(windows: WindowCandidate[], ctx: InferContext): InferResult`
  - Always drops any window whose `id === ctx.selfSourceId`.
  - Order: (1) `target` substring (case-insensitive) → single best = first match; if >1 match return `candidates`. (2) `projectNames` substring → if exactly one match pick it, if >1 return candidates. (3) if exactly one non-SAI window remains, pick it. (4) if >1 remain, return candidates. (5) if none remain, `none`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/capture/inferWindow.test.ts
import { describe, it, expect } from 'vitest';
import { inferWindow, type WindowCandidate } from '../../../../electron/capture/inferWindow';

const w = (id: string, title: string): WindowCandidate => ({ id, title });

describe('inferWindow', () => {
  it('always excludes the SAI window', () => {
    const r = inferWindow([w('sai', 'SAI'), w('a', 'MyApp')], { projectNames: ['MyApp'], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'pick', window: w('a', 'MyApp') });
  });

  it('matches the explicit target substring case-insensitively', () => {
    const r = inferWindow([w('a', 'Firefox'), w('b', 'MyApp (dev)')], { target: 'myapp', projectNames: [] });
    expect(r).toEqual({ kind: 'pick', window: w('b', 'MyApp (dev)') });
  });

  it('matches the project name when no target given', () => {
    const r = inferWindow([w('a', 'Steam'), w('b', 'Acme — dev')], { projectNames: ['Acme'] });
    expect(r).toEqual({ kind: 'pick', window: w('b', 'Acme — dev') });
  });

  it('returns candidate titles when ambiguous', () => {
    const r = inferWindow([w('a', 'App one'), w('b', 'App two')], { target: 'app', projectNames: [] });
    expect(r).toEqual({ kind: 'candidates', titles: ['App one', 'App two'] });
  });

  it('picks the only remaining non-SAI window when nothing else matches', () => {
    const r = inferWindow([w('sai', 'SAI'), w('a', 'Editor')], { projectNames: ['nomatch'], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'pick', window: w('a', 'Editor') });
  });

  it('returns none when only SAI is present', () => {
    const r = inferWindow([w('sai', 'SAI')], { projectNames: [], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/capture/inferWindow.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `inferWindow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/capture/inferWindow.ts
export interface WindowCandidate { id: string; title: string; }
export interface InferContext { target?: string; projectNames: string[]; selfSourceId?: string; }
export type InferResult =
  | { kind: 'pick'; window: WindowCandidate }
  | { kind: 'candidates'; titles: string[] }
  | { kind: 'none' };

function matchAll(windows: WindowCandidate[], needle: string): WindowCandidate[] {
  const n = needle.toLowerCase();
  return windows.filter((w) => w.title.toLowerCase().includes(n));
}

export function inferWindow(windows: WindowCandidate[], ctx: InferContext): InferResult {
  const pool = windows.filter((w) => w.id !== ctx.selfSourceId);
  if (pool.length === 0) return { kind: 'none' };

  if (ctx.target && ctx.target.trim()) {
    const hits = matchAll(pool, ctx.target.trim());
    if (hits.length === 1) return { kind: 'pick', window: hits[0] };
    if (hits.length > 1) return { kind: 'candidates', titles: hits.map((h) => h.title) };
  }

  for (const name of ctx.projectNames) {
    if (!name || !name.trim()) continue;
    const hits = matchAll(pool, name.trim());
    if (hits.length === 1) return { kind: 'pick', window: hits[0] };
    if (hits.length > 1) return { kind: 'candidates', titles: hits.map((h) => h.title) };
  }

  if (pool.length === 1) return { kind: 'pick', window: pool[0] };
  return { kind: 'candidates', titles: pool.map((p) => p.title) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/capture/inferWindow.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capture/inferWindow.ts tests/unit/electron/capture/inferWindow.test.ts
git commit -m "feat(capture): add project-aware window inference with SAI exclusion"
```

---

## Task 4: Fallback-CLI arg builders

**Files:**
- Create: `electron/capture/cliArgs.ts`
- Test: `tests/unit/electron/capture/cliArgs.test.ts`

**Interfaces:**
- Produces: `spectacleArgs(outPath: string): string[]` → `['-b', '-n', '-a', '-o', outPath]`
- Produces: `grimArgs(outPath: string): string[]` → `[outPath]`
- Produces: `screencaptureArgs(outPath: string): string[]` → `['-x', '-o', outPath]` (`-x` no sound, `-o` no shadow)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/capture/cliArgs.test.ts
import { describe, it, expect } from 'vitest';
import { spectacleArgs, grimArgs, screencaptureArgs } from '../../../../electron/capture/cliArgs';

describe('cliArgs', () => {
  it('spectacle: background, no-notify, active window, output path', () => {
    expect(spectacleArgs('/tmp/x.png')).toEqual(['-b', '-n', '-a', '-o', '/tmp/x.png']);
  });
  it('grim: just the output path', () => {
    expect(grimArgs('/tmp/x.png')).toEqual(['/tmp/x.png']);
  });
  it('screencapture: silent, no shadow, output path', () => {
    expect(screencaptureArgs('/tmp/x.png')).toEqual(['-x', '-o', '/tmp/x.png']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/capture/cliArgs.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `cliArgs`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/capture/cliArgs.ts
export function spectacleArgs(outPath: string): string[] {
  return ['-b', '-n', '-a', '-o', outPath];
}
export function grimArgs(outPath: string): string[] {
  return [outPath];
}
export function screencaptureArgs(outPath: string): string[] {
  return ['-x', '-o', outPath];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/capture/cliArgs.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capture/cliArgs.ts tests/unit/electron/capture/cliArgs.test.ts
git commit -m "feat(capture): add fallback CLI arg builders"
```

---

## Task 5: Side-effecting backends

**Files:**
- Create: `electron/capture/backends.ts`

**Interfaces:**
- Consumes: `spectacleArgs`/`grimArgs`/`screencaptureArgs` (Task 4); `BackendName` (Task 2).
- Produces:
  - `listDesktopWindows(): Promise<Array<{ id: string; title: string }>>` — wraps `desktopCapturer.getSources({ types: ['window'] })`, mapping `source.id` → `id`, `source.name` → `title`.
  - `captureDesktopSource(id: string): Promise<{ base64: string; rgba: Buffer; empty: boolean }>` — re-fetch sources at full thumbnail size for `id`, return PNG base64 + raw RGBA bitmap for blank detection. `empty` true if the source vanished.
  - `captureViaCli(backend: 'spectacle' | 'grim' | 'screencapture'): Promise<{ base64: string; rgba: Buffer }>` — spawn the CLI to a temp PNG, read it back, return base64 + decoded RGBA.

This task has no pure logic to unit-test (all side effects); it is exercised by the integration smoke in Task 10. Keep it thin — delegate decisions to the pure modules.

- [ ] **Step 1: Write the implementation**

```ts
// electron/capture/backends.ts
import { desktopCapturer, nativeImage, screen } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spectacleArgs, grimArgs, screencaptureArgs } from './cliArgs';

export async function listDesktopWindows(): Promise<Array<{ id: string; title: string }>> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  return sources.map((s) => ({ id: s.id, title: s.name }));
}

export async function captureDesktopSource(
  id: string,
): Promise<{ base64: string; rgba: Buffer; empty: boolean }> {
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: width * 2, height: height * 2 },
  });
  const match = sources.find((s) => s.id === id);
  if (!match) return { base64: '', rgba: Buffer.alloc(0), empty: true };
  const img = match.thumbnail;
  const rgba = img.toBitmap(); // BGRA/RGBA byte order per platform; treated channel-agnostically by blank detector
  const base64 = img.toPNG().toString('base64');
  return { base64, rgba, empty: img.isEmpty() };
}

async function spawnToFile(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${stderr.trim()}`))));
  });
}

export async function captureViaCli(
  backend: 'spectacle' | 'grim' | 'screencapture',
): Promise<{ base64: string; rgba: Buffer }> {
  const out = join(tmpdir(), `sai-capture-${backend}-${process.pid}.png`);
  const argv = backend === 'spectacle' ? spectacleArgs(out)
    : backend === 'grim' ? grimArgs(out)
    : screencaptureArgs(out);
  const bin = backend;
  try {
    await spawnToFile(bin, argv);
    const png = await fs.readFile(out);
    const img = nativeImage.createFromBuffer(png);
    return { base64: png.toString('base64'), rgba: img.toBitmap() };
  } finally {
    await fs.rm(out, { force: true }).catch(() => {});
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` (or the project's electron tsconfig if separate)
Expected: no errors in `electron/capture/backends.ts`.

- [ ] **Step 3: Commit**

```bash
git add electron/capture/backends.ts
git commit -m "feat(capture): add desktopCapturer + CLI capture backends"
```

---

## Task 6: Orchestrator

**Files:**
- Create: `electron/capture/captureWindow.ts`
- Test: `tests/unit/electron/capture/captureWindow.test.ts`

**Interfaces:**
- Consumes: `selectBackendChain` (T2), `inferWindow` (T3), `isBlankFrame` (T1).
- Produces:
  - `interface CaptureWindowDeps {`
    `  listWindows: () => Promise<Array<{ id: string; title: string }>>;`
    `  captureSource: (id: string) => Promise<{ base64: string; rgba: Buffer; empty: boolean }>;`
    `  captureCli: (b: 'spectacle' | 'grim' | 'screencapture') => Promise<{ base64: string; rgba: Buffer }>;`
    `  chain: import('./selectBackend').BackendName[];`
    `  projectNames: string[];`
    `  selfSourceId?: string;`
    `}`
  - `type CaptureWindowResult = { ok: true; __mcpImage: { base64: string; mimeType: 'image/png' }; window?: string } | { ok: false; candidates?: string[]; message: string }`
  - `captureWindowFlow(opts: { target?: string }, deps: CaptureWindowDeps): Promise<CaptureWindowResult>`

  Flow: enumerate → `inferWindow` → on `candidates` return them, on `none` return `{ ok:false, message:'no external app window found' }`. On `pick`: walk `chain`; for `desktopCapturer` call `captureSource(pick.id)` and accept if not blank; for CLI backends call `captureCli` and accept if not blank. First non-blank wins. If all blank → `{ ok:false, message }`. Dependency-injected so it is fully unit-testable without Electron.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/electron/capture/captureWindow.test.ts
import { describe, it, expect } from 'vitest';
import { captureWindowFlow, type CaptureWindowDeps } from '../../../../electron/capture/captureWindow';

const BLANK = Buffer.alloc(4000); // all zero → blank
const CONTENT = (() => { const b = Buffer.alloc(4000); b.fill(200); return b; })();

const baseDeps = (over: Partial<CaptureWindowDeps>): CaptureWindowDeps => ({
  listWindows: async () => [{ id: 'a', title: 'MyApp' }],
  captureSource: async () => ({ base64: 'AAA', rgba: CONTENT, empty: false }),
  captureCli: async () => ({ base64: 'CLI', rgba: CONTENT }),
  chain: ['desktopCapturer'],
  projectNames: ['MyApp'],
  selfSourceId: 'sai',
  ...over,
});

describe('captureWindowFlow', () => {
  it('returns the desktopCapturer image when not blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({}));
    expect(r).toEqual({ ok: true, __mcpImage: { base64: 'AAA', mimeType: 'image/png' }, window: 'MyApp' });
  });

  it('falls back to the CLI backend when desktopCapturer is blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'BLANK', rgba: BLANK, empty: false }),
    }));
    expect(r).toEqual({ ok: true, __mcpImage: { base64: 'CLI', mimeType: 'image/png' }, window: 'MyApp' });
  });

  it('returns candidates when inference is ambiguous', async () => {
    const r = await captureWindowFlow({ target: 'app' }, baseDeps({
      listWindows: async () => [{ id: 'a', title: 'App one' }, { id: 'b', title: 'App two' }],
    }));
    expect(r).toEqual({ ok: false, candidates: ['App one', 'App two'], message: expect.stringContaining('target') });
  });

  it('returns a no-window message when only SAI is present', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      listWindows: async () => [{ id: 'sai', title: 'SAI' }],
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('no external app window') });
  });

  it('reports an empty-frame failure when every backend is blank', async () => {
    const r = await captureWindowFlow({}, baseDeps({
      chain: ['desktopCapturer', 'spectacle'],
      captureSource: async () => ({ base64: 'X', rgba: BLANK, empty: false }),
      captureCli: async () => ({ base64: 'Y', rgba: BLANK }),
    }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('empty frame') });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/capture/captureWindow.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `captureWindow`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/capture/captureWindow.ts
import type { BackendName } from './selectBackend';
import { inferWindow } from './inferWindow';
import { isBlankFrame } from './blankFrame';

export interface CaptureWindowDeps {
  listWindows: () => Promise<Array<{ id: string; title: string }>>;
  captureSource: (id: string) => Promise<{ base64: string; rgba: Buffer; empty: boolean }>;
  captureCli: (b: 'spectacle' | 'grim' | 'screencapture') => Promise<{ base64: string; rgba: Buffer }>;
  chain: BackendName[];
  projectNames: string[];
  selfSourceId?: string;
}

export type CaptureWindowResult =
  | { ok: true; __mcpImage: { base64: string; mimeType: 'image/png' }; window?: string }
  | { ok: false; candidates?: string[]; message: string };

export async function captureWindowFlow(
  opts: { target?: string },
  deps: CaptureWindowDeps,
): Promise<CaptureWindowResult> {
  const windows = await deps.listWindows();
  const inferred = inferWindow(windows, {
    target: opts.target,
    projectNames: deps.projectNames,
    selfSourceId: deps.selfSourceId,
  });

  if (inferred.kind === 'none') return { ok: false, message: 'no external app window found' };
  if (inferred.kind === 'candidates') {
    return { ok: false, candidates: inferred.titles, message: 'Multiple windows matched; pass `target` to disambiguate.' };
  }

  const pick = inferred.window;
  for (const backend of deps.chain) {
    try {
      if (backend === 'desktopCapturer') {
        const shot = await deps.captureSource(pick.id);
        if (!shot.empty && !isBlankFrame(shot.rgba)) {
          return { ok: true, __mcpImage: { base64: shot.base64, mimeType: 'image/png' }, window: pick.title };
        }
      } else {
        const shot = await deps.captureCli(backend);
        if (!isBlankFrame(shot.rgba)) {
          return { ok: true, __mcpImage: { base64: shot.base64, mimeType: 'image/png' }, window: pick.title };
        }
      }
    } catch {
      // advance to next backend
    }
  }
  return { ok: false, message: 'capture returned an empty frame (screen-recording permission or Wayland portal?)' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/capture/captureWindow.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capture/captureWindow.ts tests/unit/electron/capture/captureWindow.test.ts
git commit -m "feat(capture): add capture orchestrator with backend fallback"
```

---

## Task 7: IPC handler in main process

**Files:**
- Modify: `electron/main.ts` (add handler near the existing `sai:capture-region` at line ~844; add imports at top)

**Interfaces:**
- Consumes: orchestrator (T6), backends (T5), `selectBackendChain` (T2).
- Produces: IPC channel `sai:capture-window` accepting `{ target?: string; workspace?: string }`, returning `CaptureWindowResult`.

- [ ] **Step 1: Add imports** (top of `electron/main.ts`, beside the existing `./capturePage` import)

```ts
import { existsSync, readFileSync } from 'node:fs';
import { basename, join as pathJoin } from 'node:path';
import { selectBackendChain } from './capture/selectBackend';
import { captureWindowFlow } from './capture/captureWindow';
import { listDesktopWindows, captureDesktopSource, captureViaCli } from './capture/backends';
```

(If any of these Node imports already exist in the file, reuse them rather than duplicating.)

- [ ] **Step 2: Add a project-name helper** (above `createWindow`, module scope)

```ts
function projectNamesFor(workspace?: string): string[] {
  const names: string[] = [];
  if (!workspace) return names;
  try {
    const pkgPath = pathJoin(workspace, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.productName === 'string') names.push(pkg.productName);
      if (typeof pkg.name === 'string') names.push(pkg.name);
    }
  } catch { /* ignore malformed package.json */ }
  names.push(basename(workspace));
  return names.filter(Boolean);
}
```

- [ ] **Step 3: Register the handler** (immediately after the `sai:capture-region` handler block, ~line 851)

```ts
  ipcMain.handle('sai:capture-window', async (_evt, opts: { target?: string; workspace?: string } = {}) => {
    const selfSourceId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : undefined;
    const chain = selectBackendChain({
      platform: process.platform,
      sessionType: process.env.XDG_SESSION_TYPE,
      desktop: process.env.XDG_CURRENT_DESKTOP,
      has: (bin) => {
        try { require('node:child_process').execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; }
        catch { return false; }
      },
    });
    return captureWindowFlow(
      { target: opts.target },
      {
        listWindows: listDesktopWindows,
        captureSource: captureDesktopSource,
        captureCli: captureViaCli,
        chain,
        projectNames: projectNamesFor(opts.workspace),
        selfSourceId,
      },
    );
  });
```

- [ ] **Step 4: Build the electron main bundle to verify it compiles**

Run: `npm run build` (or the project's electron-only build script if one exists — check `package.json` scripts)
Expected: build succeeds, no TypeScript errors referencing `capture/`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(capture): wire sai:capture-window IPC handler"
```

---

## Task 8: Preload bridge + window.sai type

**Files:**
- Modify: `electron/preload.ts:178-179` (add after `captureRegion`)
- Modify: `src/vite-env.d.ts:20` (add after `captureRegion` type)

**Interfaces:**
- Produces: `window.sai.captureWindow(opts: { target?: string; workspace?: string }): Promise<CaptureWindowResult>` (typed as the result union; in the `.d.ts` it can be `Promise<{ ok: boolean; [k: string]: unknown }>` to avoid importing electron types into the renderer).

- [ ] **Step 1: Add the preload bridge** (in `electron/preload.ts`, right after the `captureRegion` property)

```ts
  captureWindow: (opts: { target?: string; workspace?: string }): Promise<{ ok: boolean; [k: string]: unknown }> =>
    ipcRenderer.invoke('sai:capture-window', opts),
```

- [ ] **Step 2: Add the type** (in `src/vite-env.d.ts`, right after the `captureRegion` line)

```ts
      captureWindow: (opts: { target?: string; workspace?: string }) => Promise<{ ok: boolean; [k: string]: unknown }>;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/vite-env.d.ts
git commit -m "feat(capture): expose captureWindow on the preload bridge"
```

---

## Task 9: Tool schema registration

**Files:**
- Modify: `src/lib/saiTools.ts` (add entry after the `capture_app` block, ~line 265)
- Test: `tests/unit/lib/saiTools.test.ts` (extend the existing registration test, ~line 70)

**Interfaces:**
- Produces: `SAI_TOOL_SCHEMA` entry `capture_window`; `SAI_TOOL_NAMES.has('capture_window') === true`.

- [ ] **Step 1: Write the failing test** (extend the existing `it('registers inspect_element and capture_app ...')` or add a new `it`)

```ts
  it('registers capture_window as a chat tool with target/display props', () => {
    expect(SAI_TOOL_NAMES.has('capture_window')).toBe(true);
    const t = SAI_TOOL_SCHEMA.find((x) => x.name === 'capture_window')!;
    expect(t.toolset).toBe('chat');
    expect(t.input_schema.properties.target).toBeDefined();
    expect(t.input_schema.properties.display).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL — `capture_window` not in `SAI_TOOL_NAMES`.

- [ ] **Step 3: Add the schema entry** (after the `capture_app` object's closing `},` at ~line 265)

```ts
  {
    name: 'capture_window',
    description:
      'Screenshot the EXTERNAL app you are developing (a window or a whole display) and return the image. ' +
      'Never captures SAI itself. Omit args to auto-detect the project window; pass `target` to disambiguate ' +
      'by window title/app name. Use this to SEE the app under development — not a mock. Read-only.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Optional window title / app-name substring to match (case-insensitive).' },
        display: { type: 'boolean', description: 'Capture the whole monitor instead of a single window.' },
      },
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(capture): register capture_window tool schema"
```

---

## Task 10: Route the tool in App.tsx + manual verification

**Files:**
- Modify: `src/App.tsx:1438-1454` (add a `capture_window` branch in `onSwarmToolRequest`)

**Interfaces:**
- Consumes: `window.sai.captureWindow` (T8). The branch passes `req.input` + `req.workspace` and responds with the orchestrator result (already in `{ ok, __mcpImage? }` shape, so `respondSwarmTool` forwards it through the existing image path).

- [ ] **Step 1: Add the routing branch** (inside the `onSwarmToolRequest` callback, after the `inspect_element || capture_app` block, before the `watch_github_run` block)

```ts
      if (req.tool === 'capture_window') {
        const saiAny = sai as { captureWindow?: (o: { target?: string; workspace?: string }) => Promise<{ ok: boolean; [k: string]: unknown }> };
        if (typeof saiAny.captureWindow !== 'function') {
          sai.respondSwarmToolError(req.id, 'capture_window is unavailable in this build');
          return;
        }
        void saiAny.captureWindow({ target: req.input?.target, workspace: req.workspace }).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

- [ ] **Step 2: Run the full unit suite + type-check**

Run: `npx vitest run --maxWorkers=2 && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 3: Check whether a chat-history card is needed**

Read `src/components/Chat/RenderToolCallCard.tsx:30` (`entryFromToolCall`). Determine whether image-returning tools like `capture_app` already render via the generic `__mcpImage` path or need an explicit case. `capture_window` returns the **same** `{ ok, __mcpImage }` shape as `capture_app`, so if `capture_app` needs no card branch, neither does `capture_window`. If `capture_app` *does* have a branch, add a parallel `capture_window` branch. Note the finding in the commit message.

- [ ] **Step 4: Manual verification on this KDE Wayland box**

Rebuild and launch SAI (`npm run build && npm run start`, or the project's dev launch). With a second app open (e.g. a text editor or browser), drive the swarm/e2e harness — or use the running session — to call `sai_capture_window`. Confirm:
  - The returned image is the **other app**, not SAI.
  - With SAI as the only window, the tool returns `{ ok:false, message:'no external app window found' }` rather than a picture of SAI.
  - `target: '<part of the app title>'` selects that window.

Record the result (screenshot or the tool's JSON) in the commit body. Per `project_sai_tools_need_restart`, a running SAI session won't see the new tool until restarted — restart before verifying.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(capture): route capture_window tool to external-window capture

Verified on KDE Wayland: capturing a second app returns that app's window,
not SAI; SAI-only returns a no-window message; target= selects by title."
```

---

## Self-Review

- **Spec coverage:** schema (T9), SAI exclusion via `getMediaSourceId` (T3+T7), layered backends (T2/T5/T6), blank-frame self-heal (T1/T6), inference order incl. project match + candidates (T3), result contract identical to `capture_app` (T6), IPC + preload + routing (T7/T8/T10), two-render-paths check (T10 Step 3), testing strategy (every pure module has TDD tests; integration smoke T10 Step 4). All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows real code; commands have expected output.
- **Type consistency:** `CaptureWindowResult`, `CaptureWindowDeps`, `WindowCandidate`, `InferContext`, `BackendName`, `CaptureEnv` used consistently across T2/T3/T6/T7. Backend names `'spectacle' | 'grim' | 'screencapture'` match between T4, T5, T6. `captureWindow`/`captureSource`/`captureCli`/`listWindows` signatures align between T5 (impl), T6 (deps), T7 (wiring).
- **Note:** the `display: boolean` schema prop is registered (T9) for forward-compatibility but display-capture routing is not wired in T10 (window capture is the v1 path). This is intentional minimal scope; whole-display capture is a trivial follow-up (add a `captureDisplay` branch). Flagged here so it isn't mistaken for a gap.
