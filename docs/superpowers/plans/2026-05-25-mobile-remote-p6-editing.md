# Mobile Remote — Phase 6: File Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mobile PWA edit text files (≤256KB) from a plain-`<textarea>` editor and save them through a new `files.write` WS event guarded by optimistic-concurrency (mtime + sha). Read flow (P3) is unchanged; the new editor mounts in-place on the existing `FileViewer` behind an Edit button.

**Architecture:**
- `electron/services/fs.ts`: extend `readFileImpl` to return `{ content, mtime, sha }` (sha = sha256 hex prefix, 16 chars; mtime = `fs.stat().mtimeMs`). Add `writeFileImpl(cwd, relPath, content, { expectMtime, expectSha })` — 256KB cap, `safeJoin` from `./remote/safe-join`, optimistic concurrency (mtime+1ms slack OR sha mismatch → `code: 'stale'` error with `currentMtime`/`currentSha`), atomic `tmp + rename`. Both `expectMtime` and `expectSha` `null` = force-write sentinel; partial-null rejected as malformed.
- `electron/services/remote/bridge-server.ts`: extend `BridgeServerOpts.writeFile?`; route `files.write` next to `files.read`, encoding `stale` errors with `currentMtime`/`currentSha` and other errors with `code: err.code ?? 'write_failed'`. The existing `files.read` routing automatically forwards the new `mtime`/`sha` fields via the spread in `files.read.result`.
- `electron/main.ts`: wire `writeFile: (cwd, p, content, opts) => writeFileImpl(safeJoin(cwd, p), ...)`. Update the existing `readFile` callback to surface `mtime`/`sha` from `readFileImpl`.
- `src/renderer-remote/wire.ts`: extend `readFile` return type with `mtime` + `sha`; add `writeFile(cwd, path, content, expectMtime, expectSha): Promise<{ mtime, sha }>`. Handle `files.write.result` and `error` with `code === 'stale'` (typed reject carrying `currentMtime`/`currentSha`).
- PWA `src/renderer-remote/files/FileEditor.tsx` (new): `<textarea>` editor with iOS-friendly attrs, visualViewport-sized container (mirrors `Terminal.tsx`), dirty/saving/conflict state, Save + Cancel + conflict sheet (Overwrite / Reload / Keep editing) + dirty-discard confirm.
- PWA `src/renderer-remote/files/FileViewer.tsx`: Edit button visible when `encoding === 'text' && size <= 256 * 1024 && !signedUrl`. Tap → `setMode('edit')` mounts `<FileEditor>` in place of the Shiki view; `onSave` refetches the file then swaps back; `onCancel` swaps back.

