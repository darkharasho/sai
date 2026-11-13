# Task Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each `sai_task` task into a filtered view (feed) of the same chat. Tags are stamped on messages and tool calls when they arrive, and saved with the chat. The step/progress rail is removed.

**Architecture:**
- **Tags:** one fold, `deriveDeclaredCards`, decides which task every new item belongs to. A stamper in ChatPanel's single `setMessages` choke point writes that answer onto *new* items once (`ChatMessage.taskId` / `ToolCall.taskId`). Stored tags win from then on; old chats with no stored tags fall back to the fold's computed tag.
- **Views:** a task tab renders `filterMessagesForTask(...)` through the same `ChatMessage` renderer as All. Agent-backed tasks merge in their subagent transcript.
- **Removals:** the rail, steps, progress and the Rail/Tabs setting are deleted.

**Tech Stack:** Electron + React 18 + TypeScript, Vitest + Testing Library, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-12-task-feeds-design.md`

## Global Constraints

- Claude SDK chats only. The task UI stays gated by `taskUiEnabled` (`aiProvider === 'claude' && claudeBackendSetting !== 'cli'`, `src/App.tsx:1020`). Codex, Gemini and Kimi are untouched.
- Display-only: no task state may feed turn completion, notifications, wait state or `isStreaming`.
- All must look and behave like today. The only addition is a small task chip on tagged items. No new chrome, no reordering, no condensing.
- No tasks in the chat means no tab bar, exactly as today.
- Stored tags are batch-scoped strings: `` `${batchStartedAt}:${id}` ``.
- A stored tag is written once, when the item first appears, and is never rewritten afterwards. `null` means "stamped, no task". `undefined` means "legacy, never stamped".
- Ordinary user prompts and system/guard rows are never tagged. The exceptions are a reply typed while a tagged question is pending, and a message typed on a task tab.
- Vitest: always `npx vitest run --maxWorkers=2`.
- Subagents never `git checkout <sha>`; use `git show`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An old chat (no stored tags) is reopened and continued.** Old items keep their computed attribution, new items get stored tags, and the tabs show only the current batch. Test: Task 3 `mixed legacy and stamped history`.
2. **The final `result` frame replaces the last bubble's text.** The bubble keeps the tag it was stamped with. Test: Task 2 `result replacement keeps the tag`.
3. **Frames buffered while the panel was unmounted are drained at once.** Several new messages arrive in one update and are stamped in order, each with the task active at its position. Test: Task 2 `stamps a multi-message drain in order`.
4. **The model creates tasks but never marks one running.** Every item stays untagged, and a task tab shows a clear empty state rather than a blank pane. Test: Task 5 `empty feed message`.
5. **A later batch reuses id `t1`.** Old `t1` items never appear in the new `t1` tab. Test: Task 1 `batch-scoped tags`.

---

### Task 1: The fold computes per-item tags; `steps` becomes optional

**Files:**
- Modify: `src/types.ts`. Add `taskId?: string | null` to `ChatMessage` and to `ToolCall`, with a doc comment covering string/null/undefined.
- Modify: `src/lib/saiTaskTool.ts`.
  - Tool schema: `steps` is no longer required; `required: ['id', 'title']`.
  - `validateSaiTaskInput` accepts a task without `steps`, but rejects a non-array `steps`.
- Modify: `src/components/Chat/tasks/declaredCards.ts`
- Modify: `src/components/Chat/ToolCallCard.tsx`. Its local `TaskCardView` must render a `create` with no `steps` without throwing.
- Test: `tests/unit/components/Chat/tasks/declaredCards.test.ts`, `tests/unit/lib/saiTaskTool.test.ts` (create it if absent)

**Interfaces:**
- Produces:
  - `export function taskTag(batchStartedAt: number, id: string): string` returns `` `${batchStartedAt}:${id}` ``.
  - `export function itemKey(messageId: string, toolCallId?: string): string` returns `messageId` for message-level text, and `` `${messageId}#${toolCallId}` `` for a tool call. Tool calls without an id use `` `${messageId}#${index}` ``; the fold and the stamper must agree on this.
  - `DeclaredCards` gains `tags: Map<string, string | null>` (an entry for every taggable item in history) and `activeTag: string | null` (the tag that would apply to the next arriving item).
  - The existing `activeCardId` and `cards[].messageIds` stay, and are now derived from `tags`.

