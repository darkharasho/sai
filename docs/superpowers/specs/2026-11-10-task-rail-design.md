# Task Rail — persistent per-task progress UI

Date: 2026-11-10 · Status: draft for approval

## Why

The user increasingly fires several requests at SAI in one message, and SAI splits
them into separate pieces of work. Today that work goes one of two bad ways:

- it happens **behind the scenes in agents**, where the user can't see it, or
- it all streams into the **main chat**, where the separate threads mix together
  and there's too much going on.

The user wants a persistent view that shows, for each task: **what step it's on,
how far along it is, and a way to isolate and see that task's workstream.**

Success = with three tasks in flight, a glance tells the user which is running,
which is stuck on them, which is done, and what each is doing *right now* —
without reading the transcript.

## Goals

- One card per task the user asked for, kept up to date while work runs.
- Each card: status, title, step `n/m`, current step label, progress bar, elapsed
  time, and a **live tail** (last few lines of what that task just did).
- Isolate a task: "Open stream" shows only that task's work.
- Two layouts behind a setting so the user can live with both:
  **Rail** (A) and **Tabs** (B). The user is undecided and wants to try each for
  a while.
- Prompt engineering so the model reliably creates and maintains task cards.
- Persistent per chat across restarts.

## Non-goals

- Codex, Gemini, Kimi providers. **Claude chats only** for v1 (user decision).
  Don't break the existing progress ring / sidebar behavior for other providers.
- Cross-chat or cross-workspace task dashboards.
- Letting background agents ask the user questions mid-run (the SDK doesn't
  support it; see "Waiting on you").

## Anti-goals (failure even if it "works")

- **Lying progress.** Bars that sit at 0% while work happens, or tasks that never
  get marked done. Stale/wrong state is worse than no rail.
- **Rail becomes the new noise.** Every card spewing a tall tail at once. Only the
  selected card expands; the rest stay compact.
- **An empty rail sitting there** taking width when nothing is tracked.
- Regressing the existing stuck-"working"/false-completion fixes (see memory notes
  on turnSeq, background-wait clocks). The rail reads state; it must not become a
  new source of completion signals.

## What the user sees

Mockups (screenshots of the in-session renders, saved next to this doc):

- `2026-11-10-task-rail-mockup.png` — **the approved direction**: Rail with live tail.
- `2026-11-10-task-rail-options.png` — the three options shown (A Rail, B Tabs,
  C Mission control). B is the Tabs alternative; C contributed the live tail.

These are directional, not pixel specs (rail ~340px wide in the mock). Summary:

### Card anatomy (both layouts)

- Status dot: running (blue, glowing), waiting on you (orange), done (green),
  queued (muted), failed (red).
- Title, right-aligned `n/m · elapsed`.
- Current step label ("Running tests") and a thin progress bar (`done/total` steps).
- **Live tail:** monospace box, last ~3–4 lines of the task's activity (commands,
  tool actions, short results, a blinking cursor on the in-progress line).
- Selected card additionally shows: full step list (✓ done / ● current / ○ pending),
  "Open stream →", and "Stop" (agent-backed tasks only).
- Waiting card: orange border, the question text, and quick-answer buttons when the
  question has options, plus "Reply…".
- Done card: one-line result ("Done: 5 items drafted"), a one-line tail.

### Layout A — Rail (decided by user)

A right-hand column beside the chat (where `BackgroundTasksSidebar` sits today).
Header: "Tasks" and "k of n done". Cards stacked; one selected/expanded at a time.

### Layout B — Tabs (decided by user, as the alternative)

