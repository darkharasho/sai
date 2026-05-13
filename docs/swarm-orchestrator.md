# Swarm Mode

> Spawn multiple parallel coding agents from a single chat. Each task runs in its own git worktree, you watch them stream tool calls live, then land them one at a time (or all at once) when they're ready.

## Quick start

1. Open a project workspace.
2. Click the **⚡ Swarm** icon in the left nav to open the Swarm sidebar.
3. The sidebar opens to **Swarm Overview** — a chat with the orchestrator.
4. Type a request: `spawn three tasks: add tests for foo.ts, bar.ts, and baz.ts`.
5. Watch the SpawnTaskCard appear inline. Each task gets its own row that pulses while running, ticks up its tool count, and shows diff stats when done.
6. Click a row to focus the task and watch its full chat stream.
7. When tasks reach `done`, an inline TaskCompletedCard appears with **Diff / Discard / Land** buttons. Click **Land** to fast-forward merge into the base branch. Or click **Land all green** on the BatchCompleteCard at the end of a batch.

## What's a "swarm task"?

A SwarmTask is a sandboxed coding agent run:

- **Provider**: Claude (Codex / Gemini support is a planned follow-up — they currently fail with a friendly card).
- **Worktree**: each task that does writes gets its own git worktree on a branch named `swarm/<title-slug>-<short-id>`. Reads-only tasks share the workspace root.
- **Approval policy**: configurable per task in Settings → Swarm. Defaults to `auto-read` (reads auto-approve, writes need approval).
- **Lifecycle**: `queued → streaming → (awaiting_approval → streaming)* → done → landed | discarded | failed`.
- **Persistence**: ephemeral within a SAI session. The underlying ChatSession persists in chat history; the SwarmTask record itself doesn't survive restart.

## Talking to the orchestrator

The orchestrator is a Claude session with a custom system prompt and an MCP server (bundled as `dist-electron/swarm-mcp-server.js`) that exposes 9 swarm tools:

- `spawn_task` / `spawn_tasks` — dispatch one or many tasks
- `query_status` — read live swarm state
- `pause_task` / `resume_task` — control streaming
- `approve_tool_call` / `deny_tool_call` — resolve pending approvals
- `land` / `discard` — terminal actions

The model can't reach for `Read`, `Edit`, `Bash`, etc. — Claude is launched with `--tools "" --strict-mcp-config --disallowedTools "Skill,Task,Agent,TodoWrite" --disable-slash-commands`. Its only tools are `mcp__swarm__*`. The orchestrator decomposes your request into concrete prompts and calls `spawn_task`.

### Slash-command escape hatch

You can also dispatch directly without the orchestrator:

| Command | Effect |
| --- | --- |
| `/spawn <prompt>` | Spawn a single task |
| `/burst <line1>\n<line2>...` | Spawn one task per line |
| `/status [filter]` | Print current swarm state |
| `/approve <id>` / `/deny <id>` | Resolve a pending approval |
| `/land <ref>` / `/discard <ref>` | Land or discard by id, branch, or title prefix |
| `/pause <ref>` / `/resume <ref>` | Pause / re-run a task |
| `/help` | List commands |

