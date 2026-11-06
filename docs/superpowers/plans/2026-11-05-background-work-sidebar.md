# Background Work Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click the "Waiting on background work" pill to open a full-height right sidebar with one live card per background task: what it is, what it's doing, its cost, whether it has gone quiet, and a per-task Stop.

**Architecture:** A pure reducer (`backgroundTasks.ts`) folds SDK `task_*` frames into per-task detail records. `SdkBackend` keeps those records per session next to the existing ledger, *without touching the ledger or the wait logic*. It pushes a full snapshot to the renderer on a new dedicated IPC channel, `claude:backgroundTasks`. The channel is separate so `ChatPanel`'s message pipeline (frame gate, text flush) never sees these frames. App holds snapshots per scope key; the pill and a new sidebar read them. Stop goes through a new `claude:stopTask` IPC to `query.stopTask(taskId)`.

**Tech Stack:** Electron, React 18 + TypeScript, `motion` (framer) for the card move, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-background-work-sidebar-design.md`

## Global Constraints

- SDK backend only. The CLI backend emits nothing new, and its pill stays non-clickable.
- Read-only with respect to the wait: never modify `liveTasks`, `liveTaskTypes`, `sawTaskFrames`, `sawTaskSettled`, `lastTaskEventAt`, `stopBackgroundTaskCount`, `backgroundWaitOpen` semantics, or `waitClassifier.ts`.
- "Possibly stuck" = a running agent task with no frame for `STUCK_AFTER_MS = 120_000`. Shell tasks (`task_type === 'local_bash'`, `SHELL_TASK_TYPE` in `waitClassifier.ts`) never count as stuck.
- Hide tasks with `skip_transcript: true`.
- The done animation plays once and takes under 1s in total. With `prefers-reduced-motion` it becomes an instant state swap with no slide. No infinite animations, except that the existing pill orbit keeps its reduced-motion guard.
- Styling uses the CSS vars (`--surface-0..4`, `--accent`, `--accent-rgb`, `--border-hairline`, `--border-strong`, `--text`, `--text-muted`) and Geist Mono for numbers.
- The sidebar is about 380px wide, `flex-shrink: 0`, with a `surface-0` background and a `1px solid var(--border-strong)` left border.
- Run vitest with `--maxWorkers=2`. Don't run the full suite while the system-load guard warns; run the touched test files.

## Review Focus

1. **A frame for an unknown task id** (a `task_progress` or `task_notification` arrives before `task_started`, as happens after a resume). The reducer creates a record with the fields it has; the task is never dropped and nothing throws. Tested in Task 1 (`progress before started`).
2. **A Stop for a task that has already finished, or for a scope with no live query.** This must be a no-op that resolves `false`: no throw, and no interrupt of the turn. Tested in Task 2 (`stopTask on dead scope`).
3. **Frames arriving for a chat whose panel isn't mounted / a different chat.** App stores them by scope key. The sidebar shows only the active chat's scope, and switching chats closes the sidebar when the new chat has no tasks. Tested in Task 5 (`selectSidebarTasks`).
4. **A task that finishes while its card is mid "done" animation, or two tasks finishing together.** Both settle into Finished, with no duplicate card and no card stuck in Running. Tested in Task 4 (`two finish together`).
5. **Pill count with no task data** (CLI backend, or an old session). The pill falls back to `wait.taskCount` and stays non-clickable. Tested in Task 3 (`no tasks → not clickable`).

---

### Task 1: Task-detail reducer

**Files:**
- Create: `electron/services/claudeBackend/backgroundTasks.ts`
- Test: `tests/unit/electron/backgroundTasks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BackgroundTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  export interface BackgroundTaskDetail {
    id: string;
    description: string;
    kind: string;          // subagent_type ?? workflow_name ?? (task_type==='local_bash' ? 'shell' : task_type) ?? 'task'
    isShell: boolean;      // task_type === SHELL_TASK_TYPE
    isAgent: boolean;      // has subagent_type, or has ever sent task_progress
    status: BackgroundTaskStatus;
    startedAt: number;     // ms, first frame seen
    endedAt: number | null;
    lastEventAt: number;
    totalTokens: number | null;
    toolUses: number | null;
    lastToolName: string | null;
    summary: string | null;  // latest task_progress.summary, then task_notification.summary
    error: string | null;    // task_updated.patch.error
  }
  export const STUCK_AFTER_MS = 120_000;
  export function foldBackgroundTaskFrame(
    tasks: ReadonlyMap<string, BackgroundTaskDetail>, frame: Record<string, unknown>, nowMs: number,
  ): Map<string, BackgroundTaskDetail>;        // returns the SAME map instance if the frame changed nothing / was skipped
  export function clearFinishedTasks(tasks: ReadonlyMap<string, BackgroundTaskDetail>): Map<string, BackgroundTaskDetail>;
  export function isTerminalDetail(t: BackgroundTaskDetail): boolean;   // completed|failed|stopped
  export function isPossiblyStuck(t: BackgroundTaskDetail, nowMs: number): boolean;
  ```
- Status mapping: `task_updated.patch.status` `'killed'` → `'stopped'`; `task_notification.status` is copied as is. A terminal status sets `endedAt` (from `patch.end_time` if present, else `nowMs`).
- A frame with `skip_transcript: true` on `task_started` marks the id as hidden. Keep a module-private `WeakMap<Map, Set<string>>`, or simpler, a `hidden: true` flag on the record that snapshot code filters out. Your choice, but later frames for that id must also stay hidden.

- [ ] **Step 1: Write the failing tests**

  These tests go in `backgroundTasks.test.ts`:
  - `started builds a record`: `task_started {task_id:'a', description:'Research X', subagent_type:'Explore'}` at t=1000 gives `kind 'Explore'`, `isAgent true`, `isShell false`, `status 'running'`, `startedAt 1000`.
  - `shell kind`: `task_type:'local_bash'` gives `kind 'shell'`, `isShell true`, `isAgent false`.
  - `workflow kind`: `task_type:'local_workflow', workflow_name:'spec'` gives `kind 'spec'`.
  - `progress updates usage`: `task_progress {usage:{total_tokens:18400, tool_uses:23, duration_ms:1}, last_tool_name:'Grep', summary:'Searching'}` at t=5000 gives those values plus `lastEventAt 5000` and `isAgent true`.
  - `progress before started`: a `task_progress` for an unknown id creates a running record with `startedAt` = now and `description` from the frame.
  - `notification finishes`: `task_notification {status:'failed', summary:'boom'}` gives `status 'failed'`, `summary 'boom'`, `endedAt` set.
  - `killed maps to stopped`: `task_updated {patch:{status:'killed'}}` gives `'stopped'`.
  - `skip_transcript hidden`: a hidden task is excluded from `visibleTasks(map)` (export that helper: `visibleTasks(tasks): BackgroundTaskDetail[]`, sorted by `startedAt`).
  - `non-task frame is identity`: `foldBackgroundTaskFrame(m, {type:'assistant'}, 0) === m`.
  - `clearFinishedTasks keeps running only`.
  - `isPossiblyStuck`: an agent quiet for 120_000ms gives true, 119_999 gives false, a shell quiet for 10min gives false, and a finished agent gives false.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run tests/unit/electron/backgroundTasks.test.ts --maxWorkers=2`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `backgroundTasks.ts`** to the interface above. Import `SHELL_TASK_TYPE` from `../waitClassifier`. Keep it pure: no Electron imports.