Tabs across the top of the chat: `All` (today's mixed chat) plus one tab per task,
each with status dot, `n/m`, and a thin progress underline. Selecting a task tab
filters the chat to that task's stream and shows a strip under the tabs with the
step pills and the live tail *(the tail placement in B is my call — user didn't
specify)*.

### Setting

`Task view: Rail | Tabs` in Settings, applied live. Default: **Rail** *(my call —
the user picked A first)*.

## What a "task" is

The user said: **either** a background agent **or** a to-do item worked by the
main conversation. Cards look the same either way.

- **Inline task** — worked by the main conversation, one at a time. Its stream is
  the slice of the main chat produced while it was the active task.
- **Agent-backed task** — handed to a background subagent. Its stream is that
  agent's own transcript.

### Steps under a task

Today's to-do data (TaskCreate/TaskUpdate/TodoWrite, rebuilt in
`src/components/Chat/taskRegistry.ts` and `TodoProgress.tsx`) is a **flat list**
with no way to say "these steps belong to task 1". The design needs a grouping.

**My call:** add a dedicated SAI chat tool (on the existing chat-tools MCP, next to
the `sai_*` tools) that the model uses to declare and update task cards with
explicit structure — e.g. create a task with a title and step list, mark the
current step, mark done/failed, attach an agent, post a question. Rationale: a
prefix/naming convention over the flat TaskCreate list is brittle to parse and
easy for the model to drift from; an explicit schema is easier to prompt for and
validate. Exact tool name/schema is left to the builder.

*My call:* the task tool **replaces** TaskCreate/TodoWrite as the step tracker in
Claude SDK chats — one source of truth. The nudge tells the model to use it instead
of the to-do tools. The composer progress ring reads the active card's steps from
the task store. `taskRegistry.ts` keeps rendering TaskCreate/TaskUpdate tool cards
in old chat history.

**Undeclared background work** *(my call — the user's core complaint is work hidden
in agents)*: every background agent, workflow, and shell task the runtime reports
appears in the rail even if the model never declared a card for it. If the model
attached it to a card, it lives inside that card. Otherwise it gets its own
runtime-sourced card (title from the task description, no `n/m`, tail from
transcript for agents / last output for shell). Stop works on all of them. Nothing
the current `BackgroundTasksSidebar` shows may lose its UI.

Fallbacks the rail must still handle:

- Model used plain TaskCreate/TodoWrite instead: show **one** card ("Current work")
  whose steps are that flat list — i.e. today's ring data, rendered as a card.
- Agent-backed task with no declared steps: take steps from the agent's own
  TaskCreate/TodoWrite calls found in its transcript; if none, show no `n/m` and
  an indeterminate bar, with the tail still live.

### Prompt engineering (in scope)

Extend `CHAT_TASKS_NUDGE` (`electron/services/chatNudges.ts`, injected for SDK chats
via `appendSystemPrompt`) so the model:

- creates one card per distinct request when the user asks for several things;
- lays out real steps per card before starting and advances them as it goes;
- marks a card done/failed when it finishes, and attaches the agent when it hands a
  task to a background agent;
- doesn't create cards for single-step or conversational requests.

Must keep the existing nudge's "if the tool isn't registered, say nothing about it"
behavior. The builder should verify this live with multi-request prompts — this is
where "lying progress" is won or lost.

## Open stream — what it shows (decided: full chat view)

The user chose the **full chat view** for isolating a task, on my recommendation:

- "Open stream" (Rail) or selecting a task tab (Tabs) **replaces the chat pane**
  with that task's work rendered with the normal chat components — message bubbles,
  tool cards, thinking blocks — read-only, with a clear "← All" back control and the
  task's title/status in a header.
- **Inline tasks:** the filtered slice of the main chat (positional attribution
  below).
- **Agent-backed tasks:** the agent's transcript JSONL parsed into the app's message
  model and rendered the same way, updating live while the agent runs. This is the
  largest piece of the build.
