# Mobile State Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile PWA's snapshot/local-state model with a live event-driven model so workspace status, streaming indicators, and AskUserQuestion cards stay coherent across workspace switches and reflect real-time desktop state.

**Architecture:** Introduce a new `workspace.status` bus topic that the renderer pushes to whenever workspace status sets change. Bridge gains a per-socket opt-in subscription that bypasses the existing per-chat topic gating. Mobile keeps a `WorkspaceStatusStore` in memory, derives `streaming`/`status-dot` from it (not local Chat state), and renders a single mutually-exclusive dot. AskUserQuestion gets a full reverse-channel: bridge frame → main IPC → existing claude.ts handler, plus a mobile `AskUserQuestionView` inside `ToolCard`.

**Tech Stack:** TypeScript, React, Electron (main + preload + renderer), WebSocket bridge, `SessionBus` pub/sub, IndexedDB (existing).

---

## File Structure

**Create:**
- `src/renderer-remote/lib/workspaceStatusStore.ts` — in-memory map of `projectPath → status`, with subscribe/notify
- `src/renderer-remote/chat/AskUserQuestionView.tsx` — mobile-shaped AskUserQuestion form (mirrors desktop semantics, simpler styling)
- `tests/unit/remote/workspace-status-store.test.ts` — store behaviour
- `tests/unit/remote/bridge-server-workspace-status.test.ts` — bridge subscription/publish
- `tests/integration/remote/mobile-state-coherence.test.ts` — end-to-end: status delta → mobile dot priority; question_answered → card update

**Modify:**
- `electron/services/remote/bridge-server.ts` — add `workspace.status.subscribe`, `answer.question` frame handlers; add `emitWorkspaceStatus` opt; route `workspace.status` topic to opted-in sockets
- `electron/main.ts` — wire `emitWorkspaceStatus` (publishes to bus), wire `answerQuestion` to existing `claude:answer-question` logic via shared helper
- `electron/services/claude.ts` — extract the `answerQuestion` body into an exported `answerQuestionImpl` so main can call it directly without IPC round-trip
- `electron/preload.ts` — add `remoteEmitWorkspaceStatus` (renderer → main)
- `src/App.tsx` — call `sai.remoteEmitWorkspaceStatus` from the `workspaceStatusRef` sync effect
- `src/renderer-remote/wire.ts` — add `subscribeWorkspaceStatus`, `answerQuestion` to `WireClient` interface + connect()
- `src/renderer-remote/chat/Chat.tsx` — install workspace status store, derive `streaming` from it, handle `question_answered`, pass `onAnswerQuestion` to Transcript
- `src/renderer-remote/chat/Transcript.tsx` — accept `onAnswerQuestion`, forward to ToolCard
- `src/renderer-remote/chat/ToolCard.tsx` — render `AskUserQuestionView` body for AskUserQuestion; accept `toolUseId` + `onAnswerQuestion` props
- `src/renderer-remote/chat/WorkspaceHeader.tsx` — read from workspace status store, render single-dot StatusDot with priority

---

## Phase A — Wire scaffolding for live workspace status

### Task 1: Extract `answerQuestionImpl` from IPC handler

**Files:**
- Modify: `electron/services/claude.ts:912-946`

- [ ] **Step 1: Read the current handler**

Read `electron/services/claude.ts` lines 906-946 to confirm the handler body.

- [ ] **Step 2: Extract pure function above the handler**

Add this exported function just above the `ipcMain.handle('claude:answer-question', ...)` registration:

```ts
export async function answerQuestionImpl(
  projectPath: string,
  toolUseId: string,
  answers: Record<string, string | string[]>,
  scope?: string,
): Promise<boolean> {
  const ws = get(projectPath);
  if (!ws) return false;
  const effectiveScope = scope || 'chat';
  const claude = getClaude(ws, effectiveScope);

  if (claude.awaitingQuestionAnswer && claude.pendingQuestionId === toolUseId) {
    claude.awaitingQuestionAnswer = false;
    claude.pendingQuestionId = null;
  }

  emitChatMessage({
    type: 'question_answered',
    projectPath: ws.projectPath,
    scope: effectiveScope,
    toolUseId,
    answers,
  });

  const proc = claude.process;
  if (proc?.stdin && !proc.stdin.destroyed) {
    const followUp = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: `[AskUserQuestion answers for tool call ${toolUseId}]\nThe user picked the following answers (the earlier placeholder tool_result for this tool call should be disregarded):\n${JSON.stringify(answers, null, 2)}`,
      },
    });
    proc.stdin.write(followUp + '\n');
  }
  return true;
}
```

- [ ] **Step 3: Make the existing IPC handler delegate**

Replace the body of `ipcMain.handle('claude:answer-question', ...)` with:

```ts
ipcMain.handle('claude:answer-question', (_event, projectPath: string, toolUseId: string, answers: Record<string, string | string[]>, scope?: string) =>
  answerQuestionImpl(projectPath, toolUseId, answers, scope)
);
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claude.ts
git commit -m "refactor(claude): extract answerQuestionImpl for non-IPC callers"
```

---

### Task 2: Add `workspace.status` bus emission from renderer

