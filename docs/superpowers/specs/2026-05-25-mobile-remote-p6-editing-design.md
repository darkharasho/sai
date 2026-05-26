# Mobile Remote — Phase 6: File Editing — Design

**Status:** Approved (2026-05-25).
**Depends on:** P0–P5.1 merged.
**Scope:** Edit text files from the phone via a plain-textarea editor (no Monaco), save through a new `files.write` WS event with optimistic-concurrency guards. Read flow unchanged.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| Q1 | **Light editor: `<textarea>` + plain monospace** (no Monaco, no Shiki overlay) | Monaco is ~3MB and notoriously rough on iOS Safari; xterm-on-iOS in P5 cost a full afternoon of patching. Phone editing is for quick tweaks (typos, READMEs, configs), not real coding. A focused textarea is 5% of the work and covers 90% of the perceived value. Read mode keeps Shiki. |
| Q2 | **Optimistic concurrency via mtime+sha** | Standard If-Match etag pattern. Last-write-wins silently clobbers desktop edits; force-fetch is the same UX as B with worse defaults. B handles the realistic case (desktop autosaved while phone was open). |
| Q3 | **Edit button on FileViewer header** (view-first → edit-mode in same view) | Matches desktop mental model (click-to-view, click-to-edit). Lazy: the editor module only mounts when user opts in. Clean point to gate by file type. |
| Q4 | **Phone edits always allowed**, not gated by remote permMode clamp | The clamp is for AI agents going off-rails autonomously. A human typing edits and tapping Save IS the supervisor — that's a different threat model. Lost-phone risk is handled by token revocation in Settings. |
| Q5 | **256 KB cap on editable files** | iOS Safari starts choking on textarea inputs >100K chars (cursor jitter, paste lag). 256KB covers ~99% of source/config/markdown; oversized files stay read-only. |

## Architecture

```
phone FileEditor (<textarea>)
    │  textarea.value
    ↓
files.write { content, expectMtime, expectSha }
    │
    ↓
bridge → writeFileImpl(cwd, path, content, opts) → fs.writeFile(tmp) + fs.rename(target)
    │
    ↓
files.write.result { mtime, sha }
    or  error { code: 'stale', currentMtime, currentSha }
```

Reads already include `mtime` and `sha`; writes echo back the post-write mtime+sha so the editor can chain subsequent saves without a re-fetch.

## Wire protocol (additive)

**`files.read` response** gains two fields (extending the existing message shape, not a new message type):
```ts
{
  type: 'files.read.result',
  reqId: string,
  content?: string,
  signedUrl?: string,
  encoding: 'text' | 'binary',
  size: number,
  mime: string,
  lang?: string,
  mtime: number,    // NEW — ms epoch
  sha: string,      // NEW — sha256 hex prefix, 16 chars
}
```

**`files.write`** (new):
```ts
// Client → Server
{
  type: 'files.write',
  reqId: string,
  cwd: string,
  path: string,
  content: string,
  expectMtime: number | null,
  expectSha: string | null,
}

// Server → Client (success)
{ type: 'files.write.result', reqId: string, mtime: number, sha: string }

// Server → Client (stale)
{ type: 'error', reqId: string, code: 'stale',
  message: 'file changed since fetch',
  currentMtime: number, currentSha: string }
```

`expectMtime: null && expectSha: null` is the **force-write** sentinel — bypasses the stale check. Both null required; partial null is rejected as malformed.

## Server-side modules

### `electron/services/fs.ts` (modify)

