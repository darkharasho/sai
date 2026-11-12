# Task feeds — tasks as filtered views of the chat

Date: 2026-11-12 · Status: draft for approval · Supersedes the Rail half of
`2026-11-10-task-rail-design.md`

## Why

Task cards today are "moderately helpful at best". Step lists and progress bars
are low information ("Read files", "2/5"). What the user actually wants from a
task is **what it is doing right now**, not step names. The answer: the "All"
chat stays exactly as it is today, and each task becomes a **filtered view** of
that same chat — its own feed.

## Goals

- **All = today's chat**, unchanged in feel, with each message/tool call carrying
  a small task tag when it belongs to a task.
- **Task tab = filtered view**: the same message rendering as All, showing only
  that task's items. Agent-backed tasks also show the agent's transcript (as
  today's stream view does).
- Tag accuracy: tags are **stamped when output arrives and persisted**, not
  re-guessed from history on every render.
- SAI shapes how the model writes: short running narration before tool batches,
  and an explicit "switching to task X" before work moves between tasks.
- Questions/approvals inside a task show in **both** All and the task tab, and
  the task's tab is flagged (waiting state) until answered.

## Non-goals

- Codex, Gemini, Kimi. Claude SDK chats only, as before.
- Running every task as a subagent (approach 3, rejected).
- Cross-chat task dashboards.

## Anti-goals

- All feeling different from today (new chrome, reordering, condensing).
- Lying tags: work filed under the wrong task with no way to tell.
- Any task state feeding turn completion / notifications / wait state
  (same rule as the rail: display-only).

## Approaches

1. **Stamp the current task at arrival (picked).** The model marks the task it is
   starting with `sai_task`; SAI stamps each incoming message/tool call with the
   active task and persists the tag. Builds on today's attribution, fixes its
   reconstruct-from-history fragility. Risk: model forgets to switch → prompt +
   nudge.
2. Inline `[task]` prefixes in text — rejected: tool calls carry no text, fragile
   parsing, leaks into what the user reads.
3. Every task as a background agent — rejected: token cost, agents can't ask
   questions mid-run (conflicts with questions-in-both), resembles swarm.

User picked 1.

## What the user sees

- **No tasks in a chat → no tab bar.** Identical to today.
- **Tab bar** (existing slot in the Chat accordion bar): `All` + one tab per task.
  Each tab: status dot, title, and a one-line "now" label from the task's latest
  activity (e.g. `running vitest…`). No `n/m`, no progress underline.
- **All**: today's chat. Tagged items get a small task chip (title, task color);
  untagged items (small talk, single-step replies) have none.
- **Task tab**: the All stream filtered to that task's items, same renderer, same
  scroll behavior. Agent-backed task: its tagged main-chat items plus the agent
  transcript.
- **Waiting**: a question/approval tagged to a task renders inline in All and in
  the task tab; the tab shows the waiting (orange) dot until answered.
- **Rail removed**, along with the Rail/Tabs setting. The uncommitted rail
  hide/reopen work in the tree is discarded.

## The model contract (`sai_task` + nudge)

- `create`: one task per distinct request, title only; `steps` becomes optional
  and is no longer displayed.
- `update` with `status: "running"` = "I'm now working on this task" (the switch
  signal). `done`/`failed` with a one-line note as today. `agent` linking as today.
- Nudge rewritten to: mark the task before starting it and whenever switching;
  before each batch of tool calls write one short sentence on what you're about
  to do and why; don't maintain step lists.
- Old chats (no stored tags) keep working through the existing
  `deriveDeclaredCards` attribution as a fallback.

## Data

- New optional field on `ChatMessage` (e.g. `taskId?: string`), persisted with the
  chat. Stamped once when the message is created during streaming, from the
  active task at that moment; never rewritten on re-render.
- Card list/status still folds from `sai_task` calls (declaredCards) + runtime
  merge (taskBoard), minus steps/progress.

## Tagging rules (builder-check answers; *my calls* unless noted)

- **Granularity:** tags are per item — each assistant text segment and each tool
  call carries its own tag (`ChatMessage.taskId` + `ToolCall.taskId`), so a
  message that switches task midway files correctly. The `sai_task` call itself
  belongs to the task it switches *to*.
- **Tag lifetime:** the active task is set by `update … running` and cleared by
  that task's `done`/`failed` or by switching to another task. A new user message
  clears it too, unless it is an answer to a task's pending question/approval, in
  which case the answer is tagged to that task and the tag stays.
- **What can be tagged:** assistant text, tool calls, reasoning rows (follow their
  assistant message), and user answers to a task's question. Ordinary user
  prompts, system/guard rows are never tagged.
- **Id scope:** stored tags are batch-scoped (`<batchStartedAt>:<id>`), so a later
  batch reusing `t1` can't capture old messages. Tab bar shows the current batch
  only, as today.
- **Agent-backed tasks:** the tab interleaves the task's tagged main-chat items and
  the agent transcript by timestamp; "now" label comes from whichever is newer.
- **Questions in both places:** the same question/approval component renders in
  All and in the task tab; answering from either resolves both.
- **Composer on a task tab (user decision):** a message typed while a task tab is
  open is directed at that task — tagged with it, shown in its feed, and sent to
  the model prefixed with context like "About task "<title>": …" so it re-marks
  that task before acting. Typing in All is unchanged.
- **Nudge:** prompt-only for v1 (rewrite `CHAT_TASK_CARDS_NUDGE`); no runtime
  reminder injection. The "one sentence before each tool batch" narration rule
  applies only while tasks exist in the chat.

## Left to the builder

- Where exactly the stamp happens (renderer stream handler vs. backend event) —
  pick the place that sees `sai_task` results in order with other output.
- Chip styling and task colors; composer progress ring behavior once steps are gone.
- Removal of now-dead code (`TaskRail`, `TaskCardView`, step/progress helpers,
  `taskView` setting).
