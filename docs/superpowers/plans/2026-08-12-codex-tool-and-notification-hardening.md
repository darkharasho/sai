# Codex Tool and Notification Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex/MCP tool events safe for the chat renderer and notify users when a Codex chat turn completes.

**Architecture:** Validate untrusted provider envelopes at the renderer boundary, normalize MCP content in the Codex adapter, and inject the existing notification service into the Codex SDK backend.

**Tech Stack:** Electron, React, TypeScript, Vitest.

---

### Task 1: Guard renderer tool envelopes

**Files:**

- Modify: `src/components/Chat/ChatPanel.tsx`
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] Add a failing test that emits user and assistant messages with object `message.content` and verifies the listener does not throw.
- [ ] Run `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx` and confirm the current renderer throws an iterable TypeError.
- [ ] Require `Array.isArray(message.content)` before traversing tool-result and assistant blocks.
- [ ] Re-run the targeted ChatPanel test and confirm it passes.

### Task 2: Normalize malformed Codex MCP results

**Files:**

- Modify: `electron/services/codexBackend/sdkEventMap.ts`
- Test: `tests/unit/electron/codexSdkEventMap.test.ts`

- [ ] Add a failing mapper test for a completed MCP item whose `result.content` is an object instead of an array.
- [ ] Run `npm run test:unit -- tests/unit/electron/codexSdkEventMap.test.ts` and confirm the mapper fails before producing an envelope.
- [ ] Map only array MCP content blocks; retain structured output when present.
- [ ] Re-run the targeted mapper test and confirm it passes.

### Task 3: Restore Codex completion notifications

**Files:**

- Modify: `electron/services/codexBackend/sdkBackend.ts`
- Modify: `electron/services/codexBackend/index.ts`
- Test: `tests/unit/electron/codexSdkBackend.test.ts`

- [ ] Add failing tests proving a completed chat turn invokes a completion hook once and task, failed, and interrupted turns do not.
- [ ] Run `npm run test:unit -- tests/unit/electron/codexSdkBackend.test.ts` and confirm the notification expectation fails.
- [ ] Inject a completion hook into the SDK backend and call it only when a mapped `turn.completed` reaches a current chat turn; wire production to `notifyCompletion`.
- [ ] Re-run the targeted backend test and confirm it passes.

### Task 4: Verify the integrated change

**Files:**

- Verify: `src/components/Chat/ChatPanel.tsx`, `electron/services/codexBackend/sdkEventMap.ts`, `electron/services/codexBackend/sdkBackend.ts`, `electron/services/codexBackend/index.ts`

- [ ] Run all three targeted unit suites.
- [ ] Run `npm run build` to type-check and build the project.
- [ ] Inspect `git diff --check` and `git status --short` to ensure only the scoped files changed.