Add:
```ts
import { createHash } from 'node:crypto';
import { writeFile as fsWriteFile, rename, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const WRITE_MAX_BYTES = 256 * 1024;

function fileSha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

export async function writeFileImpl(
  cwd: string,
  relPath: string,
  content: string,
  opts: { expectMtime: number | null; expectSha: string | null }
): Promise<{ mtime: number; sha: string }> {
  if (Buffer.byteLength(content, 'utf8') > WRITE_MAX_BYTES) {
    throw Object.assign(new Error('file too large for phone edit'), { code: 'too_large' });
  }
  const target = safeJoin(cwd, relPath); // existing helper; throws on traversal
  // Optimistic concurrency check: if BOTH expects are provided, compare.
  const enforce = opts.expectMtime !== null && opts.expectSha !== null;
  if (enforce) {
    try {
      const st = await stat(target);
      const curMtime = st.mtimeMs;
      const curBuf = await readFile(target, 'utf8'); // existing helper
      const curSha = fileSha(curBuf);
      if (curMtime > opts.expectMtime! + 1 || curSha !== opts.expectSha) {
        throw Object.assign(new Error('file changed since fetch'), {
          code: 'stale', currentMtime: curMtime, currentSha: curSha,
        });
      }
    } catch (err: any) {
      if (err.code === 'stale') throw err;
      if (err.code === 'ENOENT') {
        // The file we expected to update is gone. Treat as stale rather than
        // silently recreating — the desktop probably deleted it.
        throw Object.assign(new Error('file deleted'), {
          code: 'stale', currentMtime: 0, currentSha: '',
        });
      }
      throw err;
    }
  }
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fsWriteFile(tmp, content, 'utf8');
  await rename(tmp, target);
  const st = await stat(target);
  return { mtime: st.mtimeMs, sha: fileSha(content) };
}
```

Notes:
- `+1` mtime slack absorbs filesystem timestamp granularity (some FSes round to seconds).
- No parent-directory auto-create; ENOENT on dir → bubbles up as a generic error (not stale).
- `readFile` and `safeJoin` already exist in `fs.ts`.

### `electron/services/fs.ts` — extend `readFileImpl` response

Add `mtime` and `sha` to the returned object. `mtime` from `fs.stat`; `sha` from hashing the (already-loaded) content. Cheap.

### `electron/services/remote/bridge-server.ts` (modify)

Add to `BridgeServerOpts`:
```ts
writeFile?: (cwd: string, path: string, content: string,
             opts: { expectMtime: number | null; expectSha: string | null })
            => Promise<{ mtime: number; sha: string }>;
```

Add a routing arm next to the existing `files.read`:
```ts
if (msg.type === 'files.write' && typeof msg.cwd === 'string' && typeof msg.path === 'string'
    && typeof msg.content === 'string') {
  const reqId = msg.reqId;
  if (!this.opts.writeFile) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'unsupported', message: 'writes disabled' }));
    return;
  }
  try {
    const { mtime, sha } = await this.opts.writeFile(
      msg.cwd, msg.path, msg.content,
      { expectMtime: typeof msg.expectMtime === 'number' ? msg.expectMtime : null,
        expectSha:   typeof msg.expectSha === 'string' ? msg.expectSha : null });
    ws.send(JSON.stringify({ v: 1, type: 'files.write.result', reqId, mtime, sha }));
  } catch (err: any) {
    if (err?.code === 'stale') {
      ws.send(JSON.stringify({
        v: 1, type: 'error', reqId, code: 'stale', message: String(err.message),
        currentMtime: err.currentMtime ?? 0, currentSha: err.currentSha ?? '',
      }));
    } else {
      ws.send(JSON.stringify({ v: 1, type: 'error', reqId,
        code: err?.code ?? 'write_failed', message: String(err?.message ?? err) }));
    }
  }
  return;
}
```

### `electron/main.ts` — wire the callback

```ts
writeFile: (cwd, path, content, opts) => writeFileImpl(cwd, path, content, opts),
```

## Client-side modules

### `src/renderer-remote/files/FileViewer.tsx` (modify)

Display an `Edit` button in the header when the loaded file satisfies:
```ts
encoding === 'text' && size <= 256 * 1024 && !signedUrl
```
Tap → `setMode('edit')` → render `<FileEditor>` in place of the Shiki view. Pass `initialContent`, `mtime`, `sha`, callbacks.

### `src/renderer-remote/files/FileEditor.tsx` (new)

