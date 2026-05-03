# Bypass Queue on Plain Enter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** When the user presses plain `Enter` while a turn is streaming AND the message queue is non-empty, hold the message in `pendingImmediateRef` and fire it on the next streaming-end before any queued items drain. The queue stays untouched.

**Architecture:** Single-task change inside `src/components/Chat/ChatPanel.tsx`. Add a `pendingImmediateRef`, branch in `handleSend`, extend the existing drain `useEffect` to fire the held message before draining the queue.

**Tech Stack:** React 18, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-02-bypass-queue-on-enter-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/ChatPanel.tsx` — add `pendingImmediateRef`, branch in `handleSend`, extend the drain `useEffect`
- `tests/unit/components/Chat/ChatPanel.test.tsx` — three new tests

No new files.

---

## Task 1: Hold plain-Enter messages while streaming with a non-empty queue

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Read context**

In `src/components/Chat/ChatPanel.tsx`:
- Find `const handleSend = async (text: string, images?: string[]) => { ... }` (around line 1177). Note the built-in command branches (`/fake-error`, `/clear`, `/compact`, `/help`) at the top, and the dispatch path that follows (`setMessages([..., user])`, `claudeSend`/`geminiSend`/`codexSend`).
- Find the drain `useEffect` (around line 1268):
  ```ts
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && messageQueue.length > 0 && onQueueShift && sessionId) {
      const next = messageQueue[0];
      onQueueShift(sessionId);
      setTimeout(() => handleSend(next.fullText, next.images), 300);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);
  ```

In `tests/unit/components/Chat/ChatPanel.test.tsx`:
- Find the `baseProps()` helper at the top (or the inline-props pattern other tests use).
- Note the `mockSai` from `installMockSai`. `mockSai.claudeSend`, `mockSai.geminiSend`, `mockSai.codexSend` are spies on the IPC dispatch. `mockSai.claudeOnMessage` is the handler-capture pattern other streaming tests use.

Orientation only.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
describe('bypass-queue-on-enter', () => {
  const startStreaming = async (handler: (msg: any) => void) => {
    await act(async () => {
      handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    });
  };
  const endStreaming = async (handler: (msg: any) => void) => {
    await act(async () => {
      handler({ type: 'done', projectPath: '/project', scope: 'chat' });
    });
  };

  it('holds plain-Enter message while streaming with a non-empty queue', async () => {
    const onQueueShift = vi.fn();
    const props: ChatPanelProps = {
      ...baseProps(),
      messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
      onQueueShift,
    };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    await startStreaming(handler);

    mockSai.claudeSend.mockClear();
    await act(async () => {
      await latestChatInputProps.onSend('held message');
    });

    // Held: NOT dispatched yet, queue NOT shifted.
    expect(mockSai.claudeSend).not.toHaveBeenCalled();
    expect(onQueueShift).not.toHaveBeenCalled();
  });

  it('on streaming-end the held message fires before the queue drains', async () => {
    const onQueueShift = vi.fn();
    const props: ChatPanelProps = {
      ...baseProps(),
      messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
      onQueueShift,
    };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    await startStreaming(handler);
    await act(async () => {
      await latestChatInputProps.onSend('held message');
    });

    mockSai.claudeSend.mockClear();
    await endStreaming(handler);

    // The drain useEffect schedules via setTimeout(_, 300). Advance it.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
    });

    expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
    expect(mockSai.claudeSend.mock.calls[0][1]).toContain('held message');
    // The queue was NOT shifted — only the held message ran.
    expect(onQueueShift).not.toHaveBeenCalled();
  });

  it('after the held message turn ends, the queue resumes draining from index 0', async () => {
    const onQueueShift = vi.fn();
    const props: ChatPanelProps = {
      ...baseProps(),
      messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
      onQueueShift,
    };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    // Initial turn streams, user holds, initial turn ends → held message dispatches.
    await startStreaming(handler);
    await act(async () => {
      await latestChatInputProps.onSend('held message');
    });
    await endStreaming(handler);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });

    // Now held message is streaming; end it.
    mockSai.claudeSend.mockClear();
    await startStreaming(handler);
    await endStreaming(handler);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });

    // Queue should now drain.
    expect(onQueueShift).toHaveBeenCalledTimes(1);
    expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
    expect(mockSai.claudeSend.mock.calls[0][1]).toContain('queued one');
  });
});
```