- *My call:* the composer stays visible and sends to the **main conversation** as
  usual (agents can't be messaged mid-run here). Sending doesn't leave the task
  view; the reply shows up in it only if it's attributed to that task.

## Live tail and isolated stream — data sources

From recon (file:line refs current as of v1.28.6):

- **Agents:** the renderer gets only status, a progress `summary`, and
  `lastToolName` (`electron/services/claudeBackend/backgroundTasks.ts`, folded from
  SDK `task_*` frames in `sdkBackend.ts`). **No subagent output reaches the
  renderer.** Full transcripts exist on disk at
  `~/.claude/projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl` with a
  `.meta.json` carrying `toolUseId` (links to the Agent tool call). The live tail
  and the agent's isolated stream come from **tailing that file in the main
  process** and pushing lines over IPC. Remember the `/home` ↔ `/var/home` symlink
  when building/matching paths.
- **Inline tasks:** no link exists between chat messages and to-do items. Attribute
  messages/tool calls to whichever task was current when they arrived (positional).
  The tail = the last few tool actions/results in that slice.
- Tail lines are short human-readable renderings of tool calls/results ("$ vitest …",
  "read imageStore.ts", "✗ store.gc removes orphans"), not raw JSON.

## Model-declared vs runtime truth *(my call)*

Runtime state wins where the runtime knows better; the rail never lies in the
model's favor:

- Agent/shell finished, failed, or stopped per SDK `task_*` frames → the card (or its
  attached agent) shows that, whatever the model declared.
- A turn ends (or the user interrupts) while an inline card still says running →
  the card shows **paused** (muted, "stopped mid-step"), not done and not running.
  It resumes when the model updates it again.
- App restart mid-task → in-flight cards restore as paused.
- These corrections are **display only**: the rail reads turn/task state and never
  feeds anything back into turn completion, notifications, or the
  working/stuck-state machinery.

## Waiting on you

`AskUserQuestion` is chat-level and background agents can't pause to ask the user.
So a card goes orange when the **main conversation** is blocked on the user while
that card is the current/related task (attribution is the builder's call; the task
tool may let the model tag a question with a task). Quick-answer buttons answer the
existing question flow — they don't invent a new one.

## Lifecycle and persistence (decided by user)

- When tasks finish, done cards **collapse into a summary line** ("3 tasks done ·
  14m"). The summary stays, including after a restart / next morning.
- It **clears when new work starts**. *My call:* "new work" = the model creates the
  first card of a fresh batch. Plain follow-up messages don't clear it.
- Clicking the summary re-expands the finished cards with their final results.
- The rail is **per chat**; switching chats switches the rail.
- With no tasks and no summary, the rail hides (Tabs layout: no tab strip).
- Task state persists with the chat (the existing chat persistence path), not only
  in memory — today's background-task snapshot is in-memory and cleared on finish
  (`sdkBackend.ts`), which won't satisfy this.

## Constraints

- Claude SDK backend only (`App.tsx` already gates the background sidebar on it).
  Claude chats on the `cli` backend opt-out keep today's UI unchanged *(my call)*.
- Reuse the existing right-hand slot (`App.tsx` ~6129, sibling of `.main-content`)
  and the settings path (`window.sai.settingsGet/Set`, `SettingsModal.tsx`; copy the
  `claudeAgentProgressSummaries` toggle pattern).
- The rail supersedes `BackgroundTasksSidebar` for Claude chats rather than living
  next to it. Keep Stop-task behavior.
- Don't store large blobs in chat records (see the IDB clone OOM fix) — persist
  task state and short tail lines, not full agent transcripts.
- Tailing must be cheap: bounded line buffers, stop watchers when tasks end or the
  chat closes. The machine runs heavy apps alongside SAI.
- Theme: existing surface/border/accent CSS variables; `.sai-shimmer` stays the
  app-wide "working" signal.

## Left to the builder

- Name and exact schema of the task tool; IPC shape; where the task store lives.
- How inline-task message attribution is computed and stored.
- Tail line formatting and how many lines; tail refresh throttling.
- Animations (respect reduced motion; see memory notes on StrictMode + imperative
  animations and the failed framer layoutId morph — don't retry that).
- Whether the progress ring in the composer stays, shrinks, or defers to the rail
  when the rail is showing.
- Test strategy (vitest with `--maxWorkers=2`; e2e harness exists).
