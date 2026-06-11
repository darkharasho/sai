# Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit findings from 2026-06-10: silent persistence failures, save-on-quit data loss, per-session write races, Electron resource leaks, and setState-after-unmount races.

**Architecture:** A new `sessionSaveQueue` module serializes and error-reports all chat-session writes (replacing bare `dbSaveSession().catch(() => {})` call sites). A new pure `computeQuitFlushes` function in `workspaceFlush.ts` is shared by the beforeunload backstop and a new awaited flush in the existing quit handshake (`onRequestQuit` → flush → `confirmQuit`). Electron main gets three small lifecycle fixes. Renderer effects get cancellation guards.

**Tech Stack:** React 19, Electron 36, IndexedDB (fake-indexeddb in tests), vitest (`unit` project, jsdom).

**Branch:** `stability-hardening` off `main`.

**Test command:** `npx vitest run --project unit <file>` (vitest.config.ts already caps workers at 2).

---

### Task 0: Branch + remove junk files

**Files:** Delete: `hello.txt`, `goodbye.txt`, `test.txt`

- [x] **Step 1:** `git checkout -b stability-hardening`
- [x] **Step 2:** `git rm hello.txt goodbye.txt test.txt`
- [x] **Step 3:** `git commit -m "chore: remove stray test files from repo root"`

---

### Task 1: Session save queue (serialization + error reporting)

Fixes audit findings 1 (25× swallowed `.catch(() => {})`) and 3 (interleaved per-session writes corrupting the `fromIdx` prefix-merge).

**Files:**
- Create: `src/lib/sessionSaveQueue.ts`
- Test: `tests/unit/lib/sessionSaveQueue.test.ts`

**Design:** `createSaveQueue(saveFn)` factory (injectable for tests) returning a `queueSave(projectPath, session, fromIdx?)` function that chains saves per `session.id`. Errors are logged, dispatched as a throttled `sai-persist-error` CustomEvent on `window` (with `quota: true` for `QuotaExceededError`), and the returned promise still rejects so callers keeping `.catch(() => {})` are safe but `.then()` chains only run on success.

- [x] **Step 1: Write the failing test** — `tests/unit/lib/sessionSaveQueue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSaveQueue } from '@/lib/sessionSaveQueue';
import type { ChatSession } from '@/types';

function makeSession(id: string): ChatSession {
  const now = Date.now();
  return { id, title: 't', messages: [], messageCount: 0, createdAt: now, updatedAt: now };
}

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSaveQueue', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('serializes saves for the same session id', async () => {
    const order: string[] = [];
    const first = deferred<void>();
    const saveFn = vi.fn()
      .mockImplementationOnce(() => { order.push('start-1'); return first.promise; })
      .mockImplementationOnce(() => { order.push('start-2'); return Promise.resolve(); });
    const queue = createSaveQueue(saveFn);
    const s = makeSession('a');
    const p1 = queue('/p', s, 0);
    const p2 = queue('/p', s, 5);
    await Promise.resolve();
    expect(order).toEqual(['start-1']); // second save must wait
    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'start-2']);
    expect(saveFn).toHaveBeenNthCalledWith(2, '/p', s, 5);
  });

  it('runs saves for different session ids concurrently', async () => {
    const first = deferred<void>();
    const started: string[] = [];
    const saveFn = vi.fn((_p: string, sess: ChatSession) => {
      started.push(sess.id);
      return sess.id === 'a' ? first.promise : Promise.resolve();
    });
    const queue = createSaveQueue(saveFn);
    const pa = queue('/p', makeSession('a'));
    const pb = queue('/p', makeSession('b'));
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']); // b did not wait on a
    first.resolve();
    await Promise.all([pa, pb]);
  });

  it('keeps the queue alive after a failed save', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const queue = createSaveQueue(saveFn);
    const s = makeSession('a');
    await expect(queue('/p', s)).rejects.toThrow('boom');
    await expect(queue('/p', s)).resolves.toBeUndefined();
  });

  it('dispatches a throttled sai-persist-error event on failure', async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('sai-persist-error', listener);
    try {
      const saveFn = vi.fn().mockRejectedValue(
        new DOMException('full', 'QuotaExceededError'),
      );
      const queue = createSaveQueue(saveFn);
      await queue('/p', makeSession('a')).catch(() => {});
      await queue('/p', makeSession('b')).catch(() => {});
      expect(events).toHaveLength(1); // second error throttled
      expect(events[0].detail.quota).toBe(true);
    } finally {
      window.removeEventListener('sai-persist-error', listener);
    }
  });
});
```

