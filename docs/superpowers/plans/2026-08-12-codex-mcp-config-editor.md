# Codex MCP Configuration Editor Implementation Plan

> **Execution:** use the established subagent-driven workflow: implementation, spec review, and quality review for every task.

**Goal:** Add an App Server-only, confirmation-gated editor for the user-owned Codex MCP server table, using version-checked host configuration APIs instead of rewriting TOML.

**Architecture:** The App Server backend reads `config/read` with layer metadata and extracts only the User-layer `mcp_servers` table.  A dedicated Codex config bridge returns a sanitized editable snapshot plus a version.  The renderer stages a whole replacement table, shows a redacted diff/explicit global-impact confirmation, and submits exactly one `config/batchWrite` with `expectedVersion` and `reloadUserConfig: true`.  On success it calls `config/mcpServer/reload`, rereads config, and displays the fresh snapshot.  Conflicts, requirement/layer/validation errors, and reload failures never retry automatically or fall through to Claude controls.

**Security boundary:** This applies to `$CODEX_HOME/config.toml` globally, not the project layer.  No direct TOML/filesystem writes, raw effective/project config copying, broad config mutation, auto-retry, raw secrets, OAuth flow, or generic config editor.  Initial supported connection shapes are bounded stdio (`command`, `args`, optional env-variable references) and HTTP (`url`, non-secret header values); literal token/bearer/credential-like values are rejected or redacted.  Existing turns are not mutated; UI clearly says reload applies to new/next active work.

## Task 1: Add safe host config read/write/reload contracts

**Files:**
- Modify `electron/services/codexBackend/appServerClient.ts`
- Modify `electron/services/codexBackend/appServerBackend.ts`
- Modify `electron/services/codexBackend/types.ts`
- Create/modify focused client/backend config tests

1. Add typed App Server calls for `config/read`, `config/batchWrite`, and `config/mcpServer/reload`, all after handshake and on the standard App Server client only.
2. From the read result, extract only User-layer `mcp_servers`; never treat workspace/plugin/effective-only entries as editable.  Return a sanitized config snapshot: safe server records, user config version, and a global-impact label.
3. Validate staged records strictly: unique safe names; stdio command/args and optional env-variable references; HTTP(S) URLs and non-secret header values.  Reject unknown keys, literal sensitive values, oversized/deep input, and attempts to submit a project/effective entry.
4. Write exactly one whole-table `config/batchWrite` replacement with User-layer `expectedVersion` and `reloadUserConfig: true`.  Do not write if the backend snapshot/version is stale or write validation fails.
5. On successful write, call reload then reread.  Map host errors to coarse typed errors; no automatic retry after a version conflict.  Invalidate snapshots on connection failure/generation change.
6. Test headerless wire order, layer filtering, validation/redaction, exact batch payload, conflict/no retry, reload/reread sequence, and no direct filesystem/config other calls.

**Commit:** `feat(codex): add safe MCP config host API`

## Task 2: Bridge the versioned config workflow through Electron

**Files:**
- Modify `electron/services/codexBackend/index.ts`
- Modify `electron/services/codex.ts`
- Modify `electron/preload.ts`
- Modify `src/types.ts`
- Add dispatch/IPC/preload tests

1. Add dedicated read and confirmed-write IPC endpoints with App Server ownership checks.  SDK returns an explicit unavailable reason.
2. The write endpoint takes the expected version and bounded staged record list; Electron repeats all validation and rejects stale/malformed payloads before reaching the host.
3. Require an explicit confirmation flag/token in the write payload; it is not a security bypass, but prevents accidental submission from a draft UI event.
4. Return only the refreshed sanitized snapshot or a typed coarse error.  Do not expose raw config, origins, layers, paths beyond the user-global label, or host error stacks.
5. Test cross-scope/backend refusal, malformed input, no Claude MCP service usage, conflict propagation, and success refresh.

**Commit:** `feat(codex): bridge confirmed MCP config edits`

## Task 3: Build a separate confirmation-gated Codex config preview UI

**Files:**
- Create `src/components/MCP/CodexMcpConfigPanel.tsx`
- Modify the MCP sidebar/settings owner(s)
- Add component tests

1. Show this panel only for App Server Codex.  SDK/fallback shows the existing runtime-status explanation and no editable controls; Claude continues using its existing editor.
2. Present user-owned MCP records with add/edit/remove.  Clearly label the editor as global Codex configuration and state that existing turns are unchanged until new/next activity.
3. Stage changes locally.  Before saving, show a redacted, deterministic diff and a mandatory explicit confirmation.  Do not submit on field blur, toggle, or first click.
4. On success replace the local draft with the refreshed snapshot.  On conflict, show that configuration changed elsewhere, discard/mark the draft stale, refresh, and require the user to review/confirm again.  Show coarse validation/layer/host-policy errors without secrets.
5. Test no auto-save, global warning, add/edit/remove diff confirmation, conflict behavior, secret masking/rejection, and unchanged Claude MCP UI.

**Commit:** `feat(settings): add Codex MCP config preview`

## Task 4: Verify and document

1. Run focused protocol/backend/IPC/preload/component tests, full unit suite, TypeScript and production builds (distinguishing inherited diagnostics), plus diff checks.
2. Audit exact batch-write shape, expected-version handling, confirmation requirement, config/reload ordering, redaction, no direct TOML access, no project/effective entry copying, and no automatic retry.
3. Record results and remaining work: OAuth/config sign-in, per-tool policies, ephemeral SAI MCP bridge config, remote/mobile actions, plugins/skills management, and image input.

**Commit:** `docs: verify Codex MCP config editor`
