# Mobile Remote — Phase 2 Workspaces + Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace switcher to the PWA drawer that drives both phone attach and the desktop's active workspace, plus a sticky chip row above the composer for per-prompt `model` / `effort` / `permMode` overrides.

**Architecture:** Two new WS message types (`workspaces.list`, `workspace.set`) routed through the existing P1 bridge. Both delegate to two new `RendererProxy` kinds (`listWorkspaces`, `setActiveWorkspace`) that read from / write to the renderer's existing workspace state. PWA adds three React components (`WorkspacePicker`, `OverridesBar`, `PickerSheet`) and persists override values per session in `localStorage`. No prompt wire schema changes — `model`/`effort`/`permMode` already accepted by P1.

**Tech Stack:** TypeScript, Electron `ipcMain`/`ipcRenderer`, `ws`, vitest, React, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p2-workspaces-design.md`. **P0/P1 reference:** already in `main`. **Branch:** `feat/mobile-remote-p2` is already checked out.

---

## Pre-flight notes

- `RendererProxy` lives at `electron/services/remote/renderer-proxy.ts`. Current `Kind` union: `'listSessions' | 'loadHistory' | 'getActiveSession'`.
- `BridgeServer` opts already include `listSessions`, `loadHistory`, `getActiveSessionFromRenderer`. We add `listWorkspaces` + `setActiveWorkspace`.
- Renderer state shape: `workspaces` is `Map<string, WorkspaceContext>` keyed by `projectPath`. `metaWorkspaces` is `MetaWorkspaceListItem[]` per `src/types.ts`. The `syntheticRoot` of a meta is the projectPath that appears in `workspaces` when the meta is open.
- `setActiveProjectPath` is the renderer-side setter.
- `installRemoteProxyHandler` in `src/lib/remoteProxyClient.ts` currently takes `{ getActiveSession }`. We widen its deps.
- PWA wire helpers live in `src/renderer-remote/wire.ts`. `client.listSessions` shows the request/reply correlation pattern.

---

## File structure

**New (Electron):**
- (none — extending existing `renderer-proxy.ts` + `bridge-server.ts`)

**New (renderer/PWA):**
- `src/renderer-remote/chat/WorkspacePicker.tsx`
- `src/renderer-remote/chat/OverridesBar.tsx`
- `src/renderer-remote/chat/PickerSheet.tsx`
- `src/renderer-remote/lib/overrides.ts` (localStorage helper, per-session map)
- `docs/superpowers/notes/2026-05-25-mobile-remote-p2-smoke.md`

**Modified:**
- `electron/services/remote/renderer-proxy.ts` — add two kinds + methods
- `electron/services/remote/bridge-server.ts` — two new WS handlers + opts
- `electron/main.ts` — wire opts to proxy
- `src/lib/remoteProxyClient.ts` — widen deps, handle new kinds
- `src/App.tsx` — provide `listWorkspaces` + `setActiveWorkspace` to the proxy handler
- `src/renderer-remote/wire.ts` — add `listWorkspaces` + `setActiveWorkspace` helpers
- `src/renderer-remote/chat/Chat.tsx` — mount OverridesBar, clear overrides on session change, spread overrides into `sendPrompt`
- `src/renderer-remote/chat/SessionDrawer.tsx` — mount WorkspacePicker above sessions list

---

## Task 1: Extend `RendererProxy` with workspace kinds

**Files:**
- Modify: `electron/services/remote/renderer-proxy.ts`
- Modify: `tests/unit/remote/renderer-proxy.test.ts`

- [ ] **Step 1: Add types + extend `Kind` union**

In `electron/services/remote/renderer-proxy.ts`, extend the `Kind` type and add the public types + methods:

```ts
type Kind = 'listSessions' | 'loadHistory' | 'getActiveSession'
          | 'listWorkspaces' | 'setActiveWorkspace';

export interface RemoteWorkspace {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}
```

Add methods on `RendererProxy` next to the existing `listSessions` / `loadHistory` / `getActiveSession`:

```ts
listWorkspaces(): Promise<RemoteWorkspace[]> {
  return this.request('listWorkspaces', {}) as Promise<RemoteWorkspace[]>;
}

