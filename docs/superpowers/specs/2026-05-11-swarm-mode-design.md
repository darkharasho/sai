# Swarm Mode — Design

**Status:** Approved design, ready for implementation planning
**Date:** 2026-05-11
**Scope:** New feature — concurrent task orchestration within a workspace

## Summary

Swarm mode lets a user dispatch and supervise N concurrent AI tasks against the same project. Each task is a full chat session running in its own lazily-created git worktree, isolated from the main working tree. A chattable orchestrator manages the swarm: it spawns tasks (single or batch), handles approvals, lands finished work, and answers natural-language questions about swarm state. The feature is per-workspace and ships as a new left-nav surface; existing single-chat behavior is unchanged.

## Goals

- Run multiple AI tasks concurrently against the same project without filesystem conflicts.
- Keep awareness of all active tasks at a glance while driving one at a time.
- Provide a meta-agent ("orchestrator") that can manage the swarm via chat in addition to direct UI actions.
- Reuse SAI's existing chat session, approval, and worktree primitives — don't reinvent chat.

## Non-Goals (v1)

- Cross-task awareness (one task reading another's outputs).
- Stacked / auto-rebased review chains.
- Dedicated "planner" agent that decomposes a goal into child tasks (orchestrator chat covers the manual version).
- Auto-merge policies — manual landing only; orchestrator can land on user request.
- Cross-workspace swarm overview.

## Core Concepts

### SwarmTask

A SwarmTask wraps an existing SAI chat session and adds orchestration metadata.

```ts
type SwarmTaskStatus =
  | 'queued'              // accepted, waiting for a streaming slot
  | 'streaming'           // currently running
  | 'awaiting_approval'   // paused on a tool call requiring approval
  | 'paused'              // user-paused
  | 'done'                // model said it's done; not yet landed
  | 'failed'              // errored out
  | 'landed'              // merged into the workspace branch
  | 'discarded';          // user discarded, worktree removed

type ApprovalPolicy = 'auto' | 'auto-read' | 'always-ask';

interface SwarmTask {
  id: string;
  workspaceId: string;
  sessionId: string;          // existing SAI chat session id
  title: string;              // auto-generated from prompt, user-editable
  prompt: string;             // the dispatched prompt
  provider: 'claude' | 'codex' | 'gemini';
  model: string;
  approvalPolicy: ApprovalPolicy;
  status: SwarmTaskStatus;

  branch: string;             // e.g. swarm/refactor-auth-a3f2
  worktreePath: string | null;// null until first write tool call

  createdAt: number;
  lastActivityAt: number;
  costEstimate: number;
  toolCallCount: number;
  pendingApprovals: ToolCallApproval[];
}
```

Tasks are stored alongside chat sessions (extend `chatDb`) so resume-on-relaunch reuses existing infrastructure.

### Orchestrator

The orchestrator is itself a chat session with `kind: 'orchestrator'`, one per workspace. It has tools:

- `spawn_task(prompt, opts?)` — creates a new SwarmTask.
- `spawn_tasks(prompts[], opts?)` — batch spawn.
- `query_status(taskRefOrFilter?)` — read swarm state.
- `pause_task(taskRef)`, `resume_task(taskRef)`.
- `approve_tool_call(approvalRef, opts?)`, `deny_tool_call(approvalRef)`.
- `land(taskRef)` — fast-forward merge or surface conflicts.
- `discard(taskRef)` — remove branch and worktree.

The orchestrator's composer accepts both **prompts** (becomes one or more tasks) and **commands** (orchestrator reasons + uses tools). The orchestrator decides; there is no mode toggle. The "split lines into separate tasks" toggle controls only the prompt path.

The orchestrator's provider and model are independently configurable per workspace.

### Concurrency

A `concurrencyCap` (default 5, configurable in Settings → Swarm) limits how many tasks may be in `streaming` state at once per workspace. Excess tasks sit in `queued` and start as slots free. Tasks in `awaiting_approval` and `paused` do not consume a slot.

## UI

### Left Nav

A new ⚡ **Swarm** icon. Badge shows the count of pending approvals across the active workspace's swarm. Single-chat users who never click it see no UX change anywhere else.

### Swarm Sidebar

Opens when the ⚡ icon is clicked, replacing whichever sidebar is currently open (consistent with Files/Search/Git behavior).

- **Pinned row at top:** "Swarm Overview" (orchestrator) with aggregate counts.
- **TASKS section:** scrollable list of task rows. Each row shows title, status sub-line, status icon, color-coded left border (gold = streaming, red = approval, green = done/ready, gray = paused/queued).
- **+ NEW** button in the sidebar header opens a quick-dispatch popover (single prompt + provider/model). Batch dispatch happens in the orchestrator.

Clicking a row swaps the main panel.

### Main Panel — Orchestrator View

Selected when "Swarm Overview" is the active sidebar row.

Top to bottom:

1. **Header:** "Orchestrator · <workspace>", aggregate counts (active / approvals / ready / cost / runtime), provider/model picker.
2. **Chat stream:** orchestrator chat history. Tool calls render as tool-result cards (spawned task references, status queries, approvals).
3. **Approval tray** (only when approvals exist): expandable strip with per-approval rows (task, tool call, view/deny/approve buttons). "Approve all reads" and "Deny all" shortcuts in the header.
4. **Ready-to-land tray** (only when ready tasks exist): collapsed peek by default, expandable. Each entry shows task title, branch, diff stats, with Diff / Discard / Land buttons.
5. **Composer:** single multi-line input. Toggles: `split lines into separate tasks`, `provider`, `model`. `@` mentions a task by name.

Tray buttons are equivalent to typing the corresponding command (e.g., clicking Approve is identical to the orchestrator calling `approve_tool_call`); both paths append a message to the orchestrator chat for auditability.

### Main Panel — Task View

Selected when a task row is the active sidebar row.

The existing SAI chat panel, pointed at the task's session, with a thin task-context sub-header above it: branch, worktree path (or "no worktree yet" for read-only tasks), and actions (⏸ pause, ⤴ open diff, ⊟ pop out, ⋯ menu with discard/rename/change approval policy). The composer below is the same as today's chat composer, steering this task.

## Worktree Mechanics

- **Spawn:** allocate a branch name `swarm/<kebab-slug-of-title>-<shortid>` from the workspace branch's current HEAD. **Do not materialize a worktree.**
- **Lazy materialization:** on first write-classified tool call, create a git worktree at `<project>/../.sai-swarm/<workspaceId>/<taskId>/` (sibling to the project, not inside) and re-point the task's CWD to it.
- **Read-only tasks:** never materialize. Run with CWD = the main project tree. Cheap, no merge step needed at "done."
- **Landing:** orchestrator runs `git fetch` (if remote exists), checks for fast-forward against the current workspace branch.
  - Clean FF → merges, deletes the worktree, transitions task to `landed`.
  - Conflict → leaves the worktree in place, marks task as ready-with-conflicts, surfaces a one-click "rebase onto workspace branch" action that runs in the task's chat with the model assisting.
- **Discard:** deletes the worktree and the branch (after confirmation), transitions task to `discarded`.
- **Worktree path** is stored on the SwarmTask record so resume-on-relaunch finds it.

The orchestrator does not itself merge inside the user's working tree without the user explicitly asking — auto-merge is out of scope for v1.

## Approvals

Each task has an `approvalPolicy` set at dispatch time, defaulting from a workspace-level setting:

- `auto` — never asks (allowed but not default).
- `auto-read` — auto-approves read-only tools; pauses on writes outside the worktree, `bash`, and network calls. **Default.**
- `always-ask` — every tool call requires approval.

When a task hits a tool call that requires approval, it transitions to `awaiting_approval`, frees its concurrency slot, and pushes a row into the orchestrator's approval tray. The task's sidebar row and the ⚡ nav icon both badge.

Approvals can be resolved by:
- Clicking buttons in the approval tray.
- Focusing the task and approving in its chat sub-header (same UX as today's per-chat approval flow).
- Telling the orchestrator (e.g., "approve the bash call but only if the file is read-only" — orchestrator inspects and decides).

## Lifecycle & Persistence

- **App quit / workspace close while tasks streaming:** show a confirmation modal listing affected tasks. On confirm, terminate streaming sessions but preserve task records, branches, and worktrees so they can be restarted manually on next launch.
- **Per-workspace:** swarm state is bound to a workspace. Switching workspaces switches the active swarm. The ⚡ left-nav badge reflects the active workspace.
- **Resume on relaunch:** task records persist; tasks load in their last persisted status. `streaming` tasks become `paused` (the model isn't actually running). User can resume manually.
- **Cleanup:** the orchestrator chat session and task sessions outlive `landed`/`discarded` transitions and remain accessible through the recent-activity scrollback in the orchestrator view.

## Settings

New "Swarm" section in Settings:

- Concurrency cap (default 5).
- Default approval policy (default `auto-read`).
- Default orchestrator provider/model.
- Default task provider/model (falls back to workspace defaults).
- Worktree root override (default `<project>/../.sai-swarm/`).
- Notification on task completion / approval needed (reuses existing SAI notification toggles).

## Data Model Changes

- New table `swarm_tasks` keyed by id, foreign-keyed to `chat_sessions`, indexed by `(workspaceId, status)`.
- Extend `chat_sessions` with `kind: 'chat' | 'orchestrator' | 'task'` (default `'chat'` for existing rows).
- New table `swarm_approvals` for pending tool-call approvals (deletes on resolve).
- Workspace record gains `swarmSettings` JSON column.

## Open Questions

None blocking v1 — all major decisions resolved during brainstorming.

## v2 / Future Work

- Plan-then-fan-out planner agent.
- Cross-task awareness (a task may read another's diff or output by reference).
- Stacked review with auto-rebase.
- Cross-workspace swarm view (one ⚡ panel showing every workspace's swarm).
- Auto-merge-if-green policies per task.
- Speculative task spawning (orchestrator suggests tasks based on workspace state).
