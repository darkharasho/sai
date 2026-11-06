# Background work sidebar — design

2026-11-05 · darkharasho

## Why

When Claude is waiting on background work, the chat shows a pill:
"Waiting on background work · 4 tasks running · 22s · Cancel". That is all
you get. You can't tell which tasks are running, how far along they are, or
whether one has hung, and the only control you have cancels everything.

The SDK already sends SAI rich per-task data (`task_started`, `task_progress`,
`task_updated`, `task_notification` system frames). Today
`SdkBackend._trackTaskFrame` (`electron/services/claudeBackend/sdkBackend.ts`)
reduces that data to an id→status map, and only the count reaches the pill.
This feature shows the rest.

## What the user wants (their words, condensed)

- A breakdown of the workers: **which tasks they are, how far along each one
  is, and whether one is stuck and worth cancelling.** All three matter.
- **Clicking the pill expands a right sidebar with one card per task.**
- The sidebar is **its own column**. It does not share or replace the code
  panel's space. The user first said "between chat and code panel", but in
  SAI chat, editor and terminal are stacked vertically in `.main-content`.
  Shown that, they chose **a full-height column on the right edge of the
  window, next to the whole chat/editor/terminal stack**.
- When a task finishes: **a small animation to show it finished, then it moves
  into the Finished section.**
- They approved the mockup (rendered in-session; layout described below).

## Goals

1. Clicking the background-wait pill toggles a sidebar showing every
   background task for that chat.
2. Each card answers: what is this, what is it doing now, how long and how
   much has it cost, has it gone quiet.
3. Stop a single task from its card.
4. Finishing is visible: a brief done animation, then the card moves to
   Finished.

## Non-goals

- The CLI backend (`claudeBackend=cli`). It has no task-frame source, so the
  pill stays as it is there (no click, no sidebar).
- Codex, Gemini, Kimi or other providers.
- Swarm/orchestrator task views. They have their own UI.
- Showing a task's full transcript or output inside the card. Opening the
  output file can come later.
- Keeping task history across app restarts.
- A way into the sidebar when only shell tasks remain. In that case
  `onlyShellTasksLive` (sdkBackend.ts) turns the wait into `kind: 'none'` and
  there is no pill. The user accepted pill-only for now; this may be a
  follow-up.
- Changing the vertical chat/editor/terminal accordion layout.

## Anti-goals (would make this a failure even if it works)

- The sidebar's state influencing the wait/completion logic. The ledger in
  `_trackTaskFrame` and the wait classifier stay the only source of truth for
  "is Claude still waiting". This feature only *reads* task data; it must not
  add new paths that can flip a turn to done or keep it pinned. That area has
  regressed several times; see the wait/background-drain history.
- A Stop button that stops the wrong task, or stops the whole turn.
- Animation that runs continuously while idle (an earlier always-on gradient
  animation pinned the GPU at 100%). Per-card animations run once and stop;
  idle loops must respect `prefers-reduced-motion`.

## Layout (approved mockup)

**Pill** (`src/components/Chat/WaitingIndicator.tsx`): it becomes clickable
when per-task data exists, with a hover state and a small ▸ chevron. The
chevron points ◂/▸ to show whether the sidebar is open. Cancel stays and still
cancels everything.

**Sidebar**: a full-height column on the right edge of the window, as a
sibling to the right of `.main-content` (the vertical chat/editor/terminal
stack). It is about 380px wide, with a `surface-0` background and a left
border in `border-strong`. Opening it narrows the whole stack; the stack's
vertical split math stays untouched. It still shows in `focusedChat` mode.

- Header: "Background work", then a mono subline "N running · M done", then a
  × close button.
- A scrolling list of cards, running tasks first, then a "FINISHED" section
  label, then finished cards (dimmed).

**Card**, top to bottom:

1. A status dot (accent = running, red = possibly stuck, green = done or
   failed-colored for failure), the task description (ellipsized) and a kind
   tag in mono (`subagent_type` such as `Explore` / `general-purpose`, else
   `task_type` such as `shell` / `workflow`; for workflows use
   `workflow_name`).
2. A "Now" line:
   - For agents, the latest `task_progress.summary`, falling back to
     "Now: `<last_tool_name>`".
   - For shell tasks, "Running".
   - When quiet, "No updates for Xm Ys".
3. A mono stats row: elapsed (from task start, ticking), tokens (`usage.total_tokens`),
   tool calls (`usage.tool_uses`), "updated Ns ago". Omit any field the task
   never reported.
4. A Stop button, right-aligned. On a stuck card it is red, next to
   "⚠ Quiet for 2m — may be stuck".

**Finished cards** show the dot, name and tag, then the result line
(`task_notification.summary`, or "Failed: …" / "Stopped"), then the final
elapsed time. They have no Stop button.

## Behavior

- **Opening and closing:** click the pill or ×. The sidebar belongs to the
  chat whose pill was clicked. Switching to another chat shows that chat's
  tasks, or closes the sidebar if that chat has none.
- **Done animation:** when a task reaches a terminal state, its card first
  shows the done state in place: the dot turns green with a check (red ✕ for
  failed, grey for stopped) and the card flashes briefly. Then the card
  slides into the Finished section. The whole thing takes under ~1s, plays
  once and respects `prefers-reduced-motion` (no slide, just a state swap).
- **When the wait ends** (Claude resumes, the pill disappears): the sidebar
  stays open if it was open, with everything under Finished, until the user
  closes it. This is my call; the user didn't object. Finished tasks are
  cleared when the next background wait starts in that chat.
- **"Possibly stuck":** a running **agent** task (one that has sent
  `task_progress` at least once, or has a `subagent_type`) with no task frame
  for 2 minutes. Shell tasks never get the hint: they don't send progress
  frames, so every shell would read as stuck. This is a display hint only and
  stops nothing automatically. The 2-minute threshold and the shell exemption
  are my calls; keep the threshold a single constant.
- **Which tasks appear** (my call): every task with a frame from the moment
  the background wait starts, including tasks still running from earlier in
  the turn. While the sidebar is open, tasks that start in the resumed turn
  also appear live. When the next background wait starts, finished cards are
  cleared and running ones are kept.
- **Pill count** (my call): when per-task data exists, the pill's "N tasks
  running" uses the live running count from the same store as the sidebar,
  so the two never disagree. It is display only: the wait decision still
  uses `stopBackgroundTaskCount` and the ledger, unchanged.
- **Stop:** calls the SDK's per-task `query.stopTask(taskId)` through a new
  IPC. The card shows "Stopping…" until the `task_notification` with
  `stopped` arrives, and then it animates out like any other finish.

## Constraints

- SDK types are in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
  (`SDKTaskStartedMessage`, `SDKTaskProgressMessage`, `SDKTaskUpdatedMessage`,
  `SDKTaskNotificationMessage`, `Query.stopTask`).
- Tasks marked `skip_transcript` are housekeeping. The SDK says they "may still
  appear in a tasks panel"; hide them by default (my call).
- Background work spans turns, so per-task detail must survive turn
  boundaries, just as `liveTasks` deliberately does.
- Follow existing styling: CSS variables (`--surface-*`, `--accent`,
  `--border-*`, Geist Mono for numbers), matching `WaitingIndicator`.
- vitest runs with `--maxWorkers=2`.

## Left to the builder

- How task detail reaches the renderer (a new IPC event, or enriching an
  existing message stream) and where the per-chat task store lives.
- Component structure, file names, and exact animation curves/timings within
  the limits above.
- How to unit-test the frame→card reducer and the sidebar (a reducer test plus
  a component test at minimum; no e2e required).
