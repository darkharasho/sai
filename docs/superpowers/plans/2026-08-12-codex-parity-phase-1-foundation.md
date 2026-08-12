# Codex Parity Phase 1: Capability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SAI accurately expose Codex's existing scoped-session and task-worker support, including visible native-subagent activity that keeps the thinking state alive, while bringing Claude model discovery to every supported client without version-pinned fallbacks.

**Architecture:** Keep the existing Codex SDK backend for basic chat and scoped task execution. Add provider-neutral dispatch at the renderer boundary, preserving each provider's native permission vocabulary. The SDK's legacy collaboration JSONL events supply a minimal native-subagent lifecycle display; rich agent controls, interactive approvals, MCP configuration, and plugins remain deliberately unavailable until the App Server phase supplies working protocol support.

**Tech Stack:** Electron IPC, React/TypeScript, Vite Remote PWA, React Native mobile, Vitest.

---

## File structure

- `src/providers/capabilities.ts` — truthfully advertises features already supported by each provider transport.
- `src/lib/swarmTaskRunner.ts` — provider-neutral, scoped Swarm worker launcher and policy mapping.
- `src/App.tsx` — passes the provider IPC bridge to the Swarm runner and stops the exact task scope.
- `tests/unit/providers/capabilities.test.ts` — locks capability claims to executable paths.
- `tests/swarm/swarmTaskRunner.test.ts` — locks scoped Codex/Claude task dispatch and unsupported-policy behavior.
- `src/components/Swarm/OrchestratorModelPicker.tsx` and `tests/swarm/OrchestratorModelPicker.test.tsx` — preserve the explicit Codex-orchestrator hold until its MCP bridge ships.
- `electron/services/remote/bridge-server.ts` — adds authenticated Claude-catalogue request/reply forwarding.
- `src/renderer-remote/wire.ts` — correlates the catalogue reply and exposes it to the PWA client.
- `src/renderer-remote/chat/Composer.tsx` — renders account-aware options with rolling-alias fallback.
- `sai-mobile/components/Composer.tsx` — removes version-pinned fallback model IDs from native mobile.
- `tests/unit/remote/bridge-server-chat.test.ts`, `tests/unit/remote/pwa-wire.test.ts`, and new Remote composer tests — cover protocol and visible selection behavior.
- `electron/services/codexBackend/sdkEventMap.ts` — guarantees that newly introduced Codex JSONL event/item variants cannot abort a parent turn.
- `tests/unit/electron/codexSdkEventMap.test.ts` — covers the legacy `collab_tool_call` event emitted by Codex subagents and other unknown variants.
- `src/components/Chat/ChatPanel.tsx` — holds a visible working state while a native Codex subagent is active, even when the parent produces no text.
- `tests/unit/components/Chat/ChatPanel.test.tsx` — proves a subagent start displays activity and a terminal lifecycle event releases it.

### Task 0: Keep new Codex subagent events from aborting their parent turn

**Files:**
- Modify: `tests/unit/electron/codexSdkEventMap.test.ts`
- Modify: `electron/services/codexBackend/sdkEventMap.ts`

- [ ] **Step 1: Write the failing legacy collaboration-event regression test**

```ts
it('drops an unsupported legacy collaboration item instead of returning undefined', () => {
  const event = {
    type: 'item.started',
    item: { id: 'agent-1', type: 'collab_tool_call', tool: 'spawn_agent', status: 'in_progress' },
  } as unknown as ThreadEvent;

  expect(mapCodexSdkEvent(event, ctx)).toEqual([]);
});

it('returns an empty envelope list for an unknown top-level event', () => {
  expect(mapCodexSdkEvent({ type: 'future.event' } as unknown as ThreadEvent, ctx)).toEqual([]);
});
```

- [ ] **Step 2: Verify the mapper currently returns `undefined`**

Run: `npm test -- --project unit tests/unit/electron/codexSdkEventMap.test.ts`

Expected: FAIL because `mapCodexSdkEvent()` returns `undefined` for both
variants; `SdkCodexBackend.runTurn()` then throws `TypeError: envelopes is not
iterable` while evaluating `for (const envelope of envelopes)`.

- [ ] **Step 3: Make all event/item switches total**

```ts
function startedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  switch (item.type) {
    // existing handled cases
    default:
      return [];
  }
}
```

Apply the same `default: return []` branch to `updatedItem`, `completedItem`,
and `mapCodexSdkEvent`. Do not invent a fake tool card from an untyped event;
the App Server phase owns rich native subagent activity. This task guarantees
the parent turn continues and can still emit its final answer.

