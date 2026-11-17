# Turn follow-up judge — design

2026-11-17 · Claude SDK backend only

## Why

When a Claude turn ends, the user can't tell whether the AI is going to come back
on its own. Two very different situations look identical in the chat:

- **It will resume.** The AI left something running that re-invokes it: a
  background `gh run watch`, a background agent/workflow, a monitor, a
  `ScheduleWakeup`. Today the shell-only case is deliberately presented as a plain
  finish (`onlyShellTasksLive` in `waitClassifier.ts`), so nothing says "I'll be back".
- **It won't.** The AI said "I'll keep an eye on CI", but its watch hit the
  tool's time limit, or it never set one up. Nothing will ever happen, and the
  chat looks the same as above.

The user's motivating case: waiting on a PR's CI. If CI outlasts the AI's watch,
the chat just looks done and the user doesn't know they need to poke it.

Whether a wake-up source is alive is a fact SAI already tracks. Whether the AI
*meant* to come back, and what for, only exists in its closing prose. So: a
cheap model reads the closing message for intent, and SAI's own task facts say
whether anything will actually deliver on it.

## Goals

- After each turn, show one of three end states:
  ```
  ⟳ Waiting on CI for PR #42 — will pick back up automatically     intent + live wake source
  ⚠ Said it would follow up on CI for PR #42, but nothing is watching  [Check now]
  ✓ (today's normal finish, unchanged)                               no follow-up intent
  ```
- Flip ⟳ → ⚠ when the wake source disappears without the AI resuming.
- **Check now** sends the AI a message to go check on the thing it was waiting for.

## Non-goals

- Codex / Gemini / Kimi (no background wake sources there; later, if wanted).
- Changing *when* the turn-end desktop notification fires, or the existing
  wait/pin clocks (`BACKGROUND_WAIT_SETTLE_MS`, `BACKGROUND_WAIT_IDLE_MS`). The
  judge adds a label and a state on top; it never gates completion.
- Persisting the ⟳/⚠ state across app restarts (on restart the query is dead
  anyway; nothing would resume).
- A settings toggle (my call — revisit if Haiku usage turns out to matter).

## Anti-goals

- **Auto re-prompting** the AI when ⚠ appears. Unsupervised token spend, and it
  loops forever on genuinely stuck CI. The user decided: button only.
- The judge must never delay or block the turn's end. A slow or failed judge
  degrades to today's behaviour, never to a stuck state.
- The judge must never decide a fact. It does not get to say "a watcher is
  running"; only SAI's task ledger says that.

## Approaches considered

- **A. Haiku reads the closing message (chosen).** One cheap call per natural
  turn end, async after the turn ends. Catches the "AI forgot to arrange a
  watcher" case, which is the case the user cares about.
- **B. AI self-declares via a `sai_waiting_on` tool.** Free and deterministic,
  but fails silently in exactly the ⚠ case: an AI that forgets to arrange a
  watcher also forgets to call the tool. Possible later fast path on top of A.
- **C. Keyword matching on the closing text.** Free but brittle (misses
  rephrasings, fooled by "CI already finished, all green").

Picked A, Claude SDK only, by the user.

## How it works

### 1. The judge (main process)

- **When:** on a `result` frame in `sdkBackend.ts` that is a natural end:
  `terminal_reason` is `completed` (or absent), not an error, not interrupted,
  not `superseded`, not a `continuation` (num_turns 0 + empty text). Every user-facing chat scope (one per chat
  session; task feeds are display filters over the same chat, not separate
  scopes); not internal scopes (commit message, titles, orchestrator plumbing).
- **Input:** the final assistant text (`result.result`), last ~2000 chars. Only
  the text — not the task ledger (anti-goal: it doesn't judge facts).
- **Output:** strict JSON `{ "followUp": boolean, "waitingFor": string | null }`.
  `followUp` = the message says or implies the AI will act again later without
  the user (check back, report when X finishes, keep watching). Asking the user
  a question or offering optional next steps ("want me to…?") is **not** a
  follow-up. `waitingFor` = short noun phrase, ≤ 8 words ("CI for PR #42").
- **Model:** Haiku, one-shot, same pattern as `generateTitle` in `claude.ts`.
  Must not create a resumable session in the user's history (use the CLI's
  no-persistence option, or the SDK equivalent — builder to verify which exists).
  If using the SDK `query()`, pass `pathToClaudeCodeExecutable` (every SDK
  caller must).
