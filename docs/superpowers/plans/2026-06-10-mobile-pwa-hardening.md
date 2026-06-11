# Mobile + PWA Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the mobile/PWA audit findings of 2026-06-10 — chiefly that prompts sent from mobile/PWA spawn a fresh Claude CLI session (no `--resume`) because the sessionId is never threaded through the bridge.

**Architecture:** Thread `sessionId` through the prompt frame end-to-end (wire clients → bridge `PromptArgs` → main → a new exported `setSessionIdImpl` in the claude service that mirrors the `claude:setSessionId` IPC semantics). Then fix the PWA's unguarded `session.history` application, add a mobile `session.history` handler (gives both initial history AND reconnect resync, since the bridge replays history on every `session.attach`), and do the mechanical jank sweep (async cancellation, autoscroll, listener cleanup, SaiLogo dedupe).

**Tech Stack:** Electron main (vitest unit), PWA `src/renderer-remote` (vitest, jsdom), Expo RN app `sai-mobile` (jest, `npm --prefix sai-mobile test`; typecheck via `npm --prefix sai-mobile run lint`).

**Branch:** `mobile-pwa-hardening` off `main`.

**Note:** `electron/services/remote/bridge-server.ts` is detected as binary by grep (stray non-UTF8 byte) — use `grep -a`.

---

### Task 0: Branch

- [x] `git checkout -b mobile-pwa-hardening`

---

### Task 1: `setSessionIdImpl` in the claude service

**Files:**
- Modify: `electron/services/claude.ts:1222-1239` (the `claude:setSessionId` IPC handler)
- Test: `tests/unit/services/claude.test.ts`

- [x] **Step 1: Failing test** — append to `tests/unit/services/claude.test.ts` (uses the existing `workspaceState` mock + `mockIpcMain` harness; import `setSessionIdImpl` alongside `registerClaudeHandlers`):

```ts
describe('setSessionIdImpl', () => {
  const PROJECT = '/test/remote-session';

  it('sets sessionId on an idle scope so the next spawn resumes', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    setSessionIdImpl(PROJECT, 'sess-123', 'chat');
    expect(ws.claudeScopes.get('chat')!.sessionId).toBe('sess-123');
  });

  it('does not clobber a streaming scope', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    const claude = ws.claudeScopes.get('chat')!;
    claude.process = { kill: vi.fn() } as any;
    claude.streaming = true;
    claude.sessionId = 'live-session';
    setSessionIdImpl(PROJECT, 'other-session', 'chat');
    expect(claude.sessionId).toBe('live-session');
  });

  it('kills an idle process when switching sessions', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    const claude = ws.claudeScopes.get('chat')!;
    const kill = vi.fn();
    claude.process = { kill } as any;
    claude.streaming = false; claude.busy = false;
    setSessionIdImpl(PROJECT, 'sess-next', 'chat');
    expect(kill).toHaveBeenCalled();
    expect(claude.sessionId).toBe('sess-next');
  });
});
```

- [x] **Step 2:** Run `npx vitest run --project unit tests/unit/services/claude.test.ts` — FAIL (`setSessionIdImpl` not exported).
- [x] **Step 3: Extract impl.** In `electron/services/claude.ts`, above `registerClaudeHandlers` (or near `sendImpl`), add:

```ts
/** Switch a scope to a different Claude session (history resumption). Mirrors
 *  the claude:setSessionId IPC: a streaming/busy scope is left untouched; an
 *  idle process is killed so the next spawn picks up --resume <sessionId>. */
export function setSessionIdImpl(projectPath: string, sessionId: string | undefined, scope?: string): void {
  const ws = get(projectPath);
  if (!ws) return;
  const claude = getClaude(ws, scope || 'chat');
  if (claude.process) {
    if (claude.streaming || claude.busy) return;
    claude.process.kill();
    claude.process = null;
    claude.processConfig = null;
  }
  claude.sessionId = sessionId;
}
```

Replace the body of the `claude:setSessionId` IPC handler with a delegation:

```ts
  ipcMain.on('claude:setSessionId', (_event, projectPath: string, sessionId: string | undefined, scope?: string) => {
    setSessionIdImpl(projectPath, sessionId, scope);
  });
```

(Keep the original comment about streaming scopes on the impl.) Note: the impl uses `get` (not `getOrCreate`) to match current behavior — no workspace, no-op. The remote prompt path goes through `sendImpl` right after, which calls `getOrCreate`, so order matters in Task 3.

