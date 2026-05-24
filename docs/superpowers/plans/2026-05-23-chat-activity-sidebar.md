# Per-Session Chat Scopes & Activity Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multiple chats in the same project run concurrently, then surface their live status, unread state, and finish/approval events in the chat history sidebar and via toasts.

**Architecture:** Backend already supports per-scope provider processes (swarm tasks use `scope = sessionId`). The change is mechanical: the frontend stops hard-coding `scope = "chat"` for regular chats and instead passes `scope = activeSession.id` everywhere. Approvals graduate from a per-workspace map to a per-(workspace, session) map. New backend safety nets (idle-timeout, shutdown-stops-all-scopes) bound process count. The sidebar then derives status/unread sets from existing state and renders them; a toast effect diffs the streaming/awaiting sets to fire notifications.

**Tech Stack:** TypeScript, React, Electron (main + renderer over IPC), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-23-chat-activity-sidebar-design.md`

---

## File Map

**Frontend:**
- `src/types.ts` — add `lastViewedAt?: number` on `ChatSession`; add `'attention'` to `ToastTone`.
- `src/components/WorkspaceToast.tsx` — `'attention'` tone glyph/color, optional `onClick`.
- `src/components/Chat/ChatPanel.tsx` — add `codexScope`, `geminiScope` props; thread through send/stop/approve/answer.
- `src/components/Chat/ChatHistorySidebar.tsx` — new props (`streamingSessionIds`, `awaitingSessionIds`, `errorSessionIds`); chip-ring states; unread row style.
- `src/App.tsx` — `approvalWorkspaces` → `approvalSessions`; pass session-id scope to ChatPanel; remove `*SetSessionId` calls in regular-chat swap; stamp `lastViewedAt`; derive sets; toast diff-effect; stop scope on session delete.

**Backend:**
- `electron/services/claude.ts`, `electron/services/codex.ts`, `electron/services/gemini.ts` — idle-timeout sweep per scope; workspace-shutdown stops all scopes.

**Tests:**
- `tests/unit/components/WorkspaceToast.test.tsx` (new) — tone + onClick.
- `tests/unit/components/Chat/ChatHistorySidebar.test.tsx` — chip ring + unread cases.
- `tests/unit/App.persistence-on-swap.test.tsx` (new) — flushAndPersist before session swap.
- `tests/integration/concurrent-chat-streams.test.ts` (new) — two sessions stream concurrently through the IPC mock.
- `tests/unit/services/idle-scope-sweep.test.ts` (new) — stops idle scopes after threshold.

---

### Task 1: Add `lastViewedAt` field and `attention` toast tone

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/WorkspaceToast.tsx`
- Test: `tests/unit/components/WorkspaceToast.test.tsx` (new)

- [ ] **Step 1: Write the failing toast test**

Create `tests/unit/components/WorkspaceToast.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WorkspaceToast from '../../../src/components/WorkspaceToast';

describe('WorkspaceToast', () => {
  it('renders the attention tone with an amber glyph', () => {
    render(<WorkspaceToast message="Approval needed" tone="attention" onDismiss={() => {}} />);
    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });

  it('invokes onClick before dismissal when provided', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<WorkspaceToast message="m" tone="success" onDismiss={onDismiss} onClick={onClick} />);
    fireEvent.click(screen.getByText('m').parentElement!);
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx vitest run tests/unit/components/WorkspaceToast.test.tsx`
Expected: FAIL (tone "attention" not accepted; no onClick prop).

- [ ] **Step 3: Update `ChatSession` and `ToastTone`**

In `src/types.ts`, add `lastViewedAt?: number;` to the `ChatSession` interface (after `pinned?: boolean;`). No other field changes.

- [ ] **Step 4: Extend `WorkspaceToast`**

Replace the contents of `src/components/WorkspaceToast.tsx` with:

```tsx
import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'attention';

interface WorkspaceToastProps {
  message: string;
  onDismiss: () => void;
  tone?: ToastTone;
  onClick?: () => void;
}

export default function WorkspaceToast({ message, onDismiss, tone = 'success', onClick }: WorkspaceToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const accentVar =
    tone === 'error' ? 'var(--red)' :
    tone === 'attention' ? 'var(--orange)' :
    'var(--accent)';
  const glyph =
    tone === 'error' ? '⚠' :
    tone === 'attention' ? '!' :
    '✓';

  const handleClick = onClick
    ? () => { onClick(); setVisible(false); setTimeout(onDismiss, 100); }
    : undefined;

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--text)',
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        pointerEvents: 'auto',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ color: accentVar, fontSize: 14 }}>{glyph}</span>
      {message}
    </div>
  );
}
```