**Follow-on:** When the Codex App Server transport is introduced, render each
subagent's lifecycle and activity in SAI instead of suppressing its stream
events. That work must preserve the parent-session relationship and show
spawn, progress, completion, and failure states without treating them as
ordinary parent tool calls.

- [ ] **Step 4: Verify mapper and backend regression coverage**

Run: `npm test -- --project unit tests/unit/electron/codexSdkEventMap.test.ts tests/unit/electron/codexSdkBackend.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the crash guard**

```bash
git add electron/services/codexBackend/sdkEventMap.ts tests/unit/electron/codexSdkEventMap.test.ts
git commit -m "fix(codex): tolerate collaboration stream events"
```

### Task 0a: Render native Codex subagent activity and count it as thinking

**Files:**
- Modify: `tests/unit/electron/codexSdkEventMap.test.ts`
- Modify: `electron/services/codexBackend/sdkEventMap.ts`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx`

**Release requirement:** A Codex collaboration item must never make the chat
look idle while its child agent is running. A child start or in-progress update
must render a concise `agent · <status>` hint and keep the thinking animation
visible. It must clear only when that same child reaches a terminal state
(`completed`, `failed`, or `cancelled`) and no other child remains active. A
normal parent `result`/`done` must not clear a still-running child.

- [ ] **Step 1: Write failing mapper lifecycle tests for the legacy JSONL item**

```ts
const started = mapCodexSdkEvent({
  type: 'item.started',
  item: {
    id: 'agent-1', type: 'collab_tool_call', tool: 'spawn_agent',
    status: 'in_progress', description: 'Review the auth flow',
  },
} as unknown as ThreadEvent, ctx);

expect(started).toEqual([expect.objectContaining({
  type: 'subagent_activity', agentId: 'agent-1', status: 'running',
  summary: 'Review the auth flow',
})]);
```

Cover `item.updated` and `item.completed` too. Preserve safe fallbacks for
missing or future fields: use a stable generic status label, prefer a supplied
short description, truncate any prompt fallback, and keep unrelated unknown
items as `[]`.

- [ ] **Step 2: Write the failing ChatPanel lifecycle test**

Drive the existing backend message listener with a `subagent_activity` start,
then rerender with `isStreaming={false}` to model a quiet parent. Assert that
the thinking row remains mounted and its hint identifies active agent work.
Send a terminal event for that `agentId`; assert the hint and extra thinking
state disappear once the parent is also idle. Add a two-agent case so
completion of one child does not hide the row while another is running.

- [ ] **Step 3: Map only collaboration lifecycle data into a typed SAI envelope**

Add a narrow runtime-safe reader for legacy `collab_tool_call` fields (the
current SDK type does not yet declare this item). Emit `subagent_activity`
with `agentId`, normalized `status`, and a short safe summary on start/update/
completion. Do not convert it into a normal Bash/Edit/MCP tool card, and do
not weaken the total-switch fallback added in Task 0.

- [ ] **Step 4: Keep display activity independent of the parent stream flag**

In `ChatPanel`, track active child IDs in local transient state. Derive
`subagentThinking` from that set and use `streamingForDisplay ||
subagentThinking` for presentation-only thinking/Stop state. Preserve the
existing waiting and question suppressions. Prefer the current child summary
as `streamHint`, while leaving live reasoning and running-tool cards as the
more specific primary visual when present. Clear this transient state on an
explicit terminal child event and on unmount/session replacement; do not
persist it into chat history.

- [ ] **Step 5: Run mapper and renderer regression coverage**

Run: `npm test -- --project unit tests/unit/electron/codexSdkEventMap.test.ts tests/unit/components/Chat/ChatPanel.test.tsx`

Expected: PASS. The test must demonstrate that parent-idle plus active child
still shows a thinking indicator, and that the final active child’s terminal
event removes it.

- [ ] **Step 6: Run the release-facing type check and commit**

Run: `npx tsc --noEmit`

Expected: PASS.

```bash
git add electron/services/codexBackend/sdkEventMap.ts tests/unit/electron/codexSdkEventMap.test.ts src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(codex): show native subagent activity"
```

### Task 1: Lock the safe Codex capability contract

**Files:**
- Modify: `tests/unit/providers/capabilities.test.ts`
- Modify: `src/providers/capabilities.ts`

- [ ] **Step 1: Write failing expectations for current Codex transport capabilities**