- [x] **Step 2:** Run `npx vitest run --project unit tests/unit/lib/sessionSaveQueue.test.ts` — expect FAIL (module not found).
- [x] **Step 3: Implement** `src/lib/sessionSaveQueue.ts`:

```ts
import { dbSaveSession } from '../chatDb';
import type { ChatSession } from '../types';

type SaveFn = (projectPath: string, session: ChatSession, fromIdx?: number) => Promise<void>;

const ERROR_EVENT_THROTTLE_MS = 30_000;

/**
 * Serialize session saves per session id so concurrent dbSaveSession calls
 * can't interleave their read-merge (fromIdx) transactions, and surface
 * failures (console + throttled `sai-persist-error` window event) instead of
 * silently dropping them. The returned promise rejects on failure so callers
 * chaining `.then()` only proceed on success.
 */
export function createSaveQueue(saveFn: SaveFn = dbSaveSession): SaveFn {
  const tails = new Map<string, Promise<void>>();
  let lastErrorEventAt = 0;

  const report = (err: unknown) => {
    console.error('[persist] session save failed:', err);
    const now = Date.now();
    if (now - lastErrorEventAt < ERROR_EVENT_THROTTLE_MS) return;
    lastErrorEventAt = now;
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    window.dispatchEvent(new CustomEvent('sai-persist-error', {
      detail: { quota, message: err instanceof Error ? err.message : String(err) },
    }));
  };

  return (projectPath, session, fromIdx) => {
    const prev = tails.get(session.id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => saveFn(projectPath, session, fromIdx));
    const tail = run.catch(report);
    tails.set(session.id, tail);
    void tail.finally(() => {
      if (tails.get(session.id) === tail) tails.delete(session.id);
    });
    return run;
  };
}

export const queueSaveSession = createSaveQueue();
```

- [x] **Step 4:** Run the test again — expect PASS.
- [x] **Step 5: Swap call sites in `src/App.tsx`.** Add `import { queueSaveSession } from './lib/sessionSaveQueue';` and replace `dbSaveSession(` with `queueSaveSession(` at lines 1093, 1629, 2178, 2197, 2228, 2883, 2907, 3478, 3989, 4183, 4333, 4376, 4394 (every call site; keep existing `.then`/`.catch` chains as-is). Remove `dbSaveSession` from the `./chatDb` import in App.tsx if no longer referenced.
- [x] **Step 6: Surface the error to the user.** In App.tsx, next to the other top-level effects (e.g. after the beforeunload effect ~line 2204), add:

```ts
  // Surface persistence failures (silent before — audit 2026-06-10)
  useEffect(() => {
    const onPersistError = (e: Event) => {
      const detail = (e as CustomEvent).detail as { quota?: boolean; message?: string };
      setToast({
        message: detail?.quota
          ? 'Chat history could not be saved: storage is full. Delete old sessions in Settings.'
          : `Chat history could not be saved: ${detail?.message ?? 'unknown error'}`,
        key: Date.now(),
        tone: 'error',
      });
    };
    window.addEventListener('sai-persist-error', onPersistError);
    return () => window.removeEventListener('sai-persist-error', onPersistError);
  }, []);
```

- [x] **Step 7:** Run `npx tsc --noEmit` and `npx vitest run --project unit tests/unit/chatDb.test.ts tests/unit/lib/sessionSaveQueue.test.ts tests/unit/App.persistence-on-swap.test.tsx` — expect PASS. (If `App.persistence-on-swap` mocks `dbSaveSession` from `./chatDb`, update the mock to `./lib/sessionSaveQueue` / `queueSaveSession`.)
- [x] **Step 8:** `git add -A && git commit -m "fix(persist): serialize session saves per id and surface failures"`

---

### Task 2: Awaited flush on quit (`computeQuitFlushes`)

Fixes audit finding 2: `beforeunload` fires async saves with no flush guarantee. The app already has a quit handshake (`mainWindow.on('close')` → `swarm:request-quit` → renderer calls `confirmQuit()`); we flush sessions (awaited, capped at 2s) before confirming.

**Files:**
- Modify: `src/workspaceFlush.ts` (add `computeQuitFlushes`)
- Modify: `src/App.tsx` (beforeunload effect ~2169-2204, onRequestQuit effect ~559-576, quit-modal confirm ~4950)
- Test: `tests/unit/workspaceFlush.test.ts`