- [ ] **Step 4: Run the tests again**
  Expected: all pass.

- [ ] **Step 5: Commit**
  `git add electron/services/claudeBackend/backgroundTasks.ts tests/unit/electron/backgroundTasks.test.ts && git commit -m "feat(background-tasks): task-detail reducer"`

---

### Task 2: Backend snapshot emit + per-task Stop

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts`. Touch the `ScopeSession` type (~L144), session init (~L1260), `_trackTaskFrame` (~L1345), the wait-open site (~L1623), the deps/constructor (~L386–410) and `defaultEmit` (~L2023).
- Modify: `electron/services/claudeBackend/types.ts`. Add an optional `stopTask` to the `ClaudeBackend` interface.
- Modify: `electron/services/claude.ts`. Add `emitBackgroundTasks` next to `emitChatMessage` (~L109) and register an IPC handler next to `claude:stop` (~L1614).
- Modify: `electron/preload.ts`. Add `claudeStopTask` and `claudeOnBackgroundTasks`.
- Modify the renderer `window.sai` type declaration, wherever `claudeReconcileScope` is declared (`grep -rn claudeReconcileScope src/*.d.ts src/**/*.d.ts`).
- Test: `tests/unit/electron/sdkBackend.test.ts`, using the existing `runBackgroundWaitTurn` helper (~L2490) and the `TASK_START`/`TASK_DONE` frames.

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - IPC payload on channel `claude:backgroundTasks`: `{ projectPath: string; scope: string; tasks: BackgroundTaskDetail[] }`. `tasks` = `visibleTasks(session.taskDetails)`, the full snapshot. `scope` is the same `effectiveScope` string the backend puts on `claude:message` frames.
  - `SdkBackendDeps.emitTasks?: (payload: { projectPath: string; scope: string; tasks: BackgroundTaskDetail[] }) => void`, defaulting to `emitBackgroundTasks`.
  - `ClaudeBackend.stopTask?(projectPath: string, scope: string | undefined, taskId: string): Promise<boolean>`
  - `ipcMain.handle('claude:stopTask', (_e, projectPath, scope, taskId) => getClaudeBackend().stopTask?.(projectPath, scope, taskId) ?? false)`
  - preload: `claudeStopTask(projectPath: string, scope: string | undefined, taskId: string): Promise<boolean>` and `claudeOnBackgroundTasks(cb: (p: {projectPath:string; scope:string; tasks: BackgroundTaskDetail[]}) => void): () => void`

- [ ] **Step 1: Write the failing tests** in `sdkBackend.test.ts` (new `describe('background task details')`). Construct with an `emitTasks` spy:
  - `emits a snapshot per task frame`: after `TASK_START('t-1')` then `TASK_DONE('t-1')`, the last `emitTasks` call has `tasks[0].id 't-1'` and `status 'completed'`, and every call carries `projectPath`/`scope`.
  - `does not change the wait`: the same script as existing test (51) with an `emitTasks` spy gives the same `done` emits as (51). Assert the `clearing` length is 1 at the settle window.
  - `finished cleared when next background wait opens`: run a wait turn whose `after` frames finish t-1, then a second wait turn on the same scope. The first snapshot emitted after the second wait opens has no `t-1`.
  - `stopTask calls query.stopTask`: set `fakeQuery.stopTask = vi.fn().mockResolvedValue(undefined)`. `await backend.stopTask(PROJECT, scope, 't-1')` gives `true`, and the spy was called with `'t-1'`.
  - `stopTask on dead scope`: an unknown scope resolves `false`. When `query.stopTask` rejects it resolves `false`, and `fakeQuery.interrupt` was not called.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts -t "background task details" --maxWorkers=2`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Add `taskDetails: Map<string, BackgroundTaskDetail>` to `ScopeSession`, initialised to `new Map()`. Like `liveTasks`, never clear it at turn end.
  - At the top of `_trackTaskFrame`, before the existing ledger code, which stays byte-for-byte unchanged:
    1. `const next = foldBackgroundTaskFrame(session.taskDetails, m, this._now())`
    2. If `next !== session.taskDetails`, assign it and call `this._emitTaskSnapshot(session)`.
  - At the wait-open site (~L1623), right after `session.backgroundWaitOpen = …`, add: when `wait.kind === 'background'`, set `session.taskDetails = clearFinishedTasks(session.taskDetails)` and emit a snapshot.
  - Add a private `_emitTaskSnapshot(session)` that uses `session._projectPath` / `session._scopeName`. Check that `_scopeName` is the same string as `effectiveScope` on emitted frames. If it isn't, store the effective scope on the session.
  - `stopTask`: look up the session via `toScopeKey`. If there is no `session.query` or `typeof query.stopTask !== 'function'`, return `false`. Otherwise `await query.stopTask(taskId)` inside try/catch, returning `true`, or `false` on throw. Add a `devlog('claude-sdk', 'stopTask', {...})`.
  - In `claude.ts`, `emitBackgroundTasks` does `if (mainWin) safeSend(mainWin, 'claude:backgroundTasks', payload)`.