- [x] **Step 4:** Run the test — PASS. Note: setSessionIdImpl must use `getOrCreate` if the first remote message can arrive before the workspace exists — handled in Task 3 by calling `getOrCreate(projectPath)` in main.ts? NO — simpler: change `get` to `getOrCreate` in the impl is wrong for the IPC path (current behavior no-ops). Keep `get`; Task 3 main.ts calls `setSessionIdImpl` AFTER ensuring the workspace exists via `getOrCreateWorkspace` — see Task 3 Step 3.
- [x] **Step 5:** `git add -A && git commit -m "refactor(claude): extract setSessionIdImpl from claude:setSessionId IPC"`

---

### Task 2: Bridge forwards sessionId on prompt frames

**Files:**
- Modify: `electron/services/remote/bridge-server.ts:14-24` (PromptArgs), `:762-771` (prompt handler)
- Test: `tests/unit/remote/bridge-server-chat.test.ts`

- [x] **Step 1: Failing test** — in `bridge-server-chat.test.ts`, next to the existing `'prompt calls sendPrompt'` test:

```ts
  it('prompt forwards sessionId to sendPrompt', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'prompt', text: 'continue', projectPath: '/p', scope: 'chat', sessionId: 'sess-42' }));
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    expect(sendPrompt.mock.calls[0][0]).toMatchObject({ text: 'continue', projectPath: '/p', sessionId: 'sess-42' });
    ws.close();
  });
```

- [x] **Step 2:** Run `npx vitest run --project unit tests/unit/remote/bridge-server-chat.test.ts` — FAIL (sessionId undefined in call args).
- [x] **Step 3:** In `bridge-server.ts`, add to `PromptArgs`:

```ts
  /** Claude CLI session to resume; threads through to --resume so prompts
   * from a paired device continue the conversation instead of forking a
   * fresh context. */
  sessionId?: string;
```

and in the prompt handler add one line to the `this.opts.sendPrompt?.({...})` object:

```ts
          sessionId: typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : undefined,
```

- [x] **Step 4:** Run the test file — PASS.
- [x] **Step 5:** `git add -A && git commit -m "feat(remote): forward sessionId on prompt frames through the bridge"`

---

### Task 3: main.ts adopts the sessionId before sending

**Files:**
- Modify: `electron/main.ts:196-225` (remote `sendPrompt` callback)

- [x] **Step 1:** Add `setSessionIdImpl` to the existing import from `./services/claude` in `electron/main.ts:57`. Add `getOrCreate as getOrCreateWorkspace` to the import from `./services/workspace` (line 63) if not already imported.
- [x] **Step 2:** In the `sendPrompt: (args) => {` callback, before the `sendImpl(...)` call, insert:

```ts
          // Adopt the session the device is attached to so ensureProcess
          // spawns with --resume instead of forking a fresh context. The
          // workspace may not exist yet (first remote message after launch).
          if (args.sessionId) {
            getOrCreateWorkspace(args.projectPath);
            setSessionIdImpl(args.projectPath, args.sessionId, args.scope);
          }
```

- [x] **Step 3:** `npx tsc --noEmit` clean; run `npx vitest run --project unit tests/unit/remote tests/unit/services/claude.test.ts` — PASS.
- [x] **Step 4:** `git add -A && git commit -m "fix(remote): resume the attached Claude session for prompts from paired devices"`

---

### Task 4: PWA wire + Chat send sessionId

**Files:**
- Modify: `src/renderer-remote/wire.ts:36-44` (ChatPromptArgs), `:376-385` (sendPrompt frame)
- Modify: `src/renderer-remote/chat/Chat.tsx:312-322` (onSend)
- Test: `tests/unit/renderer-remote/wire.test.ts`

- [x] **Step 1: Failing test** — in `tests/unit/renderer-remote/wire.test.ts`, following the file's existing fake-WebSocket harness pattern, add a test that `client.sendPrompt({ text: 'hi', projectPath: '/p', sessionId: 's1' })` produces a frame with `sessionId: 's1'` (assert on the captured sent JSON).
- [x] **Step 2:** Run it — FAIL.
- [x] **Step 3:** Add `sessionId?: string;` to `ChatPromptArgs` (with the doc comment from Task 2) and `sessionId: a.sessionId,` to the `sendPrompt` frame object in `wire.ts`. In `Chat.tsx` `onSend`, add `sessionId: active.sessionId,` to the `client.sendPrompt({...})` call.
- [x] **Step 4:** Test passes; `npx tsc --noEmit` clean.
- [x] **Step 5:** `git add -A && git commit -m "fix(pwa): send the attached sessionId with prompts"`

---

### Task 5: Mobile wire + chat send sessionId

**Files:**
- Modify: `sai-mobile/lib/wire.ts:97-106` (ChatPromptArgs), `:444-453` (sendPrompt frame)
- Modify: `sai-mobile/app/m/[machineId]/chat.tsx` (the `client.sendPrompt(...)` call — locate via grep)
- Test: `sai-mobile/tests/wire-client.test.ts`

