# Mobile Remote — Phase 1 Chat + Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire SAI's existing Claude chat into the Phase 0 mobile bridge: phone streams assistant output, sends prompts, approves tool calls, and switches sessions. Claude-only; codex/gemini follow later.

**Architecture:** Single-line `bus.publish` after `safeSend` in `electron/services/claude.ts` fans every chat event to the SessionBus. A new `RendererProxy` module bridges main → renderer IPC to read IndexedDB-backed chat history. The existing IPC handler bodies get pulled into exported `sendImpl`/`approveImpl`/`interruptImpl` functions that both the IPC handlers and the bridge call. Autonomy clamping (`origin: 'remote'`) threads end-to-end through `sendImpl` from day one.

**Tech Stack:** TypeScript, Electron `ipcMain`/`ipcRenderer`, `ws`, vitest, React for the PWA (in `src/renderer-remote/`).

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p1-chat-design.md`. **P0 reference (already shipped):** `electron/services/remote/`, `src/renderer-remote/`, `src/components/Settings/RemoteSettings.tsx`. **Roadmap:** `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`.

---

## Pre-flight notes

- Branch `feat/mobile-remote-p1` is already checked out from main.
- SAI's `claude.ts` IPC handlers in `electron/services/claude.ts` are registered inside `registerClaudeHandlers(win: BrowserWindow)` starting line 458. Look for `ipcMain.on('claude:send', ...)` at line 520, `ipcMain.handle('claude:approve', ...)` at line 605, `ipcMain.on('claude:stop', ...)` at line 488.
- The single best fan-out line is **after** `safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath, scope })` at line 371. The stdout handler at lines 253-371 covers all event types we care about; `safeSend` at 333, 359, 386, 399, 409 are *additional* emit sites for specific subtypes — we mirror each one.
- `chatDb` exposes `dbGetSessions(projectPath)` (line 51) and `dbGetMessages(sessionId)` (line 68).
- Active-session is held in `App.tsx`'s workspace state. The setter is the `setWorkspaces(...)` calls that update `activeSession`. We add a single side-effect call there.

---

## File structure

**New files:**
- `electron/services/remote/clamp.ts` — autonomy clamp pure function
- `electron/services/remote/renderer-proxy.ts` — main↔renderer IPC bridge for IndexedDB reads
- `tests/unit/remote/clamp.test.ts`
- `tests/unit/remote/renderer-proxy.test.ts`
- `tests/unit/remote/bridge-server-chat.test.ts`
- `tests/integration/remote/chat-end-to-end.test.ts`
- `src/lib/remoteProxyClient.ts` — renderer-side handler for proxy requests
- `src/renderer-remote/chat/Chat.tsx`
- `src/renderer-remote/chat/Transcript.tsx`
- `src/renderer-remote/chat/Composer.tsx`
- `src/renderer-remote/chat/Approval.tsx`
- `src/renderer-remote/chat/ToolCard.tsx`
- `src/renderer-remote/chat/SessionDrawer.tsx`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p1-smoke.md`

**Modified:**
- `electron/services/claude.ts` — extract impls, inject bus, publish fan-out, emit user_message
- `electron/services/remote/bridge-server.ts` — extend opts, add chat WS handlers, device-state
- `electron/main.ts` — wire RendererProxy + setRemoteBus + new bridge callbacks
- `electron/preload.ts` — expose `remote.setActiveSession`, `remote.onProxyRequest`, `remote.sendProxyReply`
- `src/vite-env.d.ts` — extend `SaiRemoteApi` with the new fields
- `src/App.tsx` — fire `setActiveSession` on workspace state change; mount remoteProxyClient
- `src/renderer-remote/App.tsx` — route to `<Chat />` after auth_ok
- `src/renderer-remote/wire.ts` — extend with attach/listSessions/sendPrompt/approve/interrupt helpers
- `src/components/Settings/RemoteSettings.tsx` — add `remoteCeiling` selector

---

## Task 1: `clamp.ts` — autonomy clamp pure function

**Files:**
- Create: `electron/services/remote/clamp.ts`
- Create: `tests/unit/remote/clamp.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/clamp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clamp, type PermMode } from '@electron/services/remote/clamp';

describe('clamp', () => {
  const cases: Array<[PermMode | undefined, PermMode | null, PermMode | undefined]> = [
    // [desktop, ceiling, expected]
    ['auto', 'always-ask', 'always-ask'],
    ['auto', 'auto-read', 'auto-read'],
    ['auto', 'auto', 'auto'],
    ['auto-read', 'always-ask', 'always-ask'],
    ['auto-read', 'auto-read', 'auto-read'],
    ['auto-read', 'auto', 'auto-read'],
    ['always-ask', 'always-ask', 'always-ask'],
    ['always-ask', 'auto-read', 'always-ask'],
    ['always-ask', 'auto', 'always-ask'],
    [undefined, 'always-ask', 'always-ask'],
    [undefined, null, undefined],
    ['auto', null, 'auto'],
  ];
  for (const [desktop, ceiling, expected] of cases) {
    it(`clamp(${desktop}, ${ceiling}) → ${expected}`, () => {
      expect(clamp(desktop, ceiling)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx vitest run tests/unit/remote/clamp.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `electron/services/remote/clamp.ts`:

```ts
export type PermMode = 'auto' | 'auto-read' | 'always-ask';

const ORDER: Record<PermMode, number> = {
  'auto': 2,        // most permissive
  'auto-read': 1,
  'always-ask': 0,  // least permissive
};

/**
 * Returns the stricter of two permission modes. The ceiling is the cap;
 * if ceiling is null, no clamp is applied. Undefined desktop returns the ceiling.
 */
