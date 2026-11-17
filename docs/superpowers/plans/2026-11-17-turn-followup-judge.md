# Turn Follow-up Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Claude turn ends, show whether the AI will pick back up on its own (⟳), said it would but nothing is watching (⚠ + Check now), or is simply done.

**Architecture:** A pure state function (`followupState.ts`) combines a Haiku verdict on the closing message (`followupJudge.ts`) with SAI's own task-ledger facts. `sdkBackend.ts` runs the judge at each natural turn end, tracks per-scope follow-up state, re-evaluates on task frames/timers/closes, holds the query alive while ⟳ (capped), and emits `followup` events. The renderer keeps a per-scope map and renders a row next to the existing `WaitingIndicator`.

**Tech Stack:** Electron main (TypeScript), `@anthropic-ai/claude-agent-sdk` backend, React renderer, vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-turn-followup-judge-design.md`

## Global Constraints

- Claude SDK backend only (`sdkBackend.ts`); no changes to `cliBackend.ts`, Codex, Gemini, Kimi.
- Judge model: Haiku. Input: last 2000 chars of final assistant text only. Output JSON `{ "followUp": boolean, "waitingFor": string | null }`, `waitingFor` ≤ 8 words.
- Judge timeout 15 s (`FOLLOWUP_JUDGE_TIMEOUT_MS = 15_000`). Failure → no verdict → today's behaviour.
- Resume grace 2 min (`FOLLOWUP_RESUME_GRACE_MS = 120_000`). Hold cap 2 h from ⟳ start (`FOLLOWUP_HOLD_CAP_MS = 2 * 60 * 60_000`).
- Wake source = a live task started since the user's last message, or a `pendingWakeup` whose `wakeupDeadline` is in the future; and the query must be alive.
- Never change turn-end notification timing, `BACKGROUND_WAIT_SETTLE_MS`, `BACKGROUND_WAIT_IDLE_MS`, or `classifyTurnEnd`.
- Check now copy, exactly: `Check on ${waitingFor} and continue where you left off.` (fallback when `waitingFor` is null: `Check on what you were waiting for and continue where you left off.`)
- Row copy: ⟳ `Waiting on ${waitingFor} — will pick back up automatically`; resuming `${waitingFor}: watcher finished — picking back up…`; ⚠ `Said it would follow up on ${waitingFor}, but nothing is watching`. Null `waitingFor` → `this`.
- devlog channel `followupJudge`.
- vitest: `npx vitest run --project unit <file>` (config already caps workers at 2). Never run the whole suite in parallel with other heavy work.
- Subagents: never `git checkout <sha>`; use `git show`. Stay on branch `turn-followup-judge`.

## Review Focus

1. **A dev server started in an earlier user turn is still running** when the AI says "I'll check back on CI" → must be ⚠, not ⟳. (Task 3 test.)
2. **New user message lands while the judge call is in flight** → the late verdict must be dropped; no ⟳/⚠ appears on the new turn. (Task 3 test.)
3. **Idle sweep runs while ⟳** (CI longer than 30 min) → scope must not be reaped; after the 2 h cap it may be, and state flips to ⚠. (Task 4 test.)
4. **AI ends with a question or an offer** ("Want me to open a PR?") → not a follow-up. (Task 2 prompt examples; Task 2 parse tests cover the shape only — note in the review that this is prompt-quality, verified live.)
5. **Judge returns junk / prose-wrapped JSON / times out** → no state change, logged, no exception escapes into the drain loop. (Task 2 + Task 3 tests.)

---

### Task 1: Pure follow-up state function

**Files:**
- Create: `electron/services/followupState.ts`
- Test: `tests/unit/followupState.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FollowUpVerdict { followUp: boolean; waitingFor: string | null }
  export type FollowUpState = 'none' | 'following' | 'resuming' | 'stalled';
  export const FOLLOWUP_RESUME_GRACE_MS = 120_000;
  export const FOLLOWUP_HOLD_CAP_MS = 2 * 60 * 60_000;
  export interface FollowUpInput {
    verdict: FollowUpVerdict | null;
    wakeSourceAlive: boolean;
    queryAlive: boolean;
    now: number;
    /** epoch ms when ⟳ first began for this turn, or null */
    followingSince: number | null;
    /** epoch ms when the wake sources last went to zero (or the pin was alive with no task at verdict time), or null */
    drainedAt: number | null;
  }
  export function deriveFollowUpState(i: FollowUpInput): FollowUpState;
  /** Next epoch ms at which deriveFollowUpState could change with no new event, or null. */
  export function nextFollowUpDeadline(i: FollowUpInput): number | null;
  ```

- [ ] **Step 1: Write failing tests** in `tests/unit/followupState.test.ts`, one `it` per rule, in this precedence order:
  - verdict null → `'none'`; `followUp:false` → `'none'` (even with wake source alive)
  - `followUp:true`, `queryAlive:false` → `'stalled'`
  - `followUp:true`, `followingSince = now - FOLLOWUP_HOLD_CAP_MS` → `'stalled'` (cap reached, even if wake source alive)
  - `followUp:true`, wake alive → `'following'`
  - `followUp:true`, not alive, `drainedAt = now - 1000` → `'resuming'`
  - `followUp:true`, not alive, `drainedAt = now - FOLLOWUP_RESUME_GRACE_MS` → `'stalled'`
  - `followUp:true`, not alive, `drainedAt:null` → `'stalled'`
  - `nextFollowUpDeadline`: resuming → `drainedAt + FOLLOWUP_RESUME_GRACE_MS`; following with `followingSince` → `followingSince + FOLLOWUP_HOLD_CAP_MS`; none/stalled → `null`.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/followupState.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement both functions in `electron/services/followupState.ts`, rules in exactly the precedence above.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5: Commit** `feat(followup): pure follow-up state derivation`

---

### Task 2: Haiku judge

**Files:**
- Create: `electron/services/followupJudge.ts`
- Test: `tests/unit/followupJudge.test.ts`

**Interfaces:**
- Consumes: `FollowUpVerdict` (Task 1).
- Produces:
  ```ts
  export const FOLLOWUP_JUDGE_TIMEOUT_MS = 15_000;
  export const FOLLOWUP_JUDGE_MAX_CHARS = 2000;
  export function buildJudgePrompt(finalText: string): string;
  export function parseJudgeVerdict(raw: string): FollowUpVerdict | null;
  /** runner returns the model's stdout; injected for tests. */
  export type JudgeRunner = (prompt: string, signal: AbortSignal) => Promise<string>;
  export function makeCliJudgeRunner(claudePath: string | undefined): JudgeRunner;
  export async function judgeFollowUp(finalText: string, run: JudgeRunner, timeoutMs?: number): Promise<FollowUpVerdict | null>;
  ```

- [ ] **Step 1: Write failing tests:**
  - `buildJudgePrompt` keeps only the **last** `FOLLOWUP_JUDGE_MAX_CHARS` chars (input `'x'.repeat(5000) + 'END'` → prompt contains `'END'` and not 5000 `x`s).
  - `parseJudgeVerdict('{"followUp":true,"waitingFor":"CI for PR #42"}')` → `{ followUp: true, waitingFor: 'CI for PR #42' }`.
  - Tolerates a ```json fence and leading prose: extracts the first `{…}` object.
  - `waitingFor` longer than 8 words → truncated to the first 8 words; empty string → `null`.
  - Junk (`'sure!'`), missing `followUp`, non-boolean `followUp` → `null`.
  - `judgeFollowUp` with a runner that never resolves and `timeoutMs = 20` → resolves `null` and the runner's signal is aborted.
  - `judgeFollowUp` with a runner that rejects → `null` (no throw).
  - `judgeFollowUp('')` / whitespace → `null` without calling the runner.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/followupJudge.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - Prompt: short instruction defining follow-up exactly as the spec does (the message says or implies the AI will act again later without the user; questions to the user and optional offers are NOT follow-ups), demand JSON only, then 5 labelled examples: CI watch promise (true, "CI for PR #42"), "I'll report back when the agents finish" (true, "the review agents"), "Want me to open a PR?" (false), "Which option do you prefer?" (false), plain summary "Done — tests pass." (false). Then the message between `<message>` tags.
  - `makeCliJudgeRunner`: `spawn(claudePath ?? 'claude', ['-p', prompt, '--output-format', 'text', '--max-turns', '1', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--strict-mcp-config'], { env: spawnEnv(), stdio: ['ignore','pipe','pipe'] })` (`spawnEnv` from `./claude`); resolve stdout on exit 0, reject otherwise; kill the child on `signal` abort.
  - `judgeFollowUp`: devlog `followupJudge`/`verdict` with `{ followUp, waitingFor, ms }`, or `followupJudge`/`fail` with `{ reason: 'timeout'|'error'|'parse', raw: devlogSnip(raw) }`.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5: Commit** `feat(followup): Haiku follow-up judge`

