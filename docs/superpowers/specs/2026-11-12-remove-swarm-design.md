# Remove swarm mode

Date: 2026-11-12 · Status: draft for approval · Size: mechanical, large

## Why

Swarm (orchestrator chat + worktree-isolated task runners + approval tray) never
worked reliably, and the main conversation now does the same job inline with
background agents. It is ~60 files of code that keeps costing us bugs (the hidden
codex orchestrator session behind the "white done marker" bug, leaked `swarm/*`
branches, stuck-state edge cases).

## Goals

- Delete swarm mode end to end: UI, orchestrator, runners, MCP server/host,
  persistence, settings, prompts, slash commands, tests.
- Leave every non-swarm path (Claude/Codex/Gemini/Kimi chats, meta workspaces,
  background agents, task tabs) behaving exactly as today.

## Non-goals

- Migrating swarm history anywhere. Existing swarm data is dropped.
- Replacing swarm with anything. The inline + background-agent flow is the replacement.

## Anti-goals

- Breaking normal chats' turn completion / stuck-working / notification logic while
  ripping out orchestrator branches in `App.tsx`, `ChatPanel.tsx`, `claude.ts`, `codex.ts`.
- Leaving dead IPC channels or preload methods that still reference removed services.

## Approaches

Only one sensible way: delete it in one branch, compiler-driven (remove the swarm
modules, then fix every import/type error until `tsc` and the test suite are
clean). A feature flag that hides it was rejected — the user wants the code gone,
and a flag keeps all the coupling we're trying to remove.

## Scope (from recon)

- `src/components/Swarm/**`, `src/components/Settings/SwarmSettings.tsx`
- `src/lib/swarm*.ts`, `orchestratorSystemPrompt.ts`, `orchestratorSlashCommands.ts`,
  `orchestratorToolDrift.ts`, `codexAppServerSwarmApproval.ts`, `swarmDb.ts`
- `electron/swarm-mcp-server.ts`, `electron/services/swarm*.ts`,
  `electron/services/claudeBackend/swarmMcpServer.ts`
- Swarm branches in shared files: `App.tsx`, `ChatPanel.tsx` (`claudeKind`,
  `claudeOrchestratorContext`), `NavBar.tsx`, `SettingsModal.tsx`, `types.ts`,
  `chatDb.ts`, `metaSystemPrompt.ts`, `mcpView.ts`, `githubRunResolver.ts`,
  `remoteProxyClient.ts`, `capabilities.ts`, `electron/main.ts`, `preload.ts`,
  `claude.ts`, `codex.ts`, `claudeExit.ts`, `git.ts`, `workspace.ts`,
  codex backend files, `mcpToolContent.ts`, `browserBridgePaths.ts`,
  test-harness stories, and swarm tests.
- Build config: any electron-builder / vite entry for the swarm MCP server.

## Decided

- Old swarm data: drop it. Delete the `swarmDb` IndexedDB database on startup
  (one-time, best effort) and remove swarm settings keys.
- Leftover `swarm/*` git branches/worktrees: *my call* — do not auto-delete user
  branches once the cleanup service is gone; mention them in release notes.

## Left to the builder

- Whether `claudeKind`/scope concepts collapse entirely or keep a single value.
- Order of deletion; keep commits reviewable (UI, lib, electron, cleanup).