The fixed `position: bottom: 16, right: 16` is preserved here; stacking is added in Task 12 by switching to a flex container in `App.tsx` rather than each toast positioning itself. For Task 1 it stays as-is — single-toast callers still work.

- [ ] **Step 5: Run test, confirm pass**

Run: `npx vitest run tests/unit/components/WorkspaceToast.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/components/WorkspaceToast.tsx tests/unit/components/WorkspaceToast.test.tsx
git commit -m "feat(toast): add attention tone and optional onClick"
```

---

### Task 2: Idle-timeout sweep in provider services

**Files:**
- Create: `electron/services/idleScopeSweep.ts`
- Modify: `electron/services/claude.ts`, `electron/services/codex.ts`, `electron/services/gemini.ts` (start the sweep at module init)
- Test: `tests/unit/services/idle-scope-sweep.test.ts` (new)

**Constraint:** `IDLE_SCOPE_MS = 30 * 60 * 1000`. A scope is "idle" when `now - lastActivityAt > IDLE_SCOPE_MS` AND no `streaming` flag is set on the per-scope state. Sweep runs every 5 minutes.

- [ ] **Step 1: Read `electron/services/workspace.ts` to understand the scope record shape**

Run: open `electron/services/workspace.ts` and confirm where `claude`/`codex`/`gemini` per-scope state is stored (look for `getClaude`, `getCodex`, `getGemini`). Note the field used for activity (likely `touchActivity` updates a timestamp on the workspace; if no per-scope `lastActivityAt`, add one as part of this task).

- [ ] **Step 2: Write the failing test**

Create `tests/unit/services/idle-scope-sweep.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { sweepIdleScopes } from '../../../electron/services/idleScopeSweep';

describe('sweepIdleScopes', () => {
  it('stops scopes idle longer than the threshold', () => {
    const now = 10_000_000;
    const stop = vi.fn();
    const scopes = [
      { workspaceId: '/a', scope: 's1', lastActivityAt: now - 31 * 60_000, streaming: false },
      { workspaceId: '/a', scope: 's2', lastActivityAt: now - 5 * 60_000,  streaming: false },
      { workspaceId: '/a', scope: 's3', lastActivityAt: now - 60 * 60_000, streaming: true },
    ];
    sweepIdleScopes({ now, idleMs: 30 * 60_000, scopes, stop });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith('/a', 's1');
  });
});
```

- [ ] **Step 3: Run it, confirm failure**

Run: `npx vitest run tests/unit/services/idle-scope-sweep.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the pure sweep helper**

Create `electron/services/idleScopeSweep.ts`:

```ts
export interface IdleScopeRecord {
  workspaceId: string;
  scope: string;
  lastActivityAt: number;
  streaming: boolean;
}

export interface SweepOptions {
  now: number;
  idleMs: number;
  scopes: IdleScopeRecord[];
  stop: (workspaceId: string, scope: string) => void;
}

export function sweepIdleScopes({ now, idleMs, scopes, stop }: SweepOptions): void {
  for (const r of scopes) {
    if (r.streaming) continue;
    if (now - r.lastActivityAt > idleMs) stop(r.workspaceId, r.scope);
  }
}

export const IDLE_SCOPE_MS = 30 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
```

- [ ] **Step 5: Run test, confirm pass**

Run: `npx vitest run tests/unit/services/idle-scope-sweep.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the sweep into each service**

In `electron/services/claude.ts`, near module bottom (after IPC handlers are registered), add:

```ts
import { sweepIdleScopes, IDLE_SCOPE_MS, SWEEP_INTERVAL_MS } from './idleScopeSweep';
import { listAllWorkspaces } from './workspace'; // add this export if missing

setInterval(() => {
  const records: { workspaceId: string; scope: string; lastActivityAt: number; streaming: boolean }[] = [];
  for (const ws of listAllWorkspaces()) {
    for (const [scope, claude] of (ws.claudeByScope ?? new Map()).entries()) {
      records.push({
        workspaceId: ws.projectPath,
        scope,
        lastActivityAt: claude.lastActivityAt ?? 0,
        streaming: !!claude.streaming,
      });
    }
  }
  sweepIdleScopes({
    now: Date.now(),
    idleMs: IDLE_SCOPE_MS,
    scopes: records,
    stop: (workspaceId, scope) => {
      // Reuse the existing stop logic by emitting an internal handler call.
      // If a private stop function exists, call it; otherwise simulate the
      // 'claude:stop' IPC inline.
      try { stopClaudeScope(workspaceId, scope); } catch { /* best-effort */ }
    },
  });
}, SWEEP_INTERVAL_MS).unref();
```

If `stopClaudeScope` (or equivalent named export) does not exist, extract the body of the existing `ipcMain.on('claude:stop', ...)` handler at `electron/services/claude.ts:488` into a private `stopClaudeScope(projectPath, scope)` function and call that function from both the IPC handler and the sweep.