**Tech Stack:** TypeScript, `node:crypto` (createHash), `node:fs/promises` (writeFile/rename/stat), `ws`, vitest, React (no new deps; Monaco/Shiki untouched).

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p6-editing-design.md`. **Branch:** `feat/mobile-remote-p6` off `main`.

---

## Pre-flight notes

- `safeJoin` lives in `electron/services/remote/safe-join.ts` (NOT inside `fs.ts` despite the spec's prose). Import it explicitly in `fs.ts` for `writeFileImpl` and reference it from `main.ts` for the `writeFile` callback wiring.
- `isTextLike` and `mimeFromPath` already gate inline reads at 64KB in `main.ts`. The 256KB edit cap is **separate** from the 64KB inline-read cap — files in the 64KB–256KB range come back as `binary` with a `signedUrl` and therefore the client-side `signedUrl` check correctly hides the Edit button. The cap that matters for `writeFileImpl` is **256KB** on the *uploaded content*.
- vitest alias `@electron/*` works for static imports (used by all existing unit tests). Avoid runtime `require('@electron/...')`.
- Tests use the `vi.hoisted` stub pattern; do not introduce `__ptyStub`/`__fsStub` globals. Mirror `tests/unit/remote/terminal-store.test.ts`.
- `fs.rename` is atomic on POSIX (the only target SAI ships). Windows quirks are out of scope (matches existing git tooling caveat in spec §Risk areas).
- The 64-bit (16-hex) sha prefix is collision-safe for single-file history; do not lengthen.
- All commits use Conventional Commits, scope `remote` or `fs`.

---

## File structure

**New:**
- `src/renderer-remote/files/FileEditor.tsx`
- `tests/unit/fs/writeFileImpl.test.ts`
- `tests/unit/remote/bridge-server-files-write.test.ts`
- `tests/integration/remote/files-write-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md`

**Modified (Electron):**
- `electron/services/fs.ts` — `readFileImpl` returns `{ content, mtime, sha }`; new `writeFileImpl`.
- `electron/services/remote/bridge-server.ts` — `writeFile` opt + `files.write` routing arm.
- `electron/main.ts` — wire `writeFile`; thread `mtime`/`sha` through the existing `readFile` callback.

**Modified (PWA):**
- `src/renderer-remote/wire.ts` — `readFile` return type adds `mtime`/`sha`; new `writeFile` helper.
- `src/renderer-remote/files/FileViewer.tsx` — Edit button + mode swap to `<FileEditor>`.

**Modified (docs):**
- `docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md` — phase-6 manual smoke list (new file under the notes dir).

---

## Task 1: Branch from main

**Files:** none (verification)

- [ ] **Step 1: Branch**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
git fetch origin
git checkout -B feat/mobile-remote-p6 origin/main
```

Expected: clean working tree, new branch tracks `main`. If `main` does not yet contain P5.1, branch from whichever ref the user designates and plan to rebase later.

- [ ] **Step 2: Sanity-check the static surface that this phase extends**

```bash
npx tsc --noEmit
npx vitest run tests/unit/remote/bridge-server-files.test.ts tests/integration/remote/files-end-to-end.test.ts
```

Expected: tsc clean; both file suites green. We need a known-good baseline before we extend `readFile`.

---

## Task 2: fs.ts — extend `readFileImpl` to return `{ content, mtime, sha }`

**Files:**
- Modify: `electron/services/fs.ts`
- Create: `tests/unit/fs/readFileImpl-meta.test.ts`

The existing `readFileImpl(filePath)` returns a bare string. Existing call sites that still want the string (IPC handler, `fs:readFile`, the renderer fs-tree) need to keep working. The cleanest move is to *add* `mtime` + `sha` as additional fields and migrate the caller in `electron/main.ts`. The IPC handler keeps reading the string directly for backward compat.

- [ ] **Step 1: Failing test for the new shape**

Create `tests/unit/fs/readFileImpl-meta.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileImpl } from '@electron/services/fs';

describe('readFileImpl meta', () => {
  let tmp: string;
  let target: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-rfi-meta-'));
    target = path.join(tmp, 'a.txt');
    fs.writeFileSync(target, 'hello\n', 'utf-8');
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns content + mtime + sha', async () => {
    const r = await readFileImpl(target);
    expect(typeof r).toBe('object');
    const obj = r as unknown as { content: string; mtime: number; sha: string };
    expect(obj.content).toBe('hello\n');
    expect(obj.mtime).toBeGreaterThan(0);
    expect(obj.sha).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/fs/readFileImpl-meta.test.ts
```

Expected: failure — `r` is currently a string.

- [ ] **Step 3: Implement**

In `electron/services/fs.ts`:

```ts
// Near the top of the file, add:
import { createHash } from 'node:crypto';

function fileSha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}
```

Replace `readFileImpl` with the object-returning shape. Keep the `ipcMain.handle('fs:readFile', ...)` handler returning only the string so the desktop renderer's call sites (`window.electron.fs.readFile(...)`) don't break:

```ts
export interface ReadFileResult { content: string; mtime: number; sha: string }

export async function readFileImpl(filePath: string): Promise<ReadFileResult> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const st = await fs.promises.stat(filePath);
  return { content, mtime: st.mtimeMs, sha: fileSha(content) };
}
```

And update the IPC handler so the desktop wire still gets a string:

```ts
ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
  const r = await readFileImpl(filePath);
  return r.content;
});
```

- [ ] **Step 4: Update the only TypeScript caller of `readFileImpl` that consumed the string directly**

The remote bridge `readFile` callback in `electron/main.ts` reads `content` from `readFileImpl`:

```ts
// Before (electron/main.ts ~L196):
const content = await readFileImpl(full);
return { content, encoding: 'text' as const, size: stat.size, lang };

// After:
const r = await readFileImpl(full);
return { content: r.content, encoding: 'text' as const, size: stat.size, lang, mtime: r.mtime, sha: r.sha };
```

Also check `tests/integration/remote/files-end-to-end.test.ts` which has its own inline `readFile` callback that calls `readFileImpl(full)` then spreads `content`. Update it the same way so the existing integration suite still passes:

```ts
// In files-end-to-end.test.ts ~L48 (the inline readFile in makeBridge):
if (isTextLike(p) && stat.size <= 64 * 1024) {
  const r = await readFileImpl(full);
  return { content: r.content, encoding: 'text' as const, size: stat.size, lang: langFromPath(p) ?? undefined, mtime: r.mtime, sha: r.sha };
}
```

(Adding `mtime`/`sha` doesn't break this suite's assertions — they only check `encoding` and `content`.)

- [ ] **Step 5: Run**

```bash
npx vitest run tests/unit/fs/readFileImpl-meta.test.ts
npx vitest run tests/integration/remote/files-end-to-end.test.ts tests/unit/remote/bridge-server-files.test.ts
npx tsc --noEmit
```

Expected: new test green; both pre-existing suites still green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/fs.ts electron/main.ts tests/unit/fs/readFileImpl-meta.test.ts tests/integration/remote/files-end-to-end.test.ts
git commit -m "feat(fs): readFileImpl returns content+mtime+sha"
```

---

## Task 3: fs.ts — add `writeFileImpl` with optimistic concurrency

**Files:**
- Modify: `electron/services/fs.ts`
- Create: `tests/unit/fs/writeFileImpl.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/fs/writeFileImpl.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileImpl, writeFileImpl } from '@electron/services/fs';

describe('writeFileImpl', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-wfi-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writes a new file and returns mtime+sha matching readFileImpl', async () => {
    const r = await writeFileImpl(tmp, 'a.txt', 'hello\n', { expectMtime: null, expectSha: null });
    expect(r.sha).toMatch(/^[0-9a-f]{16}$/);
    const rr = await readFileImpl(path.join(tmp, 'a.txt'));
    expect(rr.content).toBe('hello\n');
    expect(rr.sha).toBe(r.sha);
    expect(Math.abs(rr.mtime - r.mtime)).toBeLessThanOrEqual(2);
  });

  it('overwrites existing file when expects match (round-trip read → write)', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    const w = await writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('two\n');
    expect(w.sha).not.toBe(r.sha);
  });

  it('rejects with code=stale when current sha differs from expectSha', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    // Mutate the file behind our back.
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'three\n');
    await expect(
      writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha }),
    ).rejects.toMatchObject({ code: 'stale', currentSha: expect.stringMatching(/^[0-9a-f]{16}$/) });
    // Original file untouched.
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('three\n');
  });

  it('rejects with code=stale when mtime jumped past +1ms slack', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const r = await readFileImpl(path.join(tmp, 'a.txt'));
    // Force mtime far into the future via utimes; content (and therefore sha) stays.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(tmp, 'a.txt'), future, future);
    await expect(
      writeFileImpl(tmp, 'a.txt', 'two\n', { expectMtime: r.mtime, expectSha: r.sha }),
    ).rejects.toMatchObject({ code: 'stale' });
  });

  it('force-writes when both expects are null (bypasses stale check)', async () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    const w = await writeFileImpl(tmp, 'a.txt', 'forced\n', { expectMtime: null, expectSha: null });
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf-8')).toBe('forced\n');
    expect(w.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects content > 256KB with code=too_large', async () => {
    const huge = 'x'.repeat(256 * 1024 + 1);
    await expect(
      writeFileImpl(tmp, 'a.txt', huge, { expectMtime: null, expectSha: null }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(fs.existsSync(path.join(tmp, 'a.txt'))).toBe(false);
  });

  it('rejects path traversal via safeJoin', async () => {
    await expect(
      writeFileImpl(tmp, '../escape.txt', 'no', { expectMtime: null, expectSha: null }),
    ).rejects.toThrow(/escapes|absolute/i);
  });

  it('treats missing target with enforced expects as stale (desktop deleted it)', async () => {
    await expect(
      writeFileImpl(tmp, 'gone.txt', 'data', { expectMtime: 1, expectSha: 'aaaaaaaaaaaaaaaa' }),
    ).rejects.toMatchObject({ code: 'stale' });
  });

  it('uses tmp + rename (no partial file visible on failed rename)', async () => {
    // We can't simulate rename failure portably, so just sanity-check no .tmp files
    // are left behind on the happy path.
    await writeFileImpl(tmp, 'a.txt', 'ok\n', { expectMtime: null, expectSha: null });
    const leftovers = fs.readdirSync(tmp).filter((n) => n.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/fs/writeFileImpl.test.ts
```

Expected: all 9 tests fail (export missing).

- [ ] **Step 3: Implement**

In `electron/services/fs.ts`, add the import at the top:

```ts
import { safeJoin } from './remote/safe-join';
```

(`fs` is already imported.) Append after `readFileImpl`:

```ts
const WRITE_MAX_BYTES = 256 * 1024;

export interface WriteFileExpects { expectMtime: number | null; expectSha: string | null }
export interface WriteFileResult { mtime: number; sha: string }

export async function writeFileImpl(
  cwd: string,
  relPath: string,
  content: string,
  opts: WriteFileExpects,
): Promise<WriteFileResult> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_MAX_BYTES) {
    throw Object.assign(new Error('file too large for phone edit'), { code: 'too_large' });
  }
  const target = safeJoin(cwd, relPath);

  const enforce = opts.expectMtime !== null && opts.expectSha !== null;
  if (enforce) {
    try {
      const st = await fs.promises.stat(target);
      const curMtime = st.mtimeMs;
      const curContent = await fs.promises.readFile(target, 'utf-8');
      const curSha = fileSha(curContent);
      if (curMtime > opts.expectMtime! + 1 || curSha !== opts.expectSha) {
        throw Object.assign(new Error('file changed since fetch'), {
          code: 'stale', currentMtime: curMtime, currentSha: curSha,
        });
      }
    } catch (err: any) {
      if (err && err.code === 'stale') throw err;
      if (err && err.code === 'ENOENT') {
        throw Object.assign(new Error('file deleted'), {
          code: 'stale', currentMtime: 0, currentSha: '',
        });
      }
      throw err;
    }
  }

  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.promises.writeFile(tmp, content, 'utf-8');
  await fs.promises.rename(tmp, target);
  const st = await fs.promises.stat(target);
  return { mtime: st.mtimeMs, sha: fileSha(content) };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/fs/writeFileImpl.test.ts
npx tsc --noEmit
```

Expected: 9/9 green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/fs.ts tests/unit/fs/writeFileImpl.test.ts
git commit -m "feat(fs): writeFileImpl with optimistic mtime+sha concurrency"
```

---

## Task 4: bridge-server.ts — add `writeFile` opt + `files.write` routing

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Modify: `tests/unit/remote/bridge-server-files.test.ts` (or create a sibling file — see Step 1)
- Create: `tests/unit/remote/bridge-server-files-write.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/bridge-server-files-write.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
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

function baseOpts(extra: any) {
  return {
    tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
    pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    ...extra,
  };
}

describe('BridgeServer files.write routing', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('happy path: forwards to writeFile and returns mtime+sha', async () => {
    const writeFile = vi.fn().mockResolvedValue({ mtime: 1234, sha: 'aaaaaaaaaaaaaaaa' });
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: 1000, expectSha: 'bbbbbbbbbbbbbbbb', reqId: 'w1',
    }));
    const m = await once(ws, (m) => m.type === 'files.write.result');
    expect(m.reqId).toBe('w1');
    expect(m.mtime).toBe(1234);
    expect(m.sha).toBe('aaaaaaaaaaaaaaaa');
    expect(writeFile).toHaveBeenCalledWith('/repo', 'a.txt', 'hi',
      { expectMtime: 1000, expectSha: 'bbbbbbbbbbbbbbbb' });
    ws.close();
  });

  it('stale error is encoded with currentMtime + currentSha', async () => {
    const writeFile = vi.fn().mockRejectedValue(Object.assign(new Error('file changed since fetch'),
      { code: 'stale', currentMtime: 9999, currentSha: 'cccccccccccccccc' }));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: 1, expectSha: 'aaaaaaaaaaaaaaaa', reqId: 'w2',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('w2');
    expect(m.code).toBe('stale');
    expect(m.currentMtime).toBe(9999);
    expect(m.currentSha).toBe('cccccccccccccccc');
    ws.close();
  });

  it('force-write passes both nulls through to writeFile', async () => {
    const writeFile = vi.fn().mockResolvedValue({ mtime: 1, sha: 'dddddddddddddddd' });
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: null, expectSha: null, reqId: 'w3',
    }));
    await once(ws, (m) => m.type === 'files.write.result');
    expect(writeFile).toHaveBeenCalledWith('/repo', 'a.txt', 'hi',
      { expectMtime: null, expectSha: null });
    ws.close();
  });

  it('too_large error encodes the code field', async () => {
    const writeFile = vi.fn().mockRejectedValue(Object.assign(new Error('too large'), { code: 'too_large' }));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w4',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('too_large');
    ws.close();
  });

  it('traversal error from writeFile is forwarded as write_failed', async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error('path escapes cwd: ../bad'));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: '../bad', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w5',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('write_failed');
    expect(m.message).toMatch(/escapes/);
    ws.close();
  });

  it('missing writeFile callback returns code=unsupported', async () => {
    server = new BridgeServer(baseOpts({}));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w6',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('unsupported');
    ws.close();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/bridge-server-files-write.test.ts
```

Expected: all 6 fail (no routing arm yet).

- [ ] **Step 3: Implement**

In `electron/services/remote/bridge-server.ts`, add to `BridgeServerOpts` (next to `readFile?`):

```ts
writeFile?: (cwd: string, path: string, content: string,
             opts: { expectMtime: number | null; expectSha: string | null })
            => Promise<{ mtime: number; sha: string }>;
```

In `handleWs` add the routing arm just below the existing `files.read` block:

```ts
if (msg.type === 'files.write' && typeof msg.cwd === 'string' && typeof msg.path === 'string'
    && typeof msg.content === 'string') {
  const reqId = msg.reqId;
  if (!this.opts.writeFile) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'unsupported', message: 'writes disabled' }));
    return;
  }
  const expectMtime = typeof msg.expectMtime === 'number' ? msg.expectMtime : null;
  const expectSha   = typeof msg.expectSha   === 'string' ? msg.expectSha   : null;
  try {
    const { mtime, sha } = await this.opts.writeFile(
      msg.cwd, msg.path, msg.content, { expectMtime, expectSha },
    );
    ws.send(JSON.stringify({ v: 1, type: 'files.write.result', reqId, mtime, sha }));
  } catch (err: any) {
    if (err?.code === 'stale') {
      ws.send(JSON.stringify({
        v: 1, type: 'error', reqId, code: 'stale', message: String(err.message ?? 'stale'),
        currentMtime: err.currentMtime ?? 0, currentSha: err.currentSha ?? '',
      }));
    } else {
      ws.send(JSON.stringify({
        v: 1, type: 'error', reqId,
        code: err?.code ?? 'write_failed',
        message: String(err?.message ?? err),
      }));
    }
  }
  return;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/bridge-server-files-write.test.ts tests/unit/remote/bridge-server-files.test.ts
npx tsc --noEmit
```

Expected: 6 new + previous file routing tests all green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-files-write.test.ts
git commit -m "feat(remote): files.write routing with stale + force semantics"
```

---

## Task 5: main.ts — wire the `writeFile` callback

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add the import**

In `electron/main.ts`, extend the existing `fs` services import:

```ts
import { readDirImpl, readFileImpl, readFileBufImpl, statFileImpl, writeFileImpl } from './services/fs';
```

- [ ] **Step 2: Wire the bridge opt**

Inside the `makeBridge` block (next to `readFile`, `stageFile`, etc.):

```ts
writeFile: (cwd, p, content, opts) => writeFileImpl(cwd, p, content, opts),
```

`writeFileImpl` already calls `safeJoin(cwd, relPath)` internally, so pass `cwd` and `p` raw.

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: clean. No new test needed for this wiring — Task 6's integration test exercises it via the bridge.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(remote): wire writeFile bridge callback"
```

---

## Task 6: wire.ts — extend `readFile` return type + add `writeFile` helper

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend the `WireClient` interface**

```ts
readFile(cwd: string, path: string): Promise<{
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
  mtime?: number;
  sha?: string;
}>;
writeFile(cwd: string, path: string, content: string,
          expectMtime: number | null, expectSha: string | null
): Promise<{ mtime: number; sha: string }>;
```

Add a typed error shape so the editor can disambiguate stale conflicts without parsing message text:

```ts
export interface WriteStaleError extends Error {
  code: 'stale';
  currentMtime: number;
  currentSha: string;
}
export function isWriteStaleError(e: unknown): e is WriteStaleError {
  return !!e && typeof e === 'object' && (e as any).code === 'stale';
}
```

- [ ] **Step 2: Extend the response-dispatch switch**

In the `handlers.add((msg) => { ... })` block, add a branch for `files.write.result` and special-case the `error` branch when `code === 'stale'`:

```ts
} else if (t === 'files.write.result') {
  entry.resolve({ mtime: (msg as any).mtime, sha: (msg as any).sha });
}
```

And replace the existing `if (t === 'error')` body with:

```ts
if (t === 'error') {
  const code = (msg as any).code;
  if (code === 'stale') {
    const e = Object.assign(new Error(String((msg as any).message ?? 'stale')), {
      code: 'stale' as const,
      currentMtime: (msg as any).currentMtime ?? 0,
      currentSha: (msg as any).currentSha ?? '',
    });
    entry.reject(e);
  } else {
    const e: any = new Error(String((msg as any).message ?? 'error'));
    if (code) e.code = code;
    entry.reject(e);
  }
}
```

- [ ] **Step 3: Implement the `writeFile` send-side**

Add inside the `return { ... }` object next to `readFile`:

```ts
writeFile: (cwd, path, content, expectMtime, expectSha) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('files.write timeout')); }, 10_000);
  sendFrame({ type: 'files.write', cwd, path, content, expectMtime, expectSha, reqId });
}),
```

- [ ] **Step 4: tsc**

```bash
npx tsc --noEmit
```

Expected: clean. No new unit test for `wire.ts` — the helper is exercised by the integration test in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): wire.writeFile + typed stale-conflict reject"
```

---

## Task 7: Integration — files.write end-to-end with real fs

**Files:**
- Create: `tests/integration/remote/files-write-end-to-end.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/integration/remote/files-write-end-to-end.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { safeJoin } from '@electron/services/remote/safe-join';
import { langFromPath, isTextLike } from '@electron/services/remote/lang';
import { readFileImpl, statFileImpl, writeFileImpl } from '@electron/services/fs';

describe('mobile remote files.write end-to-end', () => {
  let tmpRoot: string;
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-files-write-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'one\n');
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  it('read → write happy path, then concurrent modify → stale → force-write', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        readFile: async (cwd, p) => {
          const full = safeJoin(cwd, p);
          const stat = await statFileImpl(full);
          if (isTextLike(p) && stat.size <= 64 * 1024) {
            const r = await readFileImpl(full);
            return { content: r.content, encoding: 'text' as const, size: stat.size,
                     lang: langFromPath(p) ?? undefined, mtime: r.mtime, sha: r.sha };
          }
          return { encoding: 'binary' as const, size: stat.size };
        },
        writeFile: (cwd, p, content, opts) => writeFileImpl(cwd, p, content, opts),
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();

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

    // 1. Read.
    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'a.txt', reqId: 'r1' }));
    await new Promise((r) => setTimeout(r, 100));
    const read = inbox.find((m) => m.type === 'files.read.result');
    expect(read.content).toBe('one\n');
    expect(typeof read.mtime).toBe('number');
    expect(read.sha).toMatch(/^[0-9a-f]{16}$/);

    // 2. Happy-path write.
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'two\n',
      expectMtime: read.mtime, expectSha: read.sha, reqId: 'w1',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w1 = inbox.find((m) => m.type === 'files.write.result' && m.reqId === 'w1');
    expect(w1).toBeTruthy();
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('two\n');

    // 3. Concurrent desktop edit, then phone tries to save with the post-w1 mtime/sha.
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'desktop\n');
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'phone\n',
      expectMtime: w1.mtime, expectSha: w1.sha, reqId: 'w2',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w2 = inbox.find((m) => m.type === 'error' && m.reqId === 'w2');
    expect(w2.code).toBe('stale');
    expect(w2.currentSha).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('desktop\n');

    // 4. Force-write succeeds.
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'phone\n',
      expectMtime: null, expectSha: null, reqId: 'w3',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w3 = inbox.find((m) => m.type === 'files.write.result' && m.reqId === 'w3');
    expect(w3).toBeTruthy();
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('phone\n');

    ws.close();
    await remote.stop();
  });
});
```

- [ ] **Step 2: Run — expect pass**

The implementation already lives in earlier tasks; this test just glues real fs + bridge together.

```bash
npx vitest run tests/integration/remote/files-write-end-to-end.test.ts
npx tsc --noEmit
```

Expected: green; tsc clean.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote/files-write-end-to-end.test.ts
git commit -m "test(remote): files.write end-to-end happy + stale + force"
```

---

## Task 8: PWA — `FileEditor.tsx` skeleton (textarea + header + viewport sizing)

**Files:**
- Create: `src/renderer-remote/files/FileEditor.tsx`

This task lands the static layout, dirty tracking, and visualViewport sizing — but `Save` is a no-op stub. The save flow (Task 9), conflict prompt (Task 10), and cancel confirm (Task 11) build on top.

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { WireClient } from '../wire';

interface Props {
  client: WireClient;
  cwd: string;
  path: string;
  initialContent: string;
  initialMtime: number;
  initialSha: string;
  onSave: (meta: { mtime: number; sha: string }) => void;
  onCancel: () => void;
}

export default function FileEditor(props: Props) {
  const { path, initialContent } = props;
  const [content, setContent] = useState(initialContent);
  const dirty = useMemo(() => content !== initialContent, [content, initialContent]);

  // iOS PWA: track visualViewport so the editor shrinks above the keyboard.
  const [viewportH, setViewportH] = useState<number | null>(() =>
    typeof window !== 'undefined' && (window as any).visualViewport
      ? (window as any).visualViewport.height : null,
  );
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) return;
    const onResize = () => setViewportH(vv.height);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: viewportH ? `${viewportH}px` : '100%',
      maxHeight: viewportH ? `${viewportH}px` : '100%',
      minHeight: 0,
      background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 12px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={() => props.onCancel()}
          style={{ padding: '6px 10px', background: 'transparent', color: 'var(--text)',
                   border: 'none', cursor: 'pointer', fontSize: 14 }}
        >Cancel</button>
        <div style={{
          flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{path}</div>
        <button
          disabled={!dirty}
          onClick={() => { /* wired in Task 9 */ }}
          style={{
            padding: '6px 12px',
            background: dirty ? 'var(--accent)' : 'var(--bg-elevated)',
            color: dirty ? '#000' : 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 6, cursor: dirty ? 'pointer' : 'not-allowed',
            fontSize: 14,
          }}
        >Save</button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="text"
        wrap="off"
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          padding: 12,
          background: 'var(--bg-input)',
          color: 'var(--text)',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          tabSize: 2,
          whiteSpace: 'pre',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/files/FileEditor.tsx