Layout:
```
┌─────────────────────────────────────────────┐
│ ← Cancel       path/to/file.md       Save   │  header
├─────────────────────────────────────────────┤
│                                             │
│   <textarea>                                │  body
│                                             │
└─────────────────────────────────────────────┘
```

- `<textarea>` styling: `font-family: "Geist Mono"`, `font-size: 13`, `tab-size: 2`, white-space preserved, `resize: none`, fills body.
- iOS attrs: `autocorrect="off" autocapitalize="none" spellcheck={false} inputmode="text"`.
- Track `content` (initialized to `initialContent`) and `dirty` (= `content !== initialContent`).
- Track `saving` (during in-flight write) and `conflict` (set when stale).
- `visualViewport.height` tracked the same way as Terminal.tsx so iOS keyboard show shrinks the editor instead of clipping it.
- Header buttons:
  - `Cancel` — if dirty, confirm sheet "Discard changes?"; otherwise call `onCancel()` immediately.
  - `Save` — disabled when `!dirty || saving`. On tap: call `client.writeFile(cwd, path, content, mtime, sha)`. On success → `onSave({ mtime, sha })`. On stale → set `conflict`. On other error → toast.
- Conflict sheet:
  ```
  Desktop modified this file 12s ago.

  [ Overwrite ]   [ Reload ]   [ Keep editing ]
  ```
  - `Overwrite` → resend `writeFile(..., null, null)`. On success → `onSave({ mtime, sha })`.
  - `Reload` → `client.readFile(cwd, path)` → set `content` + update `mtime/sha`. If dirty, confirm "Lose your edits?" first.
  - `Keep editing` → close sheet, no-op.

### `src/renderer-remote/wire.ts` (modify)

Update `readFile` return type to include `mtime` and `sha`. Add:
```ts
writeFile(cwd: string, path: string, content: string,
          expectMtime: number | null, expectSha: string | null
): Promise<{ mtime: number; sha: string }>;
```
With request/response correlation via reqId like every other write. The 10s timeout matches commit/push.

On the response path, handle `files.write.result` → resolve with `{ mtime, sha }`. The `error` path with `code === 'stale'` rejects with a typed error carrying `currentMtime`/`currentSha` for the editor to read.

## Lifecycle

**Edit → save:**
1. User opens file via Files → `files.read` returns `{ content, mtime, sha }`.
2. Tap `Edit` → `FileEditor` mounts with those values.
3. User edits; `dirty` flips.
4. Tap `Save` → `client.writeFile(...)` with expects.
5. Success → editor calls `onSave({ mtime, sha })` → `FileViewer` swaps back to Shiki, refetches via `files.read` so post-format diffs show.

**Save → stale:**
1. Server returns `error { code: 'stale', currentMtime, currentSha }`.
2. Editor opens conflict sheet.
3. Three paths above. Overwrite preserves local; Reload preserves desktop.

**Cancel with dirty:**
1. Tap `Cancel` → "Discard changes?" sheet.
2. Discard → `onCancel()`. Keep → close sheet.

**WS drop / save fail:** error toast; editor stays open with dirty buffer; retry available.

**Out of scope (YAGNI for v1):**
- localStorage draft persistence across sessions.
- New-file creation, rename, delete.
- Find/replace, go-to-line, multi-cursor, syntax-highlight-while-editing.
- Diff view in the conflict sheet (text "modified 12s ago" is the cue).
- Auto-save.

## Testing

### Unit

`tests/unit/remote/bridge-server-files-write.test.ts`:
- Happy path: write a file in tmpdir, assert content + returned mtime/sha.
- Stale by mtime: pre-write a file, then call `files.write` with an older `expectMtime` → error code `stale` with `currentMtime` ≥ expected.
- Stale by sha: same mtime (within slack) but different sha → still rejected.
- Force-write (`expectMtime: null, expectSha: null`): bypasses stale check.
- Partial null (mtime null, sha set) → malformed error, file unchanged.
- Path traversal (`../etc/passwd`) → rejected by safeJoin.
- Oversized content (>256KB) → error `too_large`, file unchanged.
- Binary content path: server treats `content` as utf8 string regardless; the eligibility gate is client-side (Edit button hidden for binary). No bridge-level binary detection.