Add per-scope `lastActivityAt` (number) and `streaming` (boolean) fields wherever the scope record is created in `workspace.ts`. Update the existing message-handling code in `claude.ts` to set `claude.streaming = true` on `streaming_start` and `claude.streaming = false` on `done`, and to update `claude.lastActivityAt = Date.now()` on every inbound stdout chunk.

Repeat the same wiring in `electron/services/codex.ts` and `electron/services/gemini.ts` (extract `stopCodexScope`/`stopGeminiScope`, add the per-scope fields, start the interval).

- [ ] **Step 7: Run all unit tests for services**

Run: `npx vitest run tests/unit/services`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/services/idleScopeSweep.ts electron/services/claude.ts electron/services/codex.ts electron/services/gemini.ts electron/services/workspace.ts tests/unit/services/idle-scope-sweep.test.ts
git commit -m "feat(services): idle-timeout sweep for per-scope provider processes"
```

---

### Task 3: Workspace shutdown stops every scope, not just 'chat'

**Files:**
- Modify: `electron/services/claude.ts`, `codex.ts`, `gemini.ts`

- [ ] **Step 1: Grep for workspace-shutdown sites**

Run: `grep -n "shutdown\\|cleanup\\|dispose\\|closeWorkspace" electron/services/*.ts`
Identify the function(s) that tear down a workspace's provider state. Today they likely call the per-scope stop only for scope `'chat'`.

- [ ] **Step 2: Replace single-scope shutdown with all-scopes iteration**

For each provider service, change the shutdown code path from:

```ts
stopClaudeScope(projectPath, 'chat');
```

to:

```ts
for (const scope of getOrCreate(projectPath).claudeByScope?.keys() ?? []) {
  stopClaudeScope(projectPath, scope);
}
```

(Replace `claudeByScope` with the actual map name used in `workspace.ts`. Same pattern for codex and gemini with their respective `codexByScope` / `geminiByScope` maps.)

- [ ] **Step 3: Add a test asserting all scopes stop on shutdown**

Extend `tests/unit/services/idle-scope-sweep.test.ts` (or create a sibling `workspace-shutdown.test.ts` if shutdown logic is separately exported) to assert that when a workspace with two scope records is shut down, both `stopClaudeScope` calls are issued.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run tests/unit/services`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services
git commit -m "fix(services): shutdown iterates all scopes per workspace"
```

---

### Task 4: Convert `approvalWorkspaces` → `approvalSessions`

**Files:**
- Modify: `src/App.tsx`

**Shape change:** `Map<string, PendingApproval>` (keyed by `projectPath`) becomes `Map<string, Map<string, PendingApproval>>` (keyed by `projectPath`, then `sessionId`).

**Note:** This task does NOT yet change what scope the frontend sends. It only changes how the frontend stores received approvals. The IPC `msg.scope` is already provided by the backend (see `electron/services/claude.ts:336, 619`); we use it directly. Today `msg.scope` is `"chat"` for regular chats; Task 6 switches that to the session id. After Task 6, the same code keyed on `msg.scope` lands approvals in the correct per-session bucket without further changes.

- [ ] **Step 1: Rename state and update all readers**

In `src/App.tsx:218`, replace:

```ts
const [approvalWorkspaces, setApprovalWorkspaces] = useState<Map<string, PendingApproval>>(new Map());
```

with:

```ts
const [approvalSessions, setApprovalSessions] = useState<Map<string, Map<string, PendingApproval>>>(new Map());
```

- [ ] **Step 2: Update the populate path**

At `src/App.tsx:1879`, replace the `setApprovalWorkspaces(prev => { ... })` block with:

```ts
const scopeForApproval = msg.scope || 'chat';
setApprovalSessions(prev => {
  const next = new Map(prev);
  const inner = new Map(next.get(msg.projectPath) ?? new Map());
  inner.set(scopeForApproval, {
    toolName: msg.toolName,
    toolUseId: msg.toolUseId,
    command: msg.command,
    description: msg.description,
    input: msg.input,
  });
  next.set(msg.projectPath, inner);
  return next;
});
```

- [ ] **Step 3: Update the resolve path**

At `src/App.tsx:1922`, replace the resolve block with:

```ts
const resolvedScope = msg.scope || 'chat';
setApprovalSessions(prev => {
  const inner = prev.get(msg.projectPath);
  if (!inner || !inner.has(resolvedScope)) return prev;
  const next = new Map(prev);
  const innerNext = new Map(inner);
  innerNext.delete(resolvedScope);
  if (innerNext.size === 0) next.delete(msg.projectPath);
  else next.set(msg.projectPath, innerNext);
  return next;
});
```

- [ ] **Step 4: Update consumers in JSX**

Find each existing reader (grep result earlier showed `src/App.tsx:3480` and `:3543`). Replace:

```ts
approvalWorkspaces={new Set(approvalWorkspaces.keys())}
```

with:

```ts
approvalWorkspaces={new Set(approvalSessions.keys())}
```

(the prop on downstream components still takes a `Set<string>` of project paths — that's preserved by `.keys()` of the outer map). For the consumer at line 3543 that passes the full `approvalWorkspaces={approvalWorkspaces}` map, change to:

```ts
approvalWorkspaces={new Map(Array.from(approvalSessions.entries()).map(([k, v]) => [k, v.values().next().value]))}
```

This collapses to one approval per workspace for components that still expect that shape — Task 9 will give them per-session shape directly. The collapse keeps existing UI working in the interim.

- [ ] **Step 5: Type-check and run existing tests**

Run: `npx tsc --noEmit` and `npx vitest run`
Expected: PASS (no type errors, no test regressions).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(app): approvalWorkspaces -> approvalSessions (per-session map)"
```

---

### Task 5: Add `codexScope` and `geminiScope` props to `ChatPanel`

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

`claudeScope` already exists and is threaded through send/stop/approve/compact/answer. Mirror it for codex and gemini so the App can hand each provider its session id.

- [ ] **Step 1: Add the props**

In the props interface near `src/components/Chat/ChatPanel.tsx:343`, add:

```ts
codexScope?: string;
geminiScope?: string;
```

Destructure them in the component signature alongside `claudeScope`.

- [ ] **Step 2: Route them through provider calls**

Find every `geminiSend`, `geminiStop`, `codexSend`, `codexStop` callsite in `ChatPanel.tsx` and pass the scope as the trailing arg (the bridge already accepts it — see `electron/services/codex.ts` and `electron/services/gemini.ts` for ipc signatures). For example, at line 1459:

```ts
(window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel, geminiScope ?? 'chat');
```

becomes:

```ts
(window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel, geminiScope);
```

(remove the `'chat'` fallback — `undefined` lets the backend default, but App will always pass a value after Task 6). And at line 1461:

```ts
window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
```

becomes:

```ts
window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel, codexScope);
```

Add the codex bridge signature `codexSend(..., scope?: string)` to the IPC type definitions in `electron/preload.ts` and `src/types.ts` if not already there. (`grep "codexSend" electron/preload.ts` to confirm.)

- [ ] **Step 3: Route through scope filtering**

At `src/components/Chat/ChatPanel.tsx:740`, the message-filter check `if (msg.scope && msg.scope !== claudeScope) return;` is claude-specific. Add equivalent filters in the codex and gemini message effects so cross-session messages don't bleed.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run existing ChatPanel tests**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/types.ts electron/preload.ts
git commit -m "feat(chat): codexScope and geminiScope props on ChatPanel"
```

---

### Task 6: Pass `activeSession.id` as scope for regular chats

**Files:**
- Modify: `src/App.tsx`

This is the central per-session-scoping switch. After this commit, regular chats each have their own backend process keyed by session id.

- [ ] **Step 1: Find where App renders `ChatPanel`**

Run: `grep -n "<ChatPanel" src/App.tsx`
There should be one or two renderings (active workspace + meta workspace tiles).

- [ ] **Step 2: Pass scope props**

For each `<ChatPanel ... />` rendering for regular (non-task / non-orchestrator) sessions, add:

```tsx
claudeScope={ws.activeSession.id}
codexScope={ws.activeSession.id}
geminiScope={ws.activeSession.id}
```

For task/orchestrator sessions, leave the existing `claudeScope={ws.activeSession.id}` style — it already used session-id-as-scope.

- [ ] **Step 3: Update non-ChatPanel send/stop callsites in App.tsx that target a regular chat**

Anywhere `window.sai.claudeStop?.(ws)` / `window.sai.codexStop?.(ws)` / `window.sai.geminiStop?.(ws)` is called for a regular chat (no explicit scope), find the active session id for that workspace via `workspaces.get(ws)?.activeSession.id` and pass it as the scope arg. Use the existing `workspaces` map.

Skip swarm/orchestrator stop sites (`src/App.tsx:2839, 3250`) — they already pass an explicit scope.

- [ ] **Step 4: Type-check + run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Some existing tests that asserted scope was `'chat'` may need updates — change those assertions to expect the session id.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): scope regular chats by session id, not workspace"
```

---

### Task 7: Remove `*SetSessionId` calls for regular chats; stamp `lastViewedAt`

**Files:**
- Modify: `src/App.tsx` (`handleSelectSession` at line 2559; `handleNewChat` at line 2548; meta-task-restore at line 2613–2625)

After Task 6, every chat session already has its own backend scope and provider session id stored in the per-scope record. The rebinding pattern (`claudeSetSessionId(ws, selected.claudeSessionId)`) is no longer needed for regular chats — there's nothing to rebind.

- [ ] **Step 1: Update `handleSelectSession`**

Replace the body of `handleSelectSession` (`src/App.tsx:2559`) with:

```ts
const handleSelectSession = (id: string) => {
  if (!activeProjectPath) return;
  flushAndPersist(activeProjectPath);
  const selected = sessions.find(s => s.id === id);
  if (!selected) return;
  // For swarm/orchestrator sessions we still rebind because they may use
  // the workspace-wide 'chat' scope as the orchestrator scope.
  if (selected.kind === 'task' || selected.kind === 'orchestrator') {
    window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId);
    (window.sai as any).codexSetSessionId(activeProjectPath, selected.codexSessionId);
    window.sai.geminiSetSessionId?.(activeProjectPath, selected.geminiSessionId, 'chat');
  }
  // Stamp lastViewedAt for unread tracking.
  const stamped: ChatSession = { ...selected, lastViewedAt: Date.now() };
  updateWorkspace(activeProjectPath, ws => ({
    ...ws,
    activeSession: stamped,
    sessions: ws.sessions.map(s => s.id === id ? stamped : s),
  }));
  dbSaveSession(activeProjectPath, stamped, 0).catch(() => {});
};
```

- [ ] **Step 2: Update `handleNewChat`**

At `src/App.tsx:2548–2557`, remove the three `*SetSessionId(activeProjectPath, undefined)` calls for regular chats. They're no longer needed — a new session has a new id which has no existing backend process; first send spins one up.

Keep the `updateWorkspace(...)` block that swaps in the new `createSession()`.

- [ ] **Step 3: Update the swarm-routing-restore path**

At `src/App.tsx:2613–2625`, the `dbGetSessions(...).then(...)` path explicitly calls `claudeSetSessionId`/`codexSetSessionId`/`geminiSetSessionId` for a task session. Leave it as-is — it's the task path which still needs rebinding semantics for the orchestrator scope.

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): drop setSessionId rebind on regular chat swap; stamp lastViewedAt"
```

---

### Task 8: Stop a session's scope on `dbDeleteSession`

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx` (delete branch at line 241) and/or `src/App.tsx` if delete is routed through there

- [ ] **Step 1: Find the delete-session sites**

Run: `grep -n "dbDeleteSession" src/`. There's a call in `ChatHistorySidebar.tsx:244` and likely one in `App.tsx`.

- [ ] **Step 2: Stop each provider's scope before deleting**

Before the `dbDeleteSession(sessionId)` call, add:

```ts
const ws = projectPath;
try { window.sai.claudeStop?.(ws, sessionId); } catch {}
try { (window.sai as any).codexStop?.(ws, sessionId); } catch {}
try { (window.sai as any).geminiStop?.(ws, sessionId); } catch {}
dbDeleteSession(sessionId).catch(() => {});
```

(Use whatever `projectPath` variable is in scope at each call site — in `ChatHistorySidebar` it's the `projectPath` prop.)

- [ ] **Step 3: Run tests, type-check**

Run: `npx tsc --noEmit && npx vitest run tests/unit/components/Chat`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx src/App.tsx
git commit -m "feat(chat): stop provider scope when deleting a session"
```

---

### Task 9: Derive `streamingSessionIds`, `awaitingSessionIds`, `errorSessionIds` in App; pass to sidebar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Chat/ChatHistorySidebar.tsx` (props only — rendering in tasks 10–11)

- [ ] **Step 1: Add props to `ChatHistorySidebar`**

Add to the `ChatHistorySidebarProps` interface in `src/components/Chat/ChatHistorySidebar.tsx`:

```ts
streamingSessionIds?: Set<string>;
awaitingSessionIds?: Set<string>;
errorSessionIds?: Set<string>;
```

Destructure them in the component signature; default each to `new Set()` if undefined. Don't render them yet — Task 10 does.

- [ ] **Step 2: Derive the sets in `App.tsx`**

Just before the `<ChatHistorySidebar ... />` JSX (~`src/App.tsx:3601`), add:

```ts
const streamingSessionIds = useMemo(() => {
  if (!activeProjectPath) return new Set<string>();
  const prefix = `${activeProjectPath}:`;
  const ids = new Set<string>();
  for (const k of streamingScopes) {
    if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
  }
  return ids;
}, [streamingScopes, activeProjectPath]);

const awaitingSessionIds = useMemo(() => {
  if (!activeProjectPath) return new Set<string>();
  return new Set(approvalSessions.get(activeProjectPath)?.keys() ?? []);
}, [approvalSessions, activeProjectPath]);

const errorSessionIds = useMemo(() => {
  const ids = new Set<string>();
  for (const s of sessions) {
    const tail = s.messages[s.messages.length - 1];
    if (tail?.error) ids.add(s.id);
  }
  return ids;
}, [sessions]);
```

The `error` field is `ChatMessage.error?: {...}` from `src/types.ts:10` — truthy when set. No further investigation needed; this resolves spec open question #3.

- [ ] **Step 3: Pass them as props**

```tsx
<ChatHistorySidebar
  ...existing props...
  streamingSessionIds={streamingSessionIds}
  awaitingSessionIds={awaitingSessionIds}
  errorSessionIds={errorSessionIds}
/>
```

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc --noEmit && npx vitest run tests/unit/components/Chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Chat/ChatHistorySidebar.tsx
git commit -m "feat(sidebar): derive activity sets and pipe to ChatHistorySidebar"
```

---

### Task 10: Render status ring on the provider chip

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx`
- Modify: `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`:

```tsx
it('renders running state on a streaming session', () => {
  const session = makeSession({ id: 'a' });
  render(<ChatHistorySidebar
    {...baseProps}
    sessions={[session]}
    streamingSessionIds={new Set(['a'])}
  />);
  expect(screen.getByTestId('provider-chip-a').className).toMatch(/chip-running/);
});

it('renders awaiting state on an approval-pending session', () => {
  const session = makeSession({ id: 'b' });
  render(<ChatHistorySidebar
    {...baseProps}
    sessions={[session]}
    awaitingSessionIds={new Set(['b'])}
  />);
  expect(screen.getByTestId('provider-chip-b').className).toMatch(/chip-awaiting/);
});

it('renders error state on an errored session', () => {
  const session = makeSession({ id: 'c' });
  render(<ChatHistorySidebar
    {...baseProps}
    sessions={[session]}
    errorSessionIds={new Set(['c'])}
  />);
  expect(screen.getByTestId('provider-chip-c').className).toMatch(/chip-error/);
});
```

(Reuse the existing `makeSession` / `baseProps` helpers in that file. If they don't exist, create minimal ones.)

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx`
Expected: FAIL on the three new cases.

- [ ] **Step 3: Update the chip render**

At `src/components/Chat/ChatHistorySidebar.tsx:331–334`, replace the provider-chip span with:

```tsx
{(() => {
  const isRunning = streamingSessionIds.has(session.id);
  const isAwaiting = awaitingSessionIds.has(session.id);
  const isError = errorSessionIds.has(session.id);
  const stateClass =
    isError ? 'chip-error' :
    isAwaiting ? 'chip-awaiting' :
    isRunning ? 'chip-running' : '';
  return (
    <span
      data-testid={`provider-chip-${session.id}`}
      className={`chat-history-provider-dot ${stateClass}`}
      style={{ background: PROVIDER_COLORS[session.aiProvider || aiProvider] || providerColor }}
    />
  );
})()}
```

- [ ] **Step 4: Add CSS for the states**

Append to the `<style>{...}` block at the end of `ChatHistorySidebar.tsx`:

```css
.chat-history-provider-dot.chip-running {
  box-shadow: 0 0 0 2px var(--accent);
  animation: chip-pulse 1.4s ease-in-out infinite;
}
.chat-history-provider-dot.chip-awaiting {
  box-shadow: 0 0 0 2px var(--orange);
}
.chat-history-provider-dot.chip-error {
  box-shadow: 0 0 0 2px var(--red);
}
@keyframes chip-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--accent); opacity: 1; }
  50%      { box-shadow: 0 0 0 4px var(--accent); opacity: 0.6; }
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx tests/unit/components/Chat/ChatHistorySidebar.test.tsx
git commit -m "feat(sidebar): status ring on provider chip for running/awaiting/error"
```

---

### Task 11: Unread indicator on chat rows

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx`
- Modify: `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`

- [ ] **Step 1: Write failing test**

Add to the sidebar test file:

```tsx
it('marks a non-active session as unread when updatedAt > lastViewedAt', () => {
  const unread = makeSession({ id: 'u', updatedAt: 2000, lastViewedAt: 1000 });
  render(<ChatHistorySidebar
    {...baseProps}
    activeSessionId="other"
    sessions={[unread]}
  />);
  expect(screen.getByTestId('unread-dot-u')).toBeInTheDocument();
});

it('does not mark the active session as unread', () => {
  const unread = makeSession({ id: 'u', updatedAt: 2000, lastViewedAt: 1000 });
  render(<ChatHistorySidebar
    {...baseProps}
    activeSessionId="u"
    sessions={[unread]}
  />);
  expect(screen.queryByTestId('unread-dot-u')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx -t unread`
Expected: FAIL.

- [ ] **Step 3: Implement unread**

In the row JSX, compute `isUnread`:

```ts
const isUnread = session.id !== activeSessionId
  && session.updatedAt > (session.lastViewedAt ?? session.updatedAt);
```

In the meta row (`chat-history-card-meta`), append next to the timestamp:

```tsx
{isUnread && <span data-testid={`unread-dot-${session.id}`} className="chat-history-unread-dot" />}
```

Bump title weight when unread by adding `style={{ fontWeight: isUnread ? 600 : 500 }}` to the title span (or add an `unread` class and set CSS).

Append CSS:

```css
.chat-history-unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
  margin-left: 4px;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx tests/unit/components/Chat/ChatHistorySidebar.test.tsx
git commit -m "feat(sidebar): unread indicator for chats with new activity"
```

---

### Task 12: Toast diff-effect for background-chat events

**Files:**
- Modify: `src/App.tsx`
- Test: extend an App-level test or add `tests/unit/App.toast-effects.test.tsx`

- [ ] **Step 1: Add a toast queue**

In `src/App.tsx`, near existing toast-related state (search `WorkspaceToast`), add:

```ts
interface ChatToast {
  id: string;
  message: string;
  tone: ToastTone;
  onClick?: () => void;
}
const [chatToasts, setChatToasts] = useState<ChatToast[]>([]);
const enqueueChatToast = useCallback((t: ChatToast) => {
  setChatToasts(prev => [...prev, t].slice(-3));
}, []);
const dismissChatToast = useCallback((id: string) => {
  setChatToasts(prev => prev.filter(t => t.id !== id));
}, []);
```

- [ ] **Step 2: Add the diff effect**

Below the queue, add:

```ts
const prevStreamingRef = useRef<Set<string>>(new Set());
const prevAwaitingRef = useRef<Set<string>>(new Set());

useEffect(() => {
  const prevStreaming = prevStreamingRef.current;
  const prevAwaiting = prevAwaitingRef.current;
  const activeId = activeSession?.id;

  // Turn finished: was streaming, now isn't, not active.
  for (const id of prevStreaming) {
    if (!streamingSessionIds.has(id) && id !== activeId) {
      const s = sessions.find(x => x.id === id);
      if (!s) continue;
      enqueueChatToast({
        id: `done-${id}-${Date.now()}`,
        message: `Reply ready in '${s.title || 'Untitled'}'`,
        tone: 'success',
        onClick: () => handleSelectSession(id),
      });
    }
  }
  // Approval pending: newly in awaiting, not active.
  for (const id of awaitingSessionIds) {
    if (!prevAwaiting.has(id) && id !== activeId) {
      const s = sessions.find(x => x.id === id);
      if (!s) continue;
      enqueueChatToast({
        id: `approval-${id}-${Date.now()}`,
        message: `Approval needed in '${s.title || 'Untitled'}'`,
        tone: 'attention',
        onClick: () => handleSelectSession(id),
      });
    }
  }
  prevStreamingRef.current = streamingSessionIds;
  prevAwaitingRef.current = awaitingSessionIds;
}, [streamingSessionIds, awaitingSessionIds, sessions, activeSession?.id, enqueueChatToast, handleSelectSession]);
```

- [ ] **Step 3: Render the stack**

Replace the existing single `<WorkspaceToast .../>` render with a stacked container. Add to the App's top-level JSX (near the existing toast):

```tsx
<div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column-reverse', gap: 8, zIndex: 900 }}>
  {chatToasts.map(t => (
    <WorkspaceToast
      key={t.id}
      message={t.message}
      tone={t.tone}
      onClick={t.onClick}
      onDismiss={() => dismissChatToast(t.id)}
    />
  ))}
</div>
```

Inside `WorkspaceToast`, the existing `position: fixed; bottom: 16; right: 16` from Task 1 needs to become `position: relative` so the wrapper controls layout. Update the inline style accordingly. Existing single-toast callers (workspace-switch toast) will need their own wrapper or accept the new relative behavior — check `grep -n "WorkspaceToast" src/App.tsx` and verify the workspace-switch usage still renders OK; wrap it in a `<div style={{ position: 'fixed', ... }}>` if needed.

- [ ] **Step 4: Write a small test for the queue**

Add `tests/unit/App.toast-effects.test.tsx` that renders a minimal harness simulating `streamingSessionIds` changing and asserts the right toast is enqueued. (If wiring App is too heavy, extract the effect body to a pure helper `computeChatToasts(prev, next, sessions, activeId)` and unit-test that — recommended for testability.)

- [ ] **Step 5: Run tests, type-check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/WorkspaceToast.tsx tests/unit/App.toast-effects.test.tsx
git commit -m "feat(app): toast queue for background-chat finish and approval events"
```

---

### Task 13: Persistence-on-swap test

**Files:**
- Test: `tests/unit/App.persistence-on-swap.test.tsx` (new)

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../src/App';
import * as chatDb from '../../src/chatDb';

vi.mock('../../src/chatDb', async () => {
  const actual = await vi.importActual<typeof chatDb>('../../src/chatDb');
  return { ...actual, dbSaveSession: vi.fn().mockResolvedValue(undefined) };
});

describe('App session swap', () => {
  it('persists the outgoing session before activating the new one', async () => {
    // Setup: render App with a workspace containing two sessions, A active.
    // (Use existing test helpers from tests/helpers/ipc-mock.ts to seed.)
    // Then click session B in the sidebar.
    // Assert dbSaveSession was called with the A session before activeSession changed.
    const calls: string[] = [];
    (chatDb.dbSaveSession as any).mockImplementation((_p: string, s: any) => {
      calls.push(`save:${s.id}`);
      return Promise.resolve();
    });
    // ...render setup with workspaces seeded...
    fireEvent.click(screen.getByText('Session B'));
    await waitFor(() => {
      const saveIdx = calls.findIndex(c => c === 'save:A');
      expect(saveIdx).toBeGreaterThanOrEqual(0);
    });
  });
});
```

The setup details depend on how App is currently tested. Look at `tests/unit/App.*.test.tsx` for the existing pattern (workspace seeding via the IPC mock and initial state). Mirror it.

- [ ] **Step 2: Run, confirm pass (this is a verification test — current code should already pass)**

Run: `npx vitest run tests/unit/App.persistence-on-swap.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/App.persistence-on-swap.test.tsx
git commit -m "test(app): persist outgoing session before swap"
```

---

### Task 14: Integration test — two chats stream concurrently

**Files:**
- Test: `tests/integration/concurrent-chat-streams.test.ts` (new)

- [ ] **Step 1: Read `tests/integration/ipc-streaming.test.ts` for the IPC-mock patterns**

Confirm how the existing integration tests drive the bridge (`(window.sai as any).claudeSend` etc) and how they assert on streaming state.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setupIpcMock, sendBackendMessage } from '../helpers/ipc-mock'; // adjust to actual helper API

describe('concurrent chat streams in one workspace', () => {
  beforeEach(() => setupIpcMock());

  it('keeps both session scopes streaming and routes events independently', async () => {
    const ws = '/repo';
    const a = 'session-a';
    const b = 'session-b';

    // Trigger streaming_start for both scopes from the mocked main process.
    sendBackendMessage('claude:message', { type: 'streaming_start', projectPath: ws, scope: a, turnSeq: 1 });
    sendBackendMessage('claude:message', { type: 'streaming_start', projectPath: ws, scope: b, turnSeq: 1 });

    // Assert renderer's streamingScopes contains both keys.
    // (Use an exported selector or read from a test-mounted App's state via a
    //  data-attribute / probe. If neither exists, expose a small test hook.)
    // Then deliver a 'done' to scope a and assert only b remains streaming.
    sendBackendMessage('claude:message', { type: 'done', projectPath: ws, scope: a, turnSeq: 1 });
    // assert only `${ws}:${b}` remains in streamingScopes
  });
});
```

The concrete assertion strategy depends on what existing helpers expose. If there's no test-side accessor for `streamingScopes`, add a minimal `data-streaming-scopes` attribute on a hidden element in App during test mode (gated on `process.env.NODE_ENV === 'test'`) — or assert on observable downstream UI (e.g. the chat history sidebar's chip ring for each session via `data-testid="provider-chip-…"` from Task 10, which gives a direct, user-visible signal that both sessions are running).

- [ ] **Step 3: Run, confirm pass**

Run: `npx vitest run tests/integration/concurrent-chat-streams.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/concurrent-chat-streams.test.ts
git commit -m "test(integration): two chat sessions stream concurrently in one workspace"
```

---

## Final verification

- [ ] Run the full test suite: `npx vitest run`
- [ ] Run typecheck: `npx tsc --noEmit`
- [ ] Manually verify in dev (`npm run dev`):
  1. Open a project, start two chats, send a prompt in each. Switch between them while both are streaming. Both should keep streaming; switching shows the right transcript.
  2. Trigger an approval in a non-active chat. A toast appears; clicking it switches to that chat.
  3. Let a non-active chat finish a turn. A toast appears; clicking it switches.
  4. Mark a chat unread by leaving it after new output, switch away, switch back — unread dot appears and clears.
  5. Delete a chat session. Its scope's process should terminate (check via process list or backend logs).