setActiveWorkspace(projectPath: string): Promise<void> {
  return this.request('setActiveWorkspace', { projectPath }) as Promise<void>;
}
```

- [ ] **Step 2: Add failing tests**

Append to `tests/unit/remote/renderer-proxy.test.ts` inside the existing `describe`:

```ts
it('listWorkspaces sends correct request and resolves with reply', async () => {
  const win = { webContents: { send: vi.fn(), isDestroyed: () => false }, isDestroyed: () => false };
  const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
  const promise = proxy.listWorkspaces();
  const [, payload] = win.webContents.send.mock.calls[0];
  expect(payload.kind).toBe('listWorkspaces');
  expect(payload.args).toEqual({});
  proxy.handleReply({ reqId: payload.reqId, result: [{ projectPath: '/p', name: 'p', kind: 'project' }] });
  expect(await promise).toEqual([{ projectPath: '/p', name: 'p', kind: 'project' }]);
});

it('setActiveWorkspace sends path and resolves', async () => {
  const win = { webContents: { send: vi.fn(), isDestroyed: () => false }, isDestroyed: () => false };
  const proxy = new RendererProxy({ getWindow: () => win as any, timeoutMs: 100 });
  const promise = proxy.setActiveWorkspace('/p');
  const [, payload] = win.webContents.send.mock.calls[0];
  expect(payload.kind).toBe('setActiveWorkspace');
  expect(payload.args).toEqual({ projectPath: '/p' });
  proxy.handleReply({ reqId: payload.reqId, result: null });
  await expect(promise).resolves.toBeNull();
});
```

- [ ] **Step 3: Verify pass + tsc + commit**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx vitest run tests/unit/remote/renderer-proxy.test.ts
npx tsc --noEmit
git add electron/services/remote/renderer-proxy.ts tests/unit/remote/renderer-proxy.test.ts
git commit -m "feat(remote): RendererProxy listWorkspaces + setActiveWorkspace"
```

Expected: 7 tests passing (5 existing + 2 new); tsc clean.

---

## Task 2: Extend `BridgeServer` opts + WS routing

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Modify: `tests/unit/remote/bridge-server-chat.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/remote/bridge-server-chat.test.ts` (inside the existing `describe('BridgeServer chat routing', ...)` block):

```ts
it('workspaces.list calls callback and replies with reqId', async () => {
  const listWorkspaces = vi.fn().mockResolvedValue([{ projectPath: '/p', name: 'p', kind: 'project' }]);
  server = new BridgeServer({
    tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus,
    pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    listWorkspaces,
  });
  ({ port } = await server.start());
  const ws = await pairedSocket(server, port);
  ws.send(JSON.stringify({ type: 'workspaces.list', reqId: 'w1' }));
  const m = await once(ws, (m) => m.type === 'workspaces.list.result');
  expect(m.reqId).toBe('w1');
  expect(m.workspaces).toEqual([{ projectPath: '/p', name: 'p', kind: 'project' }]);
  expect(listWorkspaces).toHaveBeenCalledOnce();
  ws.close();
});

it('workspace.set calls setActiveWorkspace', async () => {
  const setActiveWorkspace = vi.fn().mockResolvedValue(undefined);
  server = new BridgeServer({
    tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus,
    pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    setActiveWorkspace,
  });
  ({ port } = await server.start());
  const ws = await pairedSocket(server, port);
  ws.send(JSON.stringify({ type: 'workspace.set', projectPath: '/p/other' }));
  await new Promise((r) => setTimeout(r, 30));
  expect(setActiveWorkspace).toHaveBeenCalledWith('/p/other');
  ws.close();
});
```