```ts
it('supports scoped sessions and terminal scope', () => {
  const caps = getCapabilities('codex');
  expect(caps.supportsTerminalScope).toBe(true);
  expect(caps.supportsMultiScope).toBe(true);
});

it('does not advertise interactive-only integrations before App Server support', () => {
  const caps = getCapabilities('codex');
  expect(caps.hasOrchestrator).toBe(false);
  expect(caps.hasSlashCommands).toBe(false);
  expect(caps.hasMcp).toBe(false);
  expect(caps.hasPlugins).toBe(false);
});
```

- [ ] **Step 2: Verify the test fails for the two incorrectly hidden capabilities**

Run: `npm test -- --project unit tests/unit/providers/capabilities.test.ts`

Expected: FAIL because `supportsTerminalScope` and `supportsMultiScope` are currently `false` for Codex.

- [ ] **Step 3: Correct only the already-backed Codex flags**

```ts
  codex: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: true,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: false,
    hasPlugins: false,
  },
```

- [ ] **Step 4: Verify the focused capability contract**

Run: `npm test -- --project unit tests/unit/providers/capabilities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the isolated capability correction**

```bash
git add src/providers/capabilities.ts tests/unit/providers/capabilities.test.ts
git commit -m "fix(codex): expose scoped session capabilities"
```

### Task 2: Make Swarm worker dispatch provider-neutral

**Files:**
- Modify: `tests/swarm/swarmTaskRunner.test.ts`
- Modify: `src/lib/swarmTaskRunner.ts`

- [ ] **Step 1: Write failing Codex worker dispatch tests**

```ts
it('starts a Codex task in the worktree-scoped session', async () => {
  const deps = {
    claudeStart: vi.fn(), claudeSend: vi.fn(),
    codexStart: vi.fn().mockResolvedValue(undefined), codexSend: vi.fn(),
  };
  const dispatched = await runSwarmTask(makeTask({ provider: 'codex', model: 'gpt-5.6', worktreePath: '/tmp/wt' }), deps);
  expect(dispatched).toBe(true);
  expect(deps.codexStart).toHaveBeenCalledWith('/tmp/project', 'session-1', 'task', undefined, '/tmp/wt');
  expect(deps.codexSend).toHaveBeenCalledWith('/tmp/project', 'create hello.txt with hi', undefined, 'auto', undefined, 'gpt-5.6', 'session-1');
});

it('uses full access only for a Codex Swarm task explicitly set to auto', async () => {
  const deps = makeDepsWithCodex();
  await runSwarmTask(makeTask({ provider: 'codex', approvalPolicy: 'auto' }), deps);
  expect(deps.codexSend.mock.calls[0][3]).toBe('full-access');
});
```

- [ ] **Step 2: Verify the Codex tests fail because the runner rejects every non-Claude task**

Run: `npm test -- tests/swarm/swarmTaskRunner.test.ts`

Expected: FAIL with `dispatched` equal to `false` and no Codex start/send calls.

- [ ] **Step 3: Generalize the runner without changing Claude dispatch**

```ts
export interface SwarmRunnerDeps {
  claudeStart: ProviderStart;
  claudeSend: ProviderSend;
  codexStart: ProviderStart;
  codexSend: ProviderSend;
}

const codexPermissionForPolicy = (policy: ApprovalPolicy): 'auto' | 'full-access' =>
  policy === 'auto' ? 'full-access' : 'auto';

export async function runSwarmTask(task: SwarmTask, deps: SwarmRunnerDeps): Promise<boolean> {
  const projectPath = task.workspaceId;
  const scopeCwd = cwdForTask(task);
  if (task.provider === 'claude') {
    await deps.claudeStart(projectPath, task.sessionId, 'task', undefined, scopeCwd);
    deps.claudeSend(projectPath, task.prompt, undefined, permModeForPolicy(task.approvalPolicy), undefined, task.model, task.sessionId);
    return true;
  }
  if (task.provider === 'codex') {
    await deps.codexStart(projectPath, task.sessionId, 'task', undefined, scopeCwd);
    deps.codexSend(projectPath, task.prompt, undefined, codexPermissionForPolicy(task.approvalPolicy), undefined, task.model, task.sessionId);
    return true;
  }
  return false;
}
```

`auto-read` and `always-ask` both use Codex's `auto` (workspace-write,
on-request) profile in this SDK phase. The UI must not claim that it can
intercept every approval until Task 5 of the master design replaces the
transport with App Server.

- [ ] **Step 4: Verify scoped dispatch and existing Claude behavior**

Run: `npm test -- tests/swarm/swarmTaskRunner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit provider-neutral task dispatch**

```bash
git add src/lib/swarmTaskRunner.ts tests/swarm/swarmTaskRunner.test.ts
git commit -m "feat(swarm): dispatch Codex workers by scope"
```