Slash commands work even on Codex / Gemini orchestrator (which can't drive MCP tools today).

## Settings

**Settings → Swarm** controls:

- `concurrencyCap` (default 5) — how many tasks stream in parallel; the rest queue
- `defaultApprovalPolicy` (default `auto-read`)
- `orchestratorProvider` / `orchestratorModel` (also editable from the picker in the orchestrator header)
- `defaultTaskProvider` / `defaultTaskModel`
- `worktreeRoot` — sibling to your project (e.g. `<project>/../.sai-swarm/`)
- `notifyOnComplete` / `notifyOnApproval` — system notifications

## Auth requirements

- **Orchestrator (Claude)** — uses the same auth as the regular Claude chat (Claude Code's OAuth or `ANTHROPIC_API_KEY`).
- **Tasks (Claude)** — same auth. Each task spawns its own Claude process per scope.
- **Codex / Gemini tasks** — currently fail with a TaskFailedCard (`Task runner currently supports Claude only…`). Backend support is a planned follow-up.

## Common flows

### Spawn → land

```
You: spawn a task to add a test for foo.ts
Orchestrator: ✓ "add test for foo.ts" → spawned   [SpawnTaskCard]
… task streams in sidebar, pulses while active …
Orchestrator: [TaskCompletedCard] ✓ Task completed · 12 tools · +47 −0 · 1m 3s
                                  [Diff] [Discard] [Land]
You click Land → [LandCard] → Landed swarm/add-test-foo into main +47 −0
```

### Batch + wrap-up

```
You: spawn three tasks for hello.txt, goodbye.txt, wave.txt
… 3 SpawnTaskCard rows, each completes, each shows TaskCompletedCard …
[BatchCompleteCard] 🎯 3 tasks done in 6m 12s
                   Total: 3 · Landed: 0 · Discarded: 0 · Failed: 0
                   [Completion timeline sparkline]
                   [Land all green]
```

### Paused / stuck task

- Click the **⏸** in the focused task header to pause (kills the Claude process).
- Click **Resume** to re-run the prompt as a fresh turn.
- Or click the trash icon on the sidebar row to discard outright.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ SAI (Electron)                                                  │
│                                                                 │
│  Renderer                                                       │
│  ├─ swarmHost: spawn/land/approve/discard/...                   │
│  ├─ orchestrator chat (ChatPanel keyed to orch session id)      │
│  ├─ inline cards (SpawnTaskCard, TaskCompletedCard,             │
│  │   InlineApprovalCard, BatchCompleteCard, LandCard, ...)      │
│  └─ status mirror (claude:message → task patches + lifecycle    │
│      card emissions)                                            │
│                                                                 │
│  Main                                                           │
│  ├─ swarmMcpHost (Unix socket / Windows pipe, NDJSON, secret    │
│  │   handshake) — accepts MCP tool requests, forwards to        │
│  │   renderer, returns results                                  │
│  ├─ swarm-mcp-server.js (spawned by Claude CLI per session,     │
│  │   stdio MCP, proxies tool_use → socket → renderer)           │
│  ├─ claude.ts spawns Claude CLI with --mcp-config / --tools "" /│
│  │   --strict-mcp-config / --disallowedTools / --system-prompt  │
│  │   when kind === 'orchestrator'                               │
│  └─ git helpers: worktreeAdd/Remove, canFastForward, ffMerge    │
│      (returns ok:false on diverged instead of throwing),        │
│      auto-rebase + retry inside landTask                        │
└─────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### "Rebase needed" on Land

- Auto-rebase + retry is built in. If it still fails, the worktree branch has a real conflict against `main`. Click the inline **Rebase + retry** button — that runs `git rebase main` in the worktree. If that errors too, you have conflicts to resolve manually in the worktree.

### Orchestrator only replies in text — no tool cards appear

- Verify the model picker shows `Claude <model>`. Codex / Gemini orchestrator can't drive MCP tools today; use slash commands.
- Verify `dist-electron/swarm-mcp-server.js` exists (it's bundled by `npm run build`).
- Check console for `[swarm-mcp] socket listening at <path>` on startup.

### Tasks stuck in `streaming` forever

- Click the task row → **Pause** in the header to forcibly stop the Claude scope.
- Then **Discard** to clean up the worktree.

### Task chat shows only the prompt, no Claude reply

- Verify the task's provider is Claude. Codex / Gemini will emit a friendly TaskFailedCard.
- Check that the worktree was actually created (visible in `<project>/../.sai-swarm/<branch>/`).

### Background tasks complete but the chat doesn't update

- Background task assistant turns are persisted via a per-task buffer in App.tsx that flushes on `done`/`result`. If you click into a task right at the moment it's finishing, you may see a brief delay before its history loads from chatDb.

## Known limitations

- **Codex / Gemini task runner** — not yet wired through the kind/scope IPC; tasks fail with a friendly card. Tracked as a follow-up.
- **Diff modal** — plain `<pre>` rendering, no syntax highlighting. Sufficient for v1.
- **Tool-result merging** for background tasks — the buffer captures `tool_use` blocks but not `tool_result` content (which arrive as separate `user`-typed envelopes). Tool cards in the persisted view show input, not output. ChatPanel-mounted tasks merge results normally.
- **Workspace switching mid-orchestration** — the renderer rejects MCP tool requests for any workspace other than `activeProjectPath`. If you switch workspaces while the orchestrator has tools in flight, those calls fail until you switch back. No graceful suspension yet.
