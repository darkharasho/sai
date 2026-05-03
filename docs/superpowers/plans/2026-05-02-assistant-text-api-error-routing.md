# Route API-Error Assistant Text Through the Error UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Detect API-Error envelopes that arrive as assistant text in `ChatPanel` and re-route them through the existing parsed-error rendering path so they show as the styled error card (status badge, request_id, expandable details, retry) instead of as raw JSON.

**Architecture:** Add a `looksLikeApiError(text)` helper in `parseAiError.ts` (sibling to `parseAiError`). In ChatPanel's `msg.type === 'assistant'` handler, branch on that helper before the normal append/update path: when an assistant text payload looks like an API error and has no tool calls, drop the most recent partial assistant bubble (it was the streaming-partial that accumulated the error envelope) and append a fresh system-role message carrying the parsed error object. The existing error rendering in `ChatMessage.tsx` does the rest.

**Tech Stack:** React 18, TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-02-assistant-text-api-error-routing-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/parseAiError.ts` — add `looksLikeApiError` export alongside the existing `parseAiError`
- `src/components/Chat/ChatPanel.tsx` — branch in the assistant message handler to route detected errors through the error path

**New files:**
- `tests/unit/components/Chat/parseAiError.test.ts` — covers the new helper

**Modified test files:**
- `tests/unit/components/Chat/ChatPanel.test.tsx` — verifies that an assistant text payload containing an API-Error envelope renders as a system error message

---

## Task 1: Add `looksLikeApiError` helper

**Files:**
- Modify: `src/components/Chat/parseAiError.ts`
- Create: `tests/unit/components/Chat/parseAiError.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/Chat/parseAiError.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { looksLikeApiError } from '../../../../src/components/Chat/parseAiError';

