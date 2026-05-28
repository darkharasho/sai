# Mobile Remote — Phase 4 Git Write Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stage/unstage/commit/push/pull to the phone's Git rail. Per-repo for meta workspaces. Commit drafts persist per-cwd.

**Architecture:** Extract 5 new impl functions from `electron/services/git.ts` (P1/P3 pattern). Bridge gets 5 new WS message types + 5 callback opts. `files.status.result` is widened with `branch/ahead/behind` so the Git rail can show a branch toolbar. PWA's existing `Git.tsx` gets a BranchToolbar (top), a stage checkbox per row in `ChangesView`, and a CommitPanel at the bottom. No new files in the PWA — everything plugs into the existing Git rail.

**Tech Stack:** TypeScript, simple-git, ws, vitest, React.

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p4-git-design.md`. **Branch:** `feat/mobile-remote-p4` already checked out from main (P0–P3 shipped). **Reference:** existing `git.ts` IPC handlers at `electron/services/git.ts:218–242` (stage/unstage/commit/push/pull).

---

## Pre-flight notes

- `git.ts` IPC handlers exist at lines 218–242: `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:pull`. All call `simple-git` via the `git(cwd)` wrapper.
- `gitStatusImpl` was extracted in P3 — currently returns `{ branch, entries }`. We add `ahead` + `behind`.
- `gitDiffImpl` was extracted in P3.
- BridgeServer's existing `statusFiles` callback returns `FileStatusEntry[]`. We widen the return type to also carry branch/ahead/behind, and update the WS response.
- PWA's `wire.ts` has the reqId/timeout/sendFrame pattern + a per-type reply dispatcher.
- `ChangesView.tsx` already renders a row per modified file with a tap-to-show-diff handler. We're adding a checkbox in front.

---

## File structure

**Modified (Electron):**
- `electron/services/git.ts` — extract 5 impls + widen `gitStatusImpl`
- `electron/services/remote/bridge-server.ts` — 5 new opts + 5 new WS branches + widened status response
- `electron/main.ts` — wire 5 new opts + propagate enriched status

**Modified (PWA):**
- `src/renderer-remote/wire.ts` — 5 helpers + 5 reply branches
- `src/renderer-remote/files/Git.tsx` — BranchToolbar + CommitPanel + handlers + draft persistence
- `src/renderer-remote/files/ChangesView.tsx` — `staged` prop + checkbox column + `onToggleStage` callback

**New tests + docs:**
- `tests/unit/remote/bridge-server-git.test.ts`
- `tests/integration/remote/git-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p4-smoke.md`

---

## Task 1: Extract 5 impls + enrich `gitStatusImpl`

**Files:**
- Modify: `electron/services/git.ts`

- [ ] **Step 1: Read existing file**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
grep -n "ipcMain.handle('git:stage\|ipcMain.handle('git:unstage\|ipcMain.handle('git:commit\|ipcMain.handle('git:push\|ipcMain.handle('git:pull\|export async function gitStatusImpl" electron/services/git.ts
```

Confirm lines for stage/unstage/commit/push/pull handlers and the existing `gitStatusImpl`.

- [ ] **Step 2: Add 5 new exported impls + widen `gitStatusImpl`**

Above `registerGitHandlers`, modify `gitStatusImpl` to include ahead/behind:

```ts
export async function gitStatusImpl(cwd: string): Promise<{
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
}> {
  const s = await git(cwd).status();
  const entries: GitStatusEntry[] = [];
  for (const p of s.staged)    entries.push({ path: p, status: 'modified', staged: true });
  for (const p of s.modified)  entries.push({ path: p, status: 'modified', staged: false });
  for (const p of s.created)   entries.push({ path: p, status: 'added',    staged: true  });
  for (const p of s.deleted)   entries.push({ path: p, status: 'deleted',  staged: false });
  for (const p of s.not_added) entries.push({ path: p, status: 'added',    staged: false });
  return { branch: s.current ?? null, ahead: s.ahead, behind: s.behind, entries };
}
```

