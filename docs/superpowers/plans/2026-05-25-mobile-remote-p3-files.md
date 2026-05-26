# Mobile Remote — Phase 3 Files (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Files surface to the phone PWA: review uncommitted git changes with Shiki-highlighted diffs, browse the file tree, view file contents. Per-repo for meta workspaces.

**Architecture:** Bridge calls extracted impl functions from `fs.ts` + `git.ts` directly (no renderer-proxy roundtrip needed — main has direct fs access). Large/binary files served via signed single-use `/blob/<id>` URLs backed by the P0 ScreenshotUrlSigner crypto plus a new BlobStore lookup. PWA gets a Chat/Files top-level tab, a Files orchestrator with Changes/Browse sub-tabs and an optional per-repo chip strip, and lazy-loaded Shiki for syntax highlighting.

**Tech Stack:** TypeScript, Electron `ipcMain`, `simple-git`, `ws`, `shiki` (lazy), React.

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p3-files-design.md`. **Branch:** `feat/mobile-remote-p3` already checked out. **P0/P1/P2 reference:** merged into `main`.

---

## Pre-flight notes

- `electron/services/fs.ts` has IPC handlers: `fs:readDir`, `fs:readFile`, `fs:readFileBase64`, `fs:mtime`. `readDir` returns `{ name, path, type: 'directory' | 'file' }[]` (sorted dirs-first).
- `electron/services/git.ts` has `git:status` (returns `{ branch, staged, modified, created, deleted, not_added }`), `git:diff` (args: `cwd, filepath, staged`).
- ScreenshotUrlSigner from P0 lives at `electron/services/remote/screenshot-urls.ts` — we'll reuse it as the crypto layer.
- BridgeServer already has a `/screenshot/<id>` route pattern we can mirror for `/blob/<id>`.
- PWA wire.ts has the reqId correlation dispatcher we extended in P2.

---

## File structure

**New (Electron):**
- `electron/services/remote/blob-store.ts` — id → `{ cwd, path }` lookup with TTL
- `electron/services/remote/safe-join.ts` — path-traversal guard

**New (PWA):**
- `src/renderer-remote/chat/Tabs.tsx` — Chat/Files segmented control
- `src/renderer-remote/files/Files.tsx` — orchestrator (Changes/Browse + RepoPicker)
- `src/renderer-remote/files/RepoPicker.tsx` — meta-workspace per-repo chips
- `src/renderer-remote/files/ChangesView.tsx`
- `src/renderer-remote/files/BrowseView.tsx`
- `src/renderer-remote/files/FileViewer.tsx`
- `src/renderer-remote/files/DiffViewer.tsx`
- `src/renderer-remote/files/shiki.ts` — lazy-singleton highlighter
- `src/renderer-remote/files/lang.ts` — extension → language map

**Modified (Electron):**
- `electron/services/fs.ts` — extract `readDirImpl`, `readFileImpl`, `readFileBufImpl`, `statFileImpl`
- `electron/services/git.ts` — extract `gitStatusImpl`, `gitDiffImpl`
- `electron/services/remote/bridge-server.ts` — 4 WS branches, `/blob/<id>` route, `BridgeServerOpts` widened
- `electron/main.ts` — BlobStore + 4 new opts wired into the bridge construction

**Modified (PWA):**
- `src/renderer-remote/wire.ts` — `listFiles`/`readFile`/`statusFiles`/`diffFile` helpers + new reply branches
- `src/renderer-remote/App.tsx` — Chat/Files tab routing + last-tab persistence
- `src/renderer-remote/chat/Chat.tsx` — receives `chatActive` toggle (Files lives outside Chat)

**New tests + docs:**
- `tests/unit/remote/blob-store.test.ts`
- `tests/unit/remote/safe-join.test.ts`
- `tests/unit/remote/bridge-server-files.test.ts`
- `tests/integration/remote/files-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p3-smoke.md`

---

## Task 1: `safe-join.ts` — path-traversal guard

**Files:**
- Create: `electron/services/remote/safe-join.ts`
- Create: `tests/unit/remote/safe-join.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { safeJoin } from '@electron/services/remote/safe-join';