- [ ] **Step 4: Run the tests again**, plus the whole existing wait suite in the file:
  `npx vitest run tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
  Expected: all pass, with no change to existing tests.

- [ ] **Step 5: Typecheck**
  Run `npx tsc --noEmit -p tsconfig.json`. If the repo has a separate electron tsconfig, run it on that too.

- [ ] **Step 6: Commit**
  `git commit -am "feat(background-tasks): emit per-task snapshots and per-task stop (SDK)"` (the new files from Task 1 are already tracked).

---

### Task 3: Renderer store + clickable pill

**Files:**
- Modify: `src/App.tsx`
  - New state next to `waitingScopes` (~L385).
  - A subscription effect next to the `claudeOnMessage` effect (~L2858).
  - The ChatPanel `waiting=` prop site (~L5184), and the other ChatPanel mount (~L4772) if it receives `waiting`.
- Modify: `src/components/Chat/ChatPanel.tsx` (props ~L231/L461, pill render ~L2684)
- Modify: `src/components/Chat/WaitingIndicator.tsx`
- Test: `tests/unit/WaitingIndicator.test.tsx` (existing)

**Interfaces:**
- Consumes: the preload `claudeOnBackgroundTasks`, and the `BackgroundTaskDetail` type from Task 1 (type-only import from `electron/services/claudeBackend/backgroundTasks`, the same pattern as `WaitMeta`).
- Produces:
  - App: `backgroundTasksByScope: Map<string, BackgroundTaskDetail[]>`, keyed `${projectPath}:${scope}`. Each snapshot replaces the scope's entry; an empty array deletes the entry.
  - App: `taskSidebarOpen: boolean` and `toggleTaskSidebar()`.
  - `WaitingIndicator` new optional props: `liveTaskCount?: number`, `onToggleTasks?: () => void`, `tasksOpen?: boolean`.
  - `ChatPanel` new optional props passed straight through to the pill: `liveBackgroundTaskCount?: number`, `onToggleBackgroundTasks?: () => void`, `backgroundTasksOpen?: boolean`.
  - App passes `liveBackgroundTaskCount` = the count of non-terminal tasks for that panel's scope key. It passes `onToggleBackgroundTasks` only when that scope has at least one task.

- [ ] **Step 1: Write the failing tests** (add to `WaitingIndicator.test.tsx`):
  - `live count overrides snapshot`: `wait.taskCount 4` with `liveTaskCount 2` renders "2 tasks running".
  - `clickable with tasks`: with `onToggleTasks` passed, clicking the label area calls it once. It has `role="button"` (or is a `<button>`) with `aria-expanded` equal to `tasksOpen`, and the chevron renders ▸ when closed and ◂ when open.
  - `Cancel does not toggle`: clicking Cancel calls `onCancel`, not `onToggleTasks`.
  - `no tasks → not clickable`: without `onToggleTasks` there is no button role and no chevron, and the count falls back to `wait.taskCount`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run tests/unit/WaitingIndicator.test.tsx --maxWorkers=2`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - `WaitingIndicator`: wrap orbit + label + count + chevron in a `<button className="sai-waiting-toggle">` when `onToggleTasks` is set. Give it a hover border of `rgba(var(--accent-rgb),.55)`. Cancel stays a sibling button.
  - ChatPanel: pass the three props through.
  - App: subscribe to `claudeOnBackgroundTasks` once, wire the toggle, and compute the props at the ChatPanel mount.