**Tagging rules (spec "Tagging rules"):**
- Walk the messages in order.
- **`sai_task` update, `status: "running"`, or a bare update:** sets active to that task. The `sai_task` call item itself is tagged with the task it switches **to**.
- **`done`/`failed` on the active task:** clears active. The finishing call is tagged to that task.
- **`create`:** does not change active. Its item takes the current active tag.
- **Assistant text, reasoning rows and other tool calls:** take the current active tag.
- **A stored `taskId` overrides the fold.** If an item already has a `taskId` (string or null), the fold uses the stored value for that item. If it is a user message with a string tag, active becomes that tag.
- **A user message** with no stored tag:
  - If the latest `AskUserQuestion`, or a plan-review tool call, has `output === undefined` and a non-null tag, the message gets that tag and active stays.
  - Otherwise it gets `null` and active becomes `null`.
- **System rows:** always `null`, and they never change active.
- The batch-reset rules in today's fold are unchanged. A new batch clears active.

- [ ] **Step 1: Write the failing tests** in `declaredCards.test.ts`, using the existing message builders in that file:
  - `tags the sai_task switch call with the task it switches to`: create t1, t2; update t2 running. Expect `tags.get(key(updateCall)) === taskTag(batch,'t2')`.
  - `per-item granularity`: one assistant message whose tool calls are `[Bash, sai_task update t2 running, Read]` after t1 was running. Expect the Bash tag to be t1, and the sai_task and Read tags to be t2.
  - `user message clears the active task`: t1 running, then a user message, then assistant text. Expect the text tag to be `null`.
  - `reply to a tagged pending question keeps the task`: t1 running, an AskUserQuestion with no output, then a user message, then text. Expect the user message and the text both tagged t1.
  - `done clears; switching moves`: t1 running, then t1 done, then text. Expect `null`.
  - `batch-scoped tags`: batch A has t1 running plus text; all done; a user message; batch B creates t1 and marks it running, plus text. The two texts' tags differ, and each starts with its own batch's `batchStartedAt`.
  - `stored tags win`: text with a stored `taskId: null` while t1 is active. Expect `tags.get(text) === null`.
  - `steps optional`: a create without `steps` yields a card and doesn't throw.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/unit/components/Chat/tasks/declaredCards.test.ts`. Expect the new cases to FAIL.
- [ ] **Step 3: Implement** the rules above in `deriveDeclaredCards`. Make the type and schema changes. In `saiTaskTool.test.ts`, assert `validateSaiTaskInput({action:'create',tasks:[{id:'t1',title:'A'}]}).ok === true`, and that `steps:'x'` is rejected.
- [ ] **Step 4: Run** both test files plus `tests/unit/components/Chat/tasks/taskBoard.test.ts`. Expect PASS.
- [ ] **Step 5: Commit** `feat(tasks): compute batch-scoped per-item task tags; steps optional`

### Task 2: Stamp tags at arrival

**Files:**
- Create: `src/components/Chat/tasks/taskTags.ts`
- Modify: `src/components/Chat/ChatPanel.tsx:480-484`, the `setMessages` wrapper.
- Test: `tests/unit/components/Chat/tasks/taskTags.test.ts`

**Interfaces:**
- Consumes: `deriveDeclaredCards(...).tags`, `itemKey`.
- Produces: `export function stampTaskTags(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[]`.
  - It stamps only items that are new relative to `prev`: messages whose id is not in `prev`, and tool calls whose `itemKey` is not in `prev`.
  - It sets `taskId` from the fold's `tags`, and only where the item's `taskId === undefined`.
  - **Pass-through cases:** return `next` unchanged (same reference) when nothing is new; when the update doesn't keep `prev`'s ids as a prefix of `next`'s (a session load or switch); or when the fold throws.
  - New items in a fresh chat (`prev` empty) are stamped.

