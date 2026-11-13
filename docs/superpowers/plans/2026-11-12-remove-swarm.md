# Remove Swarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete swarm mode (orchestrator chat, task runners, approvals, swarm MCP, Codex swarm dynamic tools) end to end, leaving every normal chat path unchanged.

**Architecture:** Compiler-driven deletion in four reviewable slices: (1) make persisted data safe to load once swarm is gone, (2) remove the renderer side, (3) remove the Electron side, (4) verify. Each slice ends with `tsc` clean and the test suite green.

**Tech Stack:** Electron, React, TypeScript, Vite, Vitest (maxWorkers already 2 in `vitest.config.ts`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-12-remove-swarm-design.md`

## Global Constraints

- Old swarm data is dropped, not migrated. Delete the `sai-swarm` IndexedDB database (one-time, best effort) and stop reading `swarm.*` settings keys.
- Do not auto-delete users' `swarm/*` git branches or worktrees; list them in release notes instead.
- Non-swarm behavior must not change: Claude/Codex/Gemini/Kimi chats, meta workspaces, background agents, task tabs/rail, turn completion, notifications, stuck-state reconciler.
- Leave the `kind` / `swarmTaskId` IndexedDB *indexes* in `chatDb.ts` in place (removing an index needs a schema bump for no gain); just stop writing/reading those fields.
- Never `git checkout <sha>` in this repo during the work (detaches HEAD); use `git show`.
- Typecheck: `npx tsc --noEmit -p .` (and `-p electron` if a separate tsconfig exists — check `tsconfig*.json`). Tests: `npx vitest run --maxWorkers=2`.

## Review Focus

1. **Existing users' saved swarm sessions** — `chatDb` holds rows with `kind: 'task'` or `kind: 'orchestrator'`. After removal they must not appear as chats (sidebar, chat list, mobile remote `listSessions`) or crash the loader. Covered by Task 1 tests.
2. **Turn completion in `App.tsx`** — swarm branches sit inside the done/turnSeq/notification logic. Deleting the wrong half of an `if (kind === 'orchestrator') … else …` breaks normal chats. Keep `tests/unit/App.superseded-completion.test.tsx` and `App.persistence-on-swap.test.tsx` passing with only swarm-specific cases removed (Task 2).
3. **Codex app-server backend** without the orchestrator client — standard Codex chats must still start, stream and complete; `appServerBackend.test.ts` non-swarm cases must stay (Task 3).
4. **Claude SDK scopes** — `kind` collapses to chat; `sdkOptions` bypass logic must still honor `permMode === 'bypass'` for normal chats (Task 3 test).
5. **Settings modal** with a stale `swarm` page persisted as last-open page → must fall back to `general`, not render blank (Task 2 test).

---

### Task 1: Make persisted data safe without swarm

**Files:**
- Modify: `src/chatDb.ts` (`dbGetSessions`, `dbGetAllSessions`)
- Modify: `src/lib/remoteProxyClient.ts:40-42`
- Create: `src/lib/dropLegacySwarmData.ts`
- Modify: `src/App.tsx` (call it once at startup, next to the existing launch sweep)
- Test: `tests/unit/chatDb.test.ts`, `tests/unit/lib/dropLegacySwarmData.test.ts`

**Interfaces:**
- Produces: `isChatSessionRow(s: { kind?: unknown }): boolean` exported from `src/chatDb.ts` (true when `kind` is undefined or `'chat'`); `dropLegacySwarmData(): Promise<void>` from `src/lib/dropLegacySwarmData.ts`.

- [ ] **Step 1: Write failing tests**
  - `chatDb.test.ts › dbGetSessions excludes legacy swarm rows`: save three sessions for one project with `kind` undefined, `'task'`, `'orchestrator'`; expect `dbGetSessions` to return only the first.
  - `dropLegacySwarmData.test.ts › deletes the sai-swarm database`: spy `indexedDB.deleteDatabase`; expect it called with `'sai-swarm'`; resolves even when the request fires `onerror` or `onblocked`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/unit/chatDb.test.ts tests/unit/lib/dropLegacySwarmData.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Filter with `isChatSessionRow` in both `dbGetSessions` and `dbGetAllSessions`; change remote `listSessions` to plain `dbGetSessions` (already filtered). `dropLegacySwarmData` wraps `indexedDB.deleteDatabase('sai-swarm')` in a promise that resolves on success/error/blocked. Leave `swarm.*` settings keys in place, unread (don't add a settings-delete API for them). Call it fire-and-forget once on app start.
- [ ] **Step 4: Run** the same command — expect PASS; then full `npx vitest run --maxWorkers=2` — expect PASS.
- [ ] **Step 5: Commit** `fix(chat): ignore legacy swarm session rows; drop sai-swarm db on launch`

### Task 2: Remove swarm from the renderer

**Files:**
- Delete: `src/components/Swarm/**`, `src/components/Settings/SwarmSettings.tsx`, `src/swarmDb.ts`, `src/lib/swarm*.ts`, `src/lib/orchestratorSystemPrompt.ts`, `src/lib/orchestratorSlashCommands.ts`, `src/lib/orchestratorToolDrift.ts`, `src/lib/codexAppServerSwarmApproval.ts`, `tests/swarm/**`, `tests/e2e/swarm.spec.ts`, swarm stories under `src/test-harness/stories/`
- Modify: `src/App.tsx`, `src/components/Chat/ChatPanel.tsx` (drop `claudeKind`, `claudeOrchestratorContext`, and the orchestrator-only render hooks if nothing else passes them), `src/components/NavBar.tsx` (Swarm button, `swarmApprovalCount`, `hasOrchestrator`), `src/components/SettingsModal.tsx` (swarm page, `swarm.*` reads/writes incl. the preset at ~line 546-553), `src/providers/capabilities.ts` (`hasOrchestrator`, `codexSwarmStatus`), `src/lib/metaSystemPrompt.ts:23`, `src/types.ts` (`SwarmTask`, `SwarmApproval`, `SwarmTaskStatus`, `swarmTaskId`, `SessionKind` → remove or `'chat'` only), `src/components/MCP/mcpView.ts`, `src/components/Chat/githubRunResolver.ts`, `src/components/Chat/ChatMessage.tsx`, `src/lib/chatActivity.ts`, `src/lib/saiTools.ts`, `vitest.config.ts` (`swarm` project)
- Test: update `tests/unit/App.*.test.tsx`, `tests/unit/components/NavBar.test.tsx`, `tests/unit/providers/capabilities.test.ts`, `tests/unit/metaSystemPrompt.test.ts`, `tests/unit/components/Chat/ChatPanel.test.tsx`, `tests/unit/render/renderToolCallCard.entry.test.ts`, and others `tsc`/vitest flag

**Interfaces:**
- Consumes: Task 1's `isChatSessionRow`.
- Produces: `ChatPanel` no longer accepts `claudeKind`/`claudeOrchestratorContext`; the `claude:start` IPC call from ChatPanel passes `kind: 'chat'` (Electron side still accepts the arg until Task 3). `window.sai.swarm` and `codexSwarmStatus` are no longer called anywhere in `src/`.

- [ ] **Step 1: Write failing tests**
  - `NavBar.test.tsx › has no Swarm button`: `queryByLabelText('Swarm')` is null.
  - `SettingsModal` test (create `tests/unit/components/SettingsModal.swarmRemoved.test.tsx` if none exists): with persisted last page `'swarm'`, the General page renders; no "Swarm" nav item.
  - `metaSystemPrompt.test.ts`: output does not contain `swarm`.
- [ ] **Step 2: Run** those tests — expect FAIL.
- [ ] **Step 3: Delete the files listed above, then fix every `tsc` error.** In `App.tsx`, remove swarm state, scheduler, hydrate, approval routing, orchestrator session bootstrap, swarm sidebar/diff modal/quit modal, and `kind === 'task'` skips (sessions are always chats now). When a branch reads `if (swarm…) A else B`, keep B. Do not touch turnSeq/done/notification logic beyond removing swarm-only conditions.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .` — expect 0 errors; `npx vitest run --maxWorkers=2` — expect PASS. Remove only swarm-specific test cases from App tests; every non-swarm case stays and passes.
- [ ] **Step 5: Run** `grep -rniE 'swarm|orchestrator' src | grep -v 'chatDb.ts'` — expect no hits (the `chatDb` index migration lines are the only allowed survivors).
- [ ] **Step 6: Commit** `refactor: remove swarm from the renderer`

### Task 3: Remove swarm from Electron

**Files:**
- Delete: `electron/swarm-mcp-server.ts`, `electron/services/swarm.ts`, `electron/services/swarmMcpHost.ts`, `electron/services/swarmMcpConfig.ts`, `electron/services/swarmWorktreeCleanup.ts`, `electron/services/claudeBackend/swarmMcpServer.ts`, `electron/services/codexBackend/appServerDynamicTools.ts`, `electron/services/codexBackend/dynamicToolBridge.ts` (both swarm-only — confirm no non-swarm exports are imported elsewhere first)
- Modify: `electron/main.ts`, `electron/preload.ts` (`swarm` namespace, `codexSwarmStatus`), `src/types.ts` (matching `window.sai` typings), `electron/services/claude.ts`, `electron/services/codex.ts`, `electron/services/claudeBackend/{sdkBackend,sdkOptions,index,types}.ts` (`kind` → chat only, `buildSwarmMcpServer`, orchestrator system prompt), `electron/services/codexBackend/{appServerBackend,index,types,chatMcpConfig,appServerEventMap}.ts` (orchestrator client kind, `getSwarmStatus`), `electron/services/workspace.ts`, `electron/services/mcpToolContent.ts`, `electron/services/browserBridgePaths.ts`, `electron/services/saiToolBridge.ts`, `electron/services/loadGuard/index.ts` (comment), `vite.config.ts:32` (swarm-mcp-server entry); remove `git.ts` helpers only if `tsc --noUnusedLocals`-style search shows no remaining callers
- Test: update `tests/unit/electron/{appServerBackend,sdkBackend,sdkOptions,codexBackendDispatch,dynamicToolBridge,codexChatMcpConfig,appServerEventMap,claudeBuildArgs,claudeBackendDispatch,chatNudges,codexSdkBackend}.test.ts`, `tests/unit/services/claude.test.ts`, `tests/unit/preload.test.ts`; delete `tests/unit/electron/dynamicToolBridge.test.ts` with its module

**Interfaces:**
- Consumes: Task 2 (renderer no longer calls `window.sai.swarm`, `codexSwarmStatus`, or passes non-chat kinds).
- Produces: `claude:start` / backend `start` args no longer carry `kind` or `orchestratorContext`; `buildSdkOptions` input drops `kind` and `systemPromptOverride` if only the orchestrator used it.

- [ ] **Step 1: Write failing tests**
  - `sdkOptions.test.ts › bypass permMode still bypasses for chat`: `permMode: 'bypass'` → options use bypassPermissions; `permMode: 'default'` → not bypass.
  - `preload.test.ts › exposes no swarm API`: exposed `sai` object has no `swarm` key and no `codexSwarmStatus`.
- [ ] **Step 2: Run** those — expect the preload test to FAIL (sdkOptions test may already pass; it pins behavior through the refactor).
- [ ] **Step 3: Delete the files listed, then fix every `tsc` error.** Codex app-server backend keeps only the `'standard'` client path. Remove IPC handlers registered by `registerSwarmHandlers` and swarm MCP config cleanup at startup.
- [ ] **Step 4: Run** `npx tsc --noEmit -p .` (plus electron tsconfig if separate) — 0 errors; `npx vitest run --maxWorkers=2` — PASS; `npx vite build` — succeeds with no swarm entry.
- [ ] **Step 5: Run** `grep -rniE 'swarm|orchestrator' electron src tests vite.config.ts vitest.config.ts | grep -v 'src/chatDb.ts'` — expect no hits.
- [ ] **Step 6: Commit** `refactor: remove swarm from electron (MCP server, codex orchestrator, IPC)`

### Task 4: End-to-end verification

**Files:** none (fix-forward in the owning file if anything fails)

- [ ] **Step 1: Run** `npm run build` — expect success.
- [ ] **Step 2: Run** `npx playwright test` — expect PASS (swarm spec gone; other specs unchanged).
- [ ] **Step 3: Dev smoke** (use the `run` skill): launch the app; confirm no Swarm nav button or settings page; send a Claude chat message and a Codex chat message, each completes and the workspace "finished" marker behaves as before; reopen an existing chat from history.
- [ ] **Step 4: Note** for release notes: "Swarm mode removed. Any leftover `swarm/*` branches/worktrees in your repos are untouched; delete them with `git branch -D` / `git worktree remove` if unwanted."
- [ ] **Step 5: Commit** any fix-forward changes.
