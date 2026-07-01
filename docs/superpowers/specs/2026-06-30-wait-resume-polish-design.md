# Wait / Resume Polish — Design

**Date:** 2026-06-30
**Branch:** `wait-resume-polish`
**Status:** Design — approved, pending implementation plan

## Problem

Claude's newer agent runtime can end a turn's stream and then **resume the same
logical work later** — either because it yielded to background work, or because
it scheduled itself to wake up on a timer (`ScheduleWakeup`, `CronCreate`,
`/loop`). SAI currently treats every `result` frame as a turn end, so:

1. **No indication Claude is waiting.** The chat goes quiet and looks finished;
   the user can't tell Claude will continue.
2. **False "turn complete" notifications.** Every wait pings the user because a
   wait `result` is indistinguishable, to the current code, from a real end.
3. **Resume is janky.** When the turn wakes, the Stop button and thinking
   indicator don't reliably come back.

The root cause is a single missing distinction: the code branches on *"a
`result` arrived"* instead of *"why the turn ended."*

## The distinguishing signal

The CLI/SDK `result` frame carries `terminal_reason`
(`@anthropic-ai/claude-agent-sdk` `TerminalReason`):

```
'completed' | 'background_requested' | 'tool_deferred' | 'max_turns'
| 'aborted_streaming' | 'aborted_tools' | 'hook_stopped' | 'stop_hook_prevented'
| 'blocking_limit' | 'rapid_refill_breaker' | 'prompt_too_long'
| 'image_error' | 'model_error'
```

`electron/services/claude.ts` already **logs** `terminal_reason` (the
`[sai-stream-debug]` block, ~line 396) but never **branches** on it. This design
makes it the decision variable.

Two genuinely different waits, classified at the `result` frame:

| Wait type | Classifier | Process | Resume shape |
|---|---|---|---|
| **Background wait** | `terminal_reason === 'background_requested'` | stays alive | same turn resumes in sec–min |
| **Scheduled wait** | `terminal_reason === 'completed'` **and** a `ScheduleWakeup` / `CronCreate` / `/loop` fired this turn | may idle-suspend | re-fires as a **new turn** on a timer |
| **Real end** | `terminal_reason === 'completed'` and nothing scheduled | done | n/a |

Scheduled waits are detected from the assistant `tool_use` seen earlier in the
turn (`claude.pendingToolUse` already captures tool name + input). The wakeup
delay comes from the `ScheduleWakeup` input (`delaySeconds`); `/loop` and
`CronCreate` may have no fixed delay (see Open detail below).

## Scope

Both wait types are first-class. Chat scopes **and** background/swarm scopes
respect waits for notification purposes.

## Design

### 1. Backend classification (`electron/services/claude.ts`)

- On each `result` frame, compute a `waitKind: 'none' | 'background' | 'scheduled'`.
  - `background_requested` → `background`.
  - `completed` + a scheduling tool_use recorded this turn → `scheduled`, carrying
    `resumeInSeconds` (from `delaySeconds`) when known.
  - otherwise → `none` (real end).
- Emit this on the turn-end event the renderer consumes (the `result`/`done`
  IPC message) as a `wait` field: `{ kind, resumeInSeconds? , taskCount? }`.
- **Do not** clear `busy`/`streaming` semantics that the resume path relies on;
  the existing resume-after-wait re-arm (assistant-frame-while-not-streaming,
  ~line 482) stays as the safety net. The new `wait` metadata is additive.
- Replace the ad-hoc `[sai-stream-debug]` logging with the real branch; keep a
  single concise debug line behind the existing debug flag.

### 2. Waiting UI state (renderer)

A new turn phase — **waiting** — distinct from thinking and done.

- **Inline pill** on the last assistant message (mirrors the approved mockup):
  - *Scheduled:* pulsing `⏰`, "Waiting to resume", countdown pill, Cancel.
  - *Background:* orbit spinner, "Waiting on background work", task count, Cancel.
- **Composer mirror:** the composer's Stop/status area reflects the waiting
  state so it's visible even when the thread is scrolled away.
- **Stop → Cancel:** during a wait the Stop control's label/semantics become
  Cancel.
  - Scheduled → cancel the pending wakeup (drop the scheduled cron/loop entry).
  - Background → interrupt (existing `claudeStop` path).
