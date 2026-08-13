# Codex Parity Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining verified Codex parity gaps through safe, independently testable delivery phases.

**Architecture:** Preserve the scoped Codex backend as the source of truth, map lifecycle state at the Electron boundary, and enable UI capabilities only after their backend path and tests exist.

**Tech Stack:** Electron, React, TypeScript, Vitest.

---

### Task 1: Settle Codex command cards

**Files:**
- Modify: `electron/services/codexBackend/sdkEventMap.ts`
- Modify: `tests/unit/electron/codexSdkEventMap.test.ts`
- Verify: `src/components/Chat/ChatPanel.tsx`, `src/components/Chat/ToolCallCard.tsx`

- [ ] Add a mapper test for an `item.updated` command event with output and require a partial `tool_result` envelope.
- [ ] Run the focused mapper test and observe the missing envelope.
- [ ] Emit an explicit partial command result for SDK command updates; retain the existing terminal result mapping for completed events.
- [ ] Re-run mapper and card tests; verify partial output remains running and a terminal empty output settles the same card.
- [ ] Commit the focused lifecycle change.

### Task 2: Enable scoped Codex sessions

**Files:**
- Modify: `src/providers/capabilities.ts`
- Modify: `tests/unit/providers/capabilities.test.ts`
- Verify: `electron/services/codexBackend/sdkBackend.ts`, `tests/unit/electron/codexSdkBackend.test.ts`

- [ ] Add capability tests requiring Codex terminal and multi-scope support.
- [ ] Run the focused capability test and observe the flags are disabled.
- [ ] Verify existing scoped backend tests cover independent active scopes, then enable only the two matching flags.
- [ ] Run capability and SDK backend suites.
- [ ] Commit the scoped capability enablement.

### Task 3: Enable Codex swarm

**Files:**
- Modify: `src/providers/capabilities.ts`
- Modify: `tests/unit/providers/capabilities.test.ts`
- Verify: `electron/services/codexBackend/sdkBackend.ts`, `tests/swarm/`

- [ ] Add a failing capability test for Codex orchestrator support.
- [ ] Run the focused test and observe the disabled flag.
- [ ] Verify the swarm launcher supplies scoped Codex runtime identity and has a safe unsupported fallback; implement any missing routing with test coverage.
- [ ] Enable the orchestrator capability only after the launcher and lifecycle suites pass.
- [ ] Commit the swarm phase.

### Task 4: Surface Codex MCP

**Files:**
- Modify: `src/providers/capabilities.ts`
- Modify: `tests/unit/providers/capabilities.test.ts`
- Verify: MCP host API, status UI, and secret-sanitization tests

- [ ] Add a failing capability test for Codex MCP.
- [ ] Verify the existing status/config path is provider-safe and has unavailable-state UI coverage.
- [ ] Enable Codex MCP navigation and add a regression test that the surface is visible only under Codex.
- [ ] Run MCP and capability suites.
- [ ] Commit the MCP phase.

### Task 5: App-server interaction, extensions guidance, and remote audit

**Files:**
- Verify: App-server request routing, remote transcript, settings capabilities, extension surfaces

- [ ] Create a capability matrix test that enumerates supported, preview-only, and guidance-only Codex experiences.
- [ ] Add tests for each live app-server interaction missing from the matrix before enabling its UI.
- [ ] Add explicit plugins/skills guidance if a supported management API remains absent.
- [ ] Run desktop/remote provider regression suites and the full unit suite.
- [ ] Run `npm run build`, `git diff --check`, and inspect the final worktree.