- [ ] **Step 4: Run the tests again**
  Expected: all pass.

- [ ] **Step 5: Commit**
  `git commit -am "feat(background-tasks): renderer task store and clickable wait pill"`

---

### Task 4: Sidebar + cards + done animation

**Files:**
- Create: `src/components/Chat/BackgroundTasksSidebar.tsx`
- Create: `src/components/Chat/BackgroundTaskCard.tsx`
- Create: `src/components/Chat/backgroundTaskView.ts` (pure helpers)
- Test: `tests/unit/backgroundTaskView.test.ts`, `tests/unit/BackgroundTasksSidebar.test.tsx`

**Interfaces:**
- Consumes: `BackgroundTaskDetail`, `isPossiblyStuck`, `isTerminalDetail` (Task 1); `formatElapsed` from `./formatCountdown`.
- Produces:
  ```ts
  // backgroundTaskView.ts
  export const DONE_HOLD_MS = 650;   // in-place done state before moving; whole effect < 1s
  export function partitionTasks(tasks: BackgroundTaskDetail[], settlingIds: ReadonlySet<string>):
    { running: BackgroundTaskDetail[]; finished: BackgroundTaskDetail[] };  // settling terminal tasks stay in running; finished sorted by endedAt desc
  export function nowLine(t: BackgroundTaskDetail, nowMs: number): string;
  export function formatTokens(n: number): string;  // 18400 -> "18.4k", 950 -> "950", 1_250_000 -> "1.3M"
  // BackgroundTasksSidebar.tsx
  export default function BackgroundTasksSidebar(props: {
    tasks: BackgroundTaskDetail[];
    onClose: () => void;
    onStopTask: (taskId: string) => Promise<boolean>;
  }): JSX.Element;
  ```
