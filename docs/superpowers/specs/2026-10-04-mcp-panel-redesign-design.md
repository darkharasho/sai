# MCP panel redesign + in-app OAuth

**Date:** 2026-10-04
**Status:** Draft — awaiting review

## Goal

Make the MCP sidebar a place where you can see and fix what's wrong with your MCP servers without
leaving SAI. The motivating case: a server like Cloudflare reports `needs-auth`, and today the only
fix is `claude` → `/mcp` in a terminal. After this work, signing in is one click — from the panel or
from a nudge in the chat that hit the problem — and the chat you're in gets the tools immediately.

**Success criteria**

1. A `needs-auth` server can be signed into from SAI; after browser approval it shows connected in
   the current chat with no restart.
2. The panel shows real live status (not the enabled flag), error text for failed servers, and the
   server's tools.
3. Reconnect, enable/disable, sign out, edit and remove all take effect (live where the SDK allows).
4. The list includes every server the session actually loads: global, project, plugin, claude.ai.

## Current state (what's broken)

- `McpDetail` header shows Connected/Disconnected from `server.enabled`, not runtime status.
- Restart is a no-op (`McpSidebar.handleRestart` just reloads the list).
- Tools never render — `window.sai.mcpGetTools` doesn't exist in preload.
- Enable/disable only edits `~/.claude.json`; running sessions don't change.
- No OAuth handling; `needs-auth` is a red pill with no action.
- Project `.mcp.json` and claude.ai connectors are not listed.
- Runtime status updates only on `system/init` frames and is "latest wins across scopes".
- Add form has no headers field.
- Partially-disabled plugins re-key their servers as `<short>-<name>` (`externalMcp.ts:129`), which
  hashes to a different CLI OAuth token key than `plugin:<short>:<name>`.

## Approach

All live operations go through the **SDK session for the panel's scope** (the active chat, via the
`scope` prop McpSidebar already receives). If that scope has no live session, warm one with the
existing warm-session mechanism (`SdkBackend._warmForCommands`). Rejected alternatives: a dedicated
hidden control session (auth would land in a different session than the chat; extra process), and
implementing OAuth ourselves (re-implements CLI token keying; breaks silently on CLI updates).

### SDK surface used

Typed `Query` methods: `mcpServerStatus()`, `reconnectMcpServer(name)`, `toggleMcpServer(name, enabled)`.

Untyped-but-present methods (in `sdk.mjs`, request types in `SDKControlRequestInner`):
`mcpAuthenticate(name, redirectUri?)`, `mcpClearAuth(name)`, `mcpSubmitOAuthCallbackUrl(name, url)`.
These are wrapped in one adapter (`electron/services/claudeBackend/mcpControl.ts`) that
feature-detects each method. If missing (future SDK drops them), the UI falls back to
"Sign in from a terminal: `claude` → `/mcp`" instead of a Sign in button.

`mcp_authenticate` response: `{ authUrl?, requiresUserAction, callbackExpected?, redirectScheme?, state?, callbackPort? }`.
`requiresUserAction: false` means tokens are already valid → just reconnect. The CLI runs its own
localhost callback listener and reconnects the server itself after success; it does not open a
browser, so SAI opens `authUrl` with `shell.openExternal`.

**Risk to verify first (plan step 1, spike):** that `mcp_authenticate` works for servers SAI passes in
via `options.mcpServers` / `plugins` (not just CLI-discovered ones), and that the post-callback
reconnect happens in the same live session. If it doesn't, stop and revisit.

## Components

### Main process

**`mcpControl.ts`** (new) — thin adapter over a scope's live `Query`:
- `ensureSession(scopeKey, projectPath)` → warm if absent; returns the query.
- `status(scope)` → `McpServerStatus[]` (full: error, scope, serverInfo, tools, config).
- `reconnect`, `toggle`, `authenticate`, `submitCallbackUrl`, `clearAuth`.
- `capabilities()` → which untyped methods exist.

**`mcpRuntimeStatus.ts`** — re-key the store by `scopeKey` (drop latest-wins-across-scopes). Store
full `McpServerStatus` entries, not just `{name,status}`. Init frames still seed it; every control
call refreshes it from `mcpServerStatus()` and pushes `mcp:runtime-status` with the scope.

**Auth session tracking** — after `authenticate` returns an `authUrl`, main polls `mcpServerStatus()`
for that scope every 2s until the server is `connected`, `failed`, or 5 minutes pass; each change is
pushed. Cancel stops polling (the CLI listener times out on its own).

**`mcp.ts` config listing** — extend `mcp:list` to also return project servers from
`<projectPath>/.mcp.json` (`source: 'project'`). claude.ai connectors are not in any file; they come
only from live status entries with `scope: 'claudeai'` (`source: 'claudeai'`). Add/update/remove learn
a `source` target: `user` → `~/.claude.json`, `project` → `<projectPath>/.mcp.json`. Plugin and
claude.ai servers are never edited/removed. Add `headers` to config read/write for http/sse.

