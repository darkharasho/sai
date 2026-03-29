# Optimize Token Usage: Persistent Process & Probe Removal

**Date:** 2026-03-29
**Status:** Approved

## Problem

The app consumes significantly more API tokens than the VS Code extension for equivalent work. Three root causes:

1. **Probe on startup** — `claude -p 'hi' --max-turns 1` wastes a full API round-trip just to capture slash commands
2. **Spawn-per-message** — each `claude:send` kills the previous process and spawns a new `claude -p <msg> --resume <id>`, causing poor prompt cache hit rates
3. **Uncached commit messages** — each commit message generation spawns a fresh process with no `--resume`, paying full input token cost

## Solution

### Change 1: Persistent Interactive Process

Replace spawn-per-message with a single long-lived Claude CLI process per workspace using bidirectional stream-json.

**Spawn command:**
```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --permission-mode <acceptEdits|bypassPermissions>
  [--effort <level>]
  [--model <model>]
```

**Sending messages:** Write NDJSON to the process's stdin:
```json
{"type":"user","message":{"role":"user","content":"the user message"}}
```

**Receiving responses:** Parse NDJSON from stdout (same as current implementation).

**Lifecycle:**
- **Start:** Lazy — spawned on first `claude:send`, not on workspace open
- **Restart on crash:** If the process exits unexpectedly, the next `claude:send` detects `process === null` and respawns. Session resumes via `--resume <sessionId>`.
- **Config change:** If permission mode, effort level, or model changes between turns, kill the current process and let the next send respawn with updated flags. Store current config on the workspace to detect changes.
- **Workspace suspend:** Kill process (existing behavior in `workspace.ts` suspend logic)
- **App close:** Kill process (existing behavior in `destroyAll`)

**Session ID:** Captured from the first `system.init` message emitted by the process on startup, stored on the workspace as before.

**Turn boundaries:** The process emits `result` messages at the end of each turn. The existing `result` handler in `ChatPanel.tsx` already detects these. A `done` IPC event is sent to the renderer when a `result` message is received (replacing the current `process.on('exit')` trigger).

**Stdin management:** The process's stdin must remain open (not `'ignore'`). Use `'pipe'` for stdin, stdout, and stderr. Write messages with `process.stdin.write(JSON.stringify(msg) + '\n')`.

### Change 2: Remove the Probe

**Current:** `claude:start` IPC handler spawns a throwaway `claude -p 'hi'` process to get slash commands from the init message.

**New:** `claude:start` becomes a lightweight check:
- If the workspace already has an active process, signal ready immediately
- If not, signal ready immediately anyway — the process starts lazily on first send
- Slash commands are captured from the `system.init` message when the persistent process spawns

The renderer may briefly lack slash commands until the first message is sent. This is acceptable — slash command autocomplete isn't needed before the user starts typing.

### Change 3: Optimize Commit Message Generation

**Current:** `claude:generateCommitMessage` spawns a fresh `claude -p` with the diff as prompt. No session resume, no caching.

**New:** Route through the persistent process:
1. If a persistent process exists and is idle (not mid-turn), write the commit message prompt to stdin
2. Parse the response from stdout, extract the commit message text
3. Return via the IPC `invoke` promise

**Commit message prompt** (unchanged):
```
Generate a concise commit message for this diff. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.

<diff content, truncated to 8000 chars>
```

**Fallback:** If no persistent process exists (user generates commit message before any chat interaction), spawn a one-shot process as today. This is expected to be rare.

**Busy detection:** If the process is mid-turn (streaming a response), fall back to a one-shot process rather than queueing. Commit message generation should feel instant.

## Files Changed

| File | Scope |
|------|-------|
| `electron/services/claude.ts` | Major rewrite — persistent process lifecycle, stdin writes, stdout message routing, config change detection, commit message routing |
| `electron/services/workspace.ts` | Minor — add fields for current process config (permMode, effort, model) to detect changes |
| `electron/preload.ts` | Minor — `claudeStart` simplified, no new IPC channels needed |
| `src/components/Chat/ChatPanel.tsx` | Minor — message parsing unchanged (same JSON format), `done` event handling may need adjustment |

## Risks

| Risk | Mitigation |
|------|------------|
| Process crash mid-conversation | Detect exit, respawn on next send with `--resume`. Session persists server-side. |
| `--input-format stream-json` is underdocumented | Same protocol used by VS Code extension. Fall back to spawn-per-message if edge cases found. |
| Config changes kill the process | Acceptable — respawn with `--resume` preserves context. Only happens on explicit user action. |
| Commit message via persistent process pollutes chat | The commit message prompt appears in conversation history. Acceptable trade-off for caching. If undesirable, use one-shot fallback always. |

## Non-Goals

- Changing the renderer's message parsing logic (output format is identical)
- Adding WebSocket or HTTP-based communication (stdin/stdout is sufficient)
- Multi-process pooling (one process per workspace is enough)