### Task 3: Connect the generic worker runner in App and preserve scope routing

**Files:**
- Modify: `src/App.tsx:1115-1145,1300-1385`
- Test: `tests/swarm/swarmTaskRunner.test.ts`

- [ ] **Step 1: Extend the dispatch test to require both provider bridges**

```ts
expect(deps.claudeStart).not.toHaveBeenCalled();
expect(deps.codexStart).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Verify the renderer currently supplies only Claude dependencies**

Run: `rg -n "claudeStart: sai.claudeStart|claudeSend: sai.claudeSend" src/App.tsx`

Expected: one call site with no `codexStart` or `codexSend` entry.

- [ ] **Step 3: Pass both bridges and target stop calls by task session scope**

```ts
        {
          claudeStart: sai.claudeStart,
          claudeSend: sai.claudeSend,
          codexStart: sai.codexStart,
          codexSend: sai.codexSend,
        },
```

```ts
if (p === 'codex') return (window.sai as any).codexStop?.(ws, task.sessionId);
if (p === 'gemini') return (window.sai as any).geminiStop?.(ws, task.sessionId);
if (p === 'kimi') return (window.sai as any).kimiStop?.(ws, task.sessionId);
return (window.sai as any).claudeStop?.(ws, task.sessionId);
```

- [ ] **Step 4: Run task and application type checks**

Run: `npm test -- tests/swarm/swarmTaskRunner.test.ts && npx tsc --noEmit`

Expected: PASS and exit code 0.

- [ ] **Step 5: Commit the renderer integration**

```bash
git add src/App.tsx tests/swarm/swarmTaskRunner.test.ts
git commit -m "fix(swarm): route worker controls by task scope"
```

### Task 4: Retain the explicit Codex orchestrator hold

**Files:**
- Modify: `tests/swarm/OrchestratorModelPicker.test.tsx`
- Modify: `src/components/Swarm/OrchestratorModelPicker.tsx`

- [ ] **Step 1: Replace the Claude-specific unavailable tooltip assertion**

```ts
expect(codex.disabled).toBe(true);
expect(codex.getAttribute('title')).toMatch(/Swarm MCP bridge/i);
```

- [ ] **Step 2: Verify it fails against the stale explanatory copy**

Run: `npm test -- tests/swarm/OrchestratorModelPicker.test.tsx`

Expected: FAIL because the current title says that dispatch requires Claude.

- [ ] **Step 3: Explain the real, temporary protocol limitation**

```tsx
title={isDisabled ? 'Codex orchestrator requires the App Server Swarm MCP bridge' : `Use ${p.label}`}
```

- [ ] **Step 4: Verify the picker remains intentionally conservative**

Run: `npm test -- tests/swarm/OrchestratorModelPicker.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the degraded-state clarification**

```bash
git add src/components/Swarm/OrchestratorModelPicker.tsx tests/swarm/OrchestratorModelPicker.test.tsx
git commit -m "fix(swarm): explain Codex orchestrator availability"
```

### Task 5: Add authenticated Claude model-catalogue discovery to Remote

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Modify: `src/renderer-remote/wire.ts`
- Modify: `tests/unit/remote/bridge-server-chat.test.ts`
- Modify: `tests/unit/remote/pwa-wire.test.ts`

- [ ] **Step 1: Write the bridge request/reply contract tests**

```ts
socket.emit('message', JSON.stringify({ type: 'claude_models_request', requestId: 'models-1' }));
expect(sent()).toContainEqual(expect.objectContaining({
  type: 'claude_models', requestId: 'models-1',
  models: [{ id: 'opus', label: 'Opus', description: 'Latest Opus' }],
}));
```

```ts
client.requestClaudeModels();
receive({ type: 'claude_models', requestId: 'models-1', models: [{ id: 'fable', label: 'Fable', description: 'Account model' }] });
expect(await client.waitForClaudeModels()).toEqual([{ id: 'fable', label: 'Fable', description: 'Account model' }]);
```

- [ ] **Step 2: Verify both protocol tests fail because these frame types do not exist**

Run: `npm test -- --project unit tests/unit/remote/bridge-server-chat.test.ts tests/unit/remote/pwa-wire.test.ts`

Expected: FAIL with missing request method or no `claude_models` reply.

- [ ] **Step 3: Add the narrow authenticated catalogue exchange**

```ts
case 'claude_models_request': {
  const models = await getAvailableClaudeModels();
  send({ type: 'claude_models', requestId: frame.requestId, models });
  break;
}
```