**`externalMcp.ts`** — stop re-keying partially-disabled plugin servers as `<short>-<name>`; keep the
`plugin:<short>:<name>` key so OAuth tokens are shared with the CLI. Update `runtimeFor` name
fallbacks accordingly.

**IPC** (preload + handlers): `mcp:status(scope)`, `mcp:reconnect(scope,name)`,
`mcp:toggle(scope,name,enabled)` (live toggle + persist via existing `setDisabled`),
`mcp:authenticate(scope,name)`, `mcp:authCancel(scope,name)`, `mcp:submitCallbackUrl(scope,name,url)`,
`mcp:signOut(scope,name)`, `mcp:capabilities()`. Remove the dead `mcpGetTools` call.

### Renderer

Layout per the approved mockup (`MCP panel redesign — mockup v1`):

**List (`McpSidebar`)**
- Installed tab badge = count of servers needing attention (`needs-auth` or `failed`).
- **Needs attention** section on top (red-tinted box): each row has its fix inline — `Sign in`
  (needs-auth) or `Retry` (failed → reconnect). Subtitle shows the error text for failed servers.
- Remaining servers grouped: **Global** (~/.claude.json), **Project** (.mcp.json), **Plugins**,
  **claude.ai** (read-only). Empty groups hidden.
- Row: icon, name, subtitle `transport · N tools` / `connecting…` / `disabled` / error; status dot
  (green connected, pulsing amber pending, red failed/needs-auth, hollow disabled).
- Merge rule: config entries joined with live status by name (using the existing plugin-name
  fallback); live-only entries (claude.ai, anything the CLI discovered that SAI didn't list) are shown
  in the group matching their `scope`.

**Detail (`McpDetail`)**
- Header pill from live status: `Connected · <serverInfo name vN>`, `Connecting…`, `Needs sign-in`,
  `Failed — <error>`, `Disabled`.
- Actions: Reconnect, Enable/Disable, Sign out (http/sse only, when capable), Edit (user/project
  only), Remove (user/project only).
- **Auth card** when signing in: "Finish signing in in your browser", the URL, `Open again`,
  `Copy link`, `Cancel`, and a collapsed "Paste redirect URL" field (→ `submitCallbackUrl`) for when
  the localhost callback can't be reached.
- Tools section from live status (`name` + description, first N with "+ more" expand).
- Config section: command/args or url, env and header values masked.

**Edit (`McpAddServer` → `McpServerForm`)** — the Add form gains a mode: `add` | `edit`, prefilled
from the server, name read-only in edit. Adds a **headers** key/value section for http/sse. Saving an
edit to a live server triggers a reconnect.

**Chat nudge (`McpAuthNudge`, new)** — strip above the composer when the active chat's scope has any
`needs-auth` server: "**<name>** needs sign-in — its tools aren't available in this chat. [Sign in] ✕".
Multiple servers collapse into "3 servers need sign-in [Review]" (opens the panel). Sign in runs the
same flow; while waiting the strip shows "Waiting for browser…". Disappears when the server connects.
✕ dismisses for that scope until the set of needs-auth servers changes.

**Codex provider** — unchanged; its read-only branch stays as-is.

## Error handling

- Control call throws / returns error (e.g. "Server not found", unsupported transport) → inline error
  text on the row/detail; status re-fetched.
- `authenticate` on an unsupported server (stdio) → no Sign in button is offered for stdio.
- Auth timeout (5 min) → auth card shows "Sign-in didn't complete" with Retry.
- No live session and warming fails → panel falls back to config-only view with a "Live status
  unavailable" note; actions that need a session are disabled.
- Edit/remove write failures surface the existing `{error}` path.

## Testing

- Unit: `mcpControl` (feature detection, warm-on-demand, error mapping) with a fake Query.
- Unit: `mcpRuntimeStatus` per-scope keying + full-entry storage.
- Unit: `mcp.ts` project `.mcp.json` list/add/update/remove, headers round-trip.
- Unit: `externalMcp` keeps `plugin:<short>:<name>` keys.
- Component: `McpSidebar` grouping + needs-attention section + badge count; `McpDetail` pills/actions
  per state, auth card states; `McpServerForm` edit prefill + headers; `McpAuthNudge` show/dismiss/
  collapse.
- Live smoke (manual, after restart): sign into Cloudflare from the chat nudge; confirm tools usable
  in the same chat; confirm `claude` CLI sees the same tokens; Sign out; Reconnect a failed server.

## Out of scope

- Logs / stderr viewer for stdio servers.
- Registry (Browse tab) changes.
- Editing plugin or claude.ai servers.
- Codex MCP auth.