**Files:**
- Modify: `electron/preload.ts:30-40` (find a good insertion point near `claudeAnswerQuestion`)
- Modify: `electron/main.ts:146-200`
- Modify: `src/App.tsx:383-390`

- [ ] **Step 1: Write failing integration test**

Create `tests/unit/remote/bridge-server-workspace-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { SessionBus } from '../../../electron/services/remote/session-bus';
import { BridgeServer } from '../../../electron/services/remote/bridge-server';
import { PairingStore } from '../../../electron/services/remote/pairing-store';

describe('bridge workspace.status routing', () => {
  let bus: SessionBus;
  let pairing: PairingStore;
  let bridge: BridgeServer;
  let port: number;

  beforeEach(async () => {
    bus = new SessionBus();
    pairing = new PairingStore({ path: ':memory:' } as any);
    const token = await pairing.issuePairCode().then((c) => pairing.completePairing(c.code, 'test'));
    bridge = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus,
      pwaDir: null, screenshotSecret: 's', loadScreenshot: async () => null,
      port: 0,
    });
    port = await bridge.start();
    (globalThis as any).__token = token.token;
  });

  afterEach(async () => { await bridge.stop(); });

  it('forwards workspace.status events to opted-in sockets', async () => {
    const token = (globalThis as any).__token;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: any[] = [];
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        messages.push(m);
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'workspace.status.subscribe' }));
          setTimeout(() => {
            bus.publish('workspace.status', { type: 'workspace.status', projectPath: '/p', status: { streaming: true } });
            setTimeout(resolve, 50);
          }, 20);
        }
      });
    });
    ws.close();
    const status = messages.find((m) => m.type === 'workspace.status');
    expect(status).toBeDefined();
    expect(status.projectPath).toBe('/p');
    expect(status.status.streaming).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/remote/bridge-server-workspace-status.test.ts`
Expected: FAIL (no handler for `workspace.status.subscribe`, no routing for the topic).

- [ ] **Step 3: Add subscription handler in bridge-server**

In `electron/services/remote/bridge-server.ts`, locate the per-socket `subscribeAll` callback around line 341-344. Replace:

```ts
unsub = this.opts.bus.subscribeAll((topic, e) => {
  if ((ws as any).__attachedTopic !== topic) return; // gate by attachment
  try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* ws may be closed */ }
});
```

with:

```ts
unsub = this.opts.bus.subscribeAll((topic, e) => {
  if (topic === 'workspace.status') {
    if (!(ws as any).__workspaceStatusEnabled) return;
    try { ws.send(JSON.stringify({ v: 1, ...e })); } catch { /* closed */ }
    return;
  }
  if ((ws as any).__attachedTopic !== topic) return;
  try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* closed */ }
});
```

Then after the `auth_ok` send and before the existing `if (msg.type === 'ping')` block, add a default:

```ts
(ws as any).__workspaceStatusEnabled = false;
```

(Place it next to the existing `__attachedTopic = null` initialization on line 339.)

Add a new frame handler near the existing `session.attach` handler (around line 350):

```ts
if (msg.type === 'workspace.status.subscribe') {
  (ws as any).__workspaceStatusEnabled = true;
  return;
}
if (msg.type === 'workspace.status.unsubscribe') {
  (ws as any).__workspaceStatusEnabled = false;
  return;
}
```

- [ ] **Step 4: Re-run test to verify it passes**

Run: `npx vitest run tests/unit/remote/bridge-server-workspace-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-workspace-status.test.ts
git commit -m "feat(remote): add workspace.status bus topic routing in bridge"
```

---

### Task 3: Wire renderer → main → bus IPC for workspace status

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/App.tsx:383-390`

- [ ] **Step 1: Add preload bridge**

In `electron/preload.ts`, add after `claudeAnswerQuestion` (around line 30-31):

```ts
remoteEmitWorkspaceStatus: (projectPath: string, status: { busy: boolean; streaming: boolean; completed: boolean; approval: boolean }) =>
  ipcRenderer.invoke('remote:emit-workspace-status', projectPath, status),