export function clamp(desktop: PermMode | undefined, ceiling: PermMode | null): PermMode | undefined {
  if (ceiling == null) return desktop;
  if (desktop == null) return ceiling;
  return ORDER[desktop] < ORDER[ceiling] ? desktop : ceiling;
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/clamp.test.ts
```

Expected: 12 passing.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/remote/clamp.ts tests/unit/remote/clamp.test.ts
git commit -m "feat(remote): autonomy clamp pure function"
```

---

## Task 2: `renderer-proxy.ts` — main↔renderer IPC bridge

**Files:**
- Create: `electron/services/remote/renderer-proxy.ts`
- Create: `tests/unit/remote/renderer-proxy.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/renderer-proxy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RendererProxy } from '@electron/services/remote/renderer-proxy';

interface FakeContents { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
interface FakeWindow { webContents: FakeContents; isDestroyed: () => boolean }

function fakeWindow(opts: { destroyed?: boolean } = {}): FakeWindow {
  return {
    webContents: { send: vi.fn(), isDestroyed: () => !!opts.destroyed },
    isDestroyed: () => !!opts.destroyed,
  };
}

describe('RendererProxy', () => {
  it('resolves a request when a matching reply is received', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.listSessions('/path');
    expect(win.webContents.send).toHaveBeenCalledOnce();
    const [, payload] = win.webContents.send.mock.calls[0];
    expect(payload.kind).toBe('listSessions');
    expect(payload.args).toEqual({ projectPath: '/path' });
    proxy.handleReply({ reqId: payload.reqId, result: [{ id: 's1' }] });
    expect(await promise).toEqual([{ id: 's1' }]);
  });

  it('rejects on timeout', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 10 });
    await expect(proxy.loadHistory('s1')).rejects.toThrow(/timeout/);
  });

  it('rejects when window is destroyed', async () => {
    const win = fakeWindow({ destroyed: true });
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    await expect(proxy.loadHistory('s1')).rejects.toThrow(/window/);
  });

  it('rejects when reply carries error', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const promise = proxy.listSessions('/p');
    const [, payload] = win.webContents.send.mock.calls[0];
    proxy.handleReply({ reqId: payload.reqId, error: 'boom' });
    await expect(promise).rejects.toThrow(/boom/);
  });

  it('handles multiple in-flight requests', async () => {
    const win = fakeWindow();
    const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
    const a = proxy.listSessions('/a');
    const b = proxy.listSessions('/b');
    const [, payloadA] = win.webContents.send.mock.calls[0];
    const [, payloadB] = win.webContents.send.mock.calls[1];
    proxy.handleReply({ reqId: payloadB.reqId, result: ['B'] });
    proxy.handleReply({ reqId: payloadA.reqId, result: ['A'] });
    expect(await a).toEqual(['A']);
    expect(await b).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/renderer-proxy.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `electron/services/remote/renderer-proxy.ts`:

```ts
import type { BrowserWindow } from 'electron';

type Kind = 'listSessions' | 'loadHistory';
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RendererProxyOpts {
  getWindow: () => BrowserWindow | null;
  timeoutMs?: number;
}

export interface ProxyReply {
  reqId: number;
  result?: unknown;
  error?: string;
}

export class RendererProxy {
  private nextReqId = 1;
  private pending = new Map<number, Pending>();
  private readonly timeoutMs: number;

  constructor(private readonly opts: RendererProxyOpts) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  listSessions(projectPath: string): Promise<unknown[]> {
    return this.request('listSessions', { projectPath }) as Promise<unknown[]>;
  }

  loadHistory(sessionId: string): Promise<unknown[]> {
    return this.request('loadHistory', { sessionId }) as Promise<unknown[]>;
  }

  handleReply(reply: ProxyReply): void {
    const p = this.pending.get(reply.reqId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(reply.reqId);
    if (reply.error) p.reject(new Error(reply.error));
    else p.resolve(reply.result);
  }

  private request(kind: Kind, args: Record<string, unknown>): Promise<unknown> {
    const win = this.opts.getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return Promise.reject(new Error('renderer window unavailable'));
    }
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`renderer-proxy timeout: ${kind}`));
      }, this.timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      win.webContents.send('remote:proxy:request', { reqId, kind, args });
    });
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/renderer-proxy.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/remote/renderer-proxy.ts tests/unit/remote/renderer-proxy.test.ts
git commit -m "feat(remote): renderer-proxy IPC bridge for IndexedDB reads"
```

---

## Task 3: Extract `sendImpl` from `claude:send` IPC handler

**Files:**
- Modify: `electron/services/claude.ts` (line ~520, `ipcMain.on('claude:send', ...)`)

This is a refactor — no behavior change yet. We split the handler body into an exported function and reduce the IPC handler to a one-liner. Bus injection and origin clamping come in Tasks 5-6.

- [ ] **Step 1: Open and read lines 458-590**

Use Read on `electron/services/claude.ts` lines 458-590 to see `registerClaudeHandlers` and the `claude:send` handler.

- [ ] **Step 2: Extract `sendImpl`**

Currently the body of `ipcMain.on('claude:send', (_event, projectPath, message, imagePaths, permMode, effort, model, scope) => { ... })` is everything inside the arrow. Move it into an exported function placed near other exports (e.g., just above `registerClaudeHandlers`):

```ts
export function sendImpl(
  projectPath: string,
  message: string,
  imagePaths?: string[],
  permMode?: string,
  effort?: string,
  model?: string,
  scope?: string,
  origin: 'desktop' | 'remote' = 'desktop',
): void {
  // === ORIGINAL HANDLER BODY GOES HERE ===
  // Move the entire callback body unchanged. References to `ensureProcess`,
  // `safeSend`, win, etc. continue to work because they're module-scoped.
  // The win reference inside the old body needs to be reachable; if it was
  // captured from registerClaudeHandlers's arg, capture it via a module-level
  // `let mainWin: BrowserWindow | null = null` that `registerClaudeHandlers`
  // sets at startup.
}
```

Then replace the IPC handler with a one-liner:

```ts
ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) => {
  sendImpl(projectPath, message, imagePaths, permMode, effort, model, scope);
});
```

If the original body referenced `win` (the registerClaudeHandlers parameter), add at the top of the file (after imports):

```ts
let mainWin: BrowserWindow | null = null;
```

and at the top of `registerClaudeHandlers`:

```ts
mainWin = win;
```

Then change `win` references in `sendImpl` (and other extracted impls) to `mainWin` with a null-guard.

- [ ] **Step 3: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests still pass (1288+). If any chat-related tests fail, the refactor broke something.

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/claude.ts
git commit -m "refactor(claude): extract sendImpl from claude:send IPC handler"
```

---

## Task 4: Extract `approveImpl` and `interruptImpl`

**Files:**
- Modify: `electron/services/claude.ts`

Same pattern as Task 3 for the other two handlers.

- [ ] **Step 1: Extract `approveImpl`**

From `ipcMain.handle('claude:approve', async (_event, projectPath, toolUseId, approved, modifiedCommand, scope) => { ... })` at line 605, move the body to:

```ts
export async function approveImpl(
  projectPath: string,
  toolUseId: string,
  approved: boolean,
  modifiedCommand?: string,
  scope?: string,
): Promise<void> {
  // === ORIGINAL HANDLER BODY ===
}
```

Replace the handler:

```ts
ipcMain.handle('claude:approve', (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope?: string) => {
  return approveImpl(projectPath, toolUseId, approved, modifiedCommand, scope);
});
```

- [ ] **Step 2: Verify approveImpl is idempotent**

Read the body. If it dereferences `toolUseId` against an in-memory map (e.g., `pendingApprovals.get(toolUseId)`), confirm the path when the entry is missing returns silently. If it throws or warns, add a guard at the top:

```ts
export async function approveImpl(projectPath, toolUseId, approved, modifiedCommand, scope) {
  // Idempotency: second resolution for the same toolUseId is a no-op.
  // Otto's first-resolver-wins pattern depends on this.
  const ws = workspaces.get(projectPath);
  if (!ws) return;
  const pending = ws.pendingApprovals?.get(toolUseId);
  if (!pending) return; // already resolved
  // ... rest of original body
}
```