- **Resume folds back to thinking.** When the turn wakes (`streaming_start`
  after a wait, or the resume-after-wait re-arm), the pill collapses and the
  normal thinking indicator + Stop return. This must work even though the last
  assistant `StreamingAssistantHead` may already be `revealed` — see §5.

### 3. Countdown format

- Far out: coarse `~29m`. Under ~2 min: live `MM:SS`. Wake time
  (`resumes 3:42pm`) available on hover/tooltip.
- Countdown is driven client-side from `resumeInSeconds` captured at wait start;
  no backend ticking.

### 4. Notifications

- **Suppress on all waits** (`waitKind !== 'none'`), for chat scopes **and**
  background/swarm scopes (the `notifyOnComplete` path).
- **Notify only on true completion** (`waitKind === 'none'`), unchanged behavior
  otherwise.
- The stale-turn guard (`turnSeqGuard.turnEndIsStale`) stays; wait-classified
  results simply take the "no notify, enter waiting state" branch instead of the
  "clear + notify" branch.

### 5. Reliable resume of thinking / Stop

The known failure: on resume, the last `StreamingAssistantHead` is already in
`phase === 'revealed'` and its guard (`revealedRef`) refuses to return to
thinking, so the resumed turn shows no thinking indicator.

Approach: the resumed turn's fresh assistant output is a **new** message head, so
the thinking indicator belongs to that new head, not the revealed one. The fix
is to ensure the waiting→resume transition (a) reliably starts a new turn
boundary (`streaming_start`) that the renderer keys a new head on, and (b) does
not leave the composer Stop hidden. Where a resume must re-animate an existing
head, add an explicit "wake" path that is allowed to leave `revealed` (guarded
so StrictMode double-invoke and token-pause debounce can't trigger it — consistent
with the existing self-guard discipline in `StreamingAssistantHead`).

### 6. Idle-sweep interaction (`idleScopeSweep.ts` / `claude.ts`)

- While a scope has a **pending scheduled wakeup**, the idle sweep **defers** —
  the scope is not reaped for being idle (it is deliberately waiting, not
  abandoned).
- If a scope is nonetheless shown as suspended while a wakeup is pending, the
  sidebar marker reads **"waiting to resume"**, not "suspended after 30 min
  idle".

## Components / boundaries

- `claude.ts` — classify `terminal_reason` → `waitKind`; attach `wait` metadata
  to the turn-end IPC; defer idle sweep on pending wakeup. *Owns: what kind of
  wait this is.*
- `idleScopeSweep.ts` — honor the "pending wakeup" defer signal. *Owns: whether
  to reap.*
- Renderer turn-state (App.tsx / ChatPanel.tsx) — map `wait` metadata to the
  waiting phase; route notifications by `waitKind`; drive Stop→Cancel. *Owns:
  turn phase + notification gating.*
- Waiting pill component (new) + composer mirror — render the waiting affordance;
  countdown formatting. *Owns: presentation.*
- `StreamingAssistantHead.tsx` — wake path for reliable resume. *Owns: head
  animation lifecycle.*
- `ChatHistorySidebar.tsx` — "waiting to resume" vs "suspended" marker copy.

## Error handling

- Unknown/absent `terminal_reason` → treat as real end (`none`) so we never
  strand a turn in a permanent fake-waiting state. Waiting is opt-in on a
  positive signal only.
- Cancel during a wait must be idempotent and safe if the turn has already woken
  (race): cancel is a no-op if the wait already resolved.
- Countdown reaching zero without a resume frame → fall back to a neutral
  "resuming…" state rather than negative time; the real `streaming_start`
  (or timeout) resolves it.

## Testing

- **Classifier unit tests:** `result` frames with each `terminal_reason` +
  with/without a prior `ScheduleWakeup` tool_use → expected `waitKind` and
  `resumeInSeconds`.
- **Notification gating tests:** wait-classified turn end fires no notification;
  real-completion end does — for both chat and background scopes.
- **Resume tests:** waiting → `streaming_start` restores thinking + Stop;
  `StreamingAssistantHead` wake path doesn't double-run under StrictMode.
- **Countdown formatter unit tests:** coarse vs live thresholds, wake-time label.
- **Idle-sweep test:** pending wakeup defers reap; suspended-marker copy swaps.

## Open detail (resolve during planning, not blocking)

- `/loop` and `CronCreate` without a fixed `delaySeconds`: show the spinner-style
  "waiting to resume" without a countdown (no fabricated timer), and rely on the
  wake time only when a concrete next-fire is known.