Note: these tests construct fresh `BridgeServer` instances inside the `it` blocks instead of using the existing `beforeEach`. Restructure to a per-test setup OR move these into their own `describe` block with a custom `beforeEach`. Pick whichever fits the existing test file shape.

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-chat.test.ts
```

Expected: 2 new failures.

- [ ] **Step 3: Extend `BridgeServerOpts`**

In `electron/services/remote/bridge-server.ts`, find the `BridgeServerOpts` interface. Add (alongside existing P1 fields):

```ts
listWorkspaces?: () => Promise<import('./renderer-proxy').RemoteWorkspace[]>;
setActiveWorkspace?: (projectPath: string) => Promise<void>;
```

(Or define a local `RemoteWorkspace` interface adjacent to existing `SessionMeta`/`PromptArgs`; pick whichever keeps the file consistent.)

- [ ] **Step 4: Add WS message handlers**

In the `handleWs` method, immediately AFTER the existing `if (msg.type === 'sessions.list' ...)` branch and BEFORE any `prompt` / `approval` / etc., add:

```ts
if (msg.type === 'workspaces.list') {
  const reqId = msg.reqId;
  try {
    const workspaces = (await this.opts.listWorkspaces?.()) ?? [];
    ws.send(JSON.stringify({ v: 1, type: 'workspaces.list.result', reqId, workspaces }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'list_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'workspace.set' && typeof msg.projectPath === 'string') {
  try { await this.opts.setActiveWorkspace?.(msg.projectPath); }
  catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', code: 'switch_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 5: Verify pass + tsc + commit**

```bash
npx vitest run tests/unit/remote/bridge-server-chat.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-chat.test.ts
git commit -m "feat(remote): bridge routing for workspaces.list + workspace.set"
```

Expected: full suite 1314 passing (1312 + 2 new chat tests); tsc clean.

---

## Task 3: Wire main.ts proxy callbacks

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add the two callbacks to the bridge construction**

Find the existing `makeBridge: (tailnetIp) => new BridgeServer({...})` call. Append two fields:

```ts
listWorkspaces: () => rendererProxy!.listWorkspaces(),
setActiveWorkspace: (path) => rendererProxy!.setActiveWorkspace(path),
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add electron/main.ts
git commit -m "feat(remote): wire workspaces proxy into BridgeServer"
```

---

## Task 4: Widen `remoteProxyClient` deps + handle new kinds

**Files:**
- Modify: `src/lib/remoteProxyClient.ts`

- [ ] **Step 1: Extend the deps interface**

Open `src/lib/remoteProxyClient.ts`. Replace the existing `RemoteProxyDeps`:

```ts
export interface RemoteWorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}

export interface RemoteProxyDeps {
  getActiveSession: () => ActiveSessionSnapshot | null;
  listWorkspaces: () => RemoteWorkspaceMeta[];
  setActiveWorkspace: (projectPath: string) => void;
}
```

Inside the handler `if/else` chain (after the existing `getActiveSession` branch), add:

```ts
else if (kind === 'listWorkspaces') {
  result = deps.listWorkspaces();
}
else if (kind === 'setActiveWorkspace') {
  deps.setActiveWorkspace(args.projectPath);
  result = null;
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
```

This will fail because `src/App.tsx` calls `installRemoteProxyHandler({ getActiveSession: ... })` with the old signature. That's expected; Task 5 fixes it. **Skip the commit; continue to Task 5.**

---

## Task 5: Provide workspace deps from App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update the proxy handler installation**

Find the existing `installRemoteProxyHandler({ getActiveSession: () => activeSessionRef.current })` call (added in P1, ~line 292). Replace with:

```tsx
const off = installRemoteProxyHandler({
  getActiveSession: () => activeSessionRef.current,
  listWorkspaces: () => {
    const out: { projectPath: string; name: string; kind: 'project' | 'meta'; members?: { projectPath: string; name: string }[] }[] = [];
    const metaByPath = new Map<string, typeof metaWorkspaces[number]>();
    for (const m of metaWorkspaces) {
      if (m.syntheticRoot) metaByPath.set(m.syntheticRoot, m);
    }
    workspacesRef.current.forEach((_, projectPath) => {
      const meta = metaByPath.get(projectPath);
      if (meta) {
        out.push({
          projectPath,
          name: meta.name,
          kind: 'meta',
          members: meta.projects.map((p) => ({ projectPath: p.projectPath, name: p.name })),
        });
      } else {
        const base = projectPath.split('/').filter(Boolean).pop() ?? projectPath;
        out.push({ projectPath, name: base, kind: 'project' });
      }
    });
    return out;
  },
  setActiveWorkspace: (path) => setActiveProjectPath(path),
});
```

The closure captures `metaWorkspaces`, `workspacesRef`, and `setActiveProjectPath` from the App component scope. Since this is inside a `useEffect(..., [])`, the closure's `metaWorkspaces` will be the initial empty array. Replace the dep array to re-install the handler when `metaWorkspaces` changes:

```tsx
}, [metaWorkspaces]);
```

`workspacesRef.current` is a ref so doesn't need to be in deps. `setActiveProjectPath` is stable from useState.

- [ ] **Step 2: tsc + full suite**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
```

Expected: tsc clean; all tests passing (the unit tests don't exercise the renderer integration).

- [ ] **Step 3: Commit (this rolls up Task 4 + 5)**

```bash
git add src/lib/remoteProxyClient.ts src/App.tsx
git commit -m "feat(remote): renderer-side handler for listWorkspaces + setActiveWorkspace"
```

---

## Task 6: Extend PWA `wire.ts` with workspace helpers

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend the `WireClient` interface**

Find the existing `WireClient` interface (added in P1). Add to the interface:

```ts
listWorkspaces(): Promise<unknown[]>;
setActiveWorkspace(projectPath: string): void;
```

- [ ] **Step 2: Add helpers to the returned object inside `connect()`**

Find the existing object returned from `connect()`. Add two fields:

```ts
listWorkspaces: () => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('workspaces.list timeout')); }, 5000);
  sendFrame({ type: 'workspaces.list', reqId });
}),
setActiveWorkspace: (projectPath) => sendFrame({ type: 'workspace.set', projectPath }),
```

The pendingReq Map already routes replies by `reqId` (added in P1). The reply handler dispatches by `reqId` matching — it currently does `resolve(msg.sessions ?? msg)` which works for `sessions.list.result`. For workspaces, the reply has `msg.workspaces`; tweak the handler:

```ts
// Existing inside handlers.add(...):
if (typeof reqId === 'string' && pendingReq.has(reqId)) {
  const entry = pendingReq.get(reqId)!;
  pendingReq.delete(reqId);
  if ((msg as any).type === 'error') {
    entry.reject(new Error(String((msg as any).message ?? 'error')));
  } else if ((msg as any).type === 'sessions.list.result') {
    entry.resolve((msg as any).sessions ?? []);
  } else if ((msg as any).type === 'workspaces.list.result') {
    entry.resolve((msg as any).workspaces ?? []);
  } else {
    entry.resolve(msg);
  }
}
```

- [ ] **Step 3: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): PWA wire helpers for workspace list/switch"
```