- [x] **Step 1: Write failing tests** — append to `tests/unit/workspaceFlush.test.ts` (reuse that file's existing helpers/types; mirror its `WorkspaceLike` fixture style):

```ts
describe('computeQuitFlushes', () => {
  it('flushes a workspace whose live messages are ahead of the persisted count', () => {
    const session = makeSessionFixture({ messageCount: 1 });
    const msgs = [makeMessageFixture(), makeMessageFixture()];
    const plans = computeQuitFlushes({
      workspaces: new Map([['/ws', { activeSession: session }]]),
      wsMessages: new Map([['/ws', msgs]]),
      wsFirstLoadedIdx: new Map([['/ws', 3]]),
      focusedPath: '/ws',
      now: 1000,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].wsPath).toBe('/ws');
    expect(plans[0].fromIdx).toBe(3);
    expect(plans[0].session.messages).toBe(msgs);
    expect(plans[0].session.messageCount).toBe(2);
    expect(plans[0].session.updatedAt).toBe(1000);
    expect(plans[0].session.lastViewedAt).toBe(1000); // focused
  });

  it('does not bump lastViewedAt for unfocused workspaces', () => {
    const session = makeSessionFixture({ messageCount: 0, lastViewedAt: 5 });
    const plans = computeQuitFlushes({
      workspaces: new Map([['/bg', { activeSession: session }]]),
      wsMessages: new Map([['/bg', [makeMessageFixture()]]]),
      wsFirstLoadedIdx: new Map(),
      focusedPath: '/other',
      now: 1000,
    });
    expect(plans[0].session.lastViewedAt).toBe(5);
    expect(plans[0].fromIdx).toBe(0);
  });

  it('skips workspaces with no new messages', () => {
    const session = makeSessionFixture({ messageCount: 1 });
    const plans = computeQuitFlushes({
      workspaces: new Map([['/ws', { activeSession: session }]]),
      wsMessages: new Map([['/ws', [makeMessageFixture()]]]),
      wsFirstLoadedIdx: new Map(),
      focusedPath: '/ws',
    });
    expect(plans).toHaveLength(0);
  });

  it('falls back to activeSession when there is no live message buffer', () => {
    const session = makeSessionFixture({ messageCount: 2, messages: [makeMessageFixture(), makeMessageFixture()] });
    const plans = computeQuitFlushes({
      workspaces: new Map([['/ws', { activeSession: session }]]),
      wsMessages: new Map(),
      wsFirstLoadedIdx: new Map(),
      focusedPath: '/ws',
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].session).toBe(session);
  });
});
```

(Adapt fixture helper names to whatever `workspaceFlush.test.ts` already defines — if it builds sessions inline, do the same inline.)

- [x] **Step 2:** Run `npx vitest run --project unit tests/unit/workspaceFlush.test.ts` — expect FAIL (`computeQuitFlushes` not exported).
- [x] **Step 3: Implement** in `src/workspaceFlush.ts`, below `computeUnmountFlushes`, reusing its `WorkspaceLike`/`FlushPlan` types:

```ts
/**
 * Compute the saves needed to persist every workspace's live chat state at
 * shutdown. Mirrors the (previously inline) beforeunload logic: skip
 * workspaces with nothing new, only bump lastViewedAt on the focused one.
 */
export function computeQuitFlushes<W extends WorkspaceLike>(args: {
  workspaces: Map<string, W>;
  wsMessages: Map<string, ChatMessage[]>;
  wsFirstLoadedIdx: Map<string, number>;
  focusedPath?: string | null;
  now?: number;
}): FlushPlan[] {
  const now = args.now ?? Date.now();
  const out: FlushPlan[] = [];
  for (const [wsPath, ws] of args.workspaces) {
    const fromIdx = args.wsFirstLoadedIdx.get(wsPath) ?? 0;
    const latest = args.wsMessages.get(wsPath);
    if (!latest || latest.length === 0) {
      if (ws.activeSession.messages.length > 0) {
        out.push({ wsPath, session: ws.activeSession, fromIdx });
      }
      continue;
    }
    if (latest.length === ws.activeSession.messageCount) continue;
    out.push({
      wsPath,
      fromIdx,
      session: {
        ...ws.activeSession,
        messages: latest,
        updatedAt: now,
        ...(wsPath === args.focusedPath ? { lastViewedAt: now } : {}),
        messageCount: latest.length,
      },
    });
  }
  return out;
}
```

- [x] **Step 4:** Run the test — expect PASS.
- [x] **Step 5: Rewire App.tsx.** Import `computeQuitFlushes` from `./workspaceFlush`. Above the beforeunload effect, add a stable flush helper (refs only, no deps):

```ts
  // Flush all live sessions to IndexedDB; capped so quit can never hang.
  const flushAllSessionsRef = useRef(async () => {});
  flushAllSessionsRef.current = async () => {
    const flushes = computeQuitFlushes({
      workspaces: workspacesRef.current,
      wsMessages: wsMessagesRef.current,
      wsFirstLoadedIdx: wsFirstLoadedIdxRef.current,
      focusedPath: activeProjectPathRef.current,
    });
    if (flushes.length === 0) return;
    await Promise.race([
      Promise.allSettled(flushes.map(f => queueSaveSession(f.wsPath, f.session, f.fromIdx))),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  };
```

Replace the body of `handleBeforeUnload` (lines ~2171-2199) with the fire-and-forget version of the same:

```ts
    const handleBeforeUnload = () => {
      void flushAllSessionsRef.current();
    };
```

- [x] **Step 6: Await the flush in both quit paths.** In the `onRequestQuit` effect (~line 562), change the no-streaming branch:

```ts
      if (streaming.length === 0) {
        void flushAllSessionsRef.current().finally(() => sai.confirmQuit?.());
        return;
      }
```

And in the quit-confirm modal's confirm handler (~line 4950), change `(window.sai as any).confirmQuit?.();` to:

```ts
            void flushAllSessionsRef.current().finally(() => (window.sai as any).confirmQuit?.());
```

- [x] **Step 7:** Run `npx tsc --noEmit` and `npx vitest run --project unit tests/unit/workspaceFlush.test.ts tests/unit/App.persistence-on-swap.test.tsx` — expect PASS.
- [x] **Step 8:** `git add -A && git commit -m "fix(persist): await session flush before quit; share flush logic with beforeunload"`

---

### Task 3: Electron lifecycle fixes

Three small main-process fixes; no unit tests are practical here (BrowserWindow lifecycle) — verification is `tsc` + existing integration suite + manual smoke in Task 6.

**Files:**
- Modify: `electron/main.ts` (~461-560: pendingMcpCalls; ~971-1018: captureComponent)
- Modify: `electron/services/claude.ts` (~1421-1460: idle sweep)

- [x] **Step 1: Reject pending MCP calls on window close.** In `electron/main.ts`, immediately after the `swarmMcpHost.onToolCall(...)` registration block (after its closing `});`, ~line 523), add:

```ts
    // Don't leave MCP tool calls hanging if the window goes away mid-call.
    mainWindow.on('closed', () => {
      for (const pending of pendingMcpCalls.values()) {
        pending.reject(new Error('main window closed'));
      }
      pendingMcpCalls.clear();
    });
```

- [x] **Step 2: Harden the captureComponent poll loop.** In the `render:captureComponent` handler, inside the `while (true)` loop, add a destroyed check as the first statement:

```ts
      while (true) {
        if (win.isDestroyed()) throw new Error('capture window destroyed during poll');
        const ready = (await win.webContents.executeJavaScript('window.__renderReady === true').catch(() => false)) as boolean;
```

and add `.catch(() => 200)` to the height `executeJavaScript` call:

```ts
      const h = (await win.webContents.executeJavaScript(
        "(function(){var el=document.getElementById('render-host-root');return el?Math.ceil(el.getBoundingClientRect().height):0;})() || 200",
      ).catch(() => 200)) as number;
```

- [x] **Step 3: Make the idle sweep timer single-instance and clearable.** In `electron/services/claude.ts`, hoist the timer to module scope (near other module-level state at the top of the file):

```ts
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;
```

In `registerClaudeHandlers`, change `const idleSweepTimer = setInterval(() => {` to:

```ts
  if (idleSweepTimer) clearInterval(idleSweepTimer);
  idleSweepTimer = setInterval(() => {
```

and change `idleSweepTimer.unref?.();` to `idleSweepTimer.unref?.();` (no change needed — it still type-checks since assignment precedes it; if TS narrows to nullable, use `idleSweepTimer?.unref?.();`). Implement `destroyClaude`:

```ts
export function destroyClaude() {
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}
```

- [x] **Step 4: Call `destroyClaude` on window close.** In `electron/main.ts`, add `destroyClaude` to the existing import from the claude service module, and in the `mainWindow.on('close')` handler add `destroyClaude();` next to `stopSuspendTimer();`.
- [x] **Step 5:** Run `npx tsc --noEmit` — expect clean. Run `npx vitest run --project unit tests/unit/electron tests/unit/services` — expect PASS.
- [x] **Step 6:** `git add -A && git commit -m "fix(electron): clean up MCP calls, capture windows, and idle-sweep timer on close"`

---

### Task 4: Renderer cancellation guards and timer cleanup

Mechanical setState-after-unmount fixes. No new tests (no observable behavior change in jsdom); verified by `tsc` + existing suite.

**Files:**
- Modify: `src/App.tsx` (~1665 metaWorkspaceList, ~1670 paletteWorkspaces, ~1899-1960 settings loader)
- Modify: `src/components/Chat/ChatPanel.tsx` (~504 settings load, ~1560 auto-send timer)
- Modify: `src/components/Terminal/TerminalPanel.tsx` (~104-120 create/dispose race)

- [x] **Step 1: App.tsx metaWorkspaceList + paletteWorkspaces effects** — add guards:

```ts
  useEffect(() => {
    let cancelled = false;
    window.sai.metaWorkspaceList?.().then(list => {
      if (!cancelled) setMetaWorkspaces(list ?? []);
    }).catch(() => { if (!cancelled) setMetaWorkspaces([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    let cancelled = false;
    (window as any).sai.workspaceGetAll().then((ws: any[]) => {
      if (!cancelled) setPaletteWorkspaces(ws);
    }).catch(() => { if (!cancelled) setPaletteWorkspaces([]); });
    return () => { cancelled = true; };
  }, [commandPaletteOpen]);
```

- [x] **Step 2: App.tsx settings-loader effect (~1899).** At the top of the effect body add:

```ts
    let cancelled = false;
    const guard = <T,>(fn: (v: T) => void) => (v: T) => { if (!cancelled) fn(v); };
```

Wrap every `.then(cb)` callback that calls a setState in `guard(...)` — e.g. `window.sai.settingsGet('focusedChat', false).then(guard((v: boolean) => setFocusedChat(v)));` and similarly for editorFontSize, editorMinimap, highlightTheme, aiProvider, commitMessageProvider, aiTitleGeneration, and the nested `claude`/`codex`/`gemini` loaders (the callbacks calling setModelChoice/setEffortLevel/setPermissionMode/setCodexModel/setCodexPermission/setGeminiModel/setGeminiApprovalMode/setGeminiConversationMode). The `sidebarWidth`/`theme`/`roundedCorners` callbacks touch only the DOM/document, not state — leave them unguarded. Leave the one-time flat→nested migration block unguarded (it only writes settings). At the end of the effect add `return () => { cancelled = true; };`.
- [x] **Step 3: ChatPanel settings effect (~504):**

```ts
  useEffect(() => {
    let cancelled = false;
    window.sai.settingsGet('autoCompactThreshold', 0).then((v: number) => { if (!cancelled) setAutoCompactThreshold(v); });
    window.sai.settingsGet('toolCallsExpanded', true).then((v: boolean) => { if (!cancelled) setToolCallsExpanded(v); });
    return () => { cancelled = true; };
  }, []);
```

- [x] **Step 4: ChatPanel auto-send timer (~1560).** In the `[isStreaming]` effect, replace `setTimeout(() => handleSend(next.fullText, next.images), 300);` with a tracked timer, and clear it in the effect cleanup:

```ts
        autoSendTimerRef.current = setTimeout(() => handleSend(next.fullText, next.images), 300);
```

Declare near the other refs: `const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);` and add to the end of the effect:

```ts
    return () => {
      if (autoSendTimerRef.current) { clearTimeout(autoSendTimerRef.current); autoSendTimerRef.current = null; }
    };
```

- [x] **Step 5: TerminalPanel create/dispose race (~104).** In the mount effect, add `let disposed = false;` before the `terminalCreate` call; first line of the `.then`: `if (disposed) { window.sai.terminalKill(id); return; }`; first line of the effect cleanup: `disposed = true;`.
- [x] **Step 6:** Run `npx tsc --noEmit` and `npx vitest run --project unit` — expect PASS (full unit project; config caps workers).
- [x] **Step 7:** `git add -A && git commit -m "fix(renderer): cancellation guards for async effects, timer cleanup, pty create race"`

---

### Task 5: Full verification

- [x] **Step 1:** `npx tsc --noEmit` — clean.
- [x] **Step 2:** `npm run test:unit` — all pass.
- [x] **Step 3:** `npm run test:integration` — all pass.
- [x] **Step 4:** Review `git log --oneline main..HEAD` and the cumulative diff for stray debug code.