Then add 5 new exported impls right after:

```ts
export async function gitStageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).add(filepath);
}
export async function gitUnstageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).reset(['HEAD', '--', filepath]);
}
export async function gitCommitImpl(cwd: string, message: string): Promise<{ hash?: string }> {
  const r = await git(cwd).commit(message);
  return { hash: r.commit ?? undefined };
}
export async function gitPushImpl(cwd: string): Promise<void> {
  await git(cwd).push();
}
export async function gitPullImpl(cwd: string): Promise<void> {
  await git(cwd).pull();
}
```

- [ ] **Step 3: Verify desktop IPC handlers still untouched**

The existing `ipcMain.handle('git:stage', ...)` etc. should still work as-is. They were already one-liners. Do NOT replace them. They use simple-git directly and serve the desktop renderer — the bridge will call the new impls separately.

- [ ] **Step 4: tsc + full test suite**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
```

Expected: tsc clean; all tests pass (the widened `gitStatusImpl` return shape is backward-compatible for P3's bridge usage since it still reads `.entries`).

- [ ] **Step 5: Commit**

```bash
git add electron/services/git.ts
git commit -m "refactor(git): extract stage/unstage/commit/push/pull impls + enrich status"
```

---

## Task 2: Extend BridgeServerOpts + widen `files.status` response

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Widen the `statusFiles` callback type + add 5 new opts**

In `BridgeServerOpts`, replace the existing `statusFiles` signature with one that returns the enriched shape, and add the 5 write-op callbacks:

```ts
statusFiles?: (cwd: string) => Promise<{
  entries: FileStatusEntry[];
  branch?: string | null;
  ahead?: number;
  behind?: number;
}>;