(`mockSai.claudeSend.mock.calls[0][1]` indexes the second argument of `claudeSend(projectPath, prompt, ...)` — that's the prompt text. Adjust the index if the existing test patterns use a different shape.)

- [ ] **Step 3: Run failing tests**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "bypass-queue-on-enter"`
Expected: FAIL — currently `handleSend` dispatches immediately, so `claudeSend` is called in the first test and the queue would also drain after streaming-end.

- [ ] **Step 4: Add the `pendingImmediateRef` and branch in `handleSend`**

In `src/components/Chat/ChatPanel.tsx`, near the other refs at the top of the component (alongside `prevStreamingRef`, `pendingComposerRectRef`, etc.), add:

```ts
const pendingImmediateRef = useRef<{ text: string; images?: string[] } | null>(null);
```

In `handleSend`, after the existing built-in command branches (`/fake-error`, `/clear`, `/compact`, `/help`) but before the line that begins `isAtBottomRef.current = true;` (around line 1211), insert:

```ts
// Bypass-queue-on-enter: when streaming AND the queue has items, hold this
// send and let the drain useEffect fire it on the next streaming-end before
// any queued items drain.
if (isStreaming && messageQueue.length > 0) {
  pendingImmediateRef.current = { text, images };
  return;
}
```

The `return` skips the user-message-bubble append and the `claudeSend`/`geminiSend`/`codexSend` dispatch. Both happen later when the held message is fired by the drain `useEffect` (which calls `handleSend` again with the same args).

- [ ] **Step 5: Extend the drain `useEffect` to fire the held message first**

Replace the existing drain `useEffect` (around line 1267) with:

```ts
const prevStreamingRef = useRef(false);
useEffect(() => {
  if (prevStreamingRef.current && !isStreaming) {
    if (pendingImmediateRef.current) {
      const pending = pendingImmediateRef.current;
      pendingImmediateRef.current = null;
      setTimeout(() => handleSend(pending.text, pending.images), 300);
    } else if (messageQueue.length > 0 && onQueueShift && sessionId) {
      const next = messageQueue[0];
      onQueueShift(sessionId);
      setTimeout(() => handleSend(next.fullText, next.images), 300);
    }
  }
  prevStreamingRef.current = isStreaming;
}, [isStreaming]);
```

Pending takes priority. After it fires and its turn ends, `pendingImmediateRef` is null, so the queue drain path runs as today.

- [ ] **Step 6: Run the tests**

Run: `npm run test:unit -- ChatPanel.test.tsx`
Expected: PASS — three new bypass tests + all existing tests.

- [ ] **Step 7: Manual smoke check**

Run `npm run dev`. In a chat:
- Send a message; while it's streaming, Ctrl+Enter three more (queue=3).
- Type a fourth and press Enter (not Ctrl+Enter).
- Composer clears. The current turn finishes. Then the fourth message's user bubble appears and runs. Then the three originally-queued messages drain in order.
- Confirm: NO burst of all four firing at once at the streaming-end moment.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): hold plain-Enter sends behind queued items"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Behaviour matrix row "Streaming + queue non-empty → hold in `pendingImmediateRef`, fire next" → Step 4 (the new branch in `handleSend`) + Step 5 (extended drain useEffect)
  - All other behaviour matrix rows preserved by adding the new branch only after the built-in commands and only when both conditions hold → Step 4
  - "Held message fires BEFORE queue drains" → Step 5 (the `if (pendingImmediateRef.current) { ... } else if (queue.length > 0)` ordering)
  - "Queue resumes draining after held message's turn" → falls out of Step 5 (next streaming-end → pending is null → queue branch runs)
  - "Composer clears as if sent" → ChatInput already clears the composer on Enter; `handleSend` returning early doesn't affect that
- **Placeholder scan:** none.
- **Type consistency:** `pendingImmediateRef` is `useRef<{ text: string; images?: string[] } | null>(null)`. Stored shape matches `handleSend`'s signature `(text: string, images?: string[])`. Re-dispatched via `handleSend(pending.text, pending.images)` in the useEffect.