- [x] **Step 1: Failing test** — in `sai-mobile/tests/wire-client.test.ts`, following its existing fake-socket pattern, assert `sendPrompt({ text: 'hi', projectPath: '/p', sessionId: 's1' })` emits a frame containing `"sessionId":"s1"`.
- [x] **Step 2:** `npm --prefix sai-mobile test` — FAIL.
- [x] **Step 3:** Mirror Task 4 in `sai-mobile/lib/wire.ts` (`sessionId?: string` on ChatPromptArgs + `sessionId: a.sessionId` in the frame). In `chat.tsx`, pass the current `sessionId` state into `client.sendPrompt({ ..., sessionId: sessionId || undefined })`.
- [x] **Step 4:** `npm --prefix sai-mobile test` PASS; `npm --prefix sai-mobile run lint` clean.
- [x] **Step 5:** `git add -A && git commit -m "fix(mobile): send the attached sessionId with prompts"`

---

### Task 6: PWA — guard session.history against stale session

**Files:**
- Modify: `src/renderer-remote/chat/Chat.tsx:112-160` (listener effect), `:338-348` (onApprove)
- Test: `tests/unit/renderer-remote/chat-history-guard.test.tsx` (new)

- [x] **Step 1:** Add an `activeRef` next to the existing `messagesRef` (`Chat.tsx:78`):

```ts
  const activeRef = useRef(active);
  activeRef.current = active;
```

In the `session.history` branch, first line:

```ts
      if (t === 'session.history') {
        const sid = (msg as any).sessionId;
        // A history dump for a session we've already navigated away from must
        // not clobber the current transcript (rapid session switching).
        if (sid && activeRef.current?.sessionId && sid !== activeRef.current.sessionId) return;
```

In `onApprove`, validate the approval still belongs to the current attach (pendingApproval cleared on switch is the main guard; this is belt-and-braces — skip if PendingApproval has no session field; do NOT widen the interface).