stageFile?:   (cwd: string, path: string) => Promise<void>;
unstageFile?: (cwd: string, path: string) => Promise<void>;
commit?:      (cwd: string, message: string) => Promise<{ hash?: string }>;
push?:        (cwd: string) => Promise<void>;
pull?:        (cwd: string) => Promise<void>;
```

- [ ] **Step 2: Update the `files.status` WS branch**

Find the existing `if (msg.type === 'files.status' ...)` branch. The current body calls `statusFiles?.(msg.cwd) ?? []` and sends `entries`. Replace with:

```ts
if (msg.type === 'files.status' && typeof msg.cwd === 'string') {
  const reqId = msg.reqId;
  try {
    const result = (await this.opts.statusFiles?.(msg.cwd)) ?? { entries: [] };
    ws.send(JSON.stringify({
      v: 1, type: 'files.status.result', reqId,
      entries: result.entries,
      branch: result.branch ?? null,
      ahead: result.ahead ?? 0,
      behind: result.behind ?? 0,
    }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'status_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts
git commit -m "feat(remote): widen files.status response with branch/ahead/behind"
```

If the existing `bridge-server-files.test.ts` returns just an array from its stubbed `statusFiles`, tsc may complain. That's intentional — the next task adjusts the bridge tests to use the new return shape. Continue to Task 3 without worrying about that test yet (or if tsc fails, jump to Task 3 first and come back).

Actually if tsc DOES fail on the existing files test, fix it inline by updating the stub in that test to return `{ entries: [...] }`. Then commit both files together.

---

## Task 3: WS routing for git.stage / unstage / commit / push / pull

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Create: `tests/unit/remote/bridge-server-git.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/bridge-server-git.test.ts`:

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

describe('BridgeServer git write ops', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('git.stage calls stageFile with cwd+path', async () => {
    const stageFile = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      stageFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.stage', cwd: '/repo', path: 'a.ts', reqId: 'g1' }));
    const m = await once(ws, (m) => m.type === 'git.stage.result');
    expect(m.reqId).toBe('g1');
    expect(stageFile).toHaveBeenCalledWith('/repo', 'a.ts');
    ws.close();
  });

  it('git.unstage calls unstageFile', async () => {
    const unstageFile = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      unstageFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.unstage', cwd: '/r', path: 'a.ts', reqId: 'u1' }));
    const m = await once(ws, (m) => m.type === 'git.unstage.result');
    expect(m.reqId).toBe('u1');
    expect(unstageFile).toHaveBeenCalledWith('/r', 'a.ts');
    ws.close();
  });

  it('git.commit returns hash', async () => {
    const commit = vi.fn().mockResolvedValue({ hash: 'abc1234' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      commit,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.commit', cwd: '/r', message: 'feat: x', reqId: 'c1' }));
    const m = await once(ws, (m) => m.type === 'git.commit.result');
    expect(m.reqId).toBe('c1');
    expect(m.hash).toBe('abc1234');
    expect(commit).toHaveBeenCalledWith('/r', 'feat: x');
    ws.close();
  });

  it('git.push and git.pull call callbacks', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const pull = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      push, pull,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.push', cwd: '/r', reqId: 'p1' }));
    const pushResp = await once(ws, (m) => m.type === 'git.push.result');
    expect(pushResp.reqId).toBe('p1');
    ws.send(JSON.stringify({ type: 'git.pull', cwd: '/r', reqId: 'p2' }));
    const pullResp = await once(ws, (m) => m.type === 'git.pull.result');
    expect(pullResp.reqId).toBe('p2');
    expect(push).toHaveBeenCalledWith('/r');
    expect(pull).toHaveBeenCalledWith('/r');
    ws.close();
  });

  it('errors are returned with reqId', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('hook rejected'));
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      commit,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.commit', cwd: '/r', message: 'x', reqId: 'err' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('err');
    expect(m.message).toMatch(/hook rejected/);
    ws.close();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-git.test.ts
```

Expected: 5 failures.

- [ ] **Step 3: Implement WS handlers**

In `electron/services/remote/bridge-server.ts`, inside `handleWs`'s message handler, AFTER the `files.diff` branch (or the last existing files.* branch), add:

```ts
if (msg.type === 'git.stage' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
  const reqId = msg.reqId;
  try {
    await this.opts.stageFile?.(msg.cwd, msg.path);
    ws.send(JSON.stringify({ v: 1, type: 'git.stage.result', reqId }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'stage_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'git.unstage' && typeof msg.cwd === 'string' && typeof msg.path === 'string') {
  const reqId = msg.reqId;
  try {
    await this.opts.unstageFile?.(msg.cwd, msg.path);
    ws.send(JSON.stringify({ v: 1, type: 'git.unstage.result', reqId }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'unstage_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'git.commit' && typeof msg.cwd === 'string' && typeof msg.message === 'string') {
  const reqId = msg.reqId;
  try {
    const result = await this.opts.commit?.(msg.cwd, msg.message);
    ws.send(JSON.stringify({ v: 1, type: 'git.commit.result', reqId, hash: result?.hash }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'commit_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'git.push' && typeof msg.cwd === 'string') {
  const reqId = msg.reqId;
  try {
    await this.opts.push?.(msg.cwd);
    ws.send(JSON.stringify({ v: 1, type: 'git.push.result', reqId }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'push_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'git.pull' && typeof msg.cwd === 'string') {
  const reqId = msg.reqId;
  try {
    await this.opts.pull?.(msg.cwd);
    ws.send(JSON.stringify({ v: 1, type: 'git.pull.result', reqId }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'pull_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 4: Verify pass + full suite + tsc + commit**

```bash
npx vitest run tests/unit/remote/bridge-server-git.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-git.test.ts
git commit -m "feat(remote): WS routing for git.stage/unstage/commit/push/pull"
```

Expected: 5 new passing + existing suite green.

---

## Task 4: Wire main.ts callbacks

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add imports**

Find the existing `import { gitStatusImpl, gitDiffImpl } from './services/git';` and extend:

```ts
import { gitStatusImpl, gitDiffImpl, gitStageImpl, gitUnstageImpl, gitCommitImpl, gitPushImpl, gitPullImpl } from './services/git';
```

- [ ] **Step 2: Update statusFiles wiring (pass whole status object)**

The existing wiring looks like:

```ts
statusFiles: async (cwd) => {
  const { entries } = await gitStatusImpl(cwd);
  return entries;
},
```

Change to return the whole result so branch/ahead/behind propagate:

```ts
statusFiles: async (cwd) => {
  const { branch, ahead, behind, entries } = await gitStatusImpl(cwd);
  return { entries, branch, ahead, behind };
},
```

- [ ] **Step 3: Add 5 new opts in the same construction**

Inside the `makeBridge: (tailnetIp) => { const b = new BridgeServer({...})}` call, alongside the existing P3 file callbacks, add:

```ts
stageFile:   (cwd, path) => gitStageImpl(cwd, path),
unstageFile: (cwd, path) => gitUnstageImpl(cwd, path),
commit:      (cwd, msg) => gitCommitImpl(cwd, msg),
push:        (cwd) => gitPushImpl(cwd),
pull:        (cwd) => gitPullImpl(cwd),
```

- [ ] **Step 4: tsc + test suite + commit**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
git add electron/main.ts
git commit -m "feat(remote): wire git write callbacks into bridge"
```

---

## Task 5: PWA wire.ts — 5 helpers + reply branches

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend WireClient interface**

Add to the interface:

```ts
stageFile(cwd: string, path: string): Promise<void>;
unstageFile(cwd: string, path: string): Promise<void>;
commit(cwd: string, message: string): Promise<{ hash?: string }>;
push(cwd: string): Promise<void>;
pull(cwd: string): Promise<void>;
```

- [ ] **Step 2: Reply dispatcher branches**

Inside the existing per-type reply dispatcher in `connect()`, add (before the catch-all):

```ts
} else if (t === 'git.stage.result' || t === 'git.unstage.result' || t === 'git.push.result' || t === 'git.pull.result') {
  entry.resolve(undefined);
} else if (t === 'git.commit.result') {
  entry.resolve({ hash: (msg as any).hash });
}
```

- [ ] **Step 3: Helper implementations in the returned client**

```ts
stageFile: (cwd, path) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.stage timeout')); }, 10_000);
  sendFrame({ type: 'git.stage', cwd, path, reqId });
}),
unstageFile: (cwd, path) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.unstage timeout')); }, 10_000);
  sendFrame({ type: 'git.unstage', cwd, path, reqId });
}),
commit: (cwd, message) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.commit timeout')); }, 20_000);
  sendFrame({ type: 'git.commit', cwd, message, reqId });
}),
push: (cwd) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.push timeout')); }, 60_000);
  sendFrame({ type: 'git.push', cwd, reqId });
}),
pull: (cwd) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('git.pull timeout')); }, 60_000);
  sendFrame({ type: 'git.pull', cwd, reqId });
}),
```

(Push/pull timeouts are longer since network ops can take a bit.)

- [ ] **Step 4: tsc + PWA build + commit**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): PWA wire helpers for git stage/unstage/commit/push/pull"
```

---

## Task 6: ChangesView — staged checkbox column

**Files:**
- Modify: `src/renderer-remote/files/ChangesView.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer-remote/files/ChangesView.tsx
```

Note the existing `Props { client, cwd }`, the entries fetch via `client.statusFiles(cwd)`, and the row layout with the letter badge.

- [ ] **Step 2: Extend the Props with stage handler and busy state**

```ts
interface Props {
  client: WireClient;
  cwd: string;
  /** Path of the row currently mid-stage-toggle, so we can disable the checkbox. */
  pendingStagePath?: string | null;
  /** Tells the parent to toggle stage for this path. Parent does the WS call + status refresh. */
  onToggleStage?: (path: string, staged: boolean) => void;
  /** Refresh trigger — parent bumps this to force re-fetch (after commit, etc). */
  refreshKey?: number;
}
```

- [ ] **Step 3: Use `refreshKey` in the status fetch effect**

Add `refreshKey` to the deps of the existing `useEffect(() => { client.statusFiles(...) }, [client, cwd])` — change to `[client, cwd, refreshKey]`.

- [ ] **Step 4: Add checkbox to each row**

In the existing row render (the `<button>` that displays the entry letter + path), make it so the checkbox is a separate clickable element that does NOT trigger the row's diff-open behavior. Restructure the row from a single `<button>` to a `<div>` with two children: the checkbox (a button), and the body (a button).

Replace the existing row render. Before:

```tsx
<button key={`${e.path}-${i}`} onClick={() => setSelected(e)} style={{ /* row */ }}>
  <span style={{ /* letter */ }}>{meta.letter}</span>
  <span style={{ /* path */ }}>{e.path}</span>
  {e.staged && <span>staged</span>}
</button>
```

After:

```tsx
<div
  key={`${e.path}-${i}`}
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
    borderBottom: '1px solid var(--border)',
  }}
>
  <button
    onClick={(ev) => {
      ev.stopPropagation();
      onToggleStage?.(e.path, e.staged);
    }}
    disabled={pendingStagePath === e.path || !onToggleStage}
    aria-label={e.staged ? `Unstage ${e.path}` : `Stage ${e.path}`}
    style={{
      width: 28,
      height: 32,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      opacity: pendingStagePath === e.path ? 0.5 : 1,
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 14, height: 14,
        borderRadius: 3,
        border: `1.5px solid ${e.staged ? 'var(--accent)' : 'var(--text-muted)'}`,
        background: e.staged ? 'var(--accent)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#000',
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {e.staged ? '✓' : ''}
    </span>
  </button>
  <button
    onClick={() => setSelected(e)}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      textAlign: 'left',
      padding: '8px 14px 8px 4px',
      background: 'transparent',
      color: 'var(--text)',
      border: 'none',
      cursor: 'pointer',
      fontFamily: 'inherit',
      minWidth: 0,
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
  </button>
</div>
```

The "staged" word badge is gone — the checkbox state carries that info now.

- [ ] **Step 5: PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/ChangesView.tsx
git commit -m "feat(remote): ChangesView stage checkbox column"
```

ChangesView still works without `onToggleStage` (the checkbox is rendered disabled). Git.tsx will pass the handler in Task 7.

---

## Task 7: Git.tsx — BranchToolbar + CommitPanel + handlers

**Files:**
- Modify: `src/renderer-remote/files/Git.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer-remote/files/Git.tsx
```

It currently just wraps `<ChangesView />` with a header + `<RepoPicker />`. We replace the layout with toolbar + changes + commit panel.

- [ ] **Step 2: Replace the file contents**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { ArrowDown, ArrowUp, GitBranch } from 'lucide-react';
import type { WireClient } from '../wire';
import ChangesView from './ChangesView';
import RepoPicker from './RepoPicker';

interface Props {
  client: WireClient;
  workspacePath: string;
  metaMembers?: { projectPath: string; name: string }[];
}

interface StatusEntry { path: string; status: string; staged: boolean }

type Note = { id: string; text: string; kind: 'ok' | 'err' };

const DRAFT_KEY = 'sai-remote-commit-draft';

function readDrafts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}'); } catch { return {}; }
}
function writeDraft(cwd: string, message: string) {
  const m = readDrafts();
  if (message) m[cwd] = message;
  else delete m[cwd];
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(m)); } catch { /* quota */ }
}