describe('safeJoin', () => {
  it('joins normal relative paths', () => {
    expect(safeJoin('/repo', 'src/App.tsx')).toBe('/repo/src/App.tsx');
  });

  it('returns cwd itself when path is empty or "."', () => {
    expect(safeJoin('/repo', '')).toBe('/repo');
    expect(safeJoin('/repo', '.')).toBe('/repo');
  });

  it('throws on ..-escape', () => {
    expect(() => safeJoin('/repo', '../etc/passwd')).toThrow(/escape/);
    expect(() => safeJoin('/repo', 'a/../../b')).toThrow(/escape/);
  });

  it('throws on absolute paths', () => {
    expect(() => safeJoin('/repo', '/etc/passwd')).toThrow(/absolute/);
  });

  it('handles trailing slashes consistently', () => {
    expect(safeJoin('/repo/', 'src/')).toBe('/repo/src');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx vitest run tests/unit/remote/safe-join.test.ts
```

- [ ] **Step 3: Implement**

```ts
import nodePath from 'node:path';

export function safeJoin(cwd: string, relPath: string): string {
  if (nodePath.isAbsolute(relPath)) {
    throw new Error(`absolute paths not allowed: ${relPath}`);
  }
  const normalizedCwd = nodePath.resolve(cwd);
  const resolved = nodePath.resolve(normalizedCwd, relPath);
  if (resolved !== normalizedCwd && !resolved.startsWith(normalizedCwd + nodePath.sep)) {
    throw new Error(`path escapes cwd: ${relPath}`);
  }
  return resolved;
}
```

- [ ] **Step 4: Verify pass + tsc + commit**

```bash
npx vitest run tests/unit/remote/safe-join.test.ts
npx tsc --noEmit
git add electron/services/remote/safe-join.ts tests/unit/remote/safe-join.test.ts
git commit -m "feat(remote): safeJoin path-traversal guard"
```

Expected: 5 passing.

---

## Task 2: `blob-store.ts` — id → file pair with TTL

**Files:**
- Create: `electron/services/remote/blob-store.ts`
- Create: `tests/unit/remote/blob-store.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { BlobStore } from '@electron/services/remote/blob-store';

describe('BlobStore', () => {
  it('register + consume happy path', () => {
    const s = new BlobStore();
    const id = s.register('/repo', 'a.txt', 60_000);
    expect(typeof id).toBe('string');
    expect(s.consume(id)).toEqual({ cwd: '/repo', path: 'a.txt' });
  });

  it('consume twice returns null', () => {
    const s = new BlobStore();
    const id = s.register('/repo', 'a.txt');
    s.consume(id);
    expect(s.consume(id)).toBeNull();
  });

  it('expired entries are not consumable', () => {
    let now = 1_000_000;
    const s = new BlobStore({ now: () => now });
    const id = s.register('/repo', 'a.txt', 100);
    now += 200;
    expect(s.consume(id)).toBeNull();
  });

  it('returns null for unknown id', () => {
    const s = new BlobStore();
    expect(s.consume('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/blob-store.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { randomBytes } from 'node:crypto';

interface Entry { cwd: string; path: string; expiresAt: number }

export interface BlobStoreOpts { now?: () => number }

export class BlobStore {
  private readonly map = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(opts: BlobStoreOpts = {}) {
    this.now = opts.now ?? Date.now;
  }

  register(cwd: string, path: string, ttlMs = 60_000): string {
    const id = randomBytes(16).toString('base64url');
    this.map.set(id, { cwd, path, expiresAt: this.now() + ttlMs });
    return id;
  }

  consume(id: string): { cwd: string; path: string } | null {
    const entry = this.map.get(id);
    if (!entry) return null;
    this.map.delete(id);
    if (entry.expiresAt < this.now()) return null;
    return { cwd: entry.cwd, path: entry.path };
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run tests/unit/remote/blob-store.test.ts
npx tsc --noEmit
git add electron/services/remote/blob-store.ts tests/unit/remote/blob-store.test.ts
git commit -m "feat(remote): BlobStore for signed file URLs"
```

Expected: 4 passing.

---

## Task 3: Extract impls from `fs.ts`

**Files:**
- Modify: `electron/services/fs.ts`

- [ ] **Step 1: Add exported impl functions**

Open `electron/services/fs.ts`. Above `registerFsHandlers`, add:

```ts
export interface FileEntry { name: string; path: string; type: 'file' | 'directory' }

export async function readDirImpl(dirPath: string): Promise<FileEntry[]> {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const mapped = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dirPath, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try { isDir = (await fs.promises.stat(full)).isDirectory(); } catch { isDir = false; }
    }
    return { name: entry.name, path: full, type: isDir ? 'directory' as const : 'file' as const };
  }));
  return mapped.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFileImpl(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}

export async function readFileBufImpl(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath);
}

export async function statFileImpl(filePath: string): Promise<{ size: number; isDir: boolean; mtime: number }> {
  const s = await fs.promises.stat(filePath);
  return { size: s.size, isDir: s.isDirectory(), mtime: s.mtimeMs };
}
```

- [ ] **Step 2: Replace IPC handler bodies**

```ts
ipcMain.handle('fs:readDir', (_e, dirPath: string) => readDirImpl(dirPath));
ipcMain.handle('fs:readFile', (_e, filePath: string) => readFileImpl(filePath));
ipcMain.handle('fs:mtime', async (_e, filePath: string) => {
  const s = await statFileImpl(filePath);
  return { mtime: s.mtime };
});
```

Leave the other handlers (`readFileBase64`, `writeFile`, etc.) untouched.

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
git add electron/services/fs.ts
git commit -m "refactor(fs): extract readDir/readFile/stat impls"
```

Expected: all existing tests still pass.

---

## Task 4: Extract impls from `git.ts`

**Files:**
- Modify: `electron/services/git.ts`

- [ ] **Step 1: Add exported impl functions**

Above `registerGitHandlers` in `electron/services/git.ts`:

```ts
export interface GitStatusEntry { path: string; status: string; staged: boolean }

export async function gitStatusImpl(cwd: string): Promise<{ branch: string | null; entries: GitStatusEntry[] }> {
  const s = await git(cwd).status();
  const entries: GitStatusEntry[] = [];
  for (const p of s.staged)    entries.push({ path: p, status: 'modified', staged: true });
  for (const p of s.modified)  entries.push({ path: p, status: 'modified', staged: false });
  for (const p of s.created)   entries.push({ path: p, status: 'added',    staged: true  });
  for (const p of s.deleted)   entries.push({ path: p, status: 'deleted',  staged: false });
  for (const p of s.not_added) entries.push({ path: p, status: 'added',    staged: false });
  return { branch: s.current ?? null, entries };
}

export async function gitDiffImpl(cwd: string, filepath: string, staged: boolean): Promise<string> {
  const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
  return await git(cwd).diff(args);
}
```

- [ ] **Step 2: Verify the existing `git:status` IPC keeps its current shape**

The existing IPC returns a flat shape `{ branch, staged, modified, created, deleted, not_added, ahead, behind }`. **Don't** change that — the desktop renderer relies on it. The new `gitStatusImpl` is for the bridge only.

So leave `ipcMain.handle('git:status', ...)` as-is. Same for `git:diff` — its IPC body already does the same as the new `gitDiffImpl`, but to be safe, change it to call `gitDiffImpl`:

```ts
ipcMain.handle('git:diff', (_e, cwd: string, filepath: string, staged: boolean) => gitDiffImpl(cwd, filepath, staged));
```

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
git add electron/services/git.ts
git commit -m "refactor(git): export gitStatusImpl + gitDiffImpl for bridge use"
```

---

## Task 5: `lang.ts` helper — extension → language

**Files:**
- Create: `electron/services/remote/lang.ts`
- Create: `tests/unit/remote/lang.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { langFromPath, isTextLike, mimeFromPath } from '@electron/services/remote/lang';

describe('lang helpers', () => {
  it('langFromPath returns common language ids', () => {
    expect(langFromPath('App.tsx')).toBe('tsx');
    expect(langFromPath('src/index.ts')).toBe('typescript');
    expect(langFromPath('script.js')).toBe('javascript');
    expect(langFromPath('main.py')).toBe('python');
    expect(langFromPath('Cargo.toml')).toBe('toml');
    expect(langFromPath('README.md')).toBe('markdown');
    expect(langFromPath('unknown.xyz')).toBeNull();
  });

  it('isTextLike based on extension', () => {
    expect(isTextLike('App.tsx')).toBe(true);
    expect(isTextLike('image.png')).toBe(false);
    expect(isTextLike('binary.bin')).toBe(false);
    expect(isTextLike('plain.txt')).toBe(true);
  });

  it('mimeFromPath returns image mimes', () => {
    expect(mimeFromPath('image.png')).toBe('image/png');
    expect(mimeFromPath('photo.jpg')).toBe('image/jpeg');
    expect(mimeFromPath('unknown.xyz')).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/lang.test.ts
```

- [ ] **Step 3: Implement**

```ts
const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', kt: 'kotlin',
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  html: 'html', css: 'css', scss: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  xml: 'xml', svg: 'xml',
  dockerfile: 'dockerfile',
};

const TEXT_LIKE_EXTRA = new Set(['txt', 'log', 'env', 'gitignore', 'gitattributes', 'editorconfig', 'lock']);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  if (i === -1) {
    const base = p.split('/').pop()!.toLowerCase();
    return LANG[base] ? base : '';
  }
  return p.slice(i + 1).toLowerCase();
}

export function langFromPath(p: string): string | null {
  const ext = extOf(p);
  return LANG[ext] ?? null;
}

export function isTextLike(p: string): boolean {
  const ext = extOf(p);
  if (ext in LANG) return true;
  if (TEXT_LIKE_EXTRA.has(ext)) return true;
  if (ext === '') return true; // README, Makefile, etc.
  return false;
}

export function mimeFromPath(p: string): string {
  const ext = extOf(p);
  return IMAGE_MIME[ext] ?? 'application/octet-stream';
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run tests/unit/remote/lang.test.ts
npx tsc --noEmit
git add electron/services/remote/lang.ts tests/unit/remote/lang.test.ts
git commit -m "feat(remote): lang helpers (ext → highlighter id, text/mime)"
```

Expected: 3 passing.

---

## Task 6: Extend `BridgeServerOpts` + WS routing for files

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Create: `tests/unit/remote/bridge-server-files.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/bridge-server-files.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function once<T = any>(ws: WebSocket, predicate: (m: any) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.Data) => {
      const m = JSON.parse(data.toString());
      if (predicate(m)) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.once('close', (code) => reject(new Error(`closed: ${code}`)));
  });
}

async function pairedSocket(server: BridgeServer, port: number): Promise<WebSocket> {
  const code = server.mintPairingCode();
  const r = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel: 'Test' }),
  });
  const { token } = await r.json();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'auth', token }));
  await once(ws, (m) => m.type === 'auth_ok');
  return ws;
}

describe('BridgeServer files routing', () => {
  let server: BridgeServer; let port: number;

  afterEach(async () => { await server.stop(); });

  it('files.list returns entries with reqId', async () => {
    const listFiles = vi.fn().mockResolvedValue([{ name: 'a.txt', kind: 'file', size: 4 }]);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      listFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.list', cwd: '/repo', path: 'src', reqId: 'l1' }));
    const m = await once(ws, (m) => m.type === 'files.list.result');
    expect(m.reqId).toBe('l1');
    expect(m.entries).toEqual([{ name: 'a.txt', kind: 'file', size: 4 }]);
    expect(listFiles).toHaveBeenCalledWith('/repo', 'src');
    ws.close();
  });

  it('files.read returns content', async () => {
    const readFile = vi.fn().mockResolvedValue({ content: 'hi', encoding: 'text', size: 2, lang: 'tsx' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      readFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.read', cwd: '/repo', path: 'a.tsx', reqId: 'r1' }));
    const m = await once(ws, (m) => m.type === 'files.read.result');
    expect(m.reqId).toBe('r1');
    expect(m.content).toBe('hi');
    expect(m.lang).toBe('tsx');
    ws.close();
  });

  it('files.status returns entries', async () => {
    const statusFiles = vi.fn().mockResolvedValue([{ path: 'a.txt', status: 'modified', staged: false }]);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      statusFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.status', cwd: '/repo', reqId: 's1' }));
    const m = await once(ws, (m) => m.type === 'files.status.result');
    expect(m.entries).toHaveLength(1);
    ws.close();
  });

  it('files.diff returns diff string', async () => {
    const diffFile = vi.fn().mockResolvedValue({ diff: '@@ ...', lang: 'tsx' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      diffFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.diff', cwd: '/repo', path: 'a.tsx', staged: false, reqId: 'd1' }));
    const m = await once(ws, (m) => m.type === 'files.diff.result');
    expect(m.diff).toBe('@@ ...');
    expect(m.lang).toBe('tsx');
    ws.close();
  });

  it('errors are returned with reqId', async () => {
    const listFiles = vi.fn().mockRejectedValue(new Error('boom'));
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      listFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.list', cwd: '/repo', path: 'src', reqId: 'err' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('err');
    expect(m.message).toMatch(/boom/);
    ws.close();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-files.test.ts
```

Expected: 5 failures.

- [ ] **Step 3: Extend BridgeServerOpts**

In `electron/services/remote/bridge-server.ts`, add to the interface (near other P1/P2 fields):

```ts
export interface FileEntry { name: string; kind: 'file' | 'dir'; size?: number }
export interface FileReadResult {
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}
export interface FileStatusEntry { path: string; status: string; staged: boolean }
export interface FileDiffResult { diff: string; lang?: string }

// In BridgeServerOpts:
listFiles?: (cwd: string, path: string) => Promise<FileEntry[]>;
readFile?: (cwd: string, path: string) => Promise<FileReadResult>;
statusFiles?: (cwd: string) => Promise<FileStatusEntry[]>;
diffFile?: (cwd: string, path: string, staged: boolean) => Promise<FileDiffResult>;
loadBlob?: (id: string) => Promise<{ buffer: Buffer; mime: string } | null>;
```

- [ ] **Step 4: Add WS handlers**

Inside `handleWs`'s message handler, AFTER the existing `workspace.set` branch and BEFORE the `prompt` / `approval` branches, add:

```ts
if (msg.type === 'files.list' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
  const reqId = msg.reqId;
  try {
    const entries = (await this.opts.listFiles?.(msg.cwd, msg.path)) ?? [];
    ws.send(JSON.stringify({ v: 1, type: 'files.list.result', reqId, entries }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'files.read' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
  const reqId = msg.reqId;
  try {
    const result = await this.opts.readFile?.(msg.cwd, msg.path);
    if (!result) {
      ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'read_failed', message: 'no readFile callback' }));
      return;
    }
    ws.send(JSON.stringify({ v: 1, type: 'files.read.result', reqId, ...result }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'read_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'files.status' && typeof msg.cwd === 'string') {
  const reqId = msg.reqId;
  try {
    const entries = (await this.opts.statusFiles?.(msg.cwd)) ?? [];
    ws.send(JSON.stringify({ v: 1, type: 'files.status.result', reqId, entries }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'status_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'files.diff' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
  const reqId = msg.reqId;
  try {
    const result = await this.opts.diffFile?.(msg.cwd, msg.path, !!msg.staged);
    if (!result) {
      ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'diff_failed', message: 'no diffFile callback' }));
      return;
    }
    ws.send(JSON.stringify({ v: 1, type: 'files.diff.result', reqId, diff: result.diff, lang: result.lang }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'diff_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 5: Verify pass + commit**

```bash
npx vitest run tests/unit/remote/bridge-server-files.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-files.test.ts
git commit -m "feat(remote): WS routing for files.list/read/status/diff"
```

Expected: 5 new passing.

---

## Task 7: `/blob/<id>` HTTP route on bridge

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Add the route handler**

In `bridge-server.ts`, find the existing `handle` HTTP dispatcher. The `/screenshot/...` route was added in P0. Add a parallel `/blob/...` route handler ABOVE the screenshot one:

```ts
if (req.method === 'GET' && req.url?.startsWith('/blob/')) return await this.handleBlob(req, res);
```

Then add the handler method (above `handleScreenshot`):

```ts
private async handleBlob(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const result = this.signer.verify(req.url!);
  if (!result.ok || !result.id) { res.statusCode = 401; res.end('bad url'); return; }
  const blob = await this.opts.loadBlob?.(result.id);
  if (!blob) { res.statusCode = 404; res.end('not found'); return; }
  res.statusCode = 200;
  res.setHeader('content-type', blob.mime);
  res.setHeader('content-length', blob.buffer.length.toString());
  res.end(blob.buffer);
}
```

The existing `signer.verify` is what the screenshot route uses; same crypto, same single-use semantics. The `id` it returns is then handed to `loadBlob` (which is `blobStore.consume` in `main.ts`).

Add a tiny new method to expose the signer to `main.ts` (it'll need to sign blob ids when readFile decides a file is >64KB):

```ts
signBlobUrl(id: string): string {
  return this.signer.sign(id).replace('/screenshot/', '/blob/');
}
```

(The signer's `sign` returns `/screenshot/<id>?...`; we just swap the prefix. Or refactor the signer to take a path prefix as a constructor arg — your call. The string replace is fine for v1.)

- [ ] **Step 2: Add a quick unit test for the route**

Append to `tests/unit/remote/bridge-server-pair.test.ts` (the file that already tests other HTTP routes):

```ts
it('GET /blob/<id> serves bytes via the same signer + loadBlob', async () => {
  let loaded: string | null = null;
  const server2 = new BridgeServer({
    tailnetIp: '127.0.0.1', pairing: buildPairingStore(), bus: new SessionBus(),
    pwaDir: null, screenshotSecret: 'sek', loadScreenshot: async () => null,
    loadBlob: async (id) => { loaded = id; return { buffer: Buffer.from('hello'), mime: 'text/plain' }; },
  });
  const { port: p2 } = await server2.start();
  const url = server2.signBlobUrl('blob-123');
  const r = await fetch(`http://127.0.0.1:${p2}${url}`);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe('hello');
  expect(loaded).toBe('blob-123');
  // Second fetch: signer.verify enforces single-use, returns 401
  const r2 = await fetch(`http://127.0.0.1:${p2}${url}`);
  expect(r2.status).toBe(401);
  await server2.stop();
});
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/unit/remote/bridge-server-pair.test.ts
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-pair.test.ts
git commit -m "feat(remote): /blob/<id> HTTP route for large/binary files"
```

Expected: existing 4 + 1 new = 5 passing.

---

## Task 8: Wire `main.ts` — BlobStore + four impl callbacks

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add imports**

```ts
import { BlobStore } from './services/remote/blob-store';
import { safeJoin } from './services/remote/safe-join';
import { langFromPath, isTextLike, mimeFromPath } from './services/remote/lang';
import { readDirImpl, readFileImpl, readFileBufImpl, statFileImpl } from './services/fs';
import { gitStatusImpl, gitDiffImpl } from './services/git';
```

- [ ] **Step 2: Module-level BlobStore + bridge reference**

Near the other module singletons (`remote`, `pairing`, `bus`, `rendererProxy`):

```ts
let blobStore: BlobStore | null = null;
let bridge: import('./services/remote/bridge-server').BridgeServer | null = null;
```

Inside `getOrInitRemote()`, just after the existing init, add:

```ts
blobStore = new BlobStore();
```

- [ ] **Step 3: Capture the bridge instance**

The current `makeBridge` returns a new BridgeServer inline. Update it to also assign to the module-level `bridge` var. Change:

```ts
makeBridge: (tailnetIp) => new BridgeServer({ ... }),
```

to:

```ts
makeBridge: (tailnetIp) => {
  const b = new BridgeServer({
    /* ... existing fields ... */
    listFiles: async (cwd, path) => {
      const full = safeJoin(cwd, path);
      const stat = await statFileImpl(full);
      if (!stat.isDir) throw new Error(`not a directory: ${path}`);
      const entries = await readDirImpl(full);
      return entries.map((e) => ({ name: e.name, kind: e.type === 'directory' ? 'dir' as const : 'file' as const }));
    },
    readFile: async (cwd, path) => {
      const full = safeJoin(cwd, path);
      const stat = await statFileImpl(full);
      const lang = langFromPath(path) ?? undefined;
      const inline = isTextLike(path) && stat.size <= 64 * 1024;
      if (inline) {
        const content = await readFileImpl(full);
        return { content, encoding: 'text' as const, size: stat.size, lang };
      }
      const id = blobStore!.register(cwd, path);
      const signedUrl = b.signBlobUrl(id);
      return { signedUrl, encoding: 'binary' as const, size: stat.size, mime: mimeFromPath(path) };
    },
    statusFiles: async (cwd) => {
      const { entries } = await gitStatusImpl(cwd);
      return entries;
    },
    diffFile: async (cwd, path, staged) => {
      const diff = await gitDiffImpl(cwd, path, staged);
      return { diff, lang: langFromPath(path) ?? undefined };
    },
    loadBlob: async (id) => {
      const entry = blobStore!.consume(id);
      if (!entry) return null;
      const full = safeJoin(entry.cwd, entry.path);
      const buffer = await readFileBufImpl(full);
      return { buffer, mime: mimeFromPath(entry.path) };
    },
  });
  bridge = b;
  return b;
},
```

`b` is referenced inside the readFile callback before `bridge = b` runs — that's fine; the callback isn't invoked until a WS frame arrives. JS closures capture by reference.

- [ ] **Step 4: tsc + tests + commit**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
git add electron/main.ts
git commit -m "feat(remote): wire BlobStore + file callbacks into bridge"
```

---

## Task 9: Extend PWA `wire.ts` with file helpers

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend the `WireClient` interface**

Add to the interface:

```ts
listFiles(cwd: string, path: string): Promise<unknown[]>;
readFile(cwd: string, path: string): Promise<{
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}>;
statusFiles(cwd: string): Promise<unknown[]>;
diffFile(cwd: string, path: string, staged?: boolean): Promise<{ diff: string; lang?: string }>;
```

- [ ] **Step 2: Update reply dispatcher**

Find the existing reply dispatcher inside `connect()` (P2 added per-type branches). Add four new branches:

```ts
} else if (t === 'files.list.result') {
  entry.resolve((msg as any).entries ?? []);
} else if (t === 'files.read.result') {
  entry.resolve(msg);
} else if (t === 'files.status.result') {
  entry.resolve((msg as any).entries ?? []);
} else if (t === 'files.diff.result') {
  entry.resolve({ diff: (msg as any).diff ?? '', lang: (msg as any).lang });
}
```

Add these branches BEFORE the catch-all `entry.resolve(msg);` at the end.

- [ ] **Step 3: Add helpers in the returned client**

Inside the `return { ... }` object, add (alongside existing helpers):

```ts
listFiles: (cwd, path) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.list timeout')); }, 5000);
  sendFrame({ type: 'files.list', cwd, path, reqId });
}),
readFile: (cwd, path) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.read timeout')); }, 10_000);
  sendFrame({ type: 'files.read', cwd, path, reqId });
}),
statusFiles: (cwd) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.status timeout')); }, 5000);
  sendFrame({ type: 'files.status', cwd, reqId });
}),
diffFile: (cwd, path, staged) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.diff timeout')); }, 5000);
  sendFrame({ type: 'files.diff', cwd, path, staged: !!staged, reqId });
}),
```

- [ ] **Step 4: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): PWA wire helpers for file list/read/status/diff"
```

---

## Task 10: Lazy Shiki + lang helpers in PWA

**Files:**
- Create: `src/renderer-remote/files/shiki.ts`
- Create: `src/renderer-remote/files/lang.ts`

- [ ] **Step 1: Create `lang.ts`**

```ts
const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  swift: 'swift', kt: 'kotlin',
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  html: 'html', css: 'css', scss: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  xml: 'xml', svg: 'xml',
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  if (i === -1) return '';
  return p.slice(i + 1).toLowerCase();
}

export function langFromPath(p: string): string | null {
  return LANG[extOf(p)] ?? null;
}

export function isImage(p: string): boolean {
  return extOf(p) in IMAGE_MIME;
}
```

- [ ] **Step 2: Create `shiki.ts` — lazy singleton**

```ts
import type { Highlighter } from 'shiki';

let cached: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!cached) {
    cached = (async () => {
      const { createHighlighter } = await import('shiki');
      return await createHighlighter({
        themes: ['github-dark'],
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'rust', 'go', 'java', 'ruby',
          'c', 'cpp', 'csharp', 'swift', 'kotlin',
          'json', 'toml', 'yaml', 'markdown', 'mdx',
          'html', 'css', 'scss', 'bash', 'sql',
          'graphql', 'xml', 'diff',
        ],
      });
    })();
  }
  return cached;
}

export async function highlightToHtml(code: string, lang: string | null | undefined): Promise<string> {
  const h = await getHighlighter();
  const effective = lang && h.getLoadedLanguages().includes(lang as any) ? lang : 'text';
  try {
    return h.codeToHtml(code, { lang: effective, theme: 'github-dark' });
  } catch {
    // Fallback: escape and wrap
    const esc = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    return `<pre><code>${esc}</code></pre>`;
  }
}
```

- [ ] **Step 3: PWA build (Shiki is now installed as a transitive dep? Check)**

```bash
grep '"shiki"' package.json || echo "missing"
```

If missing, install:

```bash
npm install shiki
```

Then:

```bash
npx vite build --config vite.config.pwa.ts
```

Expected: build succeeds. Shiki is dynamic-imported so the chat-only path isn't affected.

- [ ] **Step 4: Commit**

```bash
mkdir -p src/renderer-remote/files
git add src/renderer-remote/files/shiki.ts src/renderer-remote/files/lang.ts package.json package-lock.json
git commit -m "feat(remote): lazy Shiki highlighter + PWA lang helper"
```

---

## Task 11: PWA `Tabs.tsx` — Chat/Files segmented control

**Files:**
- Create: `src/renderer-remote/chat/Tabs.tsx`

- [ ] **Step 1: Implement**

```tsx
interface Props {
  value: 'chat' | 'files';
  onChange: (v: 'chat' | 'files') => void;
}

export default function Tabs({ value, onChange }: Props) {
  const baseStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 0',
    fontSize: 12,
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    cursor: 'pointer',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderBottom: '2px solid transparent',
  };
  const activeStyle: React.CSSProperties = {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
  };
  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <button
        style={{ ...baseStyle, ...(value === 'chat' ? activeStyle : null) }}
        onClick={() => onChange('chat')}
      >
        Chat
      </button>
      <button
        style={{ ...baseStyle, ...(value === 'files' ? activeStyle : null) }}
        onClick={() => onChange('files')}
      >
        Files
      </button>
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/Tabs.tsx
git commit -m "feat(remote): Chat/Files top-level tabs"
```

---

## Task 12: PWA `DiffViewer.tsx`

**Files:**
- Create: `src/renderer-remote/files/DiffViewer.tsx`

- [ ] **Step 1: Implement**

```tsx
interface Props {
  diff: string;
}

interface ParsedLine {
  kind: 'context' | 'add' | 'remove' | 'hunk' | 'meta';
  text: string;
}

function parseDiff(diff: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) out.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      out.push({ kind: 'meta', text: line });
    }
    else if (line.startsWith('+')) out.push({ kind: 'add', text: line });
    else if (line.startsWith('-')) out.push({ kind: 'remove', text: line });
    else out.push({ kind: 'context', text: line });
  }
  return out;
}

export default function DiffViewer({ diff }: Props) {
  if (!diff || !diff.trim()) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        No changes.
      </div>
    );
  }
  const lines = parseDiff(diff);
  return (
    <pre style={{
      margin: 0,
      padding: 12,
      background: 'var(--bg-input)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      overflowX: 'auto',
      whiteSpace: 'pre',
    }}>
      {lines.map((l, i) => {
        let color = 'var(--text)';
        let bg: string | undefined;
        if (l.kind === 'add')    { color = 'var(--green)'; bg = 'color-mix(in srgb, var(--green) 10%, transparent)'; }
        else if (l.kind === 'remove') { color = 'var(--red)';   bg = 'color-mix(in srgb, var(--red)   10%, transparent)'; }
        else if (l.kind === 'hunk')   { color = 'var(--accent)'; }
        else if (l.kind === 'meta')   { color = 'var(--text-muted)'; }
        return (
          <div key={i} style={{ color, background: bg, padding: '0 6px' }}>
            {l.text || ' '}
          </div>
        );
      })}
    </pre>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/DiffViewer.tsx
git commit -m "feat(remote): PWA DiffViewer (unified +/- with gutters)"
```

---

## Task 13: PWA `FileViewer.tsx`

**Files:**
- Create: `src/renderer-remote/files/FileViewer.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { highlightToHtml } from './shiki';
import { isImage } from './lang';

interface Props {
  cwd: string;
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileViewer({ path, content, signedUrl, encoding, size, lang, mime }: Props) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (encoding === 'text' && content != null) {
      // Truncate huge text to avoid OOM on phone
      const display = content.length > 50_000 ? content.slice(0, 50_000) + '\n... (truncated)' : content;
      highlightToHtml(display, lang ?? null).then((h) => { if (!cancelled) setHtml(h); });
    } else {
      setHtml(null);
    }
    return () => { cancelled = true; };
  }, [content, encoding, lang]);

  if (encoding === 'binary') {
    if (signedUrl && isImage(path)) {
      return (
        <div style={{ padding: 12 }}>
          <img
            src={signedUrl}
            alt={path}
            style={{ maxWidth: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      );
    }
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
        Binary file ({mime ?? 'unknown'}, {formatSize(size)})
        {signedUrl && (
          <>
            {' · '}
            <a href={signedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>open raw</a>
          </>
        )}
      </div>
    );
  }

  if (!html) {
    return (
      <pre style={{ margin: 0, padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
        {content ?? ''}
      </pre>
    );
  }

  return (
    <div
      style={{
        margin: 0,
        padding: 12,
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        overflow: 'auto',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/FileViewer.tsx
git commit -m "feat(remote): PWA FileViewer (Shiki text + image preview)"
```

---

## Task 14: PWA `ChangesView.tsx`

**Files:**
- Create: `src/renderer-remote/files/ChangesView.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import type { WireClient } from '../wire';
import DiffViewer from './DiffViewer';

interface StatusEntry { path: string; status: string; staged: boolean }

interface Props {
  client: WireClient;
  cwd: string;
}

const STATUS_LABEL: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: 'var(--orange)' },
  added:    { letter: 'A', color: 'var(--green)' },
  deleted:  { letter: 'D', color: 'var(--red)' },
  renamed:  { letter: 'R', color: 'var(--blue)' },
};

export default function ChangesView({ client, cwd }: Props) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [selected, setSelected] = useState<StatusEntry | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoadingList(true); setErr(null); setSelected(null); setDiff('');
    client.statusFiles(cwd)
      .then((e) => setEntries(e as StatusEntry[]))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingList(false));
  }, [client, cwd]);

  useEffect(() => {
    if (!selected) return;
    setLoadingDiff(true);
    client.diffFile(cwd, selected.path, selected.staged)
      .then((r) => setDiff((r as any).diff ?? ''))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingDiff(false));
  }, [client, cwd, selected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
        {loadingList && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {err && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        {!loadingList && !err && entries.length === 0 && (
          <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-muted)' }}>
            No uncommitted changes.
          </div>
        )}
        {entries.map((e, i) => {
          const meta = STATUS_LABEL[e.status] ?? { letter: '?', color: 'var(--text-muted)' };
          const active = selected?.path === e.path && selected?.staged === e.staged;
          return (
            <button
              key={`${e.path}-${i}`}
              onClick={() => setSelected(e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                color: 'var(--text)',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 16,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontWeight: 700,
                color: meta.color,
              }}>{meta.letter}</span>
              <span style={{
                flex: 1,
                fontSize: 13,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {e.path}
              </span>
              {e.staged && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>staged</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {!selected && !loadingDiff && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            Select a file to view its diff.
          </div>
        )}
        {loadingDiff && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {selected && !loadingDiff && <DiffViewer diff={diff} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/ChangesView.tsx
git commit -m "feat(remote): PWA ChangesView (modified list + diff)"
```

---

## Task 15: PWA `BrowseView.tsx`

**Files:**
- Create: `src/renderer-remote/files/BrowseView.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { WireClient } from '../wire';
import FileViewer from './FileViewer';
import { langFromPath } from './lang';

interface Entry { name: string; kind: 'file' | 'dir'; size?: number }

interface Props {
  client: WireClient;
  cwd: string;
}

interface OpenFile {
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}

function TreeNode({
  client, cwd, dirPath, depth = 0, onPickFile,
}: {
  client: WireClient;
  cwd: string;
  dirPath: string;
  depth?: number;
  onPickFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || entries.length > 0) return;
    setLoading(true);
    client.listFiles(cwd, dirPath)
      .then((e) => setEntries(e as Entry[]))
      .finally(() => setLoading(false));
  }, [expanded, client, cwd, dirPath]);

  if (depth === 0) {
    // Root: render entries inline without a "/" toggle row
    return (
      <>
        {loading && <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>}
        {entries.map((e) => (
          <Row
            key={e.name}
            client={client}
            cwd={cwd}
            entry={e}
            parent={dirPath}
            depth={depth + 1}
            onPickFile={onPickFile}
          />
        ))}
      </>
    );
  }
  return null;
}

function Row({
  client, cwd, entry, parent, depth, onPickFile,
}: {
  client: WireClient;
  cwd: string;
  entry: Entry;
  parent: string;
  depth: number;
  onPickFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const childPath = parent ? `${parent}/${entry.name}` : entry.name;

  useEffect(() => {
    if (!expanded || entry.kind !== 'dir' || children.length > 0) return;
    setLoading(true);
    client.listFiles(cwd, childPath)
      .then((e) => setChildren(e as Entry[]))
      .finally(() => setLoading(false));
  }, [expanded, entry.kind, client, cwd, childPath]);

  const Icon = entry.kind === 'dir' ? Folder : FileText;
  const Chevron = entry.kind === 'dir' ? (expanded ? ChevronDown : ChevronRight) : null;

  return (
    <>
      <button
        onClick={() => {
          if (entry.kind === 'dir') setExpanded((v) => !v);
          else onPickFile(childPath);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: `6px 14px 6px ${10 + depth * 14}px`,
          background: 'transparent',
          color: 'var(--text)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
          {Chevron && <Chevron size={12} color="var(--text-muted)" />}
        </span>
        <Icon size={13} color="var(--text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: 13,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {entry.name}
        </span>
      </button>
      {expanded && entry.kind === 'dir' && (
        <>
          {loading && <div style={{ padding: `4px 14px 4px ${24 + depth * 14}px`, fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>}
          {children.map((c) => (
            <Row
              key={c.name}
              client={client}
              cwd={cwd}
              entry={c}
              parent={childPath}
              depth={depth + 1}
              onPickFile={onPickFile}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function BrowseView({ client, cwd }: Props) {
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState(false);

  const pickFile = (path: string) => {
    setLoading(true);
    client.readFile(cwd, path)
      .then((r: any) => setOpen({ path, ...r }))
      .finally(() => setLoading(false));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
        <TreeNode client={client} cwd={cwd} dirPath="" onPickFile={pickFile} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {!loading && !open && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            Select a file to view.
          </div>
        )}
        {!loading && open && (
          <>
            <div style={{
              padding: '6px 12px',
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              fontSize: 11,
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border)',
            }}>
              {open.path}
            </div>
            <FileViewer
              cwd={cwd}
              path={open.path}
              content={open.content}
              signedUrl={open.signedUrl}
              encoding={open.encoding}
              size={open.size}
              lang={open.lang ?? langFromPath(open.path) ?? undefined}
              mime={open.mime}
            />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/BrowseView.tsx
git commit -m "feat(remote): PWA BrowseView (lazy tree + viewer)"
```

---

## Task 16: PWA `RepoPicker.tsx` + `Files.tsx` orchestrator

**Files:**
- Create: `src/renderer-remote/files/RepoPicker.tsx`
- Create: `src/renderer-remote/files/Files.tsx`

- [ ] **Step 1: RepoPicker**

```tsx
import { Folder } from 'lucide-react';

interface Member { projectPath: string; name: string }

interface Props {
  members: Member[];
  current: string;
  onPick: (projectPath: string) => void;
}

export default function RepoPicker({ members, current, onPick }: Props) {
  if (members.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 10px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-mid)',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {members.map((m) => {
        const active = m.projectPath === current;
        return (
          <button
            key={m.projectPath}
            onClick={() => onPick(m.projectPath)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              fontSize: 12,
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#000' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            <Folder size={11} strokeWidth={2} />
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Files.tsx orchestrator**

```tsx
import { useEffect, useState } from 'react';
import type { WireClient } from '../wire';
import ChangesView from './ChangesView';
import BrowseView from './BrowseView';
import RepoPicker from './RepoPicker';

interface Props {
  client: WireClient;
  /** Active workspace path on the desktop. For plain projects this is also the cwd. */
  workspacePath: string;
  /** For meta workspaces only: the member projects. */
  metaMembers?: { projectPath: string; name: string }[];
}

type SubTab = 'changes' | 'browse';

const TAB_KEY = 'sai-remote-files-subtab';

export default function Files({ client, workspacePath, metaMembers }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as SubTab) ?? 'changes'; } catch { return 'changes'; }
  });
  const [cwd, setCwd] = useState<string>(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);

  useEffect(() => {
    // Reset cwd when active workspace changes
    setCwd(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  }, [workspacePath, metaMembers]);

  const setSub = (v: SubTab) => {
    setSubTab(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* quota */ }
  };

  const tabBtn = (v: SubTab, label: string): React.CSSProperties => ({
    flex: 1,
    padding: '6px 0',
    fontSize: 11,
    fontWeight: 600,
    background: 'transparent',
    color: subTab === v ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: `2px solid ${subTab === v ? 'var(--accent)' : 'transparent'}`,
    cursor: 'pointer',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {metaMembers && metaMembers.length > 0 && (
        <RepoPicker members={metaMembers} current={cwd} onPick={setCwd} />
      )}
      <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button style={tabBtn('changes', 'Changes')} onClick={() => setSub('changes')}>Changes</button>
        <button style={tabBtn('browse', 'Browse')} onClick={() => setSub('browse')}>Browse</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {subTab === 'changes'
          ? <ChangesView client={client} cwd={cwd} />
          : <BrowseView client={client} cwd={cwd} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/RepoPicker.tsx src/renderer-remote/files/Files.tsx
git commit -m "feat(remote): PWA Files orchestrator + RepoPicker"
```

---

## Task 17: Route Chat ↔ Files in the app shell

**Files:**
- Modify: `src/renderer-remote/App.tsx`
- Modify: `src/renderer-remote/chat/Chat.tsx`

- [ ] **Step 1: Add Tabs + tab state in App.tsx**

In `src/renderer-remote/App.tsx`, after the `phase === 'connected' && client` block, replace `<Chat client={client} />` with a wrapper that includes Tabs:

```tsx
import Tabs from './chat/Tabs';
import Files from './files/Files';
```

Find the `phase === 'connected'` render branch. Replace with:

```tsx
if (phase === 'connected' && client) {
  if (wsState !== 'open') {
    return <Status deviceLabel="" serverUrl={location.origin} wsState={wsState} onDisconnect={disconnect} />;
  }
  return <ConnectedShell client={client} />;
}
```

And add a `ConnectedShell` component above `App`:

```tsx
import { useEffect, useState as useStateInner } from 'react';

interface ShellProps { client: WireClient }
function ConnectedShell({ client }: ShellProps) {
  const [tab, setTab] = useStateInner<'chat' | 'files'>(() => {
    try { return (localStorage.getItem('sai-remote-tab') as 'chat' | 'files') ?? 'chat'; } catch { return 'chat'; }
  });
  const [workspacePath, setWorkspacePath] = useStateInner<string>('');
  const [metaMembers, setMetaMembers] = useStateInner<{ projectPath: string; name: string }[] | undefined>(undefined);

  // The Chat orchestrator already tracks `active`; we forward its updates here via a ref or a shared callback.
  // Simplest: subscribe to session.active to know what workspace the user is on.
  useEffect(() => {
    return client.on((msg) => {
      const t = (msg as any).type;
      if (t === 'session.active') setWorkspacePath((msg as any).projectPath ?? '');
      // For meta members, the Chat orchestrator already gets them via the workspace dropdown; we
      // mirror the same source by listing on tab switch.
    });
  }, [client]);

  const onTab = (v: 'chat' | 'files') => {
    setTab(v);
    try { localStorage.setItem('sai-remote-tab', v); } catch { /* quota */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Tabs value={tab} onChange={onTab} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'chat'
          ? <Chat client={client} />
          : workspacePath
            ? <Files client={client} workspacePath={workspacePath} metaMembers={metaMembers} />
            : <div style={{ padding: 16, color: 'var(--text-muted)' }}>No workspace attached.</div>}
      </div>
    </div>
  );
}
```

For meta-members lookup: when the user is on a meta workspace, we need member info. The cleanest is to fetch the workspaces list via `client.listWorkspaces` once `workspacePath` is set and check if the matching entry is `kind: 'meta'`:

```ts
useEffect(() => {
  if (!workspacePath) { setMetaMembers(undefined); return; }
  client.listWorkspaces().then((ws: any[]) => {
    const me = ws.find((w) => w.projectPath === workspacePath);
    if (me && me.kind === 'meta' && Array.isArray(me.members)) setMetaMembers(me.members);
    else setMetaMembers(undefined);
  }).catch(() => setMetaMembers(undefined));
}, [client, workspacePath]);
```

- [ ] **Step 2: tsc + PWA build**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/App.tsx
git commit -m "feat(remote): top-level Chat/Files tabs in PWA shell"
```

---

## Task 18: Integration end-to-end test

**Files:**
- Create: `tests/integration/remote/files-end-to-end.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { BlobStore } from '@electron/services/remote/blob-store';
import { safeJoin } from '@electron/services/remote/safe-join';
import { langFromPath, isTextLike, mimeFromPath } from '@electron/services/remote/lang';
import { readDirImpl, readFileImpl, readFileBufImpl, statFileImpl } from '@electron/services/fs';
import { gitStatusImpl, gitDiffImpl } from '@electron/services/git';

describe('mobile remote files end-to-end', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-files-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export const x = 1;\n');
    execSync('git init -q && git add a.ts && git -c user.email=t@t -c user.name=T commit -q -m init', { cwd: tmpRoot });
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export const x = 2;\n'); // modify after commit
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  it('list → status → diff → read round trip', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const blobStore = new BlobStore();
    let bridge: BridgeServer | null = null;

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => {
        const b = new BridgeServer({
          tailnetIp: ip, pairing, bus, pwaDir: null,
          screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
          listFiles: async (cwd, p) => {
            const entries = await readDirImpl(safeJoin(cwd, p));
            return entries.map((e) => ({ name: e.name, kind: e.type === 'directory' ? 'dir' as const : 'file' as const }));
          },
          readFile: async (cwd, p) => {
            const full = safeJoin(cwd, p);
            const stat = await statFileImpl(full);
            if (isTextLike(p) && stat.size <= 64 * 1024) {
              const content = await readFileImpl(full);
              return { content, encoding: 'text' as const, size: stat.size, lang: langFromPath(p) ?? undefined };
            }
            const id = blobStore.register(cwd, p);
            const signedUrl = b.signBlobUrl(id);
            return { signedUrl, encoding: 'binary' as const, size: stat.size, mime: mimeFromPath(p) };
          },
          statusFiles: async (cwd) => (await gitStatusImpl(cwd)).entries,
          diffFile: async (cwd, p, staged) => ({ diff: await gitDiffImpl(cwd, p, staged), lang: langFromPath(p) ?? undefined }),
          loadBlob: async (id) => {
            const e = blobStore.consume(id);
            if (!e) return null;
            return { buffer: await readFileBufImpl(safeJoin(e.cwd, e.path)), mime: mimeFromPath(e.path) };
          },
        });
        bridge = b;
        return b;
      },
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();

    // Pair + connect
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();
    const ws = new WebSocket(`${url!.replace(/^http/, 'ws')}/ws`);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const deadline = Date.now() + 3000;
    while (!inbox.find((m) => m.type === 'auth_ok') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // files.list
    ws.send(JSON.stringify({ type: 'files.list', cwd: tmpRoot, path: '', reqId: 'l1' }));
    await new Promise((r) => setTimeout(r, 80));
    const list = inbox.find((m) => m.type === 'files.list.result');
    expect(list).toBeTruthy();
    expect(list.entries.some((e: any) => e.name === 'a.ts')).toBe(true);

    // files.status
    ws.send(JSON.stringify({ type: 'files.status', cwd: tmpRoot, reqId: 's1' }));
    await new Promise((r) => setTimeout(r, 80));
    const status = inbox.find((m) => m.type === 'files.status.result');
    expect(status.entries.length).toBeGreaterThan(0);
    expect(status.entries[0].path).toBe('a.ts');

    // files.diff
    ws.send(JSON.stringify({ type: 'files.diff', cwd: tmpRoot, path: 'a.ts', staged: false, reqId: 'd1' }));
    await new Promise((r) => setTimeout(r, 80));
    const diff = inbox.find((m) => m.type === 'files.diff.result');
    expect(diff.diff).toMatch(/-export const x = 1/);
    expect(diff.diff).toMatch(/\+export const x = 2/);

    // files.read (text)
    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'a.ts', reqId: 'r1' }));
    await new Promise((r) => setTimeout(r, 80));
    const read = inbox.find((m) => m.type === 'files.read.result');
    expect(read.encoding).toBe('text');
    expect(read.content).toMatch(/export const x = 2/);

    // files.read (binary via signed URL) — write a 100KB file
    const bigPath = path.join(tmpRoot, 'big.png');
    fs.writeFileSync(bigPath, Buffer.alloc(100 * 1024, 0xab));
    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'big.png', reqId: 'r2' }));
    await new Promise((r) => setTimeout(r, 80));
    const big = inbox.filter((m) => m.type === 'files.read.result').pop();
    expect(big.encoding).toBe('binary');
    expect(big.signedUrl).toMatch(/^\/blob\//);

    // GET the signed URL → bytes back
    const blobRes = await fetch(`${url}${big.signedUrl}`);
    expect(blobRes.status).toBe(200);
    const buf = Buffer.from(await blobRes.arrayBuffer());
    expect(buf.length).toBe(100 * 1024);

    // Second GET fails (single-use)
    const blobRes2 = await fetch(`${url}${big.signedUrl}`);
    expect(blobRes2.status).toBe(401);

    ws.close();
    await remote.stop();
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:integration -- tests/integration/remote/files-end-to-end.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Full suite + commit**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit
git add tests/integration/remote/files-end-to-end.test.ts
git commit -m "test(remote): files end-to-end (list/status/diff/read/blob)"
```

---

## Task 19: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p3-smoke.md`

- [ ] **Step 1: Write**

```markdown
# Mobile Remote Phase 3 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 3 done.

## Prerequisites

- [ ] P0–P2 smoke pass (pair, chat, workspaces).
- [ ] At least one workspace open in SAI with uncommitted git changes.

## Files tab

- [ ] Tap Files at top. Sub-tabs show Changes (default) and Browse.
- [ ] Changes list shows every uncommitted file with the correct letter (M / A / D).
- [ ] Tap a modified file. Diff shows below with +/- coloring and the right code.
- [ ] Tap a staged file. Banner shows "staged"; diff is the staged diff.
- [ ] Browse tab: tap a folder — expands, lists children. Tap a `.ts` file — content renders with Shiki highlighting.
- [ ] Tap an image (e.g. `public/img/sai.png`) — image previews inline.
- [ ] Tap a binary (e.g. `node_modules/.bin/...`) — "Binary file" placeholder with "open raw" link.

## Meta workspace

- [ ] Switch to a meta workspace. RepoPicker chips appear above Changes/Browse.
- [ ] Tap a different chip. List + diff retarget to that member repo.

## Persistence

- [ ] Set Files sub-tab to Browse, reload PWA. Files opens at Browse.
- [ ] Switch top-level tab to Chat, reload PWA. Opens at Chat.

## Performance

- [ ] List a deep directory (e.g. `node_modules`). Lazy expand doesn't lock the UI.
- [ ] Open a large source file (~10K lines). Shiki render < 2s; content scrolls smoothly.
- [ ] Open a 1MB+ file. Content arrives via signedUrl; second tap after consume prompts a re-request.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p3-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 3"
```

---

## Task 20: Final sweep

- [ ] **Step 1: Run full suite + build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -5
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: all tests pass; tsc clean; PWA bundle builds.

- [ ] **Step 2: Optional tidy commit**

```bash
git add -A
git commit -m "chore(remote): final tidy after p3 verification" || true
```

---

## Done

Phase 3 is complete when:

1. All vitest unit + integration tests pass.
2. `tsc --noEmit` is clean.
3. PWA build succeeds.
4. Manual smoke walked on iPhone over Tailscale.
5. Changes view shows real modified files with correct diffs; Browse view lazy-expands and renders Shiki-highlighted code; image previews work; signed-URL single-use is verified.

Next per roadmap: **Phase 4 — Git panel** (stage/unstage/commit/push from phone) reuses `files.status` and `files.diff` from this phase.
