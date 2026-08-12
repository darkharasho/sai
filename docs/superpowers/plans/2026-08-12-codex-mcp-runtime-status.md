# Codex MCP Runtime Status Implementation Plan

> **Execution:** use the established subagent-driven workflow: implementation, spec review, then quality review per task.

**Goal:** Give App Server Codex users a truthful, read-only view of MCP server runtime status without reusing Claude's JSON configuration controls or exposing sensitive configuration data.

**Architecture:** Add a small App Server backend status API around `mcpServerStatus/list` and `mcpServer/startupStatus/updated`.  It paginates with a bounded limit, normalizes only safe status fields, and exposes a dedicated `codex:mcpRuntimeStatus` IPC.  The renderer shows a provider-labelled Codex runtime section only when App Server is the active Codex backend.  Claude's MCP sidebar and all mutation/OAuth/reload operations remain untouched.

**Security boundary:** Do not read or write `~/.codex/config.toml`, use `config/*`, invoke OAuth/reload/tool calls, expose environment variables, headers, resources, OAuth URLs, raw errors, or server configuration.  SDK Codex reports the feature unavailable rather than showing stale/Claude-owned status.

## Task 1: Query and normalize App Server MCP runtime status

**Files:**
- Modify `electron/services/codexBackend/appServerClient.ts`
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Add/update focused client/backend tests

1. Add a typed, bounded `mcpServerStatus/list` query after initialization, requesting `detail: 'toolsAndAuthOnly'` and following cursors up to a fixed maximum page/count limit.
2. Normalize each result to a safe envelope: name, lifecycle status, bounded failure text, tool count, and coarse authentication state.  Drop all unknown/raw nested payloads and reject malformed entries safely.
3. Subscribe to `mcpServer/startupStatus/updated`, apply only sanitized updates to the matching App Server client/runtime, and make an explicit refresh return the current normalized snapshot.
4. Preserve client/source identity: a standard-client status update cannot mutate an orchestrator client snapshot or vice versa.  Clear snapshots on client failure/destroy.
5. Test pagination, malformed payloads, sanitizer omissions, client-scoped updates, failure cleanup, and no calls before handshake.

**Commit:** `feat(codex): read App Server MCP status`

## Task 2: Add a dedicated read-only Codex status bridge

**Files:**
- Modify `electron/services/codexBackend/index.ts`
- Modify `electron/services/codex.ts`
- Modify `electron/preload.ts`
- Modify `src/types.ts`
- Add dispatch/IPC/preload tests

1. Add a `getMcpRuntimeStatus` backend operation.  App Server returns sanitized data; SDK returns `{ available: false, reason }`.
2. Add a dedicated `codex:mcpRuntimeStatus` IPC/preload API; do not add endpoints that mutate config or reuse `mcp:*` Claude endpoints.
3. Route status to the scope-owning transport and return a precise unavailable/fallback reason if the selected session is SDK or App Server is unavailable.
4. Validate all IPC arguments and return data at the Electron boundary.  Keep status requests read-only and side-effect-free beyond the documented host query.
5. Test SDK unavailable, App Server success/failure, scope ownership, and no Claude service invocation.

**Commit:** `feat(codex): bridge MCP runtime status`

## Task 3: Show a provider-labelled Codex runtime section

**Files:**
- Modify the existing MCP settings/sidebar owner(s)
- Add component tests

1. Keep the existing installed/browse/add/edit/remove Claude MCP controls visually and behaviorally scoped to Claude.
2. For an App Server Codex workspace, display a read-only `Codex runtime` status section: server name, startup state, safe failure reason, tool count, and coarse auth state.
3. For SDK Codex or unavailable App Server, show a concise explanation that runtime MCP status requires Codex App Server; do not show a stale Claude list as Codex data.
4. Do not show OAuth links, config values, secrets, raw error stacks, or configuration controls in this slice.
5. Test provider switching, unavailable messaging, safe rendering, and no regression to Claude controls.

**Commit:** `feat(settings): show Codex MCP runtime status`

## Task 4: Verify and document

1. Run focused backend/IPC/preload/component tests, TypeScript, production build, and diff checks; separate inherited diagnostics from changed paths.
2. Audit no `config/*`, TOML filesystem writes, OAuth/reload/tool-call invocation, secret return, or cross-client snapshot mutation.
3. Record exact verification and deferred work: a separate confirmation-gated Codex config editor, reload/OAuth actions, per-tool policies, ephemeral SAI MCP bridge configuration, Remote/mobile status rendering, and plugins/skills management.

**Commit:** `docs: verify Codex MCP runtime status`