describe('looksLikeApiError', () => {
  it('returns true for the prefixed API Error envelope', () => {
    const text = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"},"request_id":"req_011CaeanuZcbSgzbnKUNX8hP"}';
    expect(looksLikeApiError(text)).toBe(true);
  });

  it('returns true for a bare JSON envelope without prefix', () => {
    const text = '{"type":"error","error":{"type":"api_error","message":"oops"}}';
    expect(looksLikeApiError(text)).toBe(true);
  });

  it('returns false for ordinary assistant text', () => {
    expect(looksLikeApiError('Sure! Here is the answer.')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(looksLikeApiError('')).toBe(false);
  });

  it('returns false for prose that mentions errors but is not an envelope', () => {
    expect(looksLikeApiError('I noticed your code has an error message in main.ts.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm run test:unit -- parseAiError.test.ts`
Expected: FAIL — module does not export `looksLikeApiError`.

- [ ] **Step 3: Add the helper to `parseAiError.ts`**

Append to `src/components/Chat/parseAiError.ts`, after the existing `parseAiError` export:

```ts
export function looksLikeApiError(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (/^API Error\b/i.test(t)) return true;
  if (/"type"\s*:\s*"error"/.test(t) && /"message"\s*:/.test(t)) return true;
  return false;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- parseAiError.test.ts`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/parseAiError.ts tests/unit/components/Chat/parseAiError.test.ts
git commit -m "feat(chat): add looksLikeApiError helper"
```

---

## Task 2: Route API-Error assistant text to the error UI

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Read context**

Open `src/components/Chat/ChatPanel.tsx` and locate the `msg.type === 'assistant'` handler (around line 800). Note where `text` is collected (`textParts.join('')`) and where the `setMessages(prev => ...)` block runs that either updates the last partial assistant or appends a new assistant message.

The existing import line near the top imports `parseAiError`. Extend it to also import `looksLikeApiError` (added in Task 1).

This step is orientation only.

- [ ] **Step 2: Write the failing test**

Add a new test to `tests/unit/components/Chat/ChatPanel.test.tsx`. The test mocks `ChatMessage` (already mocked at the top of the file), so we'll assert on the `messages` array via the `onMessagesChange` callback rather than on rendered DOM. That gives us a clean assertion on the data model.

Use the existing `baseProps()` helper / inline-props pattern for consistency with surrounding tests:

```tsx
it('routes API-Error assistant text through the error path', async () => {
  const onMessagesChange = vi.fn();
  const props: ChatPanelProps = { ...baseProps(), onMessagesChange };

  render(<ChatPanel {...props} />);

  await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

  const apiErrorText = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"},"request_id":"req_011CaeanuZcbSgzbnKUNX8hP"}';

  await act(async () => {
    for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
      (handler as (msg: any) => void)({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: apiErrorText }] },
      });
    }
  });

  // The latest call to onMessagesChange should reflect the rerouted error.
  const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
  const messages = lastCall[0];
  const last = messages[messages.length - 1];

  expect(last.role).toBe('system');
  expect(last.error).toBeTruthy();
  expect(last.error.title).toBe('Invalid request');
  expect(last.error.status).toBe(400);
  expect(last.error.message).toBe('Output blocked by content filtering policy');
  expect(last.error.requestId).toBe('req_011CaeanuZcbSgzbnKUNX8hP');
});
```

If `baseProps()` doesn't exist in this file, build the props inline by copying the shape used by the "renders thinking indicator while streaming" test and changing only the relevant fields (`onMessagesChange`, `aiProvider: 'claude'`, `initialMessages: []`).

- [ ] **Step 3: Run the failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "API-Error assistant text"`
Expected: FAIL — the last message has `role: 'assistant'` (current behavior) and no `error` field.

- [ ] **Step 4: Branch in the assistant handler**

In `src/components/Chat/ChatPanel.tsx`:

1. Extend the existing parseAiError import:

```tsx
import { parseAiError, looksLikeApiError } from './parseAiError';
```

2. Find the `if (text || tools.length > 0) { setMessages(prev => { ... }) }` block inside the `msg.type === 'assistant'` handler (around line 824). Insert a new branch BEFORE that existing block:

```tsx
if (text && tools.length === 0 && looksLikeApiError(text)) {
  const error = parseAiError(text);
  setMessages(prev => {
    const next = [...prev];
    const last = next[next.length - 1];
    // If the last message is a streaming-partial assistant with no tool calls,
    // it's the partial that has been accumulating the error envelope as it
    // streamed in — drop it.
    if (last?.role === 'assistant' && !last.toolCalls) {
      next.pop();
    }
    next.push({
      id: `${Date.now()}-${Math.random()}`,
      role: 'system',
      content: error.message,
      timestamp: Date.now(),
      error,
    });
    return next;
  });
  return;
}
```

The `return` exits the assistant handler so the normal append/update path doesn't also run. Do not modify the existing append/update block — non-error assistant text continues to flow through it unchanged.

- [ ] **Step 5: Run the test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "API-Error assistant text"`
Expected: PASS.

- [ ] **Step 6: Run the full ChatPanel suite to confirm no regressions**

Run: `npm run test:unit -- ChatPanel.test.tsx`
Expected: PASS — the new test plus all existing tests.

- [ ] **Step 7: Manual smoke check**

Run the app with `npm run dev`. Trigger an API error (a content-policy block, an oversize input, or any other request that returns a 4xx envelope as assistant text — pasting a long prompt that triggers content filtering is the easiest reproducer). Confirm the message renders as the standard accent-bordered error card with title, HTTP status badge, message, request_id, expandable details, and a retry button — not as raw JSON inside an assistant bubble.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): route API-error assistant text through error UI"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Detection" → Task 1 (the helper) + Task 2 step 4 (the branch reads `looksLikeApiError`)
  - "Routing change — drop partial, append system error" → Task 2 step 4 (`next.pop()` then `next.push({ role: 'system', error })`)
  - "tools.length > 0 → leave as-is" → Task 2 step 4 (`tools.length === 0` guard in the new branch)
  - "Result: identical rendering to other parsed errors" → no implementation change needed; the existing system-role + `error` field rendering does the work
  - "Test cases" → Task 1 covers all four `looksLikeApiError` cases plus the prose false-positive guard; Task 2 covers the routing end-to-end
- **Placeholder scan:** none.
- **Type consistency:** `looksLikeApiError(text: string): boolean` declared in Task 1 step 3, called in Task 2 step 4. `error` field shape (title/status/message/requestId) inherited from existing `ParsedError` type — no drift.