- [x] **Step 2: Test.** New `tests/unit/renderer-remote/chat-history-guard.test.tsx`: render `Chat` with a mock client whose `on()` captures the handler; attach session A; fire `session.history` with `sessionId: 'B'` and messages — assert transcript stays empty; fire with `sessionId: 'A'` — assert messages render. If `Chat`'s prop surface makes a component test impractical (check its props first), instead extract the handler's history branch into an exported pure helper `applyHistoryFrame(msg, activeSessionId): TranscriptMessage[] | null` and unit-test that. Either way: watch the test fail against pre-guard behavior first (write the test before Step 1's guard — implement test, run RED, then add guard from Step 1).
- [x] **Step 3:** Tests pass; `npx tsc --noEmit` clean.
- [x] **Step 4:** `git add -A && git commit -m "fix(pwa): ignore session.history frames for sessions no longer attached"`

---

### Task 7: Mobile — handle session.history (initial + reconnect resync)

The bridge already replays a `session.history` dump on every `session.attach` (`bridge-server.ts:441-465`), and the mobile wire replays `session.attach` on reconnect — mobile just never consumes the dump.

**Files:**
- Modify: `sai-mobile/app/m/[machineId]/chat.tsx` (inbound handler effect, ~lines 99-217)
- Modify: `sai-mobile/lib/transcriptStore.ts` (add a `replace(tkey, events)` action if absent — check first)
- Test: `sai-mobile/tests/transcript.test.ts`

- [x] **Step 1: Failing test** — in `sai-mobile/tests/transcript.test.ts`, following its store-test pattern: a `replace` action swaps the full event list for a key (and leaves other keys untouched).
- [x] **Step 2:** `npm --prefix sai-mobile test` — FAIL (no `replace`).
- [x] **Step 3:** Add `replace(tkey, events)` to the transcript store (same shape as `append` but assigning the array). In `chat.tsx`'s inbound handler, add a `session.history` branch mirroring the PWA's expansion (text bubble per message + tool events from `toolCalls`), mapping to the mobile event shape used by `append` (`{ id, type: 'text'|'tool_use', ... }` — copy the field names used by the existing `assistant` branch), then `replace(tkey, out)`.
- [x] **Step 4:** Tests pass; mobile lint clean.
- [x] **Step 5:** `git add -A && git commit -m "fix(mobile): hydrate and resync chat transcript from session.history"`

---

### Task 8: Mobile mechanical sweep (cancellation + timers)

**Files (each gets the same `let cancelled = false` pattern):**
- `sai-mobile/app/m/[machineId]/files/index.tsx:173` — `client.listFiles(cwd, '').then((e) => { if (!cancelled) setEntries(e as Entry[]); })`, cleanup `return () => { cancelled = true; };`
- `sai-mobile/app/m/[machineId]/files/changes.tsx:178` — same pattern around `client.statusFiles(...)`.
- `sai-mobile/app/m/[machineId]/files/view.tsx:91-106` — `cancelled` guard before each setState after `await client.readFile(...)`.
- `sai-mobile/app/m/[machineId]/files/edit.tsx:100-122` — same for `load()`'s setters.
- `sai-mobile/app/m/[machineId]/files/diff.tsx:36-59` — same around the `Promise.all`.
- `sai-mobile/app/m/[machineId]/files/view.tsx:113-117` — copy timer: store in `const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);`, clear previous on each press, clear on unmount via `useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, [])`.
- `sai-mobile/components/NavDrawer.tsx:183-195` — `cancelled` guard around `client.listSessions(...)`.

- [x] **Step 1:** Apply all guards (no behavior change; pattern identical to the desktop sweep of commit f3043f7).
- [x] **Step 2:** `npm --prefix sai-mobile run lint` clean; `npm --prefix sai-mobile test` green.
- [x] **Step 3:** `git add -A && git commit -m "fix(mobile): cancellation guards for async screen effects and copy timer"`

---

### Task 9: Mobile transcript autoscroll + handler-dep check

**Files:**
- Modify: `sai-mobile/components/Transcript.tsx:262-282`
- Verify only: `sai-mobile/app/m/[machineId]/chat.tsx:217` dep array

- [x] **Step 1:** In `Transcript.tsx`, add:

```tsx
  const listRef = useRef<FlatList<any>>(null);
  const atBottomRef = useRef(true);
```

On the FlatList:

```tsx
      ref={listRef}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
      }}
```

(Import `useRef` from react and `FlatList` type if needed.)
- [x] **Step 2:** Check whether `append` in `chat.tsx` comes from a zustand store selector (store actions are referentially stable). If stable, the dep array is fine — only remove `append` if it is NOT stable (e.g. inline closure). Record the finding in the commit message; do not churn deps speculatively.
- [x] **Step 3:** Mobile lint + tests green.
- [x] **Step 4:** `git add -A && git commit -m "fix(mobile): keep transcript pinned to bottom as new messages stream in"`

---

### Task 10: PWA — NavDrawer listener cleanup + SaiLogo dedupe

**Files:**
- Modify: `src/renderer-remote/chat/NavDrawer.tsx:79-101`
- Replace: `src/renderer-remote/branding/SaiLogo.tsx` with a re-export

- [x] **Step 1: NavDrawer.** Track in-flight listener removers so closing the drawer detaches immediately instead of waiting out the 5s timeout:

```ts
    const inflight = new Set<() => void>();
    const poll = () => {
      const reqId = `gb${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const off = client.on((m: any) => { /* unchanged body */ });
      inflight.add(off);
      client.send({ type: 'files.status', cwd: gitCwd, reqId });
      setTimeout(() => { off(); inflight.delete(off); }, 5000);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      for (const off of inflight) off();
      inflight.clear();
    };
```

- [x] **Step 2: SaiLogo.** The only diff vs desktop is an `export` keyword. Replace the entire body of `src/renderer-remote/branding/SaiLogo.tsx` with:

```tsx
// Single source of truth lives in the desktop tree; the PWA build (vite root
// src/renderer-remote) resolves imports outside its root fine. Re-export so
// the two copies can't drift again (they did — audit 2026-06-10).
export { default, ORIGINAL_D } from '../../components/SaiLogo';
export type { SaiLogoMode } from '../../components/SaiLogo';
```

Then `vite build --config vite.config.pwa.ts` must succeed (verifies the cross-root import + CSS resolve). If the PWA build rejects the cross-root import, revert to the copy and instead add a vitest test that reads both files and asserts they're identical modulo the `export ` keyword. (`ThinkingAnimation` is an intentional fork — header comment says so — leave it.)
- [x] **Step 3:** `npx vitest run --project unit tests/unit/renderer-remote tests/unit/remote` PASS; `npx tsc --noEmit` clean; `npm run build` (includes PWA build) succeeds.
- [x] **Step 4:** `git add -A && git commit -m "fix(pwa): detach nav-drawer poll listeners on close; dedupe SaiLogo with desktop"`

---

### Task 11: Full verification + merge

- [x] **Step 1:** `npx tsc --noEmit` and `npm --prefix sai-mobile run lint` — clean.
- [x] **Step 2:** `npm test` (desktop unit+integration) and `npm --prefix sai-mobile test` — all green.
- [x] **Step 3:** Review `git log --oneline main..HEAD` + diff for debug leftovers.
- [x] **Step 4:** Merge to main per user's standing preference (merge locally, delete branch), re-running `npm test` on the merge result.