git commit -m "feat(remote): FileEditor skeleton (textarea + header + viewport sizing)"
```

---

## Task 9: FileEditor — save flow

**Files:**
- Modify: `src/renderer-remote/files/FileEditor.tsx`

- [ ] **Step 1: Track mtime/sha + add save handler**

Replace the header section's `<button onClick={...}>Save</button>` no-op with a real handler. Add at the top of the component body:

```ts
const [mtime, setMtime] = useState(props.initialMtime);
const [sha, setSha] = useState(props.initialSha);
const [saving, setSaving] = useState(false);
const [error, setError] = useState<string | null>(null);

async function doSave(force = false) {
  setSaving(true); setError(null);
  try {
    const result = await props.client.writeFile(
      props.cwd, props.path, content,
      force ? null : mtime,
      force ? null : sha,
    );
    setMtime(result.mtime);
    setSha(result.sha);
    setSaving(false);
    props.onSave(result);
  } catch (err: any) {
    setSaving(false);
    // Stale handling lands in Task 10; for now surface a generic error.
    setError(String(err?.message ?? err));
  }
}
```

Update the Save button:

```tsx
<button
  disabled={!dirty || saving}
  onClick={() => { void doSave(false); }}
  ...
>{saving ? 'Saving…' : 'Save'}</button>
```

And render the error toast below the textarea:

```tsx
{error && (
  <div style={{
    padding: '8px 12px',
    background: 'var(--bg-elevated)', color: 'var(--red, #f88)',
    borderTop: '1px solid var(--border)', fontSize: 12,
  }}>{error}</div>
)}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean. Manual smoke happens in Task 13.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/files/FileEditor.tsx
git commit -m "feat(remote): FileEditor save flow via wire.writeFile"
```

---

## Task 10: FileEditor — conflict prompt (Overwrite / Reload / Keep editing)

**Files:**
- Modify: `src/renderer-remote/files/FileEditor.tsx`

- [ ] **Step 1: Add conflict state + sheet**

Import the type guard:

```ts
import type { WireClient } from '../wire';
import { isWriteStaleError } from '../wire';
```

Add state next to `error`:

```ts
const [conflict, setConflict] = useState<null | { currentMtime: number; currentSha: string }>(null);
```

In the `catch` of `doSave`, branch on stale:

```ts
} catch (err: any) {
  setSaving(false);
  if (isWriteStaleError(err)) {
    setConflict({ currentMtime: err.currentMtime, currentSha: err.currentSha });
    return;
  }
  setError(String(err?.message ?? err));
}
```

Add the conflict actions:

```ts
async function doReload(force = false) {
  if (dirty && !force) {
    if (!confirm('Reloading will discard your unsaved edits. Continue?')) return;
  }
  setConflict(null);
  try {
    const r = await props.client.readFile(props.cwd, props.path);
    if (r.encoding !== 'text' || typeof r.content !== 'string') {
      setError('file is no longer text-editable');
      return;
    }
    setContent(r.content);
    if (typeof r.mtime === 'number') setMtime(r.mtime);
    if (typeof r.sha === 'string') setSha(r.sha);
  } catch (err: any) {
    setError(String(err?.message ?? err));
  }
}
```

Render the sheet below the textarea (above the error toast):

```tsx
{conflict && (
  <div style={{
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'flex-end',
    zIndex: 10,
  }} onClick={() => setConflict(null)}>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', padding: 16,
        background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--text)' }}>
        This file changed on the desktop since you opened it.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => { setConflict(null); void doSave(true); }}
          style={{ padding: '8px 12px', background: 'var(--accent)', color: '#000',
                   border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >Overwrite</button>
        <button
          onClick={() => { void doReload(false); }}
          style={{ padding: '8px 12px', background: 'var(--bg-elevated)', color: 'var(--text)',
                   border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
        >Reload</button>
        <button
          onClick={() => setConflict(null)}
          style={{ padding: '8px 12px', background: 'transparent', color: 'var(--text-muted)',
                   border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
        >Keep editing</button>
      </div>
    </div>
  </div>
)}
```

Wrap the outer `<div>` with `position: 'relative'` so the sheet's absolute overlay anchors to the editor:

```tsx
<div style={{ position: 'relative', display: 'flex', /* ...existing... */ }}>
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/files/FileEditor.tsx
git commit -m "feat(remote): FileEditor conflict sheet (overwrite/reload/keep)"
```

---

## Task 11: FileEditor — cancel + dirty-discard confirm

**Files:**
- Modify: `src/renderer-remote/files/FileEditor.tsx`

- [ ] **Step 1: Guard Cancel**

Replace the Cancel button's handler:

```tsx
<button
  onClick={() => {
    if (dirty) {
      if (!confirm('Discard your changes?')) return;
    }
    props.onCancel();
  }}
  ...
>Cancel</button>
```

This uses `window.confirm` for v1 — it matches the iOS native modal styling and dodges another piece of overlay infra. A native sheet can replace it later if smoke testing finds it disruptive.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/files/FileEditor.tsx
git commit -m "feat(remote): FileEditor cancel dirty-discard confirm"
```

---

## Task 12: FileViewer integration — Edit button + mode swap

**Files:**
- Modify: `src/renderer-remote/files/FileViewer.tsx`

- [ ] **Step 1: Add Edit mode + button**

`FileViewer.tsx` currently doesn't receive a `client` or `cwd`. Look at the call site in `src/renderer-remote/files/` (the page wiring) and thread them in alongside the existing `path`. The viewer also needs to know how to refetch on save success.

Update the Props:

```ts
import { useEffect, useState } from 'react';
import { highlightToHtml } from './shiki';
import { isImage } from './lang';
import type { WireClient } from '../wire';
import FileEditor from './FileEditor';

interface Props {
  client: WireClient;
  cwd: string;
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
  mtime?: number;
  sha?: string;
  /** Re-fetch from the bridge and replace the current viewer state. Called after a successful save. */
  onRefetch?: () => void;
}
```

Add mode state at the top of the component:

```ts
const [mode, setMode] = useState<'view' | 'edit'>('view');
```

The eligibility predicate:

```ts
const editable = encoding === 'text' && size <= 256 * 1024 && !signedUrl
  && typeof content === 'string' && typeof props.mtime === 'number' && typeof props.sha === 'string';
```

(The `mtime`/`sha` checks defend against an older bridge that doesn't ship the new fields yet — the button stays hidden in that case rather than crashing on save.)

Render the editor when `mode === 'edit'`:

```tsx
if (mode === 'edit' && editable) {
  return (
    <FileEditor
      client={props.client}
      cwd={props.cwd}
      path={props.path}
      initialContent={content!}
      initialMtime={props.mtime!}
      initialSha={props.sha!}
      onSave={() => { setMode('view'); props.onRefetch?.(); }}
      onCancel={() => setMode('view')}
    />
  );
}
```

Add an Edit button above the highlighted content (only in text-view mode, when eligible). The simplest spot is wrapping the existing highlighted `<div>` in a column flex container:

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
    {editable && (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setMode('edit')}
          style={{ padding: '4px 10px', background: 'var(--bg-elevated)', color: 'var(--text)',
                   border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
        >Edit</button>
      </div>
    )}
    <div
      style={{ /* …existing block… without the outer 12px padding which moves to the wrapper */ }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  </div>
);
```

(Adjust the existing inline padding to avoid double-wrapping.)

- [ ] **Step 2: Thread `client`/`cwd`/`mtime`/`sha`/`onRefetch` from the parent**

Find the `FileViewer` mount in `src/renderer-remote/files/` (the page or panel that drives it). Update the JSX to pass:

```tsx
<FileViewer
  client={client}
  cwd={cwd}
  path={path}
  content={read.content}
  signedUrl={read.signedUrl}
  encoding={read.encoding}
  size={read.size}
  lang={read.lang}
  mime={read.mime}
  mtime={read.mtime}
  sha={read.sha}
  onRefetch={refetch}
/>
```

If the call site already abstracts the read into a hook, just make sure it re-runs the same read on `refetch()` and feeds the fresh `mtime`/`sha`.

- [ ] **Step 3: tsc + suite**

```bash
npx tsc --noEmit
npx vitest run tests/integration/remote/files-end-to-end.test.ts tests/integration/remote/files-write-end-to-end.test.ts
```

Expected: tsc clean; both integration suites still green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/files/FileViewer.tsx src/renderer-remote/files/
git commit -m "feat(remote): FileViewer Edit button + mode swap to FileEditor"
```

---

## Task 13: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Mobile Remote — Phase 6 manual smoke

Real iPhone + paired SAI session.

- [ ] Open a markdown file via Files. Edit button visible. Tap → editor mounts with content.
- [ ] Type a line. Save button enables. Tap Save. Editor closes, viewer shows new content.
- [ ] Re-open from Files (fresh read). Content persists.
- [ ] Open a 200-line config file. Scroll. Cursor smooth, no jitter.
- [ ] Concurrent edit: phone has file open; desktop edits and saves the same file. Tap phone Save → conflict sheet appears.
  - [ ] Overwrite: desktop reflects phone content on next read.
  - [ ] Reload: editor shows desktop content; if dirty, confirm prompt fires first.
  - [ ] Keep editing: sheet dismisses, no write.
- [ ] Open a binary file (e.g. PNG) via Files: NO Edit button.
- [ ] Open a >256KB text file: NO Edit button (file comes back as binary via the 64KB inline cap → already excluded). Confirm a 300KB JSON falls into this bucket.
- [ ] iOS keyboard show: textarea shrinks above the keyboard, Save remains reachable.
- [ ] Cancel with dirty buffer: confirm prompt → Discard returns to viewer; Keep stays in editor.
- [ ] WS drop during save: toast appears with error message; reconnect; retry succeeds.
- [ ] No regression in P3 (Files browse), P4 (git), P5/P5.1 (terminals).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 6"
```

---

## Task 14: Final sweep — tsc, full vitest, PWA build

**Files:** none (verification)

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 2: Full vitest suite**

```bash
npx vitest run 2>&1 | tail -40
```

Expected: all green. Key suites to verify in the tail summary:
- `tests/unit/fs/readFileImpl-meta.test.ts`
- `tests/unit/fs/writeFileImpl.test.ts`
- `tests/unit/remote/bridge-server-files.test.ts`
- `tests/unit/remote/bridge-server-files-write.test.ts`
- `tests/integration/remote/files-end-to-end.test.ts`
- `tests/integration/remote/files-write-end-to-end.test.ts`

- [ ] **Step 3: PWA build**

```bash
npm run build:pwa 2>&1 | tail -20
```

Expected: build completes, no TS or bundling errors.

- [ ] **Step 4: Status check**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected: clean tree, ~14 commits on `feat/mobile-remote-p6`, all using `feat(remote|fs)` or `test(remote)` or `docs(remote)` scopes.

No commit here — this is verification only. If anything is red, fix in a follow-up task before opening the PR.