- `nowLine` copy:
  - Agent: `summary`, else `Now: ${lastToolName}`, else `Starting…`.
  - Shell: `Running`.
  - Stuck: `No updates for ${formatElapsed(...)}`.
  - Finished: `summary`, or `Completed`; `Failed: ${error ?? summary ?? 'unknown error'}`; `Stopped`.

- [ ] **Step 1: Write the failing tests**
  - `backgroundTaskView.test.ts`:
    - `partitionTasks` keeps a settling completed task in `running`, and puts a non-settling one in `finished`.
    - `two finish together`: two settling ids both move to `finished` once removed from the set, and no id appears in both lists.
    - Every `nowLine` branch above.
    - The `formatTokens` cases.
  - `BackgroundTasksSidebar.test.tsx` (use `vi.useFakeTimers()`):
    - The header shows "Background work" and "2 running · 1 done".
    - Each running card shows its description, kind tag, and a Stop button; finished cards have no Stop.
    - Clicking Stop calls `onStopTask('a')`, then the button reads "Stopping…" and is disabled.
    - When a rerender flips task `a` to `completed`, the card is still in the running section with `data-state="done"`. After `DONE_HOLD_MS` it is under the "Finished" label.
    - Stuck: with an agent task where `lastEventAt = now - 120_000`, the card has `data-stuck="true"` and the text "may be stuck".
    - × calls `onClose`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `npx vitest run tests/unit/backgroundTaskView.test.ts tests/unit/BackgroundTasksSidebar.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement**
  - The sidebar ticks `nowMs` every 1s with one interval, only while some task is non-terminal.
  - It tracks the previous status per id in a ref. When an id becomes terminal, add it to `settlingIds` state and remove it after `DONE_HOLD_MS` with a timeout. Clear all timeouts on unmount.
  - Cards are `motion.div` with `layout` inside `LayoutGroup`. Use `useReducedMotion()` to pass `layout={false}` and skip the flash.
  - `data-state="done"` triggers a one-shot CSS keyframe: the dot morphs to a green ✓ (red ✕ when failed, grey when stopped) and the card background flashes `rgba(var(--accent-rgb),.12)` → transparent over 500ms.
  - "Stopping…" is local state per id, cleared when the task turns terminal. If `onStopTask` resolves `false`, revert and set `title="Couldn't stop this task"`.
  - Follow the approved mockup's styles: card `surface-2`, `border-hairline`, 9px radius; stuck card border `rgba(224,108,117,.45)`; mono stats row.

- [ ] **Step 4: Run the tests again**
  Expected: all pass.

- [ ] **Step 5: Commit**
  `git add src/components/Chat/BackgroundTask* src/components/Chat/backgroundTaskView.ts tests/unit/backgroundTaskView.test.ts tests/unit/BackgroundTasksSidebar.test.tsx && git commit -m "feat(background-tasks): sidebar with task cards and done animation"`

---

### Task 5: Mount the sidebar in the window layout

**Files:**
- Modify: `src/App.tsx`. The sidebar mounts after `.main-content` inside `.tm-views-wrapper` (~L6044–6057).
- Modify: `src/styles/globals.css`. Next to `.tm-views-wrapper` (~L229), make `.tm-views-wrapper` `flex-direction: row` with `.main-content` keeping `flex:1; min-width:0`, *or* wrap `.main-content` + the sidebar in a new row container. Pick whichever leaves the vertical drag math (`clientY`, `mainContentRef` rect) unchanged.
- Create: `src/components/Chat/selectSidebarTasks.ts`
- Test: `tests/unit/selectSidebarTasks.test.ts`

**Interfaces:**
- Consumes: Task 3's `backgroundTasksByScope`, `taskSidebarOpen`, `toggleTaskSidebar`; Task 4's `BackgroundTasksSidebar`; the preload `claudeStopTask`.
- Produces: `selectSidebarTasks(byScope: ReadonlyMap<string, BackgroundTaskDetail[]>, activeScopeKey: string | null): BackgroundTaskDetail[]`. It returns `[]` for a null or unknown key. The active scope key = `${activeProjectPath}:${activeWorkspace.activeSession.id}` for Claude chats, matching the `waiting=` lookup at ~L5184.

- [ ] **Step 1: Write the failing test.** `selectSidebarTasks` returns the active scope's list, `[]` for another chat's key, and `[]` for null.

- [ ] **Step 2: Run it to verify it fails**
  Run: `npx vitest run tests/unit/selectSidebarTasks.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement + mount**
  - Render `<BackgroundTasksSidebar>` when `taskSidebarOpen && tasks.length > 0` and the active provider is Claude.
  - Add an effect that sets `taskSidebarOpen=false` when the active scope's tasks become empty. That covers switching to a chat with no tasks; it also means the sidebar stays open after the wait ends, as long as finished cards remain.
  - `onStopTask` = `(id) => window.sai.claudeStopTask(activeProjectPath, activeScope, id)`.
  - It must also render in `focusedChat` mode.