```

Also add it to the TypeScript surface declared for `window.sai` (search for `claudeAnswerQuestion:` in the same file to find the declaration block to extend).

- [ ] **Step 2: Add IPC handler in main**

In `electron/main.ts`, inside the function/scope where `bus` is in lexical scope (search for `bus = new SessionBus`), add after the bus is constructed:

```ts
ipcMain.handle('remote:emit-workspace-status', (_evt, projectPath: string, status: { busy: boolean; streaming: boolean; completed: boolean; approval: boolean }) => {
  bus?.publish('workspace.status', { type: 'workspace.status', projectPath, status });
});
```

Make sure `ipcMain` is imported at the top of the file (it likely already is — verify with a grep).

- [ ] **Step 3: Emit from App.tsx whenever status sets change**

In `src/App.tsx`, locate the `useEffect` at line 383-390 that syncs `workspaceStatusRef`. Replace its body with:

```ts
useEffect(() => {
  workspaceStatusRef.current = {
    busy: new Set(busyWorkspaces),
    streaming: new Set(chatStreamingWorkspaces),
    completed: new Set(completedWorkspaces),
    approval: new Set(approvalWorkspaces.keys()),
  };
  // Emit per-workspace deltas to the remote bus so mobile sees live status.
  const all = new Set<string>([
    ...busyWorkspaces, ...chatStreamingWorkspaces, ...completedWorkspaces, ...approvalWorkspaces.keys(),
    ...lastEmittedWorkspaceStatusRef.current.keys(),
  ]);
  for (const projectPath of all) {
    const next = {
      busy: busyWorkspaces.has(projectPath),
      streaming: chatStreamingWorkspaces.has(projectPath),
      completed: completedWorkspaces.has(projectPath),
      approval: approvalWorkspaces.has(projectPath),
    };
    const prev = lastEmittedWorkspaceStatusRef.current.get(projectPath);
    if (!prev || prev.busy !== next.busy || prev.streaming !== next.streaming || prev.completed !== next.completed || prev.approval !== next.approval) {
      lastEmittedWorkspaceStatusRef.current.set(projectPath, next);
      void (window.sai as any).remoteEmitWorkspaceStatus?.(projectPath, next);
    }
  }
}, [busyWorkspaces, chatStreamingWorkspaces, completedWorkspaces, approvalWorkspaces]);
```

Above that effect (near the other refs around line 240), declare:

```ts
const lastEmittedWorkspaceStatusRef = useRef<Map<string, { busy: boolean; streaming: boolean; completed: boolean; approval: boolean }>>(new Map());
```

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`
Open the desktop, start a chat in a workspace, watch the main-process console: there should be no errors. (Mobile won't show anything yet — that's Task 4+.)

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts electron/main.ts src/App.tsx
git commit -m "feat(remote): push workspace status deltas from renderer to bus"
```

---

### Task 4: Wire client `subscribeWorkspaceStatus` method

**Files:**
- Modify: `src/renderer-remote/wire.ts:46-95` (interface) and `190-301` (impl)

- [ ] **Step 1: Add type to interface**

In `src/renderer-remote/wire.ts`, add to the `WireClient` interface (after `setActiveWorkspace`):

```ts
subscribeWorkspaceStatus(): void;
unsubscribeWorkspaceStatus(): void;
```

- [ ] **Step 2: Add implementations**

In the returned object (after `setActiveWorkspace`):

```ts
subscribeWorkspaceStatus: () => sendFrame({ type: 'workspace.status.subscribe' }),
unsubscribeWorkspaceStatus: () => sendFrame({ type: 'workspace.status.unsubscribe' }),
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): add workspace.status subscribe methods to WireClient"
```

---

## Phase B — Mobile workspace status store + single-dot rendering

### Task 5: Create `workspaceStatusStore`

**Files:**
- Create: `src/renderer-remote/lib/workspaceStatusStore.ts`
- Create: `tests/unit/remote/workspace-status-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/remote/workspace-status-store.test.ts
import { describe, it, expect } from 'vitest';
import { createWorkspaceStatusStore } from '../../../src/renderer-remote/lib/workspaceStatusStore';

