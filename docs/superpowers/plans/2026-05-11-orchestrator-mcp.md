# Orchestrator MCP — Chat-Driven Swarm Dispatch

**Goal:** Make the orchestrator chat in `OrchestratorView` actually dispatch swarm operations (`spawn_task`, `land`, `approve`, …) via natural conversation with the user. This unblocks the Phase 3 carry-forward "Task 17 schema injection deferred."

**Approach:** Treat the Claude CLI as a generic LLM. Expose the existing `SWARM_TOOL_SCHEMA` via an MCP server bundled with SAI, auto-inject it into orchestrator sessions, restrict the model to swarm-only tools, and steer behavior with a strong orchestrator system prompt. Codex/Gemini orchestrator chats fall back to slash commands + trays.

**Confirmed design choices:**
- MCP transport: stdio (Claude CLI spawns the SAI MCP server directly).
- SAI ↔ MCP server protocol: NDJSON over Unix socket / Windows named pipe; one socket per running SAI process, MCP server connects with workspace identifier passed via env var.
- Lifecycle: MCP server lives for the lifetime of its parent Claude CLI process; SAI's socket server accepts multiple concurrent MCP connections (one per workspace orchestrator session).
- Tests: unit-test socket server + MCP server protocol with a fake Claude client; e2e is a manual smoke against a real Claude CLI.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ SAI (Electron)                                                    │
│                                                                   │
│  Renderer (App.tsx)                                               │
│  ├─ swarmHost (spawnTask/land/approve/…)                          │
│  └─ orchestrator chat (ChatPanel keyed to orch session)           │
│        │                                                          │
│        │ existing claude:message IPC                              │
│        ▼                                                          │
│  Main (electron/services/claude.ts + new swarmMcpHost.ts)         │
│  ├─ spawns Claude CLI with --mcp-config <sai-managed.json>        │
│  ├─ swarmMcpHost socket server (NDJSON over Unix socket / pipe)   │
│  └─ proxies tool requests from MCP server → renderer → swarmHost  │
│        │                                                          │
│        │ stdio                                                    │
│        ▼                                                          │
│  Claude CLI process                                               │
│        │                                                          │
│        │ stdio (MCP)                                              │
│        ▼                                                          │
│  swarm-mcp-server.js (bundled in dist-electron/)                  │
│  ├─ implements MCP server protocol                                │
│  ├─ exposes 9 swarm_* tools matching SWARM_TOOL_SCHEMA            │
│  └─ connects back to SAI's socket via $SAI_SWARM_SOCKET_PATH      │
└───────────────────────────────────────────────────────────────────┘
```

Key invariants:
- The MCP server is a dumb proxy. All swarm logic stays in the renderer's `swarmHost`.
- The socket server only accepts connections from MCP processes spawned with the SAI-managed config (we mint a per-process secret in env to gate this).
- Non-orchestrator Claude sessions never see the swarm MCP config.

---

## Files

**New:**
- `electron/swarm-mcp-server.ts` (built to `dist-electron/swarm-mcp-server.js`) — the MCP server binary
- `electron/services/swarmMcpHost.ts` — main-process socket server + Claude config builder
- `src/lib/orchestratorSystemPrompt.ts` — generates the orchestrator system-prompt text
- `tests/swarm/swarmMcpProtocol.test.ts` — protocol round-trip tests
- `tests/swarm/orchestratorSystemPrompt.test.ts` — prompt invariants

**Modified:**
- `electron/services/claude.ts` — accept `kind: 'orchestrator'` flag at start; merge SAI-managed mcp-config + restrict tools
- `electron/preload.ts` — pass `kind` through `claudeStart`
- `src/App.tsx` — pass `kind: 'orchestrator'` when starting the orchestrator session; wire `onSwarmTool` IPC for routing
- `src/components/Swarm/OrchestratorView.tsx` — show a small banner on non-Claude orchestrators ("Chat dispatch requires Claude — use the trays or switch provider.")
- `electron/main.ts` — initialize swarmMcpHost on app start
- `vite.electron.config.ts` (or equivalent) — emit `swarm-mcp-server.js` as an additional entry

---

## Phase 1: MCP server + socket transport (foundation)

### Task 1: Bundle the swarm MCP server

**Files:**
- Create: `electron/swarm-mcp-server.ts`
- Modify: electron build config to add it as a separate entry
- Test: `tests/swarm/swarmMcpProtocol.test.ts` (smoke — boots and answers `tools/list`)

Implements MCP protocol (JSON-RPC 2.0 over stdio). Methods:
- `initialize` → returns `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'sai-swarm', version: '1.0.0' } }`
- `tools/list` → returns the 9 swarm tools (mapped from `SWARM_TOOL_SCHEMA`, prefixed with `swarm_`)
- `tools/call` → forwards to SAI socket, awaits result, returns it

On startup: connects to `process.env.SAI_SWARM_SOCKET_PATH` with `process.env.SAI_SWARM_SECRET` and `process.env.SAI_SWARM_WORKSPACE` as the handshake. If env missing → logs to stderr and exits with code 2 (so Claude CLI surfaces a clear error).

Steps:
1. Failing test: spawn the script with mock env vars, send `tools/list`, expect 9 tools with `swarm_` prefix.
2. Implement.
3. Run, GREEN.
4. Commit: `feat(orch-mcp): swarm MCP server skeleton`

### Task 2: Main-process socket host

**Files:**
- Create: `electron/services/swarmMcpHost.ts`
- Modify: `electron/main.ts` (init on app ready, teardown on quit)
- Test: `tests/swarm/swarmMcpProtocol.test.ts` (extend with end-to-end socket round-trip)

`swarmMcpHost` exports:
- `start(): { socketPath: string; secret: string }` — boots a Unix-socket / named-pipe server, returns the path & secret
- `stop(): void`
- `onToolCall(handler: (req: ToolCallRequest) => Promise<ToolCallResponse>): void` — single handler invoked per dispatch
- Connection auth: handshake first frame must include matching secret, else disconnect.

NDJSON protocol:
- MCP server → host: `{ id, type: 'call', tool: 'spawn_task', input: {...}, workspace: '<wsPath>' }`
- Host → MCP server: `{ id, type: 'result', result: {...} }` or `{ id, type: 'error', error: '...' }`

Steps:
1. Failing test: start host, connect a mock client with bad secret → rejected; with good secret → accepted; send call, host receives and can reply.
2. Implement.
3. Commit: `feat(orch-mcp): socket host with handshake + NDJSON protocol`

### Task 3: Wire MCP server `tools/call` through socket

**Files:**
- Modify: `electron/swarm-mcp-server.ts`
- Test: extend `tests/swarm/swarmMcpProtocol.test.ts` for the round-trip

When MCP server receives `tools/call`:
1. Strip `swarm_` prefix → original tool name
2. Send `{ id, type: 'call', tool, input, workspace }` over socket
3. Await matching response, return as MCP `tool_result`

Steps:
1. Failing test: end-to-end — spawn server, route a `swarm_spawn_task` call through host, mock host responds, verify MCP server returns tool_result.
2. Implement.
3. Commit: `feat(orch-mcp): MCP server proxies tool calls to SAI host`

---

## Phase 2: Renderer integration

### Task 4: Route socket calls to renderer's swarmHost

**Files:**
- Modify: `electron/services/swarmMcpHost.ts` (forwards via IPC)
- Modify: `electron/preload.ts` (expose `onSwarmToolRequest` + `respondSwarmTool`)
- Modify: `src/App.tsx` (subscribe in a useEffect; dispatch via `dispatchSwarmTool(name, input, swarmHost)`)
- Test: `tests/swarm/AppSwarmWiring.test.tsx` (extend — mock onSwarmToolRequest, verify dispatch)

Flow:
- `swarmMcpHost.onToolCall(req)` → `safeSend(win, 'swarm:tool-request', req)` → renderer's listener calls `dispatchSwarmTool(req.tool, req.input, swarmHost)` → calls `window.sai.respondSwarmTool(req.id, result)` → main → socket → MCP server → Claude.

Steps:
1. Failing test (renderer): trigger a fake `swarm:tool-request`, assert respondSwarmTool fires with a sensible result.
2. Implement.
3. Commit: `feat(orch-mcp): route socket calls through renderer swarmHost`

### Task 5: Claude session orchestrator-mode start

**Files:**
- Modify: `electron/services/claude.ts` — add `kind?: 'orchestrator'` to `claude:start`, when set:
  - Append SAI-managed mcp-config json (write a temp file at session start with `{ mcpServers: { swarm: { command: process.execPath, args: [path-to-swarm-mcp-server.js], env: { SAI_SWARM_SOCKET_PATH, SAI_SWARM_SECRET, SAI_SWARM_WORKSPACE } } } }`)
  - Append `--allowedTools "mcp__swarm__*"` (or whatever the Claude CLI flag is — verify; if no allow-list, fall back to `--disallowedTools` for the major ones: `Read,Edit,Write,Bash,Glob,Grep,…`)
- Modify: `electron/preload.ts` — `claudeStart(cwd, scope?, kind?)`
- Modify: `src/App.tsx` — when starting orchestrator session, pass `kind: 'orchestrator'`
- Test: `tests/swarm/claudeOrchestratorStart.test.ts` — assert args include `--mcp-config` pointing at SAI-managed config + `--allowedTools` restriction

Steps:
1. Failing test.
2. Implement (mock spawn, verify args).
3. Commit: `feat(orch-mcp): orchestrator-mode Claude start with swarm MCP injection`

---

## Phase 3: Orchestrator behavior steering

### Task 6: Orchestrator system prompt

**Files:**
- Create: `src/lib/orchestratorSystemPrompt.ts`
- Modify: `src/App.tsx` — when sending the first message of an orchestrator session, prepend the system prompt
- Test: `tests/swarm/orchestratorSystemPrompt.test.ts` — assert key constraints present

Prompt constraints (excerpted, full text in the lib):
```
You are the SAI swarm orchestrator. Your role is to plan and dispatch
work across parallel SwarmTasks — not to do the work yourself.