- [ ] **Step 4: Run the touched tests** (Tasks 3–5) and typecheck.
  `npx vitest run tests/unit/selectSidebarTasks.test.ts tests/unit/BackgroundTasksSidebar.test.tsx tests/unit/WaitingIndicator.test.tsx tests/unit/backgroundTaskView.test.ts tests/unit/electron/backgroundTasks.test.ts tests/unit/electron/sdkBackend.test.ts --maxWorkers=2 && npx tsc --noEmit`

- [ ] **Step 5: Live check in the dev app** (`npm run dev`, or the project's run skill).
  1. Ask Claude to launch 2 background Explore agents plus a `sleep 200` background shell.
  2. Click the pill. The sidebar opens on the right, full height, and the chat/editor/terminal stack narrows.
  3. Cards tick, and an agent card shows its summary or tool.
  4. Stop one agent: it reads "Stopping…", then the done (grey) state, then moves to Finished.
  5. An agent finishing naturally plays the green ✓ flash, then moves.
  6. Switch to a chat with no tasks: the sidebar closes.
  7. The editor/terminal drag handle still resizes vertically.
  8. Take a screenshot with `sai_capture_app` for the user.

- [ ] **Step 6: Commit**
  `git commit -am "feat(background-tasks): mount sidebar as right column"`