- **Budget:** 15 s timeout. Parse failure / timeout / spawn error → no verdict
  → today's behaviour. Logged.
- **Staleness:** stamp the verdict with the turn's `turnSeq`. If a new turn has
  started by the time it lands, drop it.

### 2. Wake source (facts, main process)

A wake source is alive when, for that scope, any of:
- a live task (any type, shells included) that **started since the user's last
  message** — i.e. during the current user turn or any autonomous resume turn
  after it. Older tasks don't count: a dev server started an hour ago would
  otherwise make every "I'll check back" read ⟳ forever. (User decision. The
  ledger needs a per-task start marker — turn number or timestamp — which it
  doesn't store today.) Accepted cost: a rare false ⚠ when the AI relies on a
  watcher it started several user messages ago.
- `pendingWakeup` with `wakeupDeadline` still in the future.

The scope's query also has to be alive (not suspended/swept/closed) — a dead
query can't resume anything.

**⟳ keeps the query alive.** (User decision.) SAI's own reapers would otherwise
kill the motivating case: the 30-min idle sweep (`IDLE_SCOPE_MS`) and workspace
auto-suspend close the query, which kills the background watcher. While a scope
is ⟳ it counts as busy in `_isBusy`, `isWorkspaceBusy` and `_sweepOnce`, with a
hard cap of **2 hours** from when ⟳ began (named constant). At the cap the hold
is released and the state flips to ⚠. Accepted cost: one idle Claude process
(a few hundred MB) stays resident for the length of the wait.

### 3. Combining → end state

| verdict | wake source | state |
|---|---|---|
| none / `followUp:false` | any | unchanged from today (✓, or the existing waiting pill for agents/scheduled) |
| `followUp:true` | alive | **⟳ following up** on `waitingFor` |
| `followUp:true` | gone | **⚠ stalled** on `waitingFor`, with Check now |

When the existing waiting pill is already up (agent/workflow wait, scheduled
wakeup), ⟳ doesn't add a second row: the pill just gains the `waitingFor`
label instead of "Waiting on background work".

**⟳ → ⚠ transition.** While ⟳, re-evaluate whenever a task frame arrives, the
wakeup deadline passes, or the query closes. When the last wake source goes
away, the runtime normally re-invokes the AI within seconds to minutes (measured:
median 56 s, p75 105 s after drain). So hold ⟳ with the label "watcher finished —
picking back up…" for a **2-minute resume grace** (my call, a named constant),
then flip to ⚠ if no new turn has started. A real query close (`query.close()`,
session deletion, idle sweep, workspace suspend) flips to ⚠ immediately.
Releasing the background-wait pin (`_closeBackgroundWaitIfDue` stage "pin") is
**not** a close; the query is still alive and can still resume.

**Clearing.** Any new turn on the scope (user send, Check now, or an autonomous
resume) clears ⟳/⚠.

### 4. Renderer

- New IPC event per scope: `{ type: 'followup', state: 'following' | 'resuming' | 'stalled' | 'none', waitingFor, turnSeq }`.
  App keeps it in a per-scope map, like `waitingScopes`.
- ⟳ and ⚠ render in the same slot as `WaitingIndicator` (`ChatPanel.tsx` chat
  waiting row), same visual family. ⚠ uses a warning tone, no shimmer/spin,
  and a **Check now** button.
- **Check now** sends a normal visible user message through the existing send
  path: `Check on <waitingFor> and continue where you left off.`
- Workspace/chat-list status: ⚠ shows the same attention marker a pending
  question gets, so a stalled chat is findable from the sidebar (my call).

### 5. Diagnostics

devlog channel `followupJudge`: verdict, latency, raw output on parse failure,
state transitions, and the outcome (resumed within grace / stalled / user hit
Check now). That gives us a measured false-positive rate to tune the prompt.

## Left to the builder

- Exact prompt wording (keep it short; include 4–6 labelled examples covering
  CI watch, "let me know if…" offers, questions to the user, a plain summary).
- CLI one-shot vs SDK `query()` for the Haiku call.
- Visual details within the WaitingIndicator family.
- Test layout. Pure combine/transition logic should be a pure function next to
  `classifyTurnEnd` and unit-tested on its own.