---

## Task 7: PWA `PickerSheet.tsx` — bottom-sheet picker

**Files:**
- Create: `src/renderer-remote/chat/PickerSheet.tsx`

- [ ] **Step 1: Create the component**

```tsx
interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T> {
  open: boolean;
  title: string;
  options: Option<T>[];
  current: T | undefined;
  onSelect: (value: T | undefined) => void;
  onClose: () => void;
  /** Optional row to reset to "use desktop default" */
  allowClear?: boolean;
  clearLabel?: string;
}

export default function PickerSheet<T extends string>({
  open, title, options, current, onSelect, onClose, allowClear, clearLabel,
}: Props<T>) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          paddingBottom: 'env(safe-area-inset-bottom)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '14px 16px 10px',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
        }}>
          {title}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {allowClear && (
            <button
              onClick={() => { onSelect(undefined); onClose(); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                background: 'transparent',
                color: current === undefined ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'inherit',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {clearLabel ?? 'Use desktop default'}
            </button>
          )}
          {options.map((opt) => {
            const selected = opt.value === current;
            return (
              <button
                key={String(opt.value)}
                onClick={() => { onSelect(opt.value); onClose(); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text)',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: selected ? 600 : 400 }}>{opt.label}</div>
                {opt.hint && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {opt.hint}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/PickerSheet.tsx
git commit -m "feat(remote): PWA bottom-sheet picker"
```

---

