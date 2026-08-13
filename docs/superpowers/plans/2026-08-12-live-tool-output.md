# Live Tool Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render incremental shell-command output in the existing desktop and remote tool cards, retaining it when the command completes.

**Architecture:** Add an explicit optional `running` state to the normalized `tool_result` block rather than inferring settlement from whether output exists. ACP `tool_call_update` events will emit partial result blocks until their terminal status, and both transcript reducers will append/update the identified card without allowing stale frames to overwrite a settled result.

**Tech Stack:** TypeScript, Electron ACP adapter, React, Vitest.

---

### Task 1: Normalize partial tool-result state

**Files:**
- Modify: `electron/services/acpProvider.ts:324-376`
- Modify: `tests/unit/electron/acpProviderTranslate.test.ts`

- [ ] **Step 1: Add failing translator tests for partial and terminal updates**

```ts
it('maps an in-progress command update to a partial tool result', () => {
  const out = translateAcpEvent({ method: 'session/update', params: { update: {
    sessionUpdate: 'tool_call_update', toolCallId: 'cmd-1', status: 'in_progress',
    content: [{ type: 'content', content: { type: 'text', text: 'running tests\\n' } }],
  } } }, '/p', 'chat');
  expect(out.message.content[0]).toMatchObject({
    type: 'tool_result', tool_use_id: 'cmd-1', content: 'running tests\\n', partial: true,
  });
});

it('does not mark a completed tool update partial', () => {
  const out = translateAcpEvent({ method: 'session/update', params: { update: {
    sessionUpdate: 'tool_call_update', toolCallId: 'cmd-1', status: 'completed', content: [],
  } } }, '/p', 'chat');
  expect(out.message.content[0].partial).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:unit -- tests/unit/electron/acpProviderTranslate.test.ts`

Expected: FAIL because `partial` is absent.

- [ ] **Step 3: Map non-terminal ACP updates as partial results**

In the `tool_call_update` branch, derive partialness from terminal ACP statuses:

```ts
const terminal = update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled';
return {
  type: 'user', projectPath, scope,
  message: { content: [{
    type: 'tool_result', tool_use_id: update.toolCallId,
    content: acpContentToToolResult(update.content),
    is_error: update.status === 'failed',
    ...(terminal ? {} : { partial: true }),
  }] },
};
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm run test:unit -- tests/unit/electron/acpProviderTranslate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract change**

```bash
git add electron/services/acpProvider.ts tests/unit/electron/acpProviderTranslate.test.ts
git commit -m "feat(acp): mark live tool output partial"
```

### Task 2: Preserve running output in desktop transcript state

**Files:**
- Modify: `src/types.ts:122-135`
- Modify: `src/components/Chat/ChatPanel.tsx:1154-1192`
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Add failing reducer-level ChatPanel tests**

Extend the existing wire-message harness with an assistant `tool_use` followed by a partial and terminal `tool_result`. Assert the card has `output: 'line one\\nline two\\n'` and `liveOutput: true` after two partial frames, then has the terminal output and no `liveOutput` after completion. Send one more partial result and assert the terminal output remains unchanged.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx`

Expected: FAIL because tool cards settle whenever `output` is assigned.

- [ ] **Step 3: Add explicit live-output state and apply partial frames safely**

Add this optional property to `ToolCall`:

```ts
/** Output is still arriving; output contains the accumulated live transcript. */
liveOutput?: boolean;
```

In `ChatPanel`, retain `partial` while collecting result blocks. For a partial result, update only a matching card whose `liveOutput` is not `false`, append only when the provider supplied a new suffix, and set `liveOutput: true`. For a terminal result, replace output, set `liveOutput: false`, add duration, and keep existing images. Ignore partial results for a card already marked `liveOutput: false`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm run test:unit -- tests/unit/components/Chat/ChatPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the desktop transcript change**

```bash
git add src/types.ts src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): retain live command output"
```

### Task 3: Render a running output region without stealing scroll position

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx:910-954,1010-1100`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Add failing tool-card tests**

Render a terminal `ToolCall` with `output: 'collecting...\\n'` and `liveOutput: true`; assert the output appears and the status badge is `running`. Re-render with `liveOutput: false`; assert the same output remains and the status badge is `done`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:unit -- tests/unit/components/Chat/ToolCallCard.test.tsx`

Expected: FAIL because a non-empty `output` currently means settled/done.

- [ ] **Step 3: Make card settlement depend on explicit live state**

Use `toolCall.liveOutput !== true && toolCall.output != null` for terminal settlement, keep `hasBody` true for terminal commands with any output, and pass a `live` flag to `BashInOut`. Add a `ref` to the output container that scrolls to its bottom only when `scrollHeight - scrollTop - clientHeight < 24` before the update; preserve a reader's position otherwise. Keep the existing final output presentation and error parser unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm run test:unit -- tests/unit/components/Chat/ToolCallCard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the card behavior**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(chat): show running command output"
```

### Task 4: Keep remote chat semantically aligned

**Files:**
- Modify: `src/renderer-remote/chat/Transcript.tsx:64-74`
- Modify: `src/renderer-remote/chat/Chat.tsx:243-258`
- Modify: `src/renderer-remote/chat/ToolCard.tsx:1-190`

- [ ] **Step 1: Add `toolLiveOutput?: boolean` to remote transcript messages**

```ts
toolLiveOutput?: boolean;
```

- [ ] **Step 2: Apply partial blocks in the remote reducer**

For a `tool_result` with `partial: true`, append the received text to the matching running card and retain `toolStatus: 'running'`; for the terminal block, replace the text and set `toolLiveOutput: false` with the existing done/error status. Ignore partial blocks once the matching card is terminal.

- [ ] **Step 3: Render running result content in the remote card**

Render the `result` section whenever a result exists, including `status === 'running'`, label it `output` while running, and preserve the existing result/error labels on settlement.

- [ ] **Step 4: Commit remote parity**

```bash
git add src/renderer-remote/chat/Transcript.tsx src/renderer-remote/chat/Chat.tsx src/renderer-remote/chat/ToolCard.tsx
git commit -m "feat(remote): show live command output"
```

### Task 5: Verify the complete change

**Files:**
- Verify: `tests/unit/electron/acpProviderTranslate.test.ts`
- Verify: `tests/unit/components/Chat/ChatPanel.test.tsx`
- Verify: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Run focused live-output tests**

Run: `npm run test:unit -- tests/unit/electron/acpProviderTranslate.test.ts tests/unit/components/Chat/ChatPanel.test.tsx tests/unit/components/Chat/ToolCallCard.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the full unit suite**

Run: `npm run test:unit`

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exits 0.

- [ ] **Step 4: Inspect the final worktree**

Run: `git status --short --branch && git log --oneline main..HEAD`

Expected: only the planned commits and no uncommitted files.