`tests/unit/fs/writeFileImpl.test.ts`:
- Atomic: temp file created with `.tmp.<pid>.<ts>` suffix; rename onto target. Mid-write reader sees old content (concurrent fs.readFile).
- mtime+sha returned reflect freshly-written file.
- ENOENT parent → error (no auto mkdir).
- Existing file overwrite: contents replaced, mtime updated.

### Integration

`tests/integration/remote/files-write-end-to-end.test.ts`:
- Spin up bridge with tmpdir as a workspace. Authenticate WS, send `files.read` → assert `mtime` and `sha`. `files.write` happy path. Re-read, assert content.
- Concurrent: write file directly with `fs.writeFile` mid-flow, then send `files.write` with original `expectMtime` → assert `stale` error frame.
- Force-write after stale: same flow, then `files.write` with nulls → success.

### Manual smoke

Append to `docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md`:
- Open a markdown file via Files → Edit button visible → tap → editor mounts with content.
- Type → Save → re-open → content persists.
- 200-line config file: scrolling + cursor smooth, no jitter.
- Edit on phone, save desktop side too. On phone tap Save → conflict sheet appears with "modified Xs ago" line. Overwrite → desktop reflects phone content. Reload (without overwrite) → editor shows desktop content; warning if dirty.
- Open big binary in Files: no Edit button.
- File > 256KB: no Edit button.
- iOS keyboard show: textarea shrinks above keyboard; Save button stays reachable.
- Cancel with dirty buffer → confirm sheet → Discard → returns to viewer; Keep → stays in editor.
- WS drop during save: toast appears; reconnect; retry succeeds.

## Risk areas

- **iOS textarea jitter at large size** — 256KB ceiling is conservative; if testing shows jitter at that cap, drop to 128KB.
- **sha 16-hex collision** — 64-bit prefix, negligible for single-file history.
- **Atomic rename on Windows** — `fs.rename` can fail across atomicity guarantees on Win32. SAI is primarily macOS/Linux; document as known. (Same caveat applies to the existing git tooling.)
- **mtime granularity** — some filesystems (FAT, ext3) round to 1s. `+1` slack handles it; if tests fail on a slow CI, widen to `+10`.
- **Concurrent phone writes** — two phones (unlikely, since each device has its own token but multi-pairing is supported). The stale check serializes them naturally; second writer sees the first's mtime, gets `stale`.
- **Encoding** — content is utf8 string. CRLF files round-trip as-is because the textarea preserves line endings; the user shouldn't see CRLF flatten to LF or vice versa.

## File map

**New:**
- `src/renderer-remote/files/FileEditor.tsx`
- `tests/unit/remote/bridge-server-files-write.test.ts`
- `tests/unit/fs/writeFileImpl.test.ts`
- `tests/integration/remote/files-write-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p6-smoke.md`

**Modified:**
- `electron/services/fs.ts` (writeFileImpl, mtime+sha on readFileImpl)
- `electron/services/remote/bridge-server.ts` (files.write routing)
- `electron/main.ts` (writeFile callback wiring)
- `src/renderer-remote/wire.ts` (writeFile helper, readFile mtime/sha)
- `src/renderer-remote/files/FileViewer.tsx` (Edit button, mode swap)

## Exit criteria

- Edit + save a small file from phone; desktop sees the change live (next read).
- Stale conflict produces a usable prompt; Overwrite and Reload both work.
- iOS keyboard show/hide doesn't clip the textarea or hide Save.
- Files ≤256KB editable; larger or binary files stay read-only.
- All unit + integration tests passing.
- Manual smoke checklist signed off on real iPhone.
- No regression in P5/P5.1 surfaces.