export default function Git({ client, workspacePath, metaMembers }: Props) {
  const [cwd, setCwd] = useState<string>(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  const [branch, setBranch] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [message, setMessage] = useState<string>('');
  const [pendingStagePath, setPendingStagePath] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ commit?: boolean; push?: boolean; pull?: boolean }>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    setCwd(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  }, [workspacePath, metaMembers]);

  // Load commit draft when cwd changes
  useEffect(() => {
    setMessage(readDrafts()[cwd] ?? '');
  }, [cwd]);

  // Pull the branch + ahead/behind + stagedCount from the latest status
  const refreshHeader = useCallback(async () => {
    try {
      const s: any = await (client as any).send
        ? null // placeholder; we use listFiles-style helper below
        : null;
      // Use existing wire client method that returns the raw frame; statusFiles only returns entries.
      // We send a manual frame for the enriched response.
      const reqId = `gh${Date.now()}`;
      const got = await new Promise<any>((resolve, reject) => {
        const off = client.on((m: any) => {
          if (m.type === 'files.status.result' && m.reqId === reqId) {
            off();
            resolve(m);
          } else if (m.type === 'error' && m.reqId === reqId) {
            off();
            reject(new Error(m.message ?? 'status failed'));
          }
        });
        client.send({ type: 'files.status', cwd, reqId });
        setTimeout(() => { off(); reject(new Error('status timeout')); }, 5000);
      });
      setBranch(got.branch ?? null);
      setAhead(got.ahead ?? 0);
      setBehind(got.behind ?? 0);
      setStagedCount((got.entries as StatusEntry[]).filter((e) => e.staged).length);
    } catch {
      setBranch(null);
      setAhead(0);
      setBehind(0);
      setStagedCount(0);
    }
  }, [client, cwd]);

  useEffect(() => { void refreshHeader(); }, [refreshHeader, refreshKey]);

  const addNote = (text: string, kind: Note['kind']) => {
    const n: Note = { id: `n${Date.now()}`, text, kind };
    setNotes((arr) => [...arr.slice(-2), n]);
    setTimeout(() => setNotes((arr) => arr.filter((x) => x.id !== n.id)), 5000);
  };

  const onToggleStage = async (path: string, staged: boolean) => {
    setPendingStagePath(path);
    try {
      if (staged) await client.unstageFile(cwd, path);
      else        await client.stageFile(cwd, path);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addNote(`${staged ? 'unstage' : 'stage'} failed: ${(err as Error).message}`, 'err');
    } finally {
      setPendingStagePath(null);
    }
  };

  const onCommit = async () => {
    if (!message.trim() || stagedCount === 0 || busy.commit) return;
    setBusy((b) => ({ ...b, commit: true }));
    try {
      const r: any = await client.commit(cwd, message.trim());
      addNote(r?.hash ? `committed ${String(r.hash).slice(0, 7)}` : 'committed', 'ok');
      setMessage('');
      writeDraft(cwd, '');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addNote(`commit failed: ${(err as Error).message}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, commit: false }));
    }
  };

  const onPush = async () => {
    if (busy.push) return;
    setBusy((b) => ({ ...b, push: true }));
    try { await client.push(cwd); addNote('pushed', 'ok'); setRefreshKey((k) => k + 1); }
    catch (err) { addNote(`push failed: ${(err as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, push: false })); }
  };
  const onPull = async () => {
    if (busy.pull) return;
    setBusy((b) => ({ ...b, pull: true }));
    try { await client.pull(cwd); addNote('pulled', 'ok'); setRefreshKey((k) => k + 1); }
    catch (err) { addNote(`pull failed: ${(err as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, pull: false })); }
  };

  const onMessageChange = (v: string) => {
    setMessage(v);
    writeDraft(cwd, v);
  };

  const canCommit = message.trim().length > 0 && stagedCount > 0 && !busy.commit;

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text)',
      }}>
        Changes
      </div>

      {metaMembers && metaMembers.length > 0 && (
        <RepoPicker members={metaMembers} current={cwd} onPick={setCwd} />
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 12, fontFamily: '"Geist Mono", ui-monospace, monospace', flexShrink: 0 }}>
          <GitBranch size={13} strokeWidth={2} />
          {branch ?? '—'}
        </span>
        {(ahead > 0 || behind > 0) && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace', flexShrink: 0 }}>
            {ahead > 0 && <>↑{ahead} </>}
            {behind > 0 && <>↓{behind}</>}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onPull}
          disabled={!branch || busy.pull}
          style={{ ...iconBtn, opacity: !branch || busy.pull ? 0.6 : 1, color: 'var(--text)' }}
        >
          <ArrowDown size={13} strokeWidth={2} />
          {busy.pull ? 'Pulling…' : 'Pull'}
        </button>
        <button
          onClick={onPush}
          disabled={!branch || ahead === 0 || busy.push}
          style={{ ...iconBtn, opacity: !branch || ahead === 0 || busy.push ? 0.6 : 1, color: ahead > 0 ? 'var(--accent)' : 'var(--text)' }}
        >
          <ArrowUp size={13} strokeWidth={2} />
          {busy.push ? 'Pushing…' : ahead > 0 ? `Push ${ahead}` : 'Push'}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ChangesView
          client={client}
          cwd={cwd}
          onToggleStage={onToggleStage}
          pendingStagePath={pendingStagePath}
          refreshKey={refreshKey}
        />
      </div>

      {/* Inline notes (success / error toasts, auto-dismiss in 5s) */}
      {notes.length > 0 && (
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {notes.map((n) => (
            <div key={n.id} style={{
              fontSize: 11,
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              color: n.kind === 'err' ? 'var(--red)' : 'var(--green)',
            }}>
              {n.text}
            </div>
          ))}
        </div>
      )}

      {/* Commit panel */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        padding: '8px 12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}>
          Commit {stagedCount > 0 ? `(${stagedCount} staged)` : '(0 staged)'}
        </div>
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Message"
          rows={2}
          style={{
            width: '100%',
            minWidth: 0,
            resize: 'none',
            fontFamily: 'inherit',
            fontSize: 16, // iOS zoom prevention
            lineHeight: 1.4,
            padding: '8px 10px',
            background: 'var(--bg-input)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <button
          onClick={onCommit}
          disabled={!canCommit}
          style={{
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: canCommit ? 'var(--accent)' : 'var(--bg-elevated)',
            color: canCommit ? '#000' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderColor: canCommit ? 'var(--accent)' : 'var(--border)',
            borderRadius: 8,
            cursor: canCommit ? 'pointer' : 'not-allowed',
            opacity: canCommit ? 1 : 0.6,
            alignSelf: 'flex-start',
          }}
        >
          {busy.commit ? 'Committing…' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
```

Note: this uses `client.send({ type: 'files.status', cwd, reqId })` + `client.on(...)` directly for the header status fetch since the existing `statusFiles` helper only returns entries. `client.send` and `client.on` are already in `WireClient`.

- [ ] **Step 3: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/files/Git.tsx
git commit -m "feat(remote): Git rail BranchToolbar + CommitPanel + stage handlers"
```

---

## Task 8: Integration test

**Files:**
- Create: `tests/integration/remote/git-end-to-end.test.ts`

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
import {
  gitStatusImpl, gitStageImpl, gitUnstageImpl, gitCommitImpl,
} from '@electron/services/git';

describe('mobile remote git end-to-end', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-git-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'one\n');
    execSync('git init -q && git add a.txt && git -c user.email=t@t -c user.name=T commit -q -m init', { cwd: tmpRoot });
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'two\n');
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  async function send(ws: WebSocket, frame: any, inbox: any[], type: string, timeoutMs = 2000): Promise<any> {
    ws.send(JSON.stringify(frame));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = inbox.find((x) => x.type === type && x.reqId === frame.reqId);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${type}`);
  }

  it('stage → status → commit → status', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        statusFiles: async (cwd) => {
          const { entries, branch, ahead, behind } = await gitStatusImpl(cwd);
          return { entries, branch, ahead, behind };
        },
        stageFile:   (cwd, p) => gitStageImpl(cwd, p),
        unstageFile: (cwd, p) => gitUnstageImpl(cwd, p),
        commit:      (cwd, m) => gitCommitImpl(cwd, m),
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

    // 1. status: a.txt is modified, unstaged
    let s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's1' }, inbox, 'files.status.result');
    expect(s.entries.find((e: any) => e.path === 'a.txt')).toMatchObject({ status: 'modified', staged: false });
    expect(s.branch).toBeTruthy();

    // 2. stage
    await send(ws, { type: 'git.stage', cwd: tmpRoot, path: 'a.txt', reqId: 'g1' }, inbox, 'git.stage.result');

    // 3. status: now staged
    s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's2' }, inbox, 'files.status.result');
    expect(s.entries.find((e: any) => e.path === 'a.txt')).toMatchObject({ staged: true });

    // 4. commit
    const c = await send(ws, { type: 'git.commit', cwd: tmpRoot, message: 'feat: two', reqId: 'c1' }, inbox, 'git.commit.result');
    expect(c.hash).toBeTruthy();

    // 5. status: clean
    s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's3' }, inbox, 'files.status.result');
    expect(s.entries).toHaveLength(0);

    ws.close();
    await remote.stop();
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:integration -- tests/integration/remote/git-end-to-end.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Full suite + tsc + commit**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit
git add tests/integration/remote/git-end-to-end.test.ts
git commit -m "test(remote): git end-to-end (stage/status/commit)"
```

---

## Task 9: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p4-smoke.md`