## Task 8: PWA `overrides.ts` — localStorage helper

**Files:**
- Create: `src/renderer-remote/lib/overrides.ts`

- [ ] **Step 1: Create the module**

```ts
const KEY = 'sai-remote-overrides';

export interface SessionOverrides {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  permMode?: 'auto' | 'auto-read' | 'always-ask';
}

type OverrideMap = Record<string /* sessionId */, SessionOverrides>;

function read(): OverrideMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function write(map: OverrideMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota/etc. */ }
}

export function getOverrides(sessionId: string): SessionOverrides {
  return read()[sessionId] ?? {};
}

export function setOverrides(sessionId: string, next: SessionOverrides): void {
  const map = read();
  map[sessionId] = next;
  write(map);
}

export function clearOverrides(sessionId: string): void {
  const map = read();
  delete map[sessionId];
  write(map);
}
```

- [ ] **Step 2: PWA build + commit**

```bash
mkdir -p src/renderer-remote/lib
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/lib/overrides.ts
git commit -m "feat(remote): PWA per-session override localStorage helper"
```

---

## Task 9: PWA `OverridesBar.tsx` — chip row above composer

**Files:**
- Create: `src/renderer-remote/chat/OverridesBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import PickerSheet from './PickerSheet';
import type { SessionOverrides } from '../lib/overrides';

const CLAUDE_MODELS: { value: string; label: string; hint?: string }[] = [
  { value: 'claude-opus-4-7',           label: 'Opus 4.7',   hint: 'most capable' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', hint: 'balanced' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  hint: 'fastest' },
];

const EFFORTS: { value: 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
];

const PERM_MODES: { value: 'auto' | 'auto-read' | 'always-ask'; label: string; hint?: string }[] = [
  { value: 'auto',        label: 'Auto',        hint: 'allow all tools' },
  { value: 'auto-read',   label: 'Auto reads',  hint: 'allow reads, ask for writes' },
  { value: 'always-ask',  label: 'Always ask',  hint: 'approve every tool' },
];

type Field = 'model' | 'effort' | 'permMode';

interface Props {
  overrides: SessionOverrides;
  onChange: (next: SessionOverrides) => void;
}

export default function OverridesBar({ overrides, onChange }: Props) {
  const [open, setOpen] = useState<Field | null>(null);

  const chipBase: React.CSSProperties = {
    flexShrink: 0,
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    cursor: 'pointer',
  };

  const modelLabel = overrides.model
    ? (CLAUDE_MODELS.find((m) => m.value === overrides.model)?.label ?? overrides.model)
    : 'default model';
  const effortLabel = overrides.effort ? `effort: ${overrides.effort}` : 'effort: default';
  const modeLabel = overrides.permMode ? `mode: ${overrides.permMode}` : 'mode: default';

  const chipStyle = (set: boolean): React.CSSProperties => ({
    ...chipBase,
    color: set ? 'var(--accent)' : 'var(--text-muted)',
    borderColor: set ? 'var(--accent)' : 'var(--border)',
  });

  const allClear = !overrides.model && !overrides.effort && !overrides.permMode;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 10px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <button style={chipStyle(!!overrides.model)} onClick={() => setOpen('model')}>{modelLabel}</button>
      <button style={chipStyle(!!overrides.effort)} onClick={() => setOpen('effort')}>{effortLabel}</button>
      <button style={chipStyle(!!overrides.permMode)} onClick={() => setOpen('permMode')}>{modeLabel}</button>
      {!allClear && (
        <button
          onClick={() => onChange({})}
          style={{
            flexShrink: 0,
            marginLeft: 'auto',
            padding: '4px 8px',
            fontSize: 11,
            background: 'transparent',
            color: 'var(--text-muted)',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          reset
        </button>
      )}

      <PickerSheet
        open={open === 'model'}
        title="Model"
        options={CLAUDE_MODELS}
        current={overrides.model}
        onSelect={(v) => onChange({ ...overrides, model: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
      <PickerSheet
        open={open === 'effort'}
        title="Effort"
        options={EFFORTS}
        current={overrides.effort}
        onSelect={(v) => onChange({ ...overrides, effort: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
      <PickerSheet
        open={open === 'permMode'}
        title="Approval mode"
        options={PERM_MODES}
        current={overrides.permMode}
        onSelect={(v) => onChange({ ...overrides, permMode: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/OverridesBar.tsx
git commit -m "feat(remote): PWA OverridesBar chip row"
```