You have access to the following MCP tools (all named mcp__swarm__*):
- spawn_task / spawn_tasks: dispatch new SwarmTasks
- query_status: read swarm state
- pause_task / resume_task
- approve_tool_call / deny_tool_call
- land / discard

YOU MUST NOT: read files, edit files, write files, run bash commands,
search the codebase, or use any non-swarm tool. Even if the user asks
for a quick fix, your only response is to spawn a task that does it.

When the user gives you a request:
 1. Decompose into one or more concrete prompts.
 2. Call spawn_task / spawn_tasks with those prompts.
 3. Reply with one short line per dispatched task: ✓ <branch> · "<title>"
 4. Then offer next steps if any.

Be terse. Don't apologize, don't restate the request, don't add filler.
Don't speculate about the work — that's the task's job.

If the user is asking a question about the swarm itself, use query_status.
If they want to land/discard/approve, use the corresponding tool.
```

Steps:
1. Failing test: prompt contains the "you must not" list, the "spawn don't solve" rule, and the brevity rule.
2. Implement.
3. Commit: `feat(orch-mcp): orchestrator system prompt`

### Task 7: Guardrail re-prompt on tool drift

**Files:**
- Modify: `src/App.tsx` — in the orchestrator session's claudeOnMessage handler, if a tool_use comes through with a non-`mcp__swarm__*` name, intercept and inject a follow-up user message: `"You used a non-swarm tool. You may only use mcp__swarm__* tools. Retry."` (this happens automatically if --allowedTools is set, but belt-and-suspenders for any provider that ignores the flag).
- Test: `tests/swarm/orchestratorGuardrail.test.ts`

Steps:
1. Failing test.
2. Implement.
3. Commit: `feat(orch-mcp): tool-drift guardrail`

---

## Phase 4: UX & non-Claude fallback

### Task 8: Non-Claude orchestrator banner

**Files:**
- Modify: `src/components/Swarm/OrchestratorView.tsx`
- Test: extend `tests/swarm/OrchestratorView.test.tsx`

When `orchestratorProvider !== 'claude'`, render a small info banner at the top of the chatSlot region: "Chat-driven dispatch requires Claude. Use the trays below or switch provider in Settings → Swarm." Keep the chat input visible — user can still talk, just won't get auto-dispatch.

Steps:
1. Failing test.
2. Implement.
3. Commit: `feat(orch-mcp): non-Claude orchestrator banner`

### Task 9: Slash-command escape hatch

**Files:**
- Create: `src/lib/orchestratorSlashCommands.ts` — parser
- Modify: `src/App.tsx` — intercept user messages in orchestrator chat that start with `/`; dispatch via swarmHost; inject a synthetic assistant message with the result; do NOT forward to provider
- Test: `tests/swarm/orchestratorSlashCommands.test.ts`

Commands: `/spawn <prompt>`, `/burst <line1> <line2> …`, `/land <ref>`, `/discard <ref>`, `/approve <id>`, `/deny <id>`, `/status [filter]`, `/pause <ref>`, `/resume <ref>`.

Steps:
1. Failing test.
2. Implement.
3. Commit: `feat(orch-mcp): slash-command escape hatch`

---

## Phase 5: Manual smoke + docs

### Task 10: Manual smoke + docs

- Real Claude CLI run against a test repo; verify: `spawn_task` → task appears in sidebar; `query_status` returns live state; `land` succeeds.
- Document setup in `docs/swarm-orchestrator.md` (where users can find auth requirements, troubleshooting).

---

## Sanity checks (post-implementation)

- [ ] `npx vitest run` — all green
- [ ] `npx tsc --noEmit` — clean
- [ ] Manual: spawn 3 tasks via chat ("spawn three tasks: add tests for foo, bar, baz")
- [ ] Manual: ask "what's the status?" → orchestrator calls `query_status`
- [ ] Manual: ask "land the auth task" → orchestrator calls `land` with the right ref
- [ ] Manual: codex/gemini orchestrator shows banner; slash commands work
- [ ] Verify the model never reaches for Read/Bash/Edit (check chat history for any non-swarm tool_use)

---

## Estimated effort

- Phase 1 (MCP infra): ~1 day
- Phase 2 (renderer wiring): ~0.5 day
- Phase 3 (prompt + guardrail): ~0.5 day
- Phase 4 (UX): ~0.5 day
- Phase 5 (smoke): ~0.5 day

Total: ~3 days assuming no surprises with Claude CLI's MCP loader or `--allowedTools` flag behavior.

---

## Open risks

1. **Claude CLI may not have `--allowedTools`** — if not, fall back to the orchestrator system prompt + guardrail re-prompt. Less robust but workable.
2. **MCP server discovery** — Claude CLI's `--mcp-config` format must match exactly; verify against current CLI version.
3. **Bundled binary path** — `process.execPath` (Electron) won't work for spawning a Node script; need to either (a) use `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, or (b) ship a Node binary, or (c) use the system Node. Option (a) is cleanest — Electron supports it.
4. **Windows named pipes** — different from Unix sockets; `net.createServer` handles both via `path` form (`\\.\pipe\name` on Windows).

---

## Continuation prompt

> Resume executing `docs/superpowers/plans/2026-05-11-orchestrator-mcp.md`. Use `superpowers:subagent-driven-development`. Phase 1 first; manual review checkpoints after each phase.