(Replace `pendingApprovals` with whatever the actual structure is. The key check is: if the toolUseId isn't tracked, return silently.)

- [ ] **Step 3: Extract `interruptImpl`**

From `ipcMain.on('claude:stop', (_event, projectPath: string, scope?: string) => { ... })` at line 488:

```ts
export function interruptImpl(projectPath: string, scope?: string): void {
  // === ORIGINAL HANDLER BODY ===
}

ipcMain.on('claude:stop', (_event, projectPath: string, scope?: string) => {
  interruptImpl(projectPath, scope);
});
```

- [ ] **Step 4: Full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: 1288+ passing.

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/claude.ts
git commit -m "refactor(claude): extract approveImpl + interruptImpl (idempotent approval)"
```

---

## Task 5: Inject `remoteBus` and fan-out publish

**Files:**
- Modify: `electron/services/claude.ts`

- [ ] **Step 1: Add bus injection at module level**

Near the top of `electron/services/claude.ts` (after imports), add:

```ts
import type { SessionBus } from './remote/session-bus';

let remoteBus: SessionBus | null = null;
export function setRemoteBus(bus: SessionBus | null): void {
  remoteBus = bus;
}
```

- [ ] **Step 2: Add publish after every `safeSend` for chat events**

In the stdout handler around lines 253-410, find each `safeSend(win, 'claude:message', ...)` call. After each, add:

```ts
const __pubMsg = { /* the same object you just safeSend'd */ };
safeSend(mainWin!, 'claude:message', __pubMsg);
remoteBus?.publish(`chat:${__pubMsg.projectPath}:${__pubMsg.scope ?? 'chat'}`, __pubMsg);
```

To avoid duplication, define a tiny helper at the top of the stdout block:

```ts
const emit = (msg: any) => {
  if (mainWin) safeSend(mainWin, 'claude:message', msg);
  remoteBus?.publish(`chat:${msg.projectPath}:${msg.scope ?? 'chat'}`, msg);
};
```

Then replace each existing `safeSend(win, 'claude:message', {...})` with `emit({...})`. There are about 7 such calls (lines 260, 268, 333, 359, 360, 371, 386, 399, 409 per the pre-flight grep).

- [ ] **Step 3: Smoke-run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: no regressions; `remoteBus` is null until Task 7 wires it, so the publish line is a no-op.

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/claude.ts
git commit -m "feat(remote): fan-out claude:message events to SessionBus"
```

---

## Task 6: Emit `user_message` event from sendImpl + apply remote clamp

**Files:**
- Modify: `electron/services/claude.ts`
- Modify: `electron/services/remote/clamp.ts` (export `type PermMode` if not already)

- [ ] **Step 1: Add a remoteCeiling setter at module level**

Near `setRemoteBus`:

```ts
import { clamp, type PermMode } from './remote/clamp';

let remoteCeiling: PermMode | null = null;
export function setRemoteCeiling(ceiling: PermMode | null): void {
  remoteCeiling = ceiling;
}
```

- [ ] **Step 2: Apply clamp + emit user_message in `sendImpl`**

At the top of `sendImpl` (after argument destructure / state lookup), add:

```ts
let effectivePermMode = permMode as PermMode | undefined;
if (origin === 'remote') {
  effectivePermMode = clamp(effectivePermMode, remoteCeiling);
}
```

Then use `effectivePermMode` everywhere the original used `permMode`. (Search the body for `permMode` references and substitute.)

Find the line that writes the prompt to stdin (around line 584 per pre-flight grep — `claudeProcess.stdin.write(JSON.stringify(...))`). Immediately AFTER that write, emit the user_message:

```ts
const userMsg = {
  type: 'user_message',
  projectPath,
  scope: scope ?? 'chat',
  text: message,
  origin,
  turnSeq: ws.turnSeq, // or whatever the local turnSeq variable is named
};
if (mainWin) safeSend(mainWin, 'claude:message', userMsg);
remoteBus?.publish(`chat:${projectPath}:${scope ?? 'chat'}`, userMsg);
```

- [ ] **Step 3: Smoke-run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: no regressions. The desktop renderer will start receiving `user_message` events; if any chat-component test asserts the absence of unknown events, update those tests (likely none — most assert specific known types).

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/claude.ts
git commit -m "feat(remote): emit user_message + apply autonomy clamp for remote origin"
```

---

## Task 7: Add remoteCeiling setting to RemoteSettings UI

**Files:**
- Modify: `src/components/Settings/RemoteSettings.tsx`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/vite-env.d.ts`

The setting persists in the existing `sai-remote-kv.json` (added in P0).

- [ ] **Step 1: Extend the KV in main.ts**

In `electron/main.ts`, the `RemoteKv` interface (added in P0 around line 65) currently has `screenshotSecret?: string; enabled?: boolean`. Extend it:

```ts
interface RemoteKv {
  screenshotSecret?: string;
  enabled?: boolean;
  remoteCeiling?: 'auto' | 'auto-read' | 'always-ask' | null;
}
```

Add an IPC handler near the other `remote:*` handlers in `createWindow()`:

```ts
ipcMain.handle('remote:setCeiling', async (_e, ceiling: 'auto' | 'auto-read' | 'always-ask' | null) => {
  await getOrInitRemote();
  writeRemoteKv({ remoteCeiling: ceiling });
  setRemoteCeiling(ceiling); // imported from './services/claude'
});

ipcMain.handle('remote:getCeiling', async () => {
  await getOrInitRemote();
  return readRemoteKv().remoteCeiling ?? null;
});
```

Also import `setRemoteCeiling` at the top:

```ts
import { setRemoteCeiling } from './services/claude';
```

And inside `getOrInitRemote()` after `kv` is read, restore the saved ceiling:

```ts
setRemoteCeiling(kv.remoteCeiling ?? null);
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.ts`, extend the `remote: {...}` group:

```ts
setCeiling: (ceiling: 'auto' | 'auto-read' | 'always-ask' | null) =>
  ipcRenderer.invoke('remote:setCeiling', ceiling),
getCeiling: () => ipcRenderer.invoke('remote:getCeiling'),
```

- [ ] **Step 3: Add to SaiRemoteApi in vite-env.d.ts**

Append to the `SaiRemoteApi` interface:

```ts
setCeiling: (ceiling: 'auto' | 'auto-read' | 'always-ask' | null) => Promise<void>;
getCeiling: () => Promise<'auto' | 'auto-read' | 'always-ask' | null>;
```

- [ ] **Step 4: Add UI to RemoteSettings.tsx**

In `src/components/Settings/RemoteSettings.tsx`, add a new state and UI section. After the existing toggle row, before the divider:

```tsx
const [ceiling, setCeiling] = useState<'auto' | 'auto-read' | 'always-ask' | null>(null);

useEffect(() => {
  void window.sai.remote.getCeiling().then(setCeiling);
}, []);

const handleCeiling = async (next: 'auto' | 'auto-read' | 'always-ask' | null) => {
  setCeiling(next);
  await window.sai.remote.setCeiling(next);
};
```

And in the JSX, after the enable toggle row:

```tsx
<div className="settings-row settings-row-spaced">
  <div className="settings-row-info">
    <div className="settings-row-name">Remote autonomy ceiling</div>
    <div className="settings-row-desc">
      Cap the approval mode for prompts sent from the phone. Clamped against your desktop setting; never more permissive.
    </div>
  </div>
  <select
    value={ceiling ?? ''}
    onChange={(e) => handleCeiling((e.target.value || null) as any)}
    style={{
      fontSize: 12, padding: '4px 8px',
      background: 'var(--bg-secondary)', color: 'var(--text)',
      border: '1px solid var(--border)', borderRadius: 6,
    }}
  >
    <option value="">No clamp (use desktop)</option>
    <option value="always-ask">Always ask</option>
    <option value="auto-read">Auto for reads, ask for writes</option>
    <option value="auto">Auto (allow all)</option>
  </select>
</div>
```

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add electron/main.ts electron/preload.ts src/vite-env.d.ts src/components/Settings/RemoteSettings.tsx
git commit -m "feat(remote): remoteCeiling setting persisted + applied at sendImpl"
```

---

## Task 8: Extend `bridge-server.ts` opts for Phase 1 callbacks

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`

No new tests yet — purely interface widening. Tests come with Task 9.

- [ ] **Step 1: Extend `BridgeServerOpts`**

Find `interface BridgeServerOpts` near the top of the file (added in P0). Add the new optional fields:

```ts
export interface PromptArgs {
  text: string;
  projectPath: string;
  scope: string;
  model?: string;
  effort?: string;
  permMode?: string;
}
export interface ApprovalArgs {
  toolUseId: string;
  decision: 'approve' | 'deny';
  modifiedCommand?: string;
  projectPath: string;
  scope: string;
}
export interface SessionMeta { id: string; projectPath: string; title?: string; updatedAt: number; kind?: string }
export interface ChatMsg { /* opaque pass-through from chatDb */ [k: string]: unknown }
export interface SessionActivePayload { projectPath: string; scope: string; sessionId: string }

export interface BridgeServerOpts {
  /* existing P0 fields unchanged */
  // ...
  sendPrompt?: (args: PromptArgs) => void;
  resolveApproval?: (args: ApprovalArgs) => Promise<void>;
  interruptTurn?: (projectPath: string, scope: string) => void;
  listSessions?: (projectPath: string) => Promise<SessionMeta[]>;
  loadHistory?: (sessionId: string) => Promise<ChatMsg[]>;
  registerActiveSessionBroadcast?: (broadcast: (payload: SessionActivePayload) => void) => void;
}
```

- [ ] **Step 2: Add device-state tracking in handleWs**

Inside `handleWs`, after the existing auth bookkeeping (where you set `authed = true; deviceId = found.id;`), add:

```ts
const state: { attachedTopic: string | null; followEnabled: boolean } = {
  attachedTopic: null,
  followEnabled: false,
};
```

And replace the existing `subscribeAll` body that forwards events:

```ts
unsub = this.opts.bus.subscribeAll((topic, e) => {
  if (state.attachedTopic !== topic) return; // gate by attachment
  try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* ws may be closed */ }
});
```

- [ ] **Step 3: Add broadcast hook for session.active**

In `start()`, after `this.wss = new WebSocketServer(...)`, call the broadcaster registration:

```ts
this.opts.registerActiveSessionBroadcast?.((payload) => {
  if (!this.wss) return;
  for (const client of this.wss.clients) {
    // We only push to clients that have follow-mode enabled.
    // Track follow state on the WebSocket object itself.
    const followEnabled = (client as any).__followEnabled;
    if (!followEnabled) continue;
    try { client.send(JSON.stringify({ v: 1, type: 'session.active', ...payload })); } catch { /* ignore */ }
  }
});
```

Inside `handleWs`, also store `state` on the ws so the broadcaster can read it. Update the existing `state` declaration to instead live on `ws`:

```ts
(ws as any).__attachedTopic = null;
(ws as any).__followEnabled = false;
const setAttached = (topic: string | null) => { (ws as any).__attachedTopic = topic; };
const setFollow = (enabled: boolean) => { (ws as any).__followEnabled = enabled; };
```

And update the subscribeAll filter to read `(ws as any).__attachedTopic`.

- [ ] **Step 4: tsc + commit**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts
git commit -m "feat(remote): extend BridgeServerOpts and device-state for Phase 1"
```

---

## Task 9: Implement Phase 1 WS message routing in bridge-server

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Create: `tests/unit/remote/bridge-server-chat.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/bridge-server-chat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('BridgeServer chat routing', () => {
  let server: BridgeServer; let port: number; let bus: SessionBus;
  let sendPrompt = vi.fn(); let resolveApproval = vi.fn(); let interruptTurn = vi.fn();
  let listSessions = vi.fn(); let loadHistory = vi.fn();

  beforeEach(async () => {
    bus = new SessionBus();
    sendPrompt = vi.fn();
    resolveApproval = vi.fn().mockResolvedValue(undefined);
    interruptTurn = vi.fn();
    listSessions = vi.fn().mockResolvedValue([{ id: 's1', projectPath: '/p' }]);
    loadHistory = vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus,
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      sendPrompt, resolveApproval, interruptTurn, listSessions, loadHistory,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  it('session.attach gates bus events to the attached topic only', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    setTimeout(() => {
      bus.publish('chat:/p:chat', { type: 'assistant', text: 'hello' });
      bus.publish('chat:/other:chat', { type: 'assistant', text: 'dropped' });
    }, 20);
    const m = await once(ws, (m) => m.type === 'assistant');
    expect(m.text).toBe('hello');
    expect(m.topic).toBe('chat:/p:chat');
    ws.close();
  });

  it('sessions.list calls callback and replies with reqId correlation', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'sessions.list', projectPath: '/p', reqId: 'r1' }));
    const m = await once(ws, (m) => m.type === 'sessions.list.result');
    expect(m.reqId).toBe('r1');
    expect(m.sessions).toEqual([{ id: 's1', projectPath: '/p' }]);
    expect(listSessions).toHaveBeenCalledWith('/p');
    ws.close();
  });

  it('session.attach replies with history dump', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    const m = await once(ws, (m) => m.type === 'session.history');
    expect(m.sessionId).toBe('s1');
    expect(m.messages).toEqual([{ role: 'user', content: 'hi' }]);
    ws.close();
  });

  it('prompt calls sendPrompt with origin remote', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'prompt', text: 'hi', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi', projectPath: '/p', scope: 'chat' }));
    ws.close();
  });

  it('approval calls resolveApproval', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'approval', toolUseId: 'tu1', decision: 'approve', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveApproval).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: 'tu1', decision: 'approve' }));
    ws.close();
  });

  it('interrupt calls interruptTurn', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'interrupt', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(interruptTurn).toHaveBeenCalledWith('/p', 'chat');
    ws.close();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-chat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the WS message routing**

In `electron/services/remote/bridge-server.ts`, inside `handleWs`, inside the `ws.on('message', async (data) => {...})` block, AFTER the existing `if (msg.type === 'ping')` branch (and before the closing brace), add:

```ts
if (msg.type === 'session.attach' && typeof msg.projectPath === 'string') {
  const scope = (msg.scope as string) ?? 'chat';
  const topic = `chat:${msg.projectPath}:${scope}`;
  (ws as any).__attachedTopic = topic;
  // Replay history (best-effort; errors become an error frame).
  if (typeof msg.sessionId === 'string') {
    try {
      const messages = await this.opts.loadHistory?.(msg.sessionId) ?? [];
      ws.send(JSON.stringify({
        v: 1, type: 'session.history',
        projectPath: msg.projectPath, scope, sessionId: msg.sessionId, messages,
      }));
    } catch (err) {
      ws.send(JSON.stringify({ v: 1, type: 'error', code: 'history_unavailable', message: (err as Error).message }));
    }
  }
  return;
}

if (msg.type === 'session.follow' && typeof msg.enabled === 'boolean') {
  (ws as any).__followEnabled = msg.enabled;
  return;
}

if (msg.type === 'sessions.list' && typeof msg.projectPath === 'string') {
  const reqId = msg.reqId;
  try {
    const sessions = await this.opts.listSessions?.(msg.projectPath) ?? [];
    ws.send(JSON.stringify({ v: 1, type: 'sessions.list.result', reqId, sessions }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'prompt' && typeof msg.text === 'string' && typeof msg.projectPath === 'string') {
  this.opts.sendPrompt?.({
    text: msg.text,
    projectPath: msg.projectPath,
    scope: (msg.scope as string) ?? 'chat',
    model: msg.model as string | undefined,
    effort: msg.effort as string | undefined,
    permMode: msg.permMode as string | undefined,
  });
  return;
}

if (msg.type === 'approval' && typeof msg.toolUseId === 'string' &&
    (msg.decision === 'approve' || msg.decision === 'deny') &&
    typeof msg.projectPath === 'string') {
  try {
    await this.opts.resolveApproval?.({
      toolUseId: msg.toolUseId,
      decision: msg.decision,
      modifiedCommand: msg.modifiedCommand as string | undefined,
      projectPath: msg.projectPath,
      scope: (msg.scope as string) ?? 'chat',
    });
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', code: 'approval_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'interrupt' && typeof msg.projectPath === 'string') {
  this.opts.interruptTurn?.(msg.projectPath, (msg.scope as string) ?? 'chat');
  return;
}

if (msg.type === 'session.new' && typeof msg.projectPath === 'string') {
  // For now, session creation is implicit when the first prompt arrives;
  // emit a synthetic session.active to confirm.
  ws.send(JSON.stringify({
    v: 1, type: 'session.active',
    projectPath: msg.projectPath, scope: (msg.scope as string) ?? 'chat', sessionId: '',
  }));
  return;
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/bridge-server-chat.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: previous tests still green.

- [ ] **Step 6: tsc + commit**

```bash
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-chat.test.ts
git commit -m "feat(remote): WS routing for attach/list/prompt/approval/interrupt"
```

---

## Task 10: Wire RendererProxy + claude-bridge into main.ts

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add imports near the top**

```ts
import { setRemoteBus, sendImpl, approveImpl, interruptImpl } from './services/claude';
import { RendererProxy } from './services/remote/renderer-proxy';
```

- [ ] **Step 2: Construct RendererProxy and inject bus**

Find the `getOrInitRemote()` function. After `pairing = new PairingStore(...)` and `bus = new SessionBus()`, add:

```ts
setRemoteBus(bus);
```

Below the existing `kv = readRemoteKv()` block (around where ceiling restoration was added in Task 7):

```ts
const rendererProxy = new RendererProxy({ getWindow: () => mainWindow });
ipcMain.handle('remote:proxy:reply', (_e, reply) => rendererProxy.handleReply(reply));
```

(Bind the proxy to a closure-visible variable at module level so the bridge factory can see it. Add `let rendererProxy: RendererProxy | null = null;` at module level alongside `pairing`/`bus`, and use it inside `getOrInitRemote`.)

- [ ] **Step 3: Extend bridge construction with Phase 1 callbacks**

Update the `makeBridge: (tailnetIp) => new BridgeServer({...})` call to include the new fields:

```ts
makeBridge: (tailnetIp) => new BridgeServer({
  // ... existing P0 fields ...
  sendPrompt: (args) => sendImpl(
    args.projectPath, args.text, undefined,
    args.permMode, args.effort, args.model,
    args.scope, 'remote',
  ),
  resolveApproval: (args) => approveImpl(
    args.projectPath, args.toolUseId, args.decision === 'approve',
    args.modifiedCommand, args.scope,
  ),
  interruptTurn: (path, scope) => interruptImpl(path, scope),
  listSessions: async (path) => (await rendererProxy!.listSessions(path)) as any,
  loadHistory: async (sid) => (await rendererProxy!.loadHistory(sid)) as any,
  registerActiveSessionBroadcast: (broadcast) => {
    ipcMain.handle('remote:setActiveSession', (_e, payload) => broadcast(payload));
  },
}),
```

- [ ] **Step 4: tsc + smoke**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
```

Expected: clean + no regressions.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(remote): wire RendererProxy + claude callbacks into BridgeServer"
```

---

## Task 11: Preload exposures for proxy + active-session

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Add to preload**

In `electron/preload.ts`, extend the `remote: {...}` group:

```ts
setActiveSession: (payload: { projectPath: string; scope: string; sessionId: string }) =>
  ipcRenderer.invoke('remote:setActiveSession', payload),
onProxyRequest: (cb: (payload: { reqId: number; kind: string; args: any }) => void) => {
  const listener = (_e: any, payload: any) => cb(payload);
  ipcRenderer.on('remote:proxy:request', listener);
  return () => ipcRenderer.removeListener('remote:proxy:request', listener);
},
sendProxyReply: (payload: { reqId: number; result?: unknown; error?: string }) =>
  ipcRenderer.invoke('remote:proxy:reply', payload),
```

- [ ] **Step 2: Add to SaiRemoteApi**

In `src/vite-env.d.ts`, extend the `SaiRemoteApi` interface:

```ts
setActiveSession: (payload: { projectPath: string; scope: string; sessionId: string }) => Promise<void>;
onProxyRequest: (cb: (payload: { reqId: number; kind: string; args: any }) => void) => (() => void);
sendProxyReply: (payload: { reqId: number; result?: unknown; error?: string }) => Promise<void>;
```

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add electron/preload.ts src/vite-env.d.ts
git commit -m "feat(remote): preload exposures for proxy + active-session"
```

---

## Task 12: Renderer-side proxy handler (`src/lib/remoteProxyClient.ts`)

**Files:**
- Create: `src/lib/remoteProxyClient.ts`
- Modify: `src/App.tsx` (mount the handler)

- [ ] **Step 1: Create the handler module**

Create `src/lib/remoteProxyClient.ts`:

```ts
import { dbGetSessions, dbGetMessages } from '../chatDb';

export function installRemoteProxyHandler(): () => void {
  const sai = (window as any).sai;
  if (!sai?.remote?.onProxyRequest) return () => {};

  return sai.remote.onProxyRequest(async ({ reqId, kind, args }: { reqId: number; kind: string; args: any }) => {
    let result: unknown;
    let error: string | undefined;
    try {
      if (kind === 'listSessions') {
        result = await dbGetSessions(args.projectPath);
      } else if (kind === 'loadHistory') {
        result = await dbGetMessages(args.sessionId);
      } else {
        throw new Error(`unknown proxy kind: ${kind}`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    void sai.remote.sendProxyReply({ reqId, result, error });
  });
}
```

- [ ] **Step 2: Mount in App.tsx**

In `src/App.tsx`, find an existing top-level `useEffect` (or add one near the top of the component). Add:

```tsx
import { installRemoteProxyHandler } from './lib/remoteProxyClient';

// inside the App component, top-level effect:
useEffect(() => {
  const off = installRemoteProxyHandler();
  return off;
}, []);
```

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/remoteProxyClient.ts src/App.tsx
git commit -m "feat(remote): renderer-side proxy handler for chatDb reads"
```

---

## Task 13: Fire `setActiveSession` on workspace state change

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Find the active-session setter**

Per pre-flight, search for `activeSession:` in `src/App.tsx` — multiple spots update workspace state with a new active session. The cleanest insertion point is wherever `setWorkspaces(...)` is called with an `activeSession` change.

A simpler approach: add a `useEffect` that watches `activeWorkspace?.activeSession` and fires the IPC on change. Around line 1283 there's already an `activeSession` derivation; add this effect nearby:

```tsx
useEffect(() => {
  if (!activeWorkspace || !activeWorkspace.activeSession) return;
  void (window as any).sai?.remote?.setActiveSession?.({
    projectPath: activeWorkspace.path,
    scope: 'chat',
    sessionId: activeWorkspace.activeSession.id,
  });
}, [activeWorkspace?.path, activeWorkspace?.activeSession?.id]);
```

(Adapt property names based on what's actually in scope at that line. The key is to fire IPC whenever the active session ID changes.)

- [ ] **Step 2: Smoke**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
```

Expected: clean, no regressions.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(remote): broadcast active-session changes to followers"
```

---

## Task 14: Extend PWA wire.ts with chat helpers

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Add typed helpers to the returned WireClient**

Extend the `WireClient` interface and the object returned from `connect()`. Add new helpers that build typed frames:

```ts
export interface ChatPromptArgs { text: string; projectPath: string; scope?: string; model?: string; effort?: string; permMode?: string }
export interface ChatApprovalArgs { toolUseId: string; decision: 'approve' | 'deny'; modifiedCommand?: string; projectPath: string; scope?: string }

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: 'opening' | 'open' | 'closed') => void): () => void;
  attach(args: { projectPath: string; scope?: string; sessionId: string }): void;
  setFollow(enabled: boolean): void;
  listSessions(projectPath: string): Promise<unknown[]>;
  sendPrompt(args: ChatPromptArgs): void;
  approve(args: ChatApprovalArgs): void;
  interrupt(projectPath: string, scope?: string): void;
}
```

Inside `connect()`, before the `return`, add:

```ts
let reqCounter = 0;
const pendingReq = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
handlers.add((msg) => {
  if (typeof msg.reqId === 'string' && pendingReq.has(msg.reqId)) {
    const { resolve, reject } = pendingReq.get(msg.reqId as string)!;
    pendingReq.delete(msg.reqId as string);
    if ((msg as any).type === 'error') reject(new Error(String((msg as any).message ?? 'error')));
    else resolve((msg as any).sessions ?? msg);
  }
});