- [ ] **Step 1: Write the failing tests:**
  - `stamps a new tool call with the active task`
  - `does not rewrite an existing tag when later history would change it`: stamp text under t1; then a later message creates a new batch. The earlier text still has its original tag.
  - `session load is not stamped`: `prev` has ids [a,b], `next` has [x,y]. Expect `next` returned unchanged, with its tags still `undefined`.
  - `stamps a multi-message drain in order` (Review Focus 3): three new messages in one update; the middle one is a `sai_task` switch to t2. Expect tags [t1, t2, t2].
  - `result replacement keeps the tag` (Review Focus 2): a last message with `taskId:'1:t1'`; `next` replaces its content (same id). Expect the tag unchanged.
  - `returns the same reference when nothing is new`: a delta append to the last bubble.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/unit/components/Chat/tasks/taskTags.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement `stampTaskTags`.** Call it in the wrapper, `next = stampTaskTags(messagesRef.current, next)`, only when `taskUiEnabled`. Keep the wrapper's eager-ref ordering: stamp first, then `messagesRef.current = next`.
- [ ] **Step 4: Run** the new test file and `tests/unit/components/Chat/ChatPanel*.test.tsx`. Expect PASS.
- [ ] **Step 5: Commit** `feat(tasks): stamp task tags onto messages as they arrive`

### Task 3: Board and feeds without steps

**Files:**
- Create: `src/components/Chat/tasks/taskFeed.ts`
- Modify: `src/components/Chat/tasks/types.ts`, `taskBoard.ts`, `useTaskBoard.ts`
- Test: `tests/unit/components/Chat/tasks/taskFeed.test.ts`, `taskBoard.test.ts`, `tests/unit/components/Chat/tasks/useTaskBoard.test.ts` (create it if absent)

**Interfaces:**
- Consumes: Task 1's `tags`/`taskTag`/`itemKey`, and stored `taskId`s.
- Produces:
  - **`TaskCard` changes:** drop `steps`, `doneCount`, `totalCount` and `currentLabel`. Add `tag: string` (`taskTag(batchStartedAt, id)`, or the runtime/fallback id for non-declared cards) and `now: string | null`.
  - **`export function effectiveTag(stored: string | null | undefined, computed: string | null | undefined): string | null`:** the stored tag if `!== undefined`, else the computed tag, else `null`.
  - **`export function filterMessagesForTask(messages: ChatMessage[], tag: string, computed: Map<string, string | null>): ChatMessage[]`:**
    - It keeps messages whose message-level tag matches, or that have at least one matching tool call.
    - On a kept message, it drops tool calls with other tags, and empties `content` and `reasoning` when the message-level tag doesn't match.
    - It returns new objects and never mutates its input.
  - **`export function mergeFeed(tagged: ChatMessage[], transcript: ChatMessage[] | null): ChatMessage[]`:** a stable merge by `timestamp`.
  - **`export function nowLabel(feed: ChatMessage[]): string | null`:** the last `buildTailLines(feed, 1)` line's text, with `…` appended when its tone is `live`.
  - **`TaskBoardState`:** drop `todos`, `tails` and `streamMessages`. Add `feed(card: TaskCard): ChatMessage[] | null`; `null` means use `streamFallback`, which is unchanged. Add `todos: Todo[] | null | undefined`, now one todo per card: `done`/`failed` map to `completed`, `running`/`waiting` to `in_progress`, everything else to `pending`.
  - **`UseTaskBoardArgs`** gains `pendingApprovalToolUseId: string | null`.
  - **Waiting:** a card becomes `waiting` when the pending AskUserQuestion's tool call, or the pending approval's tool call, has that card's tag. This replaces today's "active inline card" guess in taskBoard Rule 3.

