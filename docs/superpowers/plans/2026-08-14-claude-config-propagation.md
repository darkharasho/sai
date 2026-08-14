# Claude Configuration Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Claude's selected model and effort consistent for Swarm tasks and automatic orchestrator status turns.

**Architecture:** Extend the Swarm runner's existing typed dispatch contract with an effort argument. Centralize automatic orchestrator status dispatch in an App helper that supplies the active orchestrator model and effort, so both task and batch notifications use the same configuration.

**Tech Stack:** TypeScript, React, Vitest.

---

### Task 1: Forward effort to Swarm task providers

**Files:**
- Modify: `src/lib/swarmTaskRunner.ts`
- Modify: `tests/swarm/swarmTaskRunner.test.ts`

- [ ] **Step 1: Write the failing test**

Add a Claude task with `effort: 'medium'` and assert its provider send bridge receives `'medium'` in the effort argument.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/swarm/swarmTaskRunner.test.ts`

Expected: FAIL because task effort is not represented or forwarded.

- [ ] **Step 3: Write minimal implementation**

Add `effort` to the task runner input and forward it in the existing Claude send call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/swarm/swarmTaskRunner.test.ts`

Expected: PASS.

### Task 2: Keep the orchestrator configuration on automatic status turns

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/unit/App.test.tsx` or focused extracted helper test

- [ ] **Step 1: Write the failing test**

Exercise automatic task-status and batch-status dispatch and assert both calls receive the configured orchestrator model and current effort.

- [ ] **Step 2: Run test to verify it fails**

Run the focused Vitest test.

Expected: FAIL because both calls currently pass `undefined` model and effort.

- [ ] **Step 3: Write minimal implementation**

Build the status send configuration from `swarm.orchestratorModel` with the app-wide model fallback and current effort; reuse it for both notification paths. Supply global effort when spawning Swarm tasks.

- [ ] **Step 4: Run focused tests to verify they pass**

Run the focused Vitest test and `npx vitest run tests/swarm/swarmTaskRunner.test.ts`.

Expected: PASS.

### Task 3: Verify the complete change

**Files:**
- Modify: user setting `/home/mstephens/.config/sai/settings.json`

- [ ] **Step 1: Clear the SAI workspace override**

Remove only `/home/mstephens/Documents/GitHub/sai` from `claude.workspaceOverrides`, preserving every other workspace's settings.

- [ ] **Step 2: Run the full suite and production build**

Run: `npm test && npm run build`

Expected: all test files pass and TypeScript/Vite production build exits 0.
