# Claude CLI → Agent SDK Migration — Phase 4b: Orchestrator / swarm in SDK mode

**Date:** 2026-06-30
**Status:** IMPLEMENTED on branch `claude-sdk-migration-phase4b` (commits d9517351..5b92e64f). 3 SDD tasks reviewed-clean; opus final review + flip-readiness audit = "mergeable, every ClaudeBackend method real across all kinds". Final review found the Approach-Y duplicate-card seam (renderer registers the orchestrator session unconditionally on sidebar-open, so the synthetic injection AND the SDK's real tool_use both render) — FIXED in 5b92e64f by gating the model-initiated synthetic injection to CLI mode only (Approach Y now correct-by-construction). tsc clean, 239 files/2255 tests. Live SDK-orchestrator dogfood pending; flag flip to `sdk` is the user's post-dogfood follow-up.
**Depends on:** Phases 0–3 + 4a (all merged to main). This is the LAST migration phase before the `claudeBackend` flag can default to `sdk`.

## Background

In SDK mode the orchestrator scope (`kind === 'orchestrator'`) is completely non-functional: `SdkBackend` builds no swarm MCP server, never applies the orchestrator system prompt, and doesn't restrict built-in tools. Because the backend is selected once globally (`getClaudeBackend`), flipping the flag to `sdk` routes the orchestrator through `SdkBackend` too — so swarm breaks entirely until this lands. Phase 4b ports the orchestrator to SDK mode and then verifies the whole SDK path is flip-ready (the user intends to set `claudeBackend: 'sdk'` and dogfood the complete project through daily use).

How the CLI orchestrator works today (`electron/services/claude.ts` `buildArgs`, `kind==='orchestrator'` block, ~lines 226–254): it writes a swarm MCP config pointing the CLI at the subprocess `swarm-mcp-server` (`--mcp-config` + `--strict-mcp-config`), disables all built-in tools (`--tools ''`), blocks plugin tools (`--disallowedTools Skill,Task,Agent,TodoWrite`), disables slash commands (`--disable-slash-commands`), and replaces the system prompt (`--system-prompt buildOrchestratorSystemPrompt(ctx)`). Permission mode is `bypassPermissions`. The swarm tools (`spawn_task`, `query_status`, `pause_task`, `land`, …) dispatch through the SAME shared `dispatchSwarmTool` (lifted in Phase 3) → renderer `swarm:tool-request` round-trip that the chat render tools use.

What already exists and needs no change: `StartArgs.orchestratorContext` (the IPC already passes it); `buildOrchestratorSystemPrompt(ctx)` / `resolveOrchestratorPromptContext` / `OrchestratorPromptContext` (pure, in `src/lib/orchestratorSystemPrompt.ts`, importable from electron); the shared `dispatchSwarmTool` (handles swarm tools identically for both transports); the renderer `swarm:tool-request` handler (routes spawn_task etc.); `SWARM_TOOL_SCHEMA` (`src/lib/swarmOrchestratorTools.ts`, `toolset: 'orchestrator'`); `buildSaiChatMcpServer` (the pattern to mirror); the orchestrator card UI (`SwarmToolCardSelector`).

## Scope

**In scope:** orchestrator `kind` in SDK mode — (1) plumb `orchestratorContext` into `SdkBackend`; (2) a new in-process `buildSwarmMcpServer`; (3) orchestrator options in `sdkOptions` (full-replace system prompt + `tools:[]` + `disallowedTools`); (4) card rendering via the SDK's real `tool_use` stream (Approach Y); (5) a final flip-readiness verification of every `ClaudeBackend` method across all kinds. Unit tests per piece; a real-app dogfood of the full swarm flow.

**Out of scope (later cleanup):** making the one-shot helpers (`generateCommitMessage`/`generateTitle`/`getModels`/`alwaysAllow`) SDK-native — they already work via `claude -p` regardless of backend. Deleting `CliBackend` / the flag — kept until the SDK path is proven in production. Flipping the flag default is a one-line follow-up the user makes after dogfooding, not part of this phase.

## Design

### 1. Plumb orchestratorContext into SdkBackend

`SdkBackend.start` currently drops `orchestratorContext`. Store it in `scopeMeta` (extend the stored shape to `{ cwd, kind, appendSystemPrompt, orchestratorContext? }`). `_createSession` reads it back. No IPC/types change — `StartArgs.orchestratorContext` already flows in.

### 2. buildSwarmMcpServer (in-process)

New `electron/services/claudeBackend/swarmMcpServer.ts` exporting `buildSwarmMcpServer({ workspace, dispatch })`, mirroring `buildSaiChatMcpServer` with three differences:
- Server key/name is **`swarm`** (constant `SWARM_MCP_SERVER_NAME = 'swarm'`) — required so the model-facing tool names are `mcp__swarm__<name>` and the `SwarmToolCardSelector` (`SWARM_PREFIX = 'mcp__swarm__'`) matches.
- Registers `toolsForToolset('orchestrator')` (the `SWARM_TOOL_SCHEMA` tools).
- Advertises tools under their **bare** names (`spawn_task`, not `swarm_spawn_task`) — see Approach Y below — so the SDK's real `tool_use` block is `mcp__swarm__spawn_task`, exactly what the card selector's `baseName` switch expects. Each handler calls `dispatch({ tool: <bare name>, input, workspace })` (the same shared dispatch) and wraps the result via `toMcpSuccessContent`/`toMcpErrorContent`.

### 3. Orchestrator options in sdkOptions

`buildSdkOptions` gains orchestrator handling. For `kind === 'orchestrator'`:
- `systemPrompt`: a plain **string** (full replacement) — the orchestrator prompt — NOT the `{ preset:'claude_code', append }` form. `sdkOptions` gains a `systemPromptOverride?: string` input; when set, `opts.systemPrompt = systemPromptOverride`. `SdkBackend._createSession` builds it via `buildOrchestratorSystemPrompt(resolveOrchestratorPromptContext(orchestratorContext))` and passes it as `systemPromptOverride` for orchestrator scopes.
- `tools: []` — disable all built-in tools (the CLI's `--tools ''`). `sdkOptions` sets `opts.tools = []` for orchestrator.
- `disallowedTools: ['Skill', 'Task', 'Agent', 'TodoWrite']` — block plugin tools (the CLI's `--disallowedTools`). Set for orchestrator.
- `permissionMode: 'bypassPermissions'` and no `canUseTool` — already correct for orchestrator (unchanged).
- `mcpServers: { swarm: <server> }` — passed through the existing `mcpServers` passthrough.
No SDK equivalent is needed for `--strict-mcp-config` (with `tools:[]` and only the swarm server registered, only `mcp__swarm__*` is available) or `--disable-slash-commands` (the SDK never surfaces slash commands to the model).

### 4. Wire into SdkBackend._createSession

Mirror the Phase-3 chat block. `SdkBackend` constructor gains a `buildSwarmMcpServer?: (workspace) => McpSdkServerConfigWithInstance | undefined` dep (injected by `getClaudeBackend`, wired to the new `buildSwarmMcpServer` + the shared `getSaiToolDispatch()`). In `_createSession`, for `kind === 'orchestrator'`: build the swarm server → `mcpServers = { swarm: server }`; build the orchestrator system prompt → pass as `systemPromptOverride`. (Chat keeps its `{ sai }` server + nudges; task keeps user-MCP passthrough; orchestrator gets neither nudges nor the `sai` server.)

### 5. Card rendering — Approach Y (SDK real tool_use stream)

In SDK mode the runtime surfaces MCP `tool_use` blocks in the assistant stream (proven by Phase 3 chat cards). So orchestrator cards render from the **real** `tool_use` (`mcp__swarm__spawn_task`) — no synthetic injection. Concretely: SDK orchestrator scopes do NOT register a `swarmOrchestratorSessions` entry (the `swarm:set-orchestrator-session` map stays empty for them), so `dispatchSwarmTool`'s synthetic-card injection (gated on `orchSessionId`) is skipped — avoiding a duplicate card. The bare tool names (decision in §2) make the real `tool_use` name match the card selector directly. The tool RESULT/status cards likewise come from the SDK stream's surfaced tool results. **This is the primary dogfood risk** (next section): if result/status cards don't render, or stray cards appear, fall back to **Approach X** — advertise `swarm_<name>` and set the orchestrator session so the synthetic injection drives cards (matching CLI behavior exactly).

### 6. Flip-readiness verification (no-missing-pieces)

A final task audits every `ClaudeBackend` method for every `kind` in SDK mode and confirms none is stubbed/CLI-assuming in a way that breaks under a global flag flip. The audit (mostly already true post-4a) is documented in the plan as a checklist: send/interrupt/setSessionId/compact/approve/answer*/alwaysAllow/generate*/getModels/start/destroy across chat, task, orchestrator. Anything found missing becomes a task. The flag default stays `cli`; the verification's output is the green light for the user to flip it.

### Components touched

- `electron/services/claudeBackend/sdkBackend.ts` — `start` (store orchestratorContext), `_createSession` (orchestrator branch: swarm server + system prompt override), constructor dep `buildSwarmMcpServer`.
- `electron/services/claudeBackend/sdkOptions.ts` — `systemPromptOverride?`, `tools:[]` + `disallowedTools` for orchestrator.
- `electron/services/claudeBackend/swarmMcpServer.ts` — **new**, `buildSwarmMcpServer`.
- `electron/services/claudeBackend/index.ts` — inject `buildSwarmMcpServer` into `SdkBackend`.
- Renderer / IPC / `types.ts`: no changes (cards + dispatch already exist).

## Testing

- **Unit (mocked):** `swarmMcpServer.test.ts` — builds an `sdk`-type server named `swarm` registering all orchestrator tools under bare names; a handler routes to `dispatch({ tool: 'spawn_task', … })` and wraps success/error. `sdkOptions.test.ts` — for orchestrator: `systemPromptOverride` becomes the full string `systemPrompt`; `tools === []`; `disallowedTools` set; `permissionMode === 'bypassPermissions'`; no `canUseTool`. `sdkBackend.test.ts` — orchestrator `_createSession` stores/uses `orchestratorContext`, attaches `mcpServers.swarm`, and passes the orchestrator system prompt (assert the captured `options.systemPrompt` is the plain string and contains an orchestrator-prompt marker); chat/task scopes unchanged (no swarm server).
- **Real-app dogfood (the gate):** in SDK mode, start an orchestrator, ask it to `spawn_task` → the SpawnTaskCard renders (Approach Y), the task actually spawns and streams, `query_status` shows it, `land`/`discard` work, `pause_task`/`resume_task` work. Confirm NO stray/duplicate cards and that built-in tools are unavailable to the orchestrator. (If cards misbehave → Approach X fallback.)
- `'cli'` default unchanged; full suite green; tsc clean.

## Non-goals / risks

- **Card-rendering risk (Approach Y):** result/status cards or stray cards in SDK mode — resolved by the dogfood; Approach X is the documented fallback.
- One-shot SDK-native helpers and `CliBackend`/flag deletion are later cleanup. Flipping the flag default is the user's post-dogfood follow-up.

## Success criteria

1. In SDK mode, an orchestrator scope has the swarm tools (`mcp__swarm__*`), runs under the orchestrator system prompt, has built-in tools disabled, and bypasses approvals — unit-covered.
2. The full swarm flow (spawn → status → land/discard, pause/resume) works in SDK mode with correct cards — dogfood-confirmed.
3. The flip-readiness audit shows every `ClaudeBackend` method is real for every kind in SDK mode; nothing breaks under a flag flip.
4. `'cli'` mode unchanged; full suite green; tsc clean. The flag still defaults `cli` (the user flips it after dogfooding).
