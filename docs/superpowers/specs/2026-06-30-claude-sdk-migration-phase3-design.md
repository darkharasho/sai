# Claude CLI → Agent SDK Migration — Phase 3: SAI chat tools as an in-process SDK MCP server

**Date:** 2026-06-30
**Status:** Design (pending review), then plan + execute
**Depends on:** Phase 1 (`SdkBackend` core chat) + Phase 2 (approvals/question/plan). Wires SAI's render/UI tools into SDK mode.

## Background

In CLI mode, SAI's 16 chat tools (`sai_render_html`, `sai_render_component`, `sai_render_chart`, `sai_render_diff`, `sai_render_mermaid`, `sai_render_theme`, `sai_render_form`, `sai_confirm`, `sai_choose`, `sai_pick_file`, `sai_notify`, `sai_clipboard`, `sai_inspect_element`, `sai_capture_app`, `sai_capture_window`, `sai_watch_github_run`) reach the model through a **subprocess MCP server** (`electron/swarm-mcp-server.ts`) that speaks JSON-RPC over stdio to the CLI and bridges tool calls over a socket to the Electron main process (`SwarmMcpHost`), where `main.ts`'s `onToolCall` handler does a renderer IPC round-trip (`swarm:tool-request` → renderer dispatch → render + screenshot → result, with images attached as `__mcpImage`). SDK mode (Phase 1/2) sets **no** `mcpServers`, so these tools are absent.

**Spike result (validated):** a `createSdkMcpServer({ name:'sai', tools:[…] })` passed as `mcpServers` works with the installed CLI 2.1.195 — the server shows `status:'connected'` in `system/init`, the tool is advertised as `mcp__sai__<name>`, the model calls it, and the in-process handler runs. (Unlike `canUseTool`, this control path IS supported.)

## Goal

In SDK mode, expose SAI's **chat** tools via an **in-process** SDK MCP server whose handlers delegate to the **same** renderer-IPC dispatch the socket server already uses — so render output + screenshots + `__mcpImage` results are reused unchanged. Add the chat system-prompt nudges (deferred since Phase 1). `'cli'` mode is untouched.

## Scope

**In scope:** the 16 chat (`sai_*`) tools in SDK mode, via `createSdkMcpServer`, delegating to a shared dispatch. The `CHAT_RENDER_NUDGE` + `CHAT_GITHUB_WATCH_NUDGE` system-prompt nudges added to SDK options (`sdkBackend` already passes `appendSystemPrompt`).

**Out of scope (later phase):** the **orchestrator/swarm** tools in SDK mode (the orchestrator is CLI-driven with `--tools ''`/`--strict-mcp-config`; migrating it is its own phase). User MCP config (`mcpConfigPath`) passthrough in SDK mode. The dormant `canUseTool` approvals (Phase 2 finding — unaffected here; these tools run under bypass/acceptEdits like everything else in SDK mode today).

## Design

### Shared tool-dispatch (the key reuse)

`main.ts`'s `onToolCall` handler body — which turns a `{ tool, input, workspace, id }` request into a renderer IPC round-trip and returns the result (incl. `__mcpImage`) — is extracted into a reusable async function, e.g. `dispatchSaiChatTool(req): Promise<ToolResult>` (in a new `electron/services/saiToolBridge.ts` or exported from where `onToolCall` lives). The existing socket `SwarmMcpHost.onToolCall` registration calls it (no behavior change for CLI mode); the new SDK MCP server's tool handlers also call it. This is the single source of truth for executing a SAI chat tool, so both transports share the renderer round-trip, timeouts, and image handling.

### In-process SDK MCP server

A new `electron/services/claudeBackend/saiMcpServer.ts` exports `buildSaiChatMcpServer(deps)` returning an SDK MCP server (`createSdkMcpServer` / `McpSdkServerConfigWithInstance`). It registers the 16 chat tools from the existing `SAI_TOOL_SCHEMA` registry (reuse the JSON `input_schema` — build the server via the `@modelcontextprotocol/sdk` `McpServer` instance so we don't hand-convert 16 schemas to Zod, then wrap as `{ type:'sdk', name:'sai', instance }`). Each tool's handler calls `dispatchSaiChatTool({ tool: <name>, input, workspace })` and maps the result to MCP content blocks: text → `{type:'text'}`, and an `__mcpImage` → `{type:'image', data, mimeType}` (mirroring `swarm-mcp-server.ts`'s wrapping). The model sees tools as `mcp__sai__sai_render_html`, etc.

### Wiring into SdkBackend / sdkOptions

- `sdkOptions` gains an `mcpServers?` passthrough; when provided, set `opts.mcpServers = { sai: <server> }` (and keep allowing built-in tools — do NOT set `strictMcpConfig`/`tools:''` for chat).
- `sdkBackend._createSession` builds the chat MCP server (via `buildSaiChatMcpServer`, injecting the shared dispatch) for `kind === 'chat'` and passes it through. The MCP server instance can be built once per backend (the tools are workspace-agnostic; `workspace`/`projectPath` is threaded into each call via the scope).
- `sdkOptions` appends `CHAT_RENDER_NUDGE` + `CHAT_GITHUB_WATCH_NUDGE` to the system prompt for chat (today only `metaPreamble` flows through `appendSystemPrompt`; add the two nudges, matching `buildArgs`).

### The renderer round-trip works the same

The SDK MCP tool handler runs in the Electron **main** process (where `SdkBackend` lives), so `dispatchSaiChatTool` can do the existing `swarm:tool-request`/`swarm:tool-response` IPC to the renderer and await the screenshot — identical to the socket path. No renderer changes.

### Error handling

A tool handler that throws (or a dispatch timeout/error) returns an MCP error content block (`isError: true` / an error text block) so the model sees the failure, matching the socket server's error frame behavior.

## Testing

- **Unit:** `saiMcpServer.test.ts` — building the server registers all 16 chat tools (names = `SAI_TOOL_SCHEMA` chat toolset); invoking a tool handler with a mocked `dispatchSaiChatTool` returns the right MCP content (text; and `__mcpImage` → image block); a dispatch error → error content. `sdkOptions.test.ts` — `mcpServers` set when provided; nudges appended for chat. `sdkBackend.test.ts` — `_createSession` for `kind:'chat'` passes an `mcpServers.sai` into the captured query options.
- **Shared-dispatch refactor:** existing swarm/ipc tests stay green (the socket host now calls the extracted function — behavior unchanged).
- **Real-app dogfood (the gate, like Phase 1):** in SDK mode, ask the agent to `render_html` a small snippet → the in-app render + screenshot appears in chat; try `render_component`, `render_mermaid`, `watch_github_run`. (The spike already proved the MCP transport works with the installed CLI.)
- `'cli'` default unchanged; full suite green; tsc clean.

## Non-goals / risks

- Orchestrator/swarm tools in SDK mode are deferred (separate phase). 
- If the renderer round-trip has any SDK-mode-specific timing issue (it shouldn't — same IPC), the dogfood surfaces it.
- Schema source of truth stays `SAI_TOOL_SCHEMA` (no duplication).

## Success criteria

1. In SDK mode, the model can call SAI chat tools (`mcp__sai__sai_render_html` etc.) and the rendered result + screenshot appear in chat — confirmed in the real app.
2. The chat nudges steer the model toward the render tools in SDK mode.
3. CLI mode behavior unchanged; the shared dispatch is the single execution path for both transports.
4. Unit tests cover server build + tool→dispatch mapping + sdkOptions/sdkBackend wiring; full suite green; tsc clean.