const send = (m: WireMsg) => ws?.send(JSON.stringify(m));
```

Replace the returned object with the extended one:

```ts
return {
  send,
  close: () => { closed = true; ws?.close(); },
  on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
  onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
  attach: (a) => send({ type: 'session.attach', projectPath: a.projectPath, scope: a.scope ?? 'chat', sessionId: a.sessionId }),
  setFollow: (enabled) => send({ type: 'session.follow', enabled }),
  listSessions: (projectPath) => new Promise((resolve, reject) => {
    const reqId = `r${++reqCounter}`;
    pendingReq.set(reqId, { resolve, reject });
    setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('sessions.list timeout')); }, 5000);
    send({ type: 'sessions.list', projectPath, reqId });
  }),
  sendPrompt: (a) => send({ type: 'prompt', text: a.text, projectPath: a.projectPath, scope: a.scope ?? 'chat', model: a.model, effort: a.effort, permMode: a.permMode }),
  approve: (a) => send({ type: 'approval', toolUseId: a.toolUseId, decision: a.decision, modifiedCommand: a.modifiedCommand, projectPath: a.projectPath, scope: a.scope ?? 'chat' }),
  interrupt: (projectPath, scope) => send({ type: 'interrupt', projectPath, scope: scope ?? 'chat' }),
};
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): extend PWA wire.ts with chat helpers"
```

---

## Task 15: PWA `ToolCard.tsx` (collapsible)

**Files:**
- Create: `src/renderer-remote/chat/ToolCard.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';