- [ ] **Step 1: Write the failing tests:**
  - `taskFeed.test.ts`:
    - `filters a mixed message to the task's tool calls`
    - `keeps items whose only tag is computed (legacy)`
    - `mergeFeed interleaves by timestamp`
    - `nowLabel marks a running tool with an ellipsis`: a Bash `npx vitest run` with no output gives `'$ npx vitest run…'`.
  - `useTaskBoard.test.ts`:
    - `mixed legacy and stamped history` (Review Focus 1): legacy batch A with undefined tags, then stamped batch B. The board shows only B's cards, and B's feed has only B items.
    - `approval on a tagged tool call marks that card waiting`
    - `todos are one per card`
  - Update `taskBoard.test.ts` cases that assert steps or counts to the new shape.
- [ ] **Step 2: Run** these three files. Expect FAIL.
- [ ] **Step 3: Implement.** Agent-backed cards: `feed = mergeFeed(filterMessagesForTask(...), transcript.messages)`. Non-agent cards: `feed = filterMessagesForTask(...)`. A missing or unavailable transcript keeps today's fallback order. Remove `stepsFromTranscript` and `stepsToTodos`.
- [ ] **Step 4: Run** the files from Step 2, then `npx tsc --noEmit -p .`. Expect PASS, and tsc errors only in files Tasks 4–5 rewrite (TaskRail, TaskCardView, TaskTabs, TaskStreamView, ChatPanel). List them in the report.
- [ ] **Step 5: Commit** `feat(tasks): feeds and now-labels replace steps and progress`

### Task 4: Remove the rail and the Rail/Tabs setting

**Files:**
- Delete:
  - `src/components/Chat/tasks/TaskRail.tsx`
  - `TaskRailReopen.tsx`
  - `TaskCardView.tsx`
  - `tests/unit/components/Chat/tasks/TaskRail.test.tsx`
- Create: `src/components/Chat/tasks/formatElapsed.ts`. Move `formatElapsed(ms: number): string` here unchanged, and update the importers `batchSummary.ts` and `TaskStreamView.tsx`.
- Modify:
  - **`src/App.tsx`:** remove the `taskView` and `taskRailHidden` state (L396-402), the settings loads (L1269-1270), the props (L3382-3384) and the setting-change cases (L3961-3962).
  - **`src/components/SettingsModal.tsx`:** remove the Rail/Tabs control (`taskView` state L113, load L298, save L535-536, control ~L1392).
  - **`ChatPanel.tsx`:**
    - Remove the `taskView`, `taskRailHidden` and `onTaskRailHiddenChange` props.
    - Remove `showTaskRail`, `showRailReopen`, `hiddenRailStatus`, `selectedTaskId`/`handleTaskSelect` and the `chat-panel--task-rail` class.
    - Tabs show whenever `showTaskUi`.
  - **`tasks.css`:** drop the rail and card-only rules.
- Test: `tests/unit/components/SettingsModal*.test.tsx`, `tests/unit/components/Chat/ChatPanelTaskRail.test.tsx`. Rename the latter to `ChatPanelTaskFeeds.test.tsx`; its cases are rewritten in Task 5, and this task only deletes the rail cases.

- [ ] **Step 1: Write the failing test** `SettingsModal has no task view setting`: render the modal and expect `queryByText(/Rail/)` to be null.
- [ ] **Step 2: Run** it. Expect FAIL.
- [ ] **Step 3: Delete and edit** as listed. `git grep -n -E 'TaskRail|taskRailHidden|taskView|TaskCardView' -- src tests` must return nothing. Matches inside `ToolCallCard.tsx`'s *local* `TaskCardView` function are allowed; rename it to `SaiTaskToolCard` to keep the grep clean.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .` and `npx vitest run --maxWorkers=2 tests/unit/components`. Expect no rail references; only TaskTabs/TaskStreamView/ChatPanel feed errors are left for Task 5.
- [ ] **Step 5: Commit** `refactor(tasks): remove the task rail and Rail/Tabs setting`