---

## Task 10: PWA `WorkspacePicker.tsx` — workspaces section in drawer

**Files:**
- Create: `src/renderer-remote/chat/WorkspacePicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from 'react';
import { Folder, Layers } from 'lucide-react';
import type { WireClient } from '../wire';

interface WorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}

interface Props {
  client: WireClient;
  currentProjectPath: string | null;
  onPick: (projectPath: string) => void;
}

export default function WorkspacePicker({ client, currentProjectPath, onPick }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    client.listWorkspaces()
      .then((ws) => setWorkspaces((ws as WorkspaceMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [client]);

  return (
    <div>
      <div style={{
        padding: '12px 14px 6px',
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
      }}>
        Workspaces
      </div>
      {loading && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
      {err && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
      {!loading && !err && workspaces.length === 0 && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          No workspaces open on desktop.
        </div>
      )}
      {workspaces.map((w) => {
        const active = w.projectPath === currentProjectPath;
        const Icon = w.kind === 'meta' ? Layers : Folder;
        return (
          <button
            key={w.projectPath}
            onClick={() => onPick(w.projectPath)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 14px 10px 12px',
              background: 'transparent',
              color: 'var(--text)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={14} color={active ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={2} />
              <span style={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text)',
              }}>
                {w.name}
              </span>
              {w.kind === 'meta' && (
                <span style={{
                  fontSize: 10,
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  meta
                </span>
              )}
            </div>
            {w.kind === 'meta' && w.members && w.members.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, marginLeft: 22 }}>
                {w.members.map((m) => m.name).join(' · ')}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: PWA build + commit**

```bash
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/WorkspacePicker.tsx
git commit -m "feat(remote): PWA WorkspacePicker"
```

---

## Task 11: Mount WorkspacePicker in SessionDrawer

**Files:**
- Modify: `src/renderer-remote/chat/SessionDrawer.tsx`

- [ ] **Step 1: Add import + mount**

Add to the imports at the top of `SessionDrawer.tsx`:

```tsx
import WorkspacePicker from './WorkspacePicker';
```

Find the drawer's inner scroll container (the `<div style={{ flex: 1, overflowY: 'auto' }}>` that wraps sessions). Insert the WorkspacePicker BEFORE the sessions header. The drawer props need a way to forward workspace picks back to Chat — extend the `Props` interface and the JSX:

In `Props`, add:

```ts
onPickWorkspace: (projectPath: string) => void;
```

Inside the scroll container, immediately before the sessions area:

```tsx
<WorkspacePicker
  client={client}
  currentProjectPath={currentProjectPath}
  onPick={(path) => { onPickWorkspace(path); onClose(); }}
/>
<div style={{ borderTop: '1px solid var(--border)' }} />
<div style={{
  padding: '12px 14px 6px',
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
}}>
  Sessions
</div>
```

(If the existing "Sessions" header uses different markup in SessionDrawer.tsx, leave it alone — just insert WorkspacePicker above it.)

- [ ] **Step 2: PWA build (will fail — Chat.tsx needs to pass onPickWorkspace)**

```bash
npx vite build --config vite.config.pwa.ts
```

Continue to Task 12 without committing yet.

---

## Task 12: Chat.tsx — mount OverridesBar, clear overrides on session change, wire workspace picks

**Files:**
- Modify: `src/renderer-remote/chat/Chat.tsx`

- [ ] **Step 1: Add imports**

```tsx
import OverridesBar from './OverridesBar';
import { getOverrides, setOverrides as persistOverrides, clearOverrides, type SessionOverrides } from '../lib/overrides';
```

- [ ] **Step 2: Add overrides state**

Inside the Chat component (after the existing useState calls), add:

```tsx
const [overrides, setOverridesState] = useState<SessionOverrides>({});