- [ ] **Step 1: Write**

```markdown
# Mobile Remote Phase 4 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring P4 done.

## Prerequisites

- [ ] P0–P3 smoke pass.
- [ ] A workspace open in SAI with uncommitted changes and a tracked remote.

## Stage / Unstage

- [ ] Open the Git rail. Each modified file has an empty checkbox in front of its M/A/D letter.
- [ ] Tap a checkbox. It fills with accent color + ✓. The "Commit (N staged)" counter increments.
- [ ] Tap the body of the same row. Diff renders below (P3 behavior, unchanged).
- [ ] Tap the checkbox again. Unstages; counter decrements.

## Commit

- [ ] Stage one file. Type a commit message. Commit button enables (accent fill).
- [ ] Tap Commit. "Committing…" briefly. Then `committed abc1234` system note appears.
- [ ] Changes list refreshes; the file is gone.
- [ ] Textarea clears. Reload PWA → message stays empty for this repo.
- [ ] Type a partial message, do not commit. Reload PWA. Draft persists.

## Push / Pull

- [ ] Make and commit a change locally on desktop while phone is showing same workspace. Toolbar updates to show `↓1` after 5s poll (or next status refresh — manual: switch rails to refresh).
- [ ] Tap Pull. Spinner. `pulled` note. Behind counter resets to 0.
- [ ] Commit a change from phone (or desktop). Toolbar shows `↑1`. Push button highlights in accent.
- [ ] Tap Push. Spinner. `pushed` note. Ahead counter resets.

## Errors

- [ ] Try to commit with empty message → button stays disabled.
- [ ] Try to commit with no staged files → button stays disabled.
- [ ] Stage a file, commit with a pre-commit hook that fails → error system note shows the hook output. Textarea preserves the message.

## Meta workspaces

- [ ] In a meta workspace, switch repos via RepoPicker. Commit draft and staged set are per-repo (each repo has independent state).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p4-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 4"
```

---

## Task 10: Final sweep

- [ ] **Step 1: Full suite + tsc + PWA build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -5
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: all tests pass; tsc clean; PWA build succeeds.

- [ ] **Step 2: Final tidy commit (only if anything was fixed)**

```bash
git add -A
git commit -m "chore(remote): final tidy after p4 verification" || true
```

---

## Done

Phase 4 is complete when:

1. All vitest unit + integration tests pass (P0–P3 stay green; 5 new bridge-git unit tests + 1 new e2e all green).
2. `tsc --noEmit` clean.
3. PWA bundle builds.
4. Manual smoke walked on iPhone over Tailscale.
5. Stage/commit/push/pull works on plain and meta workspaces.

Next per roadmap: **Phase 5 — Terminal** (xterm.js over WS for the phone). Independent of P3/P4, so it can be the next phase or deferred for polish work first (AI commit messages, branch picker, discard).