### Task 5: Tabs with "now", feeds through the same renderer, and chips in All

**Files:**
- Modify:
  - `src/components/Chat/tasks/TaskTabs.tsx`
  - `TaskStreamView.tsx`, renamed to `TaskFeedView.tsx` (`git mv`)
  - `src/components/Chat/ChatPanel.tsx` (render ~L2610-2660, message list)
  - `tasks.css`
- Create: `src/components/Chat/tasks/TaskChip.tsx`
- Test: `tests/unit/components/Chat/tasks/TaskTabs.test.tsx`, `TaskFeedView.test.tsx`, `TaskChip.test.tsx`, `tests/unit/components/Chat/ChatPanelTaskFeeds.test.tsx`

**Interfaces:**
- Consumes: `TaskBoardState.feed`, `card.now`, `card.tag`, `effectiveTag`, and the fold's `tags`.
- Produces:
  - **`TaskTabs`:** same props. Each tab shows the status dot, the title, and `card.now` as `.task-tabs__now`. There is no `n/m` and no underline. The finished-batch collapse/dismiss behavior is unchanged.
  - **`TaskFeedView`**, props `{ card, feed: ChatMessage[] | null, fallback, onBack, renderMessage, onStop }`:
    - The header has back, dot, title and Stop, as today.
    - There are no pills and no tail.
    - The body renders `feed` with `renderMessage`, which is the same `renderTaskMessage` (ChatMessage) All uses.
    - The scroll-stick behavior is unchanged.
  - **`TaskChip`**, props `{ title: string; colorIndex: number }`: renders `<span className="task-chip task-chip--c{colorIndex % 6}">{title}</span>`.
  - **Chip placement (my call):** ChatPanel computes `chipBefore: Map<messageId, {title, colorIndex}>`. A message gets a chip when its first tagged item's effective tag is non-null, belongs to a current-batch card, and differs from the effective tag of the previous tagged item. The chip renders above the message in the All list. `colorIndex` is the card's index in `board.cards`.

- [ ] **Step 1: Write the failing tests:**
  - `TaskTabs`:
    - `shows the now label and no progress`: given `now: '$ npx vitest run…'`, the text is present, and `n/m` and `.task-tabs__underline` are absent.
  - `TaskFeedView`:
    - `renders feed through renderMessage`
    - `empty feed message` (Review Focus 4): with a `running` card and feed `[]`, it shows `Nothing filed under this task yet`.
  - `TaskChip`: `renders title with color class`.
  - `ChatPanelTaskFeeds`:
    - `no tasks → no tab bar`
    - `All shows a chip at a task boundary only`: two consecutive t1 messages get one chip.
    - `opening a tab shows only that task's items`
    - `a tagged pending question renders in All and in the task tab, and the tab dot is waiting`
    - `pending approval UI stays visible while a task tab is open`
- [ ] **Step 2: Run** these test files. Expect FAIL.
- [ ] **Step 3: Implement.** Wire `taskBoard.feed(openTaskCard)` into `TaskFeedView`. Pass `pendingApprovalToolUseId: pendingApproval?.toolUseId ?? null` to `useTaskBoard`. Keep All's markup unchanged apart from the chip element.
- [ ] **Step 4: Run** the Step 2 files, `npx tsc --noEmit -p .` (expect exit 0) and the full `npx vitest run --maxWorkers=2` (expect all pass).
- [ ] **Step 5: Commit** `feat(tasks): task tabs open filtered feeds; task chips in All`