// Load overrides for the new session whenever attached session changes.
useEffect(() => {
  if (!active?.sessionId) { setOverridesState({}); return; }
  setOverridesState(getOverrides(active.sessionId));
}, [active?.sessionId]);

const updateOverrides = (next: SessionOverrides) => {
  setOverridesState(next);
  if (active?.sessionId) {
    if (!next.model && !next.effort && !next.permMode) clearOverrides(active.sessionId);
    else persistOverrides(active.sessionId, next);
  }
};
```

- [ ] **Step 3: Spread overrides into sendPrompt**

Find the existing `onSend` function:

```tsx
const onSend = (text: string) => {
  if (!active) return;
  setMessages((arr) => [...arr, { id: `u-opt-${Date.now()}`, role: 'user', text }]);
  setMessages((arr) => [...arr, { id: `a-pending-${Date.now()}`, role: 'assistant', text: '', streaming: true }]);
  setStreaming(true);
  client.sendPrompt({ text, projectPath: active.projectPath, scope: active.scope });
};
```

Replace the `client.sendPrompt(...)` line with:

```tsx
client.sendPrompt({
  text,
  projectPath: active.projectPath,
  scope: active.scope,
  model: overrides.model,
  effort: overrides.effort,
  permMode: overrides.permMode,
});
```

- [ ] **Step 4: Mount OverridesBar between Transcript and Composer**

Find the JSX section that contains `<Transcript ... />` followed by the Approval banner and `<Composer ... />`. Insert `<OverridesBar>` immediately before the Composer wrapper:

```tsx
<OverridesBar overrides={overrides} onChange={updateOverrides} />
<div style={{ flexShrink: 0 }}>
  <Composer streaming={streaming} onSend={onSend} onInterrupt={onInterrupt} />
