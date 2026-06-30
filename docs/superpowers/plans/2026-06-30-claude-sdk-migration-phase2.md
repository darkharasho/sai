# Claude SDK Migration — Phase 2 (Approvals + AskUserQuestion + ExitPlanMode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Wire SDK-mode tool approvals (via `canUseTool`) and the AskUserQuestion / ExitPlanMode flows (via tool-in-stream detection + answer injection) into `SdkBackend`, driving the renderer's existing cards.

**Architecture:** `sdkOptions.ts` gains a `canUseTool?` passthrough (set for non-bypass). `sdkBackend.ts` builds the `canUseTool` callback (emits `approval_needed`, awaits a decision via a `pendingApprovals` map), implements `approve` to resolve it, detects `AskUserQuestion`/`ExitPlanMode` tool_use in the drain to emit `question_needed`/`plan_review_needed`, and implements `answerQuestion`/`answerPlanReview` to push follow-up `SDKUserMessage`s. Renderer/IPC/`types.ts` are unchanged.

**Tech Stack:** TypeScript (strict), Electron main, `@anthropic-ai/claude-agent-sdk@0.3.196`, Vitest (`--maxWorkers=2`).

## Global Constraints

- Vitest `--maxWorkers=2`; mocks via `vi.hoisted()`.
- `'cli'` stays default; full existing suite stays green; no renderer/preload/IPC-shape/`types.ts` changes (the events + `ClaudeBackend.approve/answerQuestion/answerPlanReview` already exist).
- The SDK `query` (and `canUseTool` invocation) is MOCKED in unit tests — `canUseTool` only fires in the real app, so unit tests simulate the callback being invoked.
- Approval payloads must match what the renderer already consumes for `approval_needed` (`toolName`, `toolUseId`, `command`, `description`, `input`, `projectPath`, `scope`); question/plan payloads must match `question_needed` (`toolUseId`, `question`, …) and `plan_review_needed` (`toolUseId`, `plan`, …) — read the CLI's emits in `claude.ts` (~lines 553-650) for exact shapes.
- No local tool execution in SDK mode (the runtime executes; `approveImpl`'s exec path is NOT used).

---

### Task 1: Approvals via canUseTool

**Files:** Modify `electron/services/claudeBackend/sdkOptions.ts`, `electron/services/claudeBackend/sdkBackend.ts`; Test `tests/unit/electron/sdkOptions.test.ts`, `tests/unit/electron/sdkBackend.test.ts`.

**Interfaces:**
- `SdkOptionInputs` gains `canUseTool?: CanUseTool` (import the `CanUseTool` type from `@anthropic-ai/claude-agent-sdk`). `buildSdkOptions` sets `options.canUseTool = input.canUseTool` only when provided AND not bypass.
- `SdkBackend` gains a private `pendingApprovals: Map<string, (r: PermissionResult) => void>` and builds a `canUseTool` callback passed to `buildSdkOptions` (only when permMode !== 'bypass').

**Behavior:**
- `canUseTool(toolName, input, opts)`: derive `toolUseId = opts.toolUseID`; store a resolver in `pendingApprovals.set(toolUseId, resolve)`; `this._emit({ type:'approval_needed', toolName, toolUseId, input, command: <bash command if Bash else undefined>, description: undefined, projectPath, scope })`; return `new Promise<PermissionResult>(resolve => …)`.
- `approve({ projectPath, toolUseId, approved, modifiedCommand, scope })`: look up `pendingApprovals.get(toolUseId)`; if found, resolve with `approved ? { behavior:'allow', updatedInput: modifiedCommand ? { ...input-with-command } : undefined } : { behavior:'deny', message:'User denied tool use' }`, then `delete`. If not found (e.g. CLI-mode leftover), no-op return false→true as before. Return `Promise<boolean>` (true if resolved).
- `alwaysAllow` stays delegating to `alwaysAllowImpl`.
- Permission mapping in the SdkBackend `_createSession`: pass `canUseTool` into `buildSdkOptions` only when the scope's permMode is NOT 'bypass'.

**TDD steps:**
- [ ] sdkOptions test: `canUseTool` provided + non-bypass → `options.canUseTool` set; bypass → not set even if provided. RED → implement → GREEN.
- [ ] sdkBackend test (mock the callback path): construct `SdkBackend`, invoke its `canUseTool` (expose via the options passed to a captured `queryFn`, or via a small test seam) for a `Bash` tool → asserts an `approval_needed` emit with the right payload and that the returned promise is pending; then `approve({toolUseId, approved:true})` resolves it to `{behavior:'allow'}`; `approve(false)` → `{behavior:'deny'}`. RED → implement → GREEN.
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0; run the two test files `--maxWorkers=2`.
- [ ] Commit: `feat(claude): SdkBackend tool approvals via canUseTool`.

---

### Task 2: AskUserQuestion + ExitPlanMode

**Files:** Modify `electron/services/claudeBackend/sdkBackend.ts`; Test `tests/unit/electron/sdkBackend.test.ts`.

**Behavior:**
- In the drain, after mapping each SDK message, inspect assistant messages for `tool_use` blocks named `AskUserQuestion` or `ExitPlanMode`. On `AskUserQuestion`: `this._emit({ type:'question_needed', toolUseId, question: <first question text from input.questions>, projectPath, scope })`. On `ExitPlanMode`: `this._emit({ type:'plan_review_needed', toolUseId, plan: input.plan ?? '', planFilePath: input.planFilePath ?? '', projectPath, scope })`. (Match the CLI emit shapes in claude.ts.) Emit AFTER the assistant message is forwarded so the card renders.
- `answerQuestion({ projectPath, toolUseId, answers, scope })`: also emit `question_answered` (so the card paints resolved, like the CLI), then push a follow-up `SDKUserMessage` into that scope's input channel whose content conveys the answer (e.g. a user message stating the chosen answer(s)), so the agent proceeds. Return `Promise<boolean>`.
- `answerPlanReview({ projectPath, toolUseId, approved, scope })`: emit `plan_review_answered`, push a follow-up `SDKUserMessage` (approve → "Plan approved, proceed"; reject → "Plan rejected"). Return `Promise<boolean>`.
- These replace the current delegations to `answerQuestionImpl`/`answerPlanReviewImpl` in SDK mode.

**TDD steps:**
- [ ] Test: a scripted drain message stream containing an `AskUserQuestion` tool_use → asserts a `question_needed` emit with the question text; `answerQuestion(...)` emits `question_answered` AND pushes a follow-up input message (assert via the captured input channel / pushInput spy). RED → implement → GREEN.
- [ ] Test: an `ExitPlanMode` tool_use → `plan_review_needed`; `answerPlanReview({approved:true})` → `plan_review_answered` + a follow-up input message. RED → implement → GREEN.
- [ ] tsc → 0; run the test file `--maxWorkers=2`.
- [ ] Commit: `feat(claude): SdkBackend AskUserQuestion + ExitPlanMode flows`.

---

### Task 3: full verification + dogfood

**Files:** none (verification). Optionally append dogfood notes to the spec.

**Steps:**
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0.
- [ ] `npm test` → full suite green.
- [ ] **Real-app dogfood (the canUseTool gate + flows)** — document results in the task report:
  1. SDK mode + Default Approvals: ask the agent to run a Bash command → confirm SAI's approval card appears (this is the `canUseTool`-fires-in-real-app confirmation). Allow → runs; Deny → blocked.
  2. Trigger an AskUserQuestion → card appears, answer flows back.
  3. Trigger an ExitPlanMode (plan) → card appears, approve/reject flows back.
  - If the approval card does NOT appear (canUseTool didn't fire), STOP and report: the fallback is to switch SDK mode to the bundled runtime (omit `pathToClaudeCodeExecutable`) for the permission sub-protocol — a small `sdkOptions` change — then re-test.
- [ ] Commit any doc note: `docs: Phase 2 dogfood notes`.

## Self-Review

- Spec coverage: canUseTool approval flow (Task 1), AskUserQuestion/ExitPlanMode (Task 2), permission mapping (Task 1), real-app gate (Task 3). Renderer/IPC/types untouched (constraint).
- The canUseTool-fires risk is handled by Task 3's explicit dogfood gate + the bundled-runtime fallback.
- Placeholder scan: payload shapes reference the CLI emits in claude.ts (named, with line ranges) rather than inventing them — implementers read those for exactness.
- Type consistency: `CanUseTool`/`PermissionResult` from the SDK used in both sdkOptions (Task 1) and sdkBackend (Tasks 1-2); `pendingApprovals` defined in Task 1 used by `approve`.