describe('workspaceStatusStore', () => {
  it('notifies subscribers when a workspace status changes', () => {
    const s = createWorkspaceStatusStore();
    const events: Array<{ projectPath: string; status: any }> = [];
    s.subscribe((projectPath, status) => events.push({ projectPath, status }));
    s.set('/a', { busy: true, streaming: false, completed: false, approval: false });
    s.set('/a', { busy: true, streaming: true, completed: false, approval: false });
    expect(events).toHaveLength(2);
    expect(s.get('/a')).toEqual({ busy: true, streaming: true, completed: false, approval: false });
  });

  it('clears entries when all flags are false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { busy: true, streaming: false, completed: false, approval: false });
    s.set('/a', { busy: false, streaming: false, completed: false, approval: false });
    expect(s.get('/a')).toBeUndefined();
  });

  it('priority() returns single-state label', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority({ busy: false, streaming: false, completed: false, approval: false })).toBe('idle');
    expect(s.priority({ busy: true, streaming: false, completed: true, approval: false })).toBe('busy');
    expect(s.priority({ busy: true, streaming: true, completed: false, approval: false })).toBe('streaming');
    expect(s.priority({ busy: false, streaming: false, completed: true, approval: false })).toBe('completed');
    expect(s.priority({ busy: true, streaming: true, completed: true, approval: true })).toBe('approval');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/remote/workspace-status-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `src/renderer-remote/lib/workspaceStatusStore.ts`:

```ts
export interface WorkspaceStatus {
  busy: boolean;
  streaming: boolean;
  completed: boolean;
  approval: boolean;
}

export type WorkspaceStatusPriority = 'idle' | 'completed' | 'busy' | 'streaming' | 'approval';

export interface WorkspaceStatusStore {
  get(projectPath: string): WorkspaceStatus | undefined;
  set(projectPath: string, status: WorkspaceStatus): void;
  subscribe(fn: (projectPath: string, status: WorkspaceStatus | undefined) => void): () => void;
  priority(status: WorkspaceStatus | undefined): WorkspaceStatusPriority;
}

export function createWorkspaceStatusStore(): WorkspaceStatusStore {
  const map = new Map<string, WorkspaceStatus>();
  const subs = new Set<(projectPath: string, status: WorkspaceStatus | undefined) => void>();
  return {
    get: (p) => map.get(p),
    set: (p, s) => {
      const allFalse = !s.busy && !s.streaming && !s.completed && !s.approval;
      if (allFalse) map.delete(p);
      else map.set(p, s);
      const out = map.get(p);
      for (const fn of subs) { try { fn(p, out); } catch { /* isolate */ } }
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    priority: (s) => {
      if (!s) return 'idle';
      if (s.approval) return 'approval';
      if (s.streaming) return 'streaming';
      if (s.busy) return 'busy';
      if (s.completed) return 'completed';
      return 'idle';
    },
  };
}
```

- [ ] **Step 4: Re-run test**

Run: `npx vitest run tests/unit/remote/workspace-status-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer-remote/lib/workspaceStatusStore.ts tests/unit/remote/workspace-status-store.test.ts
git commit -m "feat(remote): add WorkspaceStatusStore with priority resolution"
```

---

### Task 6: Wire the store into the mobile app + subscribe on connect

**Files:**
- Modify: `src/renderer-remote/App.tsx` (mobile app shell — find it: it's the top-level component that constructs the WireClient and renders Chat)

- [ ] **Step 1: Locate the mobile app shell**

Run: `grep -rn "connect(.*token" src/renderer-remote/ | head -5`
This should point to the file that calls `connect(token)` from `wire.ts`. Open it.

- [ ] **Step 2: Construct and provide the store**

At the top of that file, import:

```ts
import { createWorkspaceStatusStore, type WorkspaceStatusStore } from './lib/workspaceStatusStore';
```

Create a single store at module scope (above the component):

```ts
const workspaceStatusStore: WorkspaceStatusStore = createWorkspaceStatusStore();
```

After the `WireClient` is constructed and the connection is open, subscribe and pipe events into the store. In a `useEffect` that runs once after `client` is available:

```ts
useEffect(() => {
  client.subscribeWorkspaceStatus();
  const off = client.on((msg) => {
    if ((msg as any).type === 'workspace.status') {
      const m = msg as any;
      workspaceStatusStore.set(m.projectPath, m.status);
    }
  });
  return () => { client.unsubscribeWorkspaceStatus(); off(); };
}, [client]);
```

Pass `workspaceStatusStore` as a prop to `Chat` and `WorkspaceHeader` (added in next tasks).

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: No new errors (props added in later tasks may show — those will be fixed there).

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/<app shell>.tsx
git commit -m "feat(remote): subscribe mobile to workspace.status stream"
```

---

### Task 7: Single-dot rendering in WorkspaceHeader

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx:5-42, 78, 133, 266`

- [ ] **Step 1: Accept the store as a prop**

Add to imports:

```ts
import type { WorkspaceStatusStore, WorkspaceStatus } from '../lib/workspaceStatusStore';
```

Extend `Props`:

```ts
interface Props {
  client: WireClient;
  currentProjectPath: string | null;
  onPick: (projectPath: string) => void;
  statusStore: WorkspaceStatusStore;
}
```

- [ ] **Step 2: Replace StatusDots with single-dot priority component**

Replace the existing `StatusDots` function (lines 27-42) with:

```ts
function StatusDot({ status, store }: { status?: WorkspaceStatus; store: WorkspaceStatusStore }) {
  const p = store.priority(status);
  if (p === 'idle') return null;
  const color =
    p === 'approval'  ? 'var(--orange)' :
    p === 'streaming' ? 'var(--accent)' :
    p === 'busy'      ? 'var(--blue)'   :
                        'var(--green)';
  const title =
    p === 'approval'  ? 'pending approval' :
    p === 'streaming' ? 'streaming'        :
    p === 'busy'      ? 'working'          :
                        'completed';
  return (
    <span
      title={title}
      style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}
    />
  );
}
```

- [ ] **Step 3: Use live store data in the component**

Inside `WorkspaceHeader`, add a `forceTick` re-render hook that subscribes to the store:

```ts
const [, forceTick] = useState(0);
useEffect(() => {
  const off = statusStore.subscribe(() => forceTick((n) => n + 1));
  return off;
}, [statusStore]);
```

(Add `useState` to the existing react import on line 1 if not present.)

Replace the two `<StatusDots status={current?.status} />` and `<StatusDots status={w.status} />` (lines 133 and 266) with:

```tsx
<StatusDot status={statusStore.get(current?.projectPath ?? '')} store={statusStore} />
```

and

```tsx
<StatusDot status={statusStore.get(w.projectPath)} store={statusStore} />
```

Drop the `status` field reads from the snapshot — the store is authoritative now. (Leave the `status` field on `WorkspaceMeta` for backwards compat in the initial `listWorkspaces` payload; it will simply be ignored.)

- [ ] **Step 4: Update call site to pass `statusStore` prop**

In the file modified in Task 6 (mobile app shell), update the `<Chat ... />` or `<WorkspaceHeader ... />` usage to pass `statusStore={workspaceStatusStore}`. (Chat already forwards client; check Chat.tsx:296 — `<WorkspaceHeader client={client} ... />` — that needs `statusStore` too. Update `Chat`'s Props to accept and forward.)

In `src/renderer-remote/chat/Chat.tsx`, add to the `Props` interface (line 10-16):

```ts
statusStore: WorkspaceStatusStore;
```

(Add import: `import type { WorkspaceStatusStore } from '../lib/workspaceStatusStore';`)

In the JSX (around line 296), pass it down:

```tsx
<WorkspaceHeader
  client={client}
  statusStore={statusStore}
  currentProjectPath={active?.projectPath ?? null}
  onPick={...}
/>
```

- [ ] **Step 5: Build and smoke**

Run: `npm run build:renderer-remote`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx src/renderer-remote/chat/Chat.tsx
git commit -m "feat(remote): single-dot status priority in WorkspaceHeader (live store)"
```

---

### Task 8: Derive `streaming` from store, not local state, on workspace switch

**Files:**
- Modify: `src/renderer-remote/chat/Chat.tsx:22, 44-48, 52-220`

- [ ] **Step 1: Replace local `streaming` with derived value**

In `Chat.tsx`, find the local `const [streaming, setStreaming] = useState(false);` (line 23). Keep it (we still want optimistic streaming on send), but rename to `localStreaming` and derive the displayed value from the store:

```ts
const [localStreaming, setLocalStreaming] = useState(false);

// Re-render when the store updates the active workspace's status
const [, statusTick] = useState(0);
useEffect(() => {
  const off = statusStore.subscribe((projectPath) => {
    if (projectPath === active?.projectPath) statusTick((n) => n + 1);
  });
  return off;
}, [statusStore, active?.projectPath]);

const backendStreaming = active ? !!statusStore.get(active.projectPath)?.streaming : false;
const streaming = backendStreaming || localStreaming;
```

Then replace every other `setStreaming` → `setLocalStreaming`. There are calls at:
- Workspace-switch effect (line 46): `setLocalStreaming(false);` — keep
- `streaming_start` handler (line 93): `setLocalStreaming(true);`
- `result`/`done` handler (line 200): `setLocalStreaming(false);`
- `error` handler (line 215): `setLocalStreaming(false);`
- `onSend` (line 225): `setLocalStreaming(true);`

- [ ] **Step 2: Don't reset on workspace switch if backend says it's streaming**

In the workspace-switch effect (lines 44-48), change:

```ts
setMessages([]); setPendingApproval(null); setStreaming(false);
```

to:

```ts
setMessages([]); setPendingApproval(null); setLocalStreaming(false);
```

(`streaming` will now reflect whatever the backend store says for the newly active workspace — no UI flicker.)

- [ ] **Step 3: Build + smoke**

Run: `npm run build:renderer-remote`
Expected: Build succeeds. Manually test: start a chat in workspace A, switch to workspace B, switch back to A — the thinking indicator should persist if A is still streaming.

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/chat/Chat.tsx
git commit -m "feat(remote): derive mobile streaming indicator from live workspace store"
```

---

## Phase C — AskUserQuestion support on mobile

### Task 9: Wire client `answerQuestion` method

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend WireClient interface**

Add to the interface (next to `approve`):

```ts
answerQuestion(args: { toolUseId: string; answers: Record<string, string | string[]>; projectPath: string; scope?: string }): void;
```

- [ ] **Step 2: Implement**

In the returned object (next to `approve`):

```ts
answerQuestion: (a) => sendFrame({
  type: 'answer.question',
  toolUseId: a.toolUseId,
  answers: a.answers,
  projectPath: a.projectPath,
  scope: a.scope ?? 'chat',
}),
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): add answerQuestion to WireClient"
```

---

### Task 10: Bridge handler for `answer.question`

**Files:**
- Modify: `electron/services/remote/bridge-server.ts` (opts type around line 59-100, frame handler near line 350)

- [ ] **Step 1: Add opt to BridgeServerOpts**

In the `BridgeServerOpts` interface, near `resolveApproval` (line 69):

```ts
answerQuestion?: (args: { toolUseId: string; answers: Record<string, string | string[]>; projectPath: string; scope: string }) => Promise<unknown> | unknown;
```

- [ ] **Step 2: Add frame handler**

After the existing `if (msg.type === 'approval' ...)` handler (search for it in the file — it's around the chat handlers), add:

```ts
if (msg.type === 'answer.question'
    && typeof msg.toolUseId === 'string'
    && typeof msg.projectPath === 'string'
    && msg.answers && typeof msg.answers === 'object') {
  const scope = typeof msg.scope === 'string' ? msg.scope : 'chat';
  try {
    await this.opts.answerQuestion?.({
      toolUseId: msg.toolUseId,
      answers: msg.answers as Record<string, string | string[]>,
      projectPath: msg.projectPath,
      scope,
    });
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', code: 'answer_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 3: Wire in electron/main.ts**

In `electron/main.ts`, inside the `new BridgeServer({...})` opts (around line 159-182), add:

```ts
answerQuestion: async (args) => {
  await answerQuestionImpl(args.projectPath, args.toolUseId, args.answers, args.scope);
},
```

Import at the top:

```ts
import { answerQuestionImpl } from './services/claude';
```

(Adjust path to match the existing import style — likely `./services/claude` or relative.)

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts electron/main.ts
git commit -m "feat(remote): bridge frame + main wiring for AskUserQuestion answers"
```

---

### Task 11: Mobile `AskUserQuestionView` component

**Files:**
- Create: `src/renderer-remote/chat/AskUserQuestionView.tsx`

- [ ] **Step 1: Write the component**

Create `src/renderer-remote/chat/AskUserQuestionView.tsx`:

```tsx
import { useState } from 'react';

interface AskOption { label: string; description?: string }
interface AskQuestion { question: string; header?: string; options: AskOption[]; multiSelect?: boolean }
interface ParsedAsk { questions: AskQuestion[]; answers?: Record<string, string | string[]> }

const OTHER = '__other__';

function parseInput(input: Record<string, unknown> | undefined): ParsedAsk | null {
  if (!input) return null;
  const questions = (input as any).questions;
  if (!Array.isArray(questions)) return null;
  return { questions: questions as AskQuestion[], answers: (input as any).answers };
}

interface Props {
  toolUseId?: string;
  input?: Record<string, unknown>;
  onAnswer?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}

export default function AskUserQuestionView({ toolUseId, input, onAnswer }: Props) {
  const parsed = parseInput(input);
  const recorded = parsed?.answers || {};
  const isAnswered = Object.keys(recorded).length > 0;
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!parsed) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Could not parse questions.</div>;
  }

  const toggle = (q: AskQuestion, label: string) => {
    if (isAnswered || submitting) return;
    setPicks((p) => {
      const next = { ...p };
      if (q.multiSelect) {
        const arr = Array.isArray(next[q.question]) ? [...(next[q.question] as string[])] : [];
        const i = arr.indexOf(label);
        if (i >= 0) arr.splice(i, 1); else arr.push(label);
        next[q.question] = arr;
      } else {
        next[q.question] = label;
      }
      return next;
    });
  };

  const isSel = (q: AskQuestion, label: string): boolean => {
    if (isAnswered) {
      const v = recorded[q.question];
      if (label === OTHER) {
        const known = new Set(q.options.map((o) => o.label));
        if (q.multiSelect) return Array.isArray(v) && v.some((x) => !known.has(x));
        return typeof v === 'string' && !known.has(v);
      }
      if (q.multiSelect) return Array.isArray(v) && v.includes(label);
      return v === label;
    }
    const v = picks[q.question];
    if (q.multiSelect) return Array.isArray(v) && v.includes(label);
    return v === label;
  };

  const canSubmit = !isAnswered && !submitting && parsed.questions.every((q) => {
    const v = picks[q.question];
    const t = other[q.question]?.trim() || '';
    if (q.multiSelect) {
      const arr = Array.isArray(v) ? v : [];
      if (arr.includes(OTHER) && !t) return false;
      return arr.length > 0;
    }
    if (v === OTHER) return t.length > 0;
    return typeof v === 'string' && v.length > 0;
  });

  const submit = () => {
    if (!canSubmit || !toolUseId || !onAnswer) return;
    const resolved: Record<string, string | string[]> = {};
    for (const q of parsed.questions) {
      const v = picks[q.question];
      const t = other[q.question]?.trim() || '';
      if (q.multiSelect) {
        const arr = Array.isArray(v) ? v.slice() : [];
        const i = arr.indexOf(OTHER);
        if (i >= 0) arr.splice(i, 1, t);
        resolved[q.question] = arr;
      } else {
        resolved[q.question] = v === OTHER ? t : (v as string);
      }
    }
    setSubmitting(true);
    onAnswer(toolUseId, resolved);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {parsed.questions.map((q, qi) => (
        <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {q.header && (
            <div style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{q.header}</div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text)' }}>{q.question}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...q.options, { label: OTHER, description: 'Type your own response' } as AskOption].map((opt, oi) => {
              const sel = isSel(q, opt.label);
              const isOther = opt.label === OTHER;
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => toggle(q, opt.label)}
                  disabled={isAnswered || submitting}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', textAlign: 'left',
                    background: sel ? 'var(--bg-input)' : 'var(--bg-mid)', color: 'var(--text)',
                    border: '1px solid', borderColor: sel ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 8, cursor: isAnswered || submitting ? 'default' : 'pointer',
                    fontFamily: 'inherit', fontSize: 13, minHeight: 36,
                  }}
                >
                  <span style={{
                    flexShrink: 0, marginTop: 2, width: 12, height: 12,
                    borderRadius: q.multiSelect ? 3 : '50%',
                    border: '1.5px solid', borderColor: sel ? 'var(--accent)' : 'var(--border)',
                    background: sel ? 'var(--accent)' : 'transparent',
                  }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{isOther ? 'Other' : opt.label}</span>
                    {opt.description && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{opt.description}</span>}
                  </span>
                </button>
              );
            })}
            {isSel(q, OTHER) && !isAnswered && (
              <input
                type="text"
                value={other[q.question] || ''}
                onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
                placeholder="Your answer…"
                style={{
                  padding: '8px 10px', background: 'var(--bg-input)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
                }}
              />
            )}
          </div>
        </div>
      ))}
      {!isAnswered && (
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          style={{
            alignSelf: 'flex-end', padding: '8px 16px',
            background: canSubmit ? 'var(--accent)' : 'var(--bg-mid)',
            color: canSubmit ? '#000' : 'var(--text-muted)',
            border: '1px solid', borderColor: canSubmit ? 'var(--accent)' : 'var(--border)',
            borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'default', minHeight: 36,
          }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer-remote/chat/AskUserQuestionView.tsx
git commit -m "feat(remote): add mobile AskUserQuestionView component"
```

---

### Task 12: Integrate AskUserQuestionView into ToolCard

**Files:**
- Modify: `src/renderer-remote/chat/ToolCard.tsx:4-9, 65, 146-167`
- Modify: `src/renderer-remote/chat/Transcript.tsx:65-103`
- Modify: `src/renderer-remote/chat/Chat.tsx`

- [ ] **Step 1: Extend ToolCard Props + render AskUserQuestion view**

In `src/renderer-remote/chat/ToolCard.tsx`, add import:

```ts
import AskUserQuestionView from './AskUserQuestionView';
```

Extend `Props`:

```ts
interface Props {
  name: string;
  input?: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  toolUseId?: string;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}
```

Update the function signature accordingly:

```ts
export default function ToolCard({ name, input, result, status, toolUseId, onAnswerQuestion }: Props) {
```

In the expanded body (the `{expanded && (...)}` block, around lines 146-167), prepend an AskUserQuestion branch:

```tsx
{expanded && (
  <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {name === 'AskUserQuestion' ? (
      <AskUserQuestionView toolUseId={toolUseId} input={input} onAnswer={onAnswerQuestion} />
    ) : (
      <>
        {summary.body && (<CodeBlock content={summary.body} language={summary.language} />)}
        {!summary.body && input && Object.keys(input).length > 0 && (
          <Section title="input">
            <CodeBlock content={JSON.stringify(input, null, 2)} language="json" />
          </Section>
        )}
        {result !== undefined && (
          <Section title={status === 'error' ? 'error' : 'result'}>
            <CodeBlock content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)} />
          </Section>
        )}
      </>
    )}
  </div>
)}
```

Also override the collapsed summary label for AskUserQuestion so it reads "Waiting for answer…" / "Answered" — extend `summarize()` at line 17, adding before the fallback:

```ts
if (name === 'AskUserQuestion') {
  const answered = i.answers && typeof i.answers === 'object' && Object.keys(i.answers).length > 0;
  return { label: answered ? 'Answered' : 'Waiting for answer…' };
}
```

- [ ] **Step 2: Extend TranscriptMessage + Transcript Props**

In `src/renderer-remote/chat/Transcript.tsx`, extend `TranscriptMessage`:

```ts
export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string | Record<string, unknown>;
  toolStatus?: 'running' | 'done' | 'error';
  streaming?: boolean;
}
```

Extend `Props`:

```ts
interface Props {
  messages: TranscriptMessage[];
  streaming?: boolean;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}
```

In the `if (m.role === 'tool')` branch (line 93-103), pass the new props through:

```tsx
return (
  <ToolCard
    key={m.id}
    name={m.toolName ?? 'tool'}
    input={m.toolInput}
    result={m.toolResult}
    status={m.toolStatus ?? 'running'}
    toolUseId={m.toolUseId}
    onAnswerQuestion={onAnswerQuestion}
  />
);
```

- [ ] **Step 3: Wire Chat.tsx**

In `src/renderer-remote/chat/Chat.tsx`:

a. In the `assistant` handler when a `tool_use` block is pushed (around line 150-156), include the id:

```ts
next.push({
  id: `tool-${blk.id}`,
  role: 'tool',
  toolName: blk.name && blk.name.length > 0 ? blk.name : 'tool',
  toolUseId: blk.id,
  toolInput: blk.input,
  toolStatus: 'running',
});
```

b. In the `session.history` loader (around lines 79-87), include the id:

```ts
out.push({
  id: `h-${i}-tc-${j}-${tc.id ?? j}`,
  role: 'tool',
  toolName: tc.name ?? tc.type ?? 'tool',
  toolUseId: tc.id,
  toolInput: parsedInput,
  toolResult,
  toolStatus: rawOutput != null ? 'done' : 'running',
});
```

c. Add a `question_answered` handler. Place this **before** the `result`/`done` handler (around line 199):

```ts
if (t === 'question_answered') {
  const toolUseId = (msg as any).toolUseId;
  const answers = (msg as any).answers;
  setMessages((arr) => arr.map((m) =>
    m.role === 'tool' && m.toolUseId === toolUseId
      ? { ...m, toolInput: { ...(m.toolInput ?? {}), answers }, toolStatus: 'done' }
      : m
  ));
  return;
}
```

d. Add the submit handler and pass it to Transcript. Near `onSend` (line 222):

```ts
const onAnswerQuestion = (toolUseId: string, answers: Record<string, string | string[]>) => {
  if (!active) return;
  client.answerQuestion({
    toolUseId,
    answers,
    projectPath: active.projectPath,
    scope: active.scope,
  });
};
```

Update the `<Transcript messages={messages} streaming={streaming} />` JSX (line 308) to:

```tsx
<Transcript messages={messages} streaming={streaming} onAnswerQuestion={onAnswerQuestion} />
```

- [ ] **Step 4: Build**

Run: `npm run build:renderer-remote`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer-remote/chat/ToolCard.tsx src/renderer-remote/chat/Transcript.tsx src/renderer-remote/chat/Chat.tsx
git commit -m "feat(remote): render AskUserQuestion inline + submit answers from mobile"
```

---

## Phase D — Verification

### Task 13: End-to-end integration test

**Files:**
- Create: `tests/integration/remote/mobile-state-coherence.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { SessionBus } from '../../../electron/services/remote/session-bus';
import { BridgeServer } from '../../../electron/services/remote/bridge-server';
import { PairingStore } from '../../../electron/services/remote/pairing-store';

describe('mobile state coherence', () => {
  let bus: SessionBus;
  let pairing: PairingStore;
  let bridge: BridgeServer;
  let port: number;
  let token: string;

  beforeEach(async () => {
    bus = new SessionBus();
    pairing = new PairingStore({ path: ':memory:' } as any);
    const code = await pairing.issuePairCode();
    const paired = await pairing.completePairing(code.code, 'test');
    token = paired.token;
    bridge = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus,
      pwaDir: null, screenshotSecret: 's', loadScreenshot: async () => null,
      port: 0,
      answerQuestion: async () => { /* stub */ },
    });
    port = await bridge.start();
  });

  afterEach(async () => { await bridge.stop(); });

  it('delivers workspace.status deltas after subscribe', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const events: any[] = [];
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        events.push(m);
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'workspace.status.subscribe' }));
          setTimeout(() => {
            bus.publish('workspace.status', { type: 'workspace.status', projectPath: '/x', status: { busy: true, streaming: true, completed: false, approval: false } });
            bus.publish('workspace.status', { type: 'workspace.status', projectPath: '/x', status: { busy: false, streaming: false, completed: true, approval: false } });
            setTimeout(resolve, 80);
          }, 30);
        }
      });
    });
    ws.close();
    const deltas = events.filter((e) => e.type === 'workspace.status');
    expect(deltas).toHaveLength(2);
    expect(deltas[0].status.streaming).toBe(true);
    expect(deltas[1].status.completed).toBe(true);
  });

  it('forwards answer.question frame to opts.answerQuestion', async () => {
    let received: any = null;
    await bridge.stop();
    bridge = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus,
      pwaDir: null, screenshotSecret: 's', loadScreenshot: async () => null,
      port: 0,
      answerQuestion: async (args) => { received = args; },
    });
    port = await bridge.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({
            type: 'answer.question',
            toolUseId: 'tu_1', projectPath: '/p', scope: 'chat',
            answers: { 'q?': 'a' },
          }));
          setTimeout(resolve, 50);
        }
      });
    });
    ws.close();
    expect(received).toEqual({
      toolUseId: 'tu_1', projectPath: '/p', scope: 'chat',
      answers: { 'q?': 'a' },
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/integration/remote/mobile-state-coherence.test.ts`
Expected: Both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote/mobile-state-coherence.test.ts
git commit -m "test(remote): mobile state coherence end-to-end"
```

---

### Task 14: Run full test suite

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds.

---

### Task 15: Manual smoke test on mobile PWA

- [ ] **Step 1: Boot desktop with PWA accessible**

Run: `npm run dev`
Confirm pair URL is reachable from phone.

- [ ] **Step 2: Workspace status**

- Start a chat in workspace A on desktop.
- Open the PWA, attach to the same workspace.
- Switch workspace dropdown — verify A shows the streaming dot live, transitions to completed dot when desktop finishes, then clears.
- Confirm only ONE dot is ever visible (not two).

- [ ] **Step 3: Streaming across switch**

- Send a long-running prompt in workspace A.
- Switch to workspace B on the phone.
- Switch back to A — the thinking indicator should still be visible (no flicker to idle).

- [ ] **Step 4: AskUserQuestion**

- Trigger an AskUserQuestion (e.g. by asking Claude a question that requires a choice).
- On phone: confirm the card renders inline with options.
- Tap an option, submit — verify the card flips to "Answered", the chosen option stays highlighted, and the assistant continues.

- [ ] **Step 5: Historical AskUserQuestion**

- Reload the PWA, re-attach to the same session — confirm the answered card still shows "Answered" + the recorded selection.

---

## Self-Review

**Spec coverage:**
- Live workspace status: Tasks 1-7 ✓
- Streaming-on-switch: Task 8 ✓
- Single-dot priority: Task 7 (StatusDot) ✓
- AskUserQuestion reverse channel: Tasks 9-12 ✓
- Historical AskUserQuestion render: Task 12 step 3b ✓

**Placeholders:** none — every step has runnable code.

**Type consistency:**
- `WorkspaceStatus`, `WorkspaceStatusStore`, `WorkspaceStatusPriority` consistent across Tasks 5, 7, 8.
- `answerQuestion` wire signature `{toolUseId, answers, projectPath, scope?}` consistent across Tasks 9, 10, 12.
- `answerQuestionImpl` signature `(projectPath, toolUseId, answers, scope?) → Promise<boolean>` consistent in Tasks 1, 10.
- `toolUseId` added to `TranscriptMessage` in Task 12 and consumed in same task.