</div>
```

OverridesBar already has `flexShrink: 0` semantics via its layout (`display: flex` with overflow-x auto sets its height naturally) but if you see it stretch, wrap it in a `<div style={{ flexShrink: 0 }}>` like the Composer.

- [ ] **Step 5: Pass `onPickWorkspace` to SessionDrawer**

Find the existing `<SessionDrawer ... />` mount. Add the new prop:

```tsx
onPickWorkspace={(projectPath) => {
  // Drive desktop AND attach phone. Desktop's setActiveProjectPath effect
  // will re-broadcast session.active; phone re-attaches via follow handler.
  client.setActiveWorkspace(projectPath);
  // If follow mode is off, optimistically pretend we're on it for this switch —
  // setActiveWorkspace doesn't fire session.active to non-followers. Force
  // re-fetch the active session immediately.
  if (!follow) {
    // Optimistically attach to the picked workspace with no sessionId; the
    // first event from that topic will populate the rest.
    setActive({ projectPath, scope: 'chat', sessionId: '' });
  }
}}
```

- [ ] **Step 6: PWA build + tsc + commit**

```bash
npx vite build --config vite.config.pwa.ts
npx tsc --noEmit
git add src/renderer-remote/chat/Chat.tsx src/renderer-remote/chat/SessionDrawer.tsx
git commit -m "feat(remote): mount OverridesBar + WorkspacePicker, wire prompt overrides"
```

---

## Task 13: Integration test for workspace switch

**Files:**
- Modify: `tests/integration/remote/chat-end-to-end.test.ts`

- [ ] **Step 1: Append a workspace-switch step**

Append to the existing test (or add a second test) — exercises the new wire messages end-to-end:

```ts
// Workspaces list + switch
const listWorkspacesCalls: any[] = [];
const switchCalls: any[] = [];
// Re-create the bridge with workspaces callbacks. Or use a fresh test.
```

Simpler: add a NEW test inside the same `describe`:

```ts
it('workspaces.list + workspace.set', async () => {
  const pairing = new PairingStore(':memory:');
  const bus = new SessionBus();
  const listWorkspaces = vi.fn().mockResolvedValue([
    { projectPath: '/p', name: 'p', kind: 'project' },
    { projectPath: '/q', name: 'q', kind: 'project' },
  ]);
  const setActiveWorkspace = vi.fn().mockResolvedValue(undefined);
  const remote = new RemoteModule({
    pairing, bus,
    resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
    makeBridge: (ip) => new BridgeServer({
      tailnetIp: ip, pairing, bus, pwaDir: null,
      screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
      listWorkspaces, setActiveWorkspace,
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
  expect(inbox.find((m) => m.type === 'auth_ok')).toBeTruthy();

  ws.send(JSON.stringify({ type: 'workspaces.list', reqId: 'w1' }));
  await new Promise((r) => setTimeout(r, 50));
  const listReply = inbox.find((m) => m.type === 'workspaces.list.result');
  expect(listReply?.reqId).toBe('w1');
  expect(listReply?.workspaces).toHaveLength(2);

  ws.send(JSON.stringify({ type: 'workspace.set', projectPath: '/q' }));
  await new Promise((r) => setTimeout(r, 30));
  expect(setActiveWorkspace).toHaveBeenCalledWith('/q');

  ws.close();
  await remote.stop();
});
```

- [ ] **Step 2: Run integration**

```bash
npm run test:integration -- tests/integration/remote/chat-end-to-end.test.ts
```

Expected: 2 passing (existing + new).

- [ ] **Step 3: Full suite + tsc + commit**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit
git add tests/integration/remote/chat-end-to-end.test.ts
git commit -m "test(remote): workspaces.list + workspace.set end-to-end"
```

---

## Task 14: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p2-smoke.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Mobile Remote Phase 2 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 2 done.

## Prerequisites

- [ ] Phase 0 + Phase 1 smoke pass (pair, chat, approvals, switch session).
- [ ] At least two workspaces open in SAI on the desktop (project + project, or project + meta).

## Workspace switcher

- [ ] Open the PWA drawer (≡). The "Workspaces" section above sessions lists every open workspace, with the currently active one highlighted in accent.
- [ ] Tap a different workspace from the phone. Desktop window's active workspace switches AND the phone re-attaches to that workspace's active chat session within ~1s.
- [ ] If a meta workspace is open, its row shows the `meta` tag and the member project names on a second line.
- [ ] Switch desktop's workspace directly (on the laptop). Phone in follow-mode updates automatically.

## Per-prompt overrides

- [ ] Tap the `default model` chip. Bottom-sheet appears with Opus/Sonnet/Haiku + "Use desktop default". Pick Haiku. Chip shows "Haiku 4.5" in accent color.
- [ ] Send a prompt. Verify on desktop that the response uses Haiku (the system init event or the model badge will say so).
- [ ] Tap `mode: default`, pick `Always ask`. Set desktop's `permMode` to `auto`. Send a write-tool prompt. Approval banner appears on both surfaces (P1 clamp).
- [ ] Tap "reset" — all three chips revert to default, the next prompt uses desktop config.
- [ ] Reload the PWA. Chip values for THIS session persist; switching to another session shows that session's own chip state (or defaults if never set).

## Edge cases

- [ ] Set an effort override. Switch to a different session via the drawer. The new session's chips reflect its own values, not the previous one's.
- [ ] Tap a workspace that's since been closed on desktop. The drawer's list updates within ~5s; trying to tap a stale entry just no-ops (or surfaces an error toast).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p2-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 2"
```

---

## Task 15: Full sweep + tsc

- [ ] **Step 1: Final verification**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -5
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: all tests passing (4 new = 2 renderer-proxy + 2 bridge-chat + 1 e2e); tsc clean; PWA bundle builds.

- [ ] **Step 2: Final commit if needed**

```bash
git add -A
git commit -m "chore(remote): final tidy after p2 verification" || true
```

---

## Done

Phase 2 is complete when:

1. All vitest unit + integration tests pass.
2. `tsc --noEmit` is clean.
3. PWA bundle builds cleanly.
4. Manual smoke walked on real hardware: workspace switching from phone drives desktop, override chips work, reset clears all, sessionId-keyed persistence works.

After this lands, the roadmap's next phase is **Phase 3 — Files (read-only)**: browse repo tree, view files, view diffs on the phone. The workspace picker from this phase becomes its entry point.
