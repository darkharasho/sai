# Claude CLI → Agent SDK Migration — Phase 2: Approvals + AskUserQuestion + ExitPlanMode (SDK mode)

**Date:** 2026-06-30
**Status:** Design (pending review), then plan + execute
**Depends on:** Phase 1 (`SdkBackend` core chat, merged + dogfood-verified). Wires the three interactive flows that Phase 1 deferred.

## Background

In SDK mode (`claudeBackend: 'sdk'`), Phase 1 runs with `permissionMode: 'acceptEdits'` (or `bypassPermissions`) and does NOT wire tool approvals, AskUserQuestion, or ExitPlanMode — `SdkBackend` delegates `approve`/`answerQuestion`/`answerPlanReview` to the CLI impls, which don't touch the SDK session, so those flows are inert in SDK mode. The renderer's UI for all three already exists (it consumes `approval_needed` / `question_needed` / `plan_review_needed` events and replies via the `claude:approve` / `claude:answer-question` / `claude:answer-plan-review` IPC). Phase 2 makes `SdkBackend` produce those events and consume those replies.

## The two mechanisms

- **Approvals** use the SDK's **`canUseTool`** callback — genuinely new. The runtime calls `canUseTool(toolName, input, opts)` BEFORE running a tool that needs permission; SAI returns `{ behavior: 'allow', updatedInput? }` or `{ behavior: 'deny', message }`, and **the runtime executes the tool itself** (no local re-execution like the CLI's `approveImpl`).
- **AskUserQuestion / ExitPlanMode** arrive as `tool_use` blocks in the assistant stream (the SDK forwards the same assistant messages the CLI does). We **mirror the CLI path**: detect them in the drain, emit `question_needed` / `plan_review_needed`, and inject the user's answer as a follow-up `SDKUserMessage`. (We deliberately do NOT depend on the SDK's `onElicitation` — a spike could not force it, and the tool-in-stream path reuses proven CLI logic.)

## KEY RISK (validated by dogfood, not by me)

`canUseTool` could not be confirmed from headless spikes: every spike runs inside a Claude Code session whose env makes the runtime auto-bypass permissions, so the callback never fired (4 configs, incl. env-unset and the bundled runtime). The SDK source confirms the wiring is correct (`processControlRequest`: `subtype === 'can_use_tool' → this.canUseTool(...)`), so it SHOULD fire in the real SAI Electron app (not a nested session) — but that is unverified. **Phase 2's first task wires a minimal `canUseTool` and the user confirms in the real app that it fires** before the full flow is built. If it does NOT fire with the installed CLI (a 2.1.195 ⇄ SDK-0.3.196 control-protocol gap), the fallback is to switch SDK mode to the bundled runtime (omit `pathToClaudeCodeExecutable`) for the permission sub-protocol, decided at that point.

## Design

### Permission-mode mapping (sdkOptions)

- SAI **Bypass** (`permMode === 'bypass'`) → SDK `permissionMode: 'bypassPermissions'`, **no** `canUseTool` (tools auto-run). Unchanged.
- SAI **Default Approvals** (otherwise) → SDK `permissionMode: 'acceptEdits'` (edits auto-accept, matching the CLI) **plus** `canUseTool` set — so non-edit tools (Bash, etc.) route through SAI's approval card. (`sdkOptions` gains a `canUseTool?` passthrough; the callback itself is provided by `SdkBackend`, not built in `sdkOptions`, to keep `sdkOptions` pure.)

### Approvals (canUseTool)

`SdkBackend` owns a `pendingApprovals: Map<toolUseId, (result: PermissionResult) => void>`. The `canUseTool` callback it passes into each scope's query:
1. Generates/uses the `opts.toolUseID`, stores its resolver in `pendingApprovals`.
2. Emits `approval_needed` (same payload the renderer already shows: `toolName`, `toolUseId`, `command`/`input`, `description`, `scope`, `projectPath`).
3. Returns a Promise that resolves when `SdkBackend.approve(args)` is called.

`SdkBackend.approve({ toolUseId, approved, modifiedCommand })` looks up the resolver and resolves it with `{ behavior: 'allow', updatedInput: <modified?> }` or `{ behavior: 'deny', message: 'User denied' }`, then deletes the entry. `alwaysAllow` continues to write `.claude/settings.local.json` (unchanged, backend-agnostic). No local tool execution — `approveImpl`'s Bash/Write/Edit/Read execution is NOT used in SDK mode.

### AskUserQuestion / ExitPlanMode

In the `SdkBackend` drain, when an assistant message contains a `tool_use` named `AskUserQuestion` or `ExitPlanMode`, emit `question_needed` / `plan_review_needed` (same payloads as the CLI: `toolUseId`, `question`/`plan`, `scope`, `projectPath`) after forwarding the assistant message (so the card renders). `SdkBackend.answerQuestion({ toolUseId, answers })` / `answerPlanReview({ toolUseId, approved })` push a follow-up `SDKUserMessage` into that scope's input channel carrying the answer/decision (mirroring the CLI's `answerQuestionImpl`/`answerPlanReviewImpl` injection), so the agent receives it on the next turn. Plan mode itself: if SAI needs `ExitPlanMode` to gate edits, set `permissionMode: 'plan'` when SAI is in plan mode (out of scope unless SAI exposes a plan toggle for SDK — confirm during planning).

### Components touched

- `sdkOptions.ts` — add a `canUseTool?: CanUseTool` passthrough into the returned `Options` (set only for non-bypass).
- `sdkBackend.ts` — build the `canUseTool` callback (pendingApprovals map); implement `approve` (resolve the pending promise) instead of delegating to `approveImpl`; detect AskUserQuestion/ExitPlanMode in the drain and emit the events; implement `answerQuestion`/`answerPlanReview` to push follow-up messages; keep `alwaysAllow` delegating.
- Renderer / IPC / `types.ts`: NO changes — the events and IPC already exist and `ClaudeBackend` already declares `approve`/`answerQuestion`/`answerPlanReview`.

### Testing

- **Unit (mocked):** `sdkBackend.test.ts` — a fake `canUseTool` invocation routes to an `approval_needed` emit and a pending resolver; `approve(allow)` resolves it `{behavior:'allow'}`, `approve(deny)` → `{behavior:'deny'}`; an `AskUserQuestion` tool_use in the drain emits `question_needed` and `answerQuestion` pushes a follow-up input; same for ExitPlanMode/`plan_review_needed`. `sdkOptions.test.ts` — `canUseTool` present for default, absent for bypass.
- **Real-app dogfood (the canUseTool gate):** Task 1 minimal-`canUseTool` confirmation, then full-flow confirmation: in SDK mode + Default Approvals, ask the agent to run a Bash command → the approval card appears → allow/deny works; trigger an AskUserQuestion and an ExitPlanMode → cards appear, answers flow back.
- `'cli'` default unchanged; full suite green.

## Non-goals (Phase 2)

MCP re-platform (render/swarm tools) → Phase 3. Images, remote-origin clamp, chat nudges, in-flight-send semantics remain as documented Phase-1 deferrals. No renderer changes.

## Success criteria

1. In SDK mode, Default Approvals: a non-edit tool triggers SAI's approval card; allow runs it, deny blocks it (confirmed in the real app).
2. AskUserQuestion and ExitPlanMode show their cards in SDK mode and the user's answer/decision reaches the agent.
3. `canUseTool` confirmed to fire in the real app (Task 1) — or the bundled-runtime fallback adopted.
4. Unit tests cover the approval/question/plan routing with mocks; `'cli'` unchanged; full suite green; tsc clean.