### Task 6: Typing on a task tab is directed at that task

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`, `handleSend` (~L2289-2410; the prompt is built at L2402).
- Test: `tests/unit/components/Chat/ChatPanelTaskFeeds.test.tsx`

**Interfaces:**
- Consumes: `openTaskCard` (with `title` and `tag`).
- Produces: `export function directAtTask(prompt: string, title: string): string` in `src/components/Chat/tasks/taskFeed.ts`. It returns `` `About task "${title}": ${prompt}` ``.

- [ ] **Step 1: Write the failing tests:**
  - `message typed on a task tab is tagged and prefixed`: open the t1 tab and send `fix it`.
    - The new user message has `taskId === card.tag` and `content === 'fix it'`.
    - `window.sai.claudeSend` is called with a prompt equal to `directAtTask(<prompt as today>, 'Build login')`.
    - The message shows in the t1 feed.
  - `typing in All is unchanged`: the user message `taskId` is `null` and the prompt has no prefix.
- [ ] **Step 2: Run** it. Expect FAIL.
- [ ] **Step 3: Implement.** When `openTaskCard` is set and `taskUiEnabled`, create the user message with `taskId: openTaskCard.tag` and wrap only the outgoing prompt. Queued messages (`handleQueue`) are unchanged.
- [ ] **Step 4: Run** the test file. Expect PASS.
- [ ] **Step 5: Commit** `feat(tasks): messages typed on a task tab go to that task`

### Task 7: Model contract (nudge and tool description)

**Files:**
- Modify: `electron/services/chatNudges.ts` (`CHAT_TASK_CARDS_NUDGE`), `src/lib/saiTaskTool.ts` (the tool `description`, plus the `steps`/`step`/`add_steps` property descriptions)
- Test: `tests/unit/electron/chatNudges.test.ts`, `tests/unit/lib/saiTaskTool.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - For `CHAT_TASK_CARDS_NUDGE`:
    - It contains `status "running"`, `switch`, `one short sentence` and `only while`.
    - It does not match `/real steps|step index|step = index/`.
  - For the tool description: it does not contain `its real steps`, and it contains `optional`.
- [ ] **Step 2: Run** it. Expect FAIL.
- [ ] **Step 3: Rewrite.** Exact nudge copy:

  > When the user asks for several things in one message, or for multi-step work (3+ distinct steps, refactors, features, debugging sessions), track it with the sai_task tool: call it with action "create" BEFORE starting, one task per distinct request, title only. Mark a task with update status "running" right before you start it and whenever you switch to a different task — SAI files everything you say and every tool you run under the task you last marked, and each task gets its own feed the user can open. Set "done" with a one-line note when a task finishes, "failed" with the reason if it can't be finished. Don't maintain step lists. Only while a chat has tasks: before each batch of tool calls, write one short sentence saying what you're about to do and why. When you hand a task to a background agent, pass agent = the exact description you gave the Agent call. Use sai_task instead of TaskCreate/TodoWrite. If the tool is deferred, load it via ToolSearch first. Skip it for single-step or conversational requests, and if the tool is not registered in this session, just do the work and do not mention the tool or its absence.

  The tool description gets the same contract in tool voice. `steps`, `step` and `add_steps` stay accepted, described as "optional, not displayed".
- [ ] **Step 4: Run** both test files. Expect PASS.
- [ ] **Step 5: Commit** `feat(tasks): nudge for task switching and short narration`

### Task 8: End-to-end verification

**Files:** none (fix forward in the file that owns the failure).

- [ ] **Step 1: Run** `npx tsc --noEmit -p .` and `npx vitest run --maxWorkers=2`. Expect exit 0 and all tests passing.
- [ ] **Step 2: Run** `npm run build`. Expect success.
- [ ] **Step 3: Run** `npx playwright test`. Expect PASS, apart from the known pre-existing `background-work-sidebar.spec.ts` failure (it also fails on main).
- [ ] **Step 4: Dev smoke** with the `run` skill, on a Claude SDK chat:
  - Ask for two things.
  - The tab bar appears with All plus two tabs, each with a moving "now" label.
  - All looks like today, plus chips.
  - Opening a tab shows only that task's items.
  - Typing on a tab sends `About task "…": …`.
  - Settings has no Rail/Tabs control.
  - Report any check you can't drive as SKIPPED, with the reason.
- [ ] **Step 5: Commit** any fix-forward changes.