interface Props {
  name: string;
  input?: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

export default function ToolCard({ name, input, result, status }: Props) {
  const [expanded, setExpanded] = useState(false);
  const dot = status === 'done' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-amber-500';
  return (
    <div className="border border-neutral-800 rounded-md my-2 text-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-900"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span className="font-mono">{name}</span>
        <span className="ml-auto text-xs text-neutral-500">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs font-mono text-neutral-400 space-y-2">
          {input && (
            <div>
              <div className="text-neutral-500">input</div>
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(input, null, 2)}</pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <div className="text-neutral-500">result</div>
              <pre className="whitespace-pre-wrap break-all">{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: PWA build verifies**

```bash
npx vite build --config vite.config.pwa.ts
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/chat/ToolCard.tsx
git commit -m "feat(remote): PWA ToolCard with collapsible input/result"
```

---

## Task 16: PWA `Approval.tsx`

**Files:**
- Create: `src/renderer-remote/chat/Approval.tsx`

- [ ] **Step 1: Implement**

```tsx
interface Props {
  toolName: string;
  command?: string;
  input?: Record<string, unknown>;
  onDecide: (decision: 'approve' | 'deny', modifiedCommand?: string) => void;
}

export default function Approval({ toolName, command, input, onDecide }: Props) {
  return (
    <div className="border border-amber-700 bg-amber-950/30 rounded-md p-3 my-2 text-sm space-y-2">
      <div className="font-semibold">Approval needed: <span className="font-mono">{toolName}</span></div>
      {command && <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-neutral-950 p-2 rounded">{command}</pre>}
      {!command && input && <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-neutral-950 p-2 rounded">{JSON.stringify(input, null, 2)}</pre>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onDecide('approve')}
          className="px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-xs"
        >Allow</button>
        <button
          onClick={() => onDecide('deny')}
          className="px-3 py-1 rounded bg-neutral-800 hover:bg-red-700 text-xs"
        >Deny</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/Approval.tsx
git commit -m "feat(remote): PWA Approval banner"
```

---

## Task 17: PWA `Composer.tsx`

**Files:**
- Create: `src/renderer-remote/chat/Composer.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState, useRef } from 'react';

interface Props {
  streaming: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export default function Composer({ streaming, onSend, onInterrupt }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    ref.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="border-t border-neutral-800 p-2 flex gap-2 items-end">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={streaming ? 'Responding…' : 'Message'}
        rows={1}
        className="flex-1 resize-none bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
      />
      {streaming ? (
        <button
          onClick={onInterrupt}
          className="px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-sm"
        >Stop</button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
        >Send</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/Composer.tsx
git commit -m "feat(remote): PWA Composer input"
```

---

## Task 18: PWA `Transcript.tsx` (renders message list)

**Files:**
- Create: `src/renderer-remote/chat/Transcript.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef } from 'react';
import ToolCard from './ToolCard';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string | Record<string, unknown>;
  toolStatus?: 'running' | 'done' | 'error';
  streaming?: boolean;
}

interface Props {
  messages: TranscriptMessage[];
}

export default function Transcript({ messages }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.text?.length]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      {messages.map((m) => {
        if (m.role === 'tool') {
          return (
            <ToolCard
              key={m.id}
              name={m.toolName ?? 'tool'}
              input={m.toolInput}
              result={m.toolResult}
              status={m.toolStatus ?? 'running'}
            />
          );
        }
        const bubble = m.role === 'user'
          ? 'bg-blue-600 text-white self-end'
          : m.role === 'system'
          ? 'bg-neutral-900 text-neutral-400 text-xs italic'
          : 'bg-neutral-900 text-neutral-100';
        return (
          <div key={m.id} className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${bubble}`}>
            {m.streaming && !m.text ? (
              <span className="inline-flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse delay-100" />
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse delay-200" />
              </span>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans">{m.text}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/Transcript.tsx
git commit -m "feat(remote): PWA Transcript with bubbles and tool cards"
```

---

## Task 19: PWA `SessionDrawer.tsx`

**Files:**
- Create: `src/renderer-remote/chat/SessionDrawer.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState, useEffect } from 'react';
import type { WireClient } from '../wire';

interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
}

interface Props {
  client: WireClient;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  onAttach: (projectPath: string, sessionId: string) => void;
  currentProjectPath: string | null;
  open: boolean;
  onClose: () => void;
}

export default function SessionDrawer({ client, followEnabled, onFollowChange, onAttach, currentProjectPath, open, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentProjectPath) return;
    setLoading(true); setErr(null);
    client.listSessions(currentProjectPath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, currentProjectPath, client]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="w-72 bg-neutral-950 border-r border-neutral-800 flex flex-col">
        <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="text-sm font-semibold">Sessions</div>
          <button onClick={onClose} className="text-neutral-400 text-xl leading-none">×</button>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-neutral-900">
          <input type="checkbox" checked={followEnabled} onChange={(e) => onFollowChange(e.target.checked)} />
          Follow desktop
        </label>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-neutral-500">Loading…</div>}
          {err && <div className="px-3 py-2 text-xs text-red-400">{err}</div>}
          {!loading && sessions.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">No sessions for this workspace.</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { onAttach(s.projectPath, s.id); onClose(); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-900 border-b border-neutral-900"
            >
              <div className="truncate">{s.title ?? `Session ${s.id.slice(0, 6)}`}</div>
              <div className="text-xs text-neutral-500">{new Date(s.updatedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-black/40" onClick={onClose} />
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/SessionDrawer.tsx
git commit -m "feat(remote): PWA SessionDrawer with follow toggle"
```

---

## Task 20: PWA `Chat.tsx` (orchestrator)

**Files:**
- Create: `src/renderer-remote/chat/Chat.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { WireClient } from '../wire';
import Transcript, { type TranscriptMessage } from './Transcript';
import Composer from './Composer';
import Approval from './Approval';
import SessionDrawer from './SessionDrawer';

interface Props {
  client: WireClient;
  initialActive?: { projectPath: string; scope: string; sessionId: string };
}

interface PendingApproval { toolUseId: string; toolName: string; command?: string; input?: Record<string, unknown> }

export default function Chat({ client, initialActive }: Props) {
  const [active, setActive] = useState<{ projectPath: string; scope: string; sessionId: string } | null>(initialActive ?? null);
  const [follow, setFollow] = useState(true);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Re-attach when active changes.
  useEffect(() => {
    if (!active) return;
    setMessages([]); setPendingApproval(null); setStreaming(false);
    client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId: active.sessionId });
  }, [active?.projectPath, active?.scope, active?.sessionId]);

  // Follow toggle.
  useEffect(() => { client.setFollow(follow); }, [follow]);

  useEffect(() => {
    const off = client.on((msg) => {
      const t = (msg as any).type;
      if (t === 'session.active' && follow) {
        setActive({ projectPath: (msg as any).projectPath, scope: (msg as any).scope, sessionId: (msg as any).sessionId });
        return;
      }
      if (t === 'session.history') {
        const raw = (msg as any).messages ?? [];
        setMessages(raw.map((m: any, i: number) => ({
          id: `h-${i}`, role: m.role ?? 'assistant', text: m.text ?? m.content ?? '',
        })));
        return;
      }
      if (t === 'streaming_start') { setStreaming(true); return; }
      if (t === 'assistant') {
        const text = (msg as any).text ?? '';
        setMessages((arr) => {
          const last = arr[arr.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            return [...arr.slice(0, -1), { ...last, text: (last.text ?? '') + text }];
          }
          return [...arr, { id: `a-${Date.now()}`, role: 'assistant', text, streaming: true }];
        });
        return;
      }
      if (t === 'user_message') {
        const text = (msg as any).text ?? '';
        const origin = (msg as any).origin;
        setMessages((arr) => {
          // Dedup: if last optimistic remote-origin bubble matches, replace.
          const last = arr[arr.length - 1];
          if (last && last.role === 'user' && last.text === text && origin === 'remote') return arr;
          return [...arr, { id: `u-${Date.now()}`, role: 'user', text }];
        });
        return;
      }
      if (t === 'result' || t === 'done') {
        setStreaming(false);
        setMessages((arr) => arr.map((m, i) => i === arr.length - 1 && m.streaming ? { ...m, streaming: false } : m));
        return;
      }
      if (t === 'approval_needed') {
        setPendingApproval({
          toolUseId: (msg as any).toolUseId,
          toolName: (msg as any).toolName ?? 'tool',
          command: (msg as any).command,
          input: (msg as any).input,
        });
        return;
      }
      if (t === 'error') {
        setMessages((arr) => [...arr, { id: `e-${Date.now()}`, role: 'system', text: `Error: ${(msg as any).message ?? 'unknown'}` }]);
        setStreaming(false);
        return;
      }
    });
    return off;
  }, [client, follow]);

  const onSend = (text: string) => {
    if (!active) return;
    setMessages((arr) => [...arr, { id: `u-opt-${Date.now()}`, role: 'user', text }]);
    setMessages((arr) => [...arr, { id: `a-pending-${Date.now()}`, role: 'assistant', text: '', streaming: true }]);
    setStreaming(true);
    client.sendPrompt({ text, projectPath: active.projectPath, scope: active.scope });
  };

  const onInterrupt = () => { if (active) client.interrupt(active.projectPath, active.scope); };

  const onApprove = (decision: 'approve' | 'deny', modifiedCommand?: string) => {
    if (!pendingApproval || !active) return;
    client.approve({
      toolUseId: pendingApproval.toolUseId,
      decision,
      modifiedCommand,
      projectPath: active.projectPath,
      scope: active.scope,
    });
    setPendingApproval(null);
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b border-neutral-800 px-3 py-2 flex items-center gap-2">
        <button onClick={() => setDrawerOpen(true)} aria-label="Open sessions" className="text-2xl leading-none">≡</button>
        <div className="text-sm truncate flex-1">
          {active ? <><span className="text-neutral-500">{active.projectPath}</span></> : <span className="text-neutral-500">No session attached</span>}
        </div>
      </div>
      <Transcript messages={messages} />
      {pendingApproval && (
        <div className="px-3">
          <Approval
            toolName={pendingApproval.toolName}
            command={pendingApproval.command}
            input={pendingApproval.input}
            onDecide={onApprove}
          />
        </div>
      )}
      <Composer streaming={streaming} onSend={onSend} onInterrupt={onInterrupt} />
      <SessionDrawer
        client={client}
        followEnabled={follow}
        onFollowChange={setFollow}
        onAttach={(projectPath, sessionId) => setActive({ projectPath, scope: 'chat', sessionId })}
        currentProjectPath={active?.projectPath ?? null}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/Chat.tsx
git commit -m "feat(remote): PWA Chat orchestrator"
```

---

## Task 21: Route PWA App.tsx to `<Chat />` after auth_ok

**Files:**
- Modify: `src/renderer-remote/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

```tsx
import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import Status from './Status';
import Chat from './chat/Chat';

export default function App() {
  const [phase, setPhase] = useState<'init' | 'pairing' | 'connected' | 'needs-pair' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [wsState, setWsState] = useState<'opening' | 'open' | 'closed'>('opening');
  const [client, setClient] = useState<WireClient | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        let bearer = localStorage.getItem(BEARER_KEY);
        const code = extractPairCode(location.href);
        if (code && !bearer) {
          setPhase('pairing');
          const label = navigator.userAgent.slice(0, 64);
          const { token, deviceId } = await pair(code, label);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
          history.replaceState(null, '', location.pathname);
          bearer = localStorage.getItem(BEARER_KEY);
        }
        if (!bearer) { setPhase('needs-pair'); return; }
        const { token } = JSON.parse(bearer);
        const c = connect(token);
        c.onState(setWsState);
        c.on((msg) => { if (msg.type === 'auth_ok') setPhase('connected'); });
        setClient(c);
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, []);

  const disconnect = () => {
    client?.close();
    localStorage.removeItem(BEARER_KEY);
    location.reload();
  };

  if (phase === 'connected' && client) {
    if (wsState !== 'open') {
      // Show a minimal status when WS drops mid-session
      return <Status deviceLabel="" serverUrl={location.origin} wsState={wsState} onDisconnect={disconnect} />;
    }
    return <Chat client={client} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-3 text-center">
      {phase === 'init' && <p>Connecting…</p>}
      {phase === 'pairing' && <p>Pairing…</p>}
      {phase === 'needs-pair' && (
        <>
          <h1 className="text-xl font-semibold">Re-pair required</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            Open the SAI app on your computer, go to Settings → Mobile Remote → Pair a new device, and scan the QR code with your phone camera.
          </p>
        </>
      )}
      {phase === 'error' && <p className="text-red-400">Error: {error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/App.tsx
git commit -m "feat(remote): PWA routes to Chat after auth_ok"
```

---

## Task 22: Integration end-to-end test

**Files:**
- Create: `tests/integration/remote/chat-end-to-end.test.ts`

This test exercises the wire end-to-end, using a stubbed `sendPrompt`/`resolveApproval`/`listSessions`/`loadHistory` (no real claude.ts). The claude.ts wiring is exercised by manual smoke since spawning a real Claude CLI in tests is fragile.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('mobile remote chat end-to-end', () => {
  it('attach → bus event → prompt → approval → interrupt', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const sendPromptCalls: any[] = [];
    const approveCalls: any[] = [];
    let interruptCalls = 0;

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        sendPrompt: (args) => { sendPromptCalls.push(args); },
        resolveApproval: async (args) => { approveCalls.push(args); },
        interruptTurn: () => { interruptCalls++; },
        listSessions: async () => [{ id: 's1', projectPath: '/p', updatedAt: 0 }],
        loadHistory: async () => [{ role: 'user', text: 'hi' }],
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();

    // pair
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();

    // ws + auth
    const ws = new WebSocket(`${url!.replace(/^http/, 'ws')}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => setTimeout(r, 50));
    expect(inbox.find((m) => m.type === 'auth_ok')).toBeTruthy();

    // attach
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(inbox.find((m) => m.type === 'session.history')?.messages).toEqual([{ role: 'user', text: 'hi' }]);

    // bus event flows
    bus.publish('chat:/p:chat', { type: 'assistant', text: 'hello' });
    bus.publish('chat:/other:chat', { type: 'assistant', text: 'dropped' });
    await new Promise((r) => setTimeout(r, 30));
    const assistantFrames = inbox.filter((m) => m.type === 'assistant');
    expect(assistantFrames).toHaveLength(1);
    expect(assistantFrames[0].text).toBe('hello');
    expect(assistantFrames[0].topic).toBe('chat:/p:chat');

    // prompt
    ws.send(JSON.stringify({ type: 'prompt', text: 'go', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(sendPromptCalls).toEqual([expect.objectContaining({ text: 'go', projectPath: '/p' })]);

    // approval
    ws.send(JSON.stringify({ type: 'approval', toolUseId: 'tu1', decision: 'approve', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(approveCalls).toEqual([expect.objectContaining({ toolUseId: 'tu1', decision: 'approve' })]);

    // interrupt
    ws.send(JSON.stringify({ type: 'interrupt', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(interruptCalls).toBe(1);

    ws.close();
    await remote.stop();
  });
});
```

- [ ] **Step 2: Run**

```bash
npm run test:integration -- tests/integration/remote/chat-end-to-end.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote/chat-end-to-end.test.ts
git commit -m "test(remote): chat end-to-end (attach/bus/prompt/approval/interrupt)"
```

---

## Task 23: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p1-smoke.md`

- [ ] **Step 1: Write**

```markdown
# Mobile Remote Phase 1 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 1 done.

## Prerequisites

- [ ] Phase 0 smoke passes (pair, status, revoke).
- [ ] Tailscale on both sides; phone PWA installed via Add-to-Home-Screen.
- [ ] At least one workspace open in SAI with a Claude chat session.

## Streaming + prompts

- [ ] On phone, open the PWA. Verify chat surface renders with a "≡" hamburger and the active session's projectPath at the top.
- [ ] Type a prompt on desktop; phone shows the user bubble and assistant streaming response.
- [ ] Type a prompt on phone; desktop transcript shows the user bubble (origin=remote dedup works — no duplicate); both surfaces stream the response.
- [ ] Mid-stream, tap "Stop" on phone; both surfaces show the turn ends cleanly.

## Tool cards

- [ ] Trigger a tool call (e.g., a Bash command). Phone shows a collapsed tool card; tap to expand input/result.

## Approvals

- [ ] Trigger a tool that requires approval. Both surfaces show approval banner.
- [ ] Approve from phone. Desktop banner dismisses; tool runs.
- [ ] Trigger another approval; deny from desktop. Phone banner dismisses; tool blocked.

## Session switching

- [ ] On phone, open the drawer (≡). Verify follow-mode is on by default and the desktop's active session is highlighted.
- [ ] Toggle follow-mode off. On phone drawer, tap a different session — phone re-attaches; transcript loads its history.
- [ ] Switch desktop's active session. Phone (with follow off) stays on the previously chosen session.
- [ ] Toggle follow-mode back on. Phone immediately re-attaches to desktop's active session.

## Autonomy clamp

- [ ] Set desktop approval mode to "auto" and remoteCeiling to "always-ask".
- [ ] Send a write-tool prompt from phone. Verify approval banner appears (despite desktop being "auto").
- [ ] Set remoteCeiling to "No clamp". Same prompt from phone now auto-approves.

## Reconnect

- [ ] Toggle Tailscale off on phone mid-stream. WS closes; on reconnect, phone re-attaches and resumes streaming via bus replay.
- [ ] Quit and restart SAI. Phone PWA (still open) auto-reconnects, re-attaches to last session.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p1-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 1"
```

---

## Task 24: Full test sweep + tsc

- [ ] **Step 1: Run full suite**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -10
```

Expected: all tests pass (P0's 1288 + Phase 1's ~12 new unit + 1 integration = ~1301).

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Build the PWA bundle to verify**

```bash
npx vite build --config vite.config.pwa.ts
```

Expected: success; `dist/renderer-remote/` includes the new chat components.

- [ ] **Step 4: If anything fails, fix in place and re-run before committing**

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore(remote): final tidy after p1 verification" || true
```

---

## Done

Phase 1 is complete when:

1. All vitest unit tests pass (Phase 0's tests still green; Phase 1's new tests passing).
2. The chat end-to-end integration test passes.
3. `tsc --noEmit` is clean.
4. The PWA bundle builds.
5. Manual smoke checklist walked on real hardware: pair → attach → bidirectional prompt+stream → approval-from-phone → interrupt-from-phone → follow-mode switch → detached session pick → autonomy clamp verification.

After this lands, brainstorm Phase 2 (Workspace switcher + Settings) per the roadmap.