```ts
requestClaudeModels(): string {
  const requestId = crypto.randomUUID();
  this.pendingClaudeModels.set(requestId, deferred<ModelOption[]>());
  this.send({ type: 'claude_models_request', requestId });
  return requestId;
}
```

Validate `requestId` as a non-empty string, return only `id`, `label`,
`description`, and `recommended`, and reject requests before the existing
authenticated connection guard. Do not serialize Claude configuration,
credentials, or account data.

- [ ] **Step 4: Verify bridge and wire correlation**

Run: `npm test -- --project unit tests/unit/remote/bridge-server-chat.test.ts tests/unit/remote/pwa-wire.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Remote model-catalogue protocol**

```bash
git add electron/services/remote/bridge-server.ts src/renderer-remote/wire.ts tests/unit/remote/bridge-server-chat.test.ts tests/unit/remote/pwa-wire.test.ts
git commit -m "feat(remote): discover Claude models from desktop"
```

### Task 6: Render discovered models and remove version-pinned mobile fallbacks

**Files:**
- Modify: `src/renderer-remote/chat/Composer.tsx`
- Modify: `sai-mobile/components/Composer.tsx`
- Modify: `tests/unit/remote/Composer.test.tsx` (create)
- Modify: `sai-mobile/tests/wire-client.test.ts`

- [ ] **Step 1: Write a Remote composer test for an account-supplied model**

```tsx
render(<Composer models={[{ id: 'fable', label: 'Fable', description: 'Account model' }]} {...props} />);
fireEvent.click(screen.getByRole('button', { name: /model/i }));
expect(screen.getByText('Fable')).toBeInTheDocument();
```

- [ ] **Step 2: Verify it fails because Composer has only static version-pinned options**

Run: `npm test -- --project unit tests/unit/remote/Composer.test.tsx`

Expected: FAIL because `Composer` does not accept `models` and renders `claude-opus-4-8`.

- [ ] **Step 3: Replace only fallbacks, not saved selections**

```ts
const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { value: 'default', label: 'Default', hint: 'Desktop recommended model', color: 'var(--text-muted)' },
  { value: 'opus', label: 'Opus', hint: 'Latest Opus', color: 'var(--orange)' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Latest Sonnet', color: 'var(--accent)' },
  { value: 'haiku', label: 'Haiku', hint: 'Latest Haiku', color: 'var(--green)' },
];
const modelOptions = models?.length ? models.map(toModelOption) : FALLBACK_MODEL_OPTIONS;
```

Request the catalogue after authenticated wire connection, preserve an unknown
persisted model as a selectable current value, and send `undefined` for the
`default` choice. Change native mobile's fallback IDs to the same rolling
aliases. Rebuild the PWA assets; never hand-edit `sai-mobile/assets/pwa`.

- [ ] **Step 4: Verify UI, wire, and generated assets**

Run: `npm test -- --project unit tests/unit/remote/Composer.test.tsx tests/unit/remote/pwa-wire.test.ts && npm run build && ! rg -n "claude-opus-4-8|claude-opus-4-7" dist sai-mobile/assets/pwa`

Expected: all tests and the build pass; the final search returns no matches.

- [ ] **Step 5: Commit client model discovery**

```bash
git add src/renderer-remote/chat/Composer.tsx sai-mobile/components/Composer.tsx tests/unit/remote/Composer.test.tsx sai-mobile/assets/pwa
git commit -m "fix(models): use rolling Claude aliases on clients"
```

### Task 7: Run the Phase 1 regression suite and record release evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-codex-parity-phase-1-foundation.md`

- [ ] **Step 1: Run all Phase 1 focused tests**

Run: `npm test -- --project unit tests/unit/electron/codexSdkEventMap.test.ts tests/unit/components/Chat/ChatPanel.test.tsx tests/unit/providers/capabilities.test.ts tests/swarm/swarmTaskRunner.test.ts tests/swarm/OrchestratorModelPicker.test.tsx tests/unit/remote/bridge-server-chat.test.ts tests/unit/remote/pwa-wire.test.ts tests/unit/remote/Composer.test.tsx`

Expected: PASS with no failed test files.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Check the phase acceptance criteria**

```bash
git diff main...HEAD --check
rg -n "claude-opus-4-8|claude-opus-4-7" src sai-mobile --glob '!assets/pwa/*'
```

Expected: no whitespace errors and no source fallback pinned to a retired
Claude release.

- [ ] **Step 4: Mark completed plan checkboxes and commit the plan record**

```bash
git add docs/superpowers/plans/2026-08-12-codex-parity-phase-1-foundation.md
git commit -m "docs: record Codex parity foundation verification"
```