---

### Task 3: Backend — run the judge, track per-scope state, emit

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (ScopeSession ~65-210, SdkBackendDeps ~343, constructor ~412, send ~612, `_beginTurn` ~1030, `_trackTaskFrame` ~1375, result handling ~1625-1700, `suspendWorkspace` ~1914, `suspendScope` ~1980, other `query.close()` sites ~488/595/652/803/895)
- Test: `tests/unit/electron/sdkBackend.test.ts` (new `describe('follow-up judge')`, built on the existing `runBackgroundWaitTurn` helper pattern ~2500)

**Interfaces:**
- Consumes: Task 1 (`deriveFollowUpState`, `nextFollowUpDeadline`, `FollowUpVerdict`, `FollowUpState`), Task 2 (`judgeFollowUp`, `makeCliJudgeRunner`).
- Produces:
  - `SdkBackendDeps.judgeFollowUp?: ((finalText: string) => Promise<FollowUpVerdict | null>) | null`. Default: real judge (`judgeFollowUp(text, makeCliJudgeRunner(this._resolveClaudePath()))`) **only when `deps?.queryFn` is undefined**; otherwise `null` (no judge) unless explicitly passed — existing tests must never spawn `claude`.
  - Emitted event: `{ type: 'followup', projectPath, scope, state: FollowUpState, waitingFor: string | null, turnSeq: number }` — emitted only when `state` or `waitingFor` changes.
  - ScopeSession fields: `userTurnSeq: number` (incremented in `send()` where `clearFinishedOnWait = true`), `liveTaskUserTurn: Map<string, number>` (set on `task_started`, deleted with `liveTasks`), `followUp: { verdict: FollowUpVerdict; turnSeq: number; followingSince: number | null; drainedAt: number | null; lastEmitted: FollowUpState; timer: ReturnType<typeof setTimeout> | null } | null`.
  - Private `_evaluateFollowUp(session: ScopeSession, scopeKey: string, queryAlive?: boolean): void` — computes wake source, calls `deriveFollowUpState`, emits on change, arms one timer at `nextFollowUpDeadline` (unref'd), stamps `followingSince` the first time state is `'following'`, sets `drainedAt = now` when it goes from wake-alive to not-alive.
  - Private `_clearFollowUp(session)` — clears timer, sets `followUp = null`; if the last emitted state wasn't `'none'`, emits `state: 'none'`.

- [ ] **Step 1: Write failing tests** (inject `judgeFollowUp: vi.fn()` returning a controlled promise; use `_nowForTest` / fake timers for clocks):
  - Natural end with result text `"I'll watch CI"` → judge called once with that text.
  - Judge NOT called for: `is_error` result, interrupted turn, `continuation` (num_turns 0 + empty), superseded turn.
  - Verdict `{followUp:true}` + a `task_started` frame during this user turn still live → emits `followup` `state:'following'`, `waitingFor` passed through.
  - Same, but the only live task was started **before** the previous user send (Review Focus 1) → `'stalled'`.
  - Verdict `{followUp:true}` and no live task, no wakeup → `'stalled'`.
  - `'following'`, then `task_notification` drains the task → `'resuming'`; advance clock past `FOLLOWUP_RESUME_GRACE_MS` and fire the timer → `'stalled'`.
  - Verdict resolves after a new `send()` began (Review Focus 2) → no `followup` emit for the old verdict.
  - New `send()` while `'following'` → emits `state:'none'`.
  - `suspendScope` while `'following'` → emits `'stalled'` before the session is removed.
  - Judge rejects / returns null → no `followup` emit, drain loop continues (next turn still works).
  - `{followUp:false}` → no emit at all.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/electron/sdkBackend.test.ts -t "follow-up judge"` → FAIL.
- [ ] **Step 3: Implement.**
  - Natural end = `m.type === 'result' && m.subtype === 'success' && !m.is_error && (terminal_reason === 'completed' || terminal_reason == null) && !superseded && !producedNothing`. Trigger the judge **after** the result's emits (never awaited in the drain loop): capture `turnSeq = session.turnSeq`, call judge with `String(m.result ?? '')`, `.then` → drop if `this.sessions.get(scopeKey) !== session` or `session.turnSeq !== turnSeq` or `session.mapperState.streaming`; else if `verdict?.followUp` set `session.followUp` and `_evaluateFollowUp`. `.catch` → devlog only.
  - Wake source alive = any `liveTasks` id whose `liveTaskUserTurn.get(id) === session.userTurnSeq`, OR `pendingWakeup && wakeupDeadline != null && now < wakeupDeadline`. If at verdict time no wake source but `pendingBackgroundResume` is true, seed `drainedAt = now` (a resume may already be queued).
  - Call `_evaluateFollowUp` at the end of `_trackTaskFrame` when `session.followUp` is set.
  - `_beginTurn` → `_clearFollowUp(session)`.
  - Every path that closes a session's query and deletes it from `this.sessions` → `_evaluateFollowUp(session, scopeKey, false)` before close, then clear the timer (state stays stalled in the renderer; backend drops it with the session). Reuse one helper so no close site is missed.
  - devlog `followupJudge`/`state` on each emitted transition: `{ scope, from, to, waitingFor, turnSeq }`.
- [ ] **Step 4:** Re-run the describe → PASS; then the full file `npx vitest run --project unit tests/unit/electron/sdkBackend.test.ts` → PASS (no regressions in wait tests).
- [ ] **Step 5: Commit** `feat(followup): judge turn ends and track follow-up state in the SDK backend`

---

### Task 4: Backend — hold the query alive while ⟳

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`_isBusy` ~816, `isWorkspaceBusy` ~1934, `_sweepOnce` ~1950)
- Test: `tests/unit/electron/sdkBackend.test.ts` (same describe)

**Interfaces:**
- Consumes: Task 3's `session.followUp`, `deriveFollowUpState`.
- Produces: private `_followUpHolds(session: ScopeSession, now: number): boolean` — true when derived state is `'following'` or `'resuming'` (the cap is already inside `deriveFollowUpState`).

- [ ] **Step 1: Write failing tests** (Review Focus 3):
  - `'following'` scope, `lastActivityAt` 31 min ago → `_sweepOnce(now)` does NOT call `query.close()`; `isWorkspaceBusy(PROJECT)` is true.
  - Same scope at `followingSince + FOLLOWUP_HOLD_CAP_MS + 1` → `_sweepOnce` closes it and a `followup` `'stalled'` emit precedes the close.
  - A `'stalled'` scope is not held (sweep closes it normally once idle).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `|| this._followUpHolds(session, now)` to `_isBusy` (use `Date.now()`), `isWorkspaceBusy`, and the `pendingWakeup` field of the `_sweepOnce` record. In `_sweepOnce`, call `_evaluateFollowUp` for each session with a follow-up before building records, so a capped hold flips to ⚠ first.
- [ ] **Step 4:** Run the whole `sdkBackend.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(followup): keep the scope alive while a follow-up is pending`

---

### Task 5: Renderer — state map, rows, Check now, sidebar marker

**Files:**
- Create: `src/components/Chat/FollowUpIndicator.tsx`
- Modify: `src/App.tsx` (state near `waitingScopes` ~360; `claude:message` handler — `followup` case next to `scope_suspended` ~2044, clear on `streaming_start` ~2088; `waiting=` prop ~3385; attention sets ~343 and ~3654)
- Modify: `src/components/Chat/ChatPanel.tsx` (props; waiting row ~2772; reuse `handleSend`)
- Modify: `src/components/Chat/WaitingIndicator.tsx` (optional `label?: string` prop overriding the computed label)
- Test: `tests/unit/components/Chat/FollowUpIndicator.test.tsx`, `tests/unit/components/Chat/WaitingIndicator.test.tsx` (add case; create if absent)

**Interfaces:**
- Consumes: Task 3's `followup` event shape; `FollowUpState` type from `electron/services/followupState`.
- Produces:
  - `App`: `followUpScopes: Map<string, { state: Exclude<FollowUpState,'none'>; waitingFor: string | null }>` keyed by `${projectPath}:${scope}`; `state:'none'` deletes the key; `streaming_start` deletes the key.
  - `ChatPanel` prop `followUp?: { state: 'following' | 'resuming' | 'stalled'; waitingFor: string | null } | null` (Claude only, same keying as `waiting=`).
  - `FollowUpIndicator({ state, waitingFor, onCheckNow }: { state: 'following'|'resuming'|'stalled'; waitingFor: string | null; onCheckNow: () => void })`.

- [ ] **Step 1: Write failing tests:**
  - `FollowUpIndicator` renders each Global-Constraints row copy for its state (null `waitingFor` → `this`).
  - Only `'stalled'` renders a `Check now` button; clicking calls `onCheckNow` once.
  - `'stalled'` row has no spinner/shimmer class (`.sai-waiting-orbit` / `.sai-shimmer` absent); `'following'` has the orbit.
  - `WaitingIndicator` with `label="Waiting on CI for PR #42"` shows that instead of "Waiting on background work".
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/components/Chat/FollowUpIndicator.test.tsx tests/unit/components/Chat/WaitingIndicator.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
  - `FollowUpIndicator`: same visual family as `WaitingIndicator` (reuse its `.sai-waiting*` classes); stalled uses a warning tone (`var(--warning, #d9a441)` border/icon, `AlertTriangle` from lucide-react).
  - `ChatPanel`: if `isWaiting && followUp?.state === 'following'` → pass `label={\`Waiting on ${followUp.waitingFor ?? 'this'}\`}` to `WaitingIndicator`, no second row. Else if `followUp && !isWaiting && !streamingForDisplay` → render `FollowUpIndicator` in the same `.chat-waiting-row` slot. `onCheckNow` → `handleSend(<Check now copy>)`.
  - `App`: handle the `followup` event; pass `followUp={aiProvider === 'claude' ? followUpScopes.get(\`${wsPath}:${ws.activeSession.id}\`) ?? null : null}`; add stalled scope keys into the set fed to `questionWorkspaces(...)` (~343) and `questionSessionIdsFor(...)` (~3654) via a memoized union — do **not** change the `awaitingQuestion` prop at ~3409.
- [ ] **Step 4:** Re-run → PASS; then `npx tsc --noEmit -p tsconfig.json` (and the electron tsconfig if separate) → no new errors.
- [ ] **Step 5: Commit** `feat(followup): follow-up rows, Check now, and stalled sidebar marker`

---

### Task 6: Verify in the real app

- [ ] **Step 1:** Run the affected unit files together: `npx vitest run --project unit tests/unit/followupState.test.ts tests/unit/followupJudge.test.ts tests/unit/electron/sdkBackend.test.ts tests/unit/components/Chat/` → PASS.
- [ ] **Step 2:** Launch the dev app (use the `run` skill). In a Claude chat ask: "Run `sleep 90 && echo ok` in the background and tell me you'll report back when it finishes." Expect ⟳ row with a label, then an automatic resume and the row clearing.
- [ ] **Step 3:** Ask: "Say 'I'll keep an eye on CI and report back' and do nothing else." Expect ⚠ row within ~3 s of turn end, sidebar attention marker, Check now sends the exact copy.
- [ ] **Step 4:** Ask a plain question ("What's 2+2?") → no row. Check `followupJudge` lines in the devlog for all three.
- [ ] **Step 5:** Commit any fixes; report results with devlog excerpts.
