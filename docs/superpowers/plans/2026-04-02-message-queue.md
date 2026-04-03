# Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to queue messages (up to 5) while the LLM is streaming, displayed as compact bar cards above the chat input, auto-fired sequentially after each turn completes.

**Architecture:** Queue state lives in-memory as a `Map<string, QueuedMessage[]>` in `App.tsx`, keyed by session ID. A new `MessageQueue` component renders the cards. `ChatInput` gains a Ctrl+Enter handler that calls an `onQueue` callback. `ChatPanel` orchestrates auto-firing on turn completion.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library

---

### Task 1: Add QueuedMessage type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the QueuedMessage interface**

Add after the `PendingApproval` interface (line 34):

```typescript
export interface QueuedMessage {
  id: string;
  text: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(queue): add QueuedMessage type"
```

---

### Task 2: Create MessageQueue component with tests (TDD)

**Files:**
- Create: `src/components/Chat/MessageQueue.tsx`
- Create: `tests/unit/components/Chat/MessageQueue.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/components/Chat/MessageQueue.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

describe('MessageQueue', () => {
  const mockQueue: QueuedMessage[] = [
    { id: '1', text: 'Refactor the auth module to use the new pattern' },
    { id: '2', text: 'Add unit tests for auth changes' },
    { id: '3', text: 'Run the full test suite' },
  ];

  it('renders nothing when queue is empty', () => {
    const { container } = render(<MessageQueue queue={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a card for each queued message', () => {
    render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} />);
    expect(screen.getByText(/Refactor the auth module/)).toBeTruthy();
    expect(screen.getByText(/Add unit tests/)).toBeTruthy();
    expect(screen.getByText(/Run the full test suite/)).toBeTruthy();
  });

  it('shows numbered indices starting at 1', () => {
    render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('3.')).toBeTruthy();
  });

  it('calls onRemove with correct id when × is clicked', () => {
    const onRemove = vi.fn();
    render(<MessageQueue queue={mockQueue} onRemove={onRemove} />);
    const removeButtons = screen.getAllByTitle('Remove from queue');
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith('2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Chat/MessageQueue.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the MessageQueue component**

```typescript
// src/components/Chat/MessageQueue.tsx
import type { QueuedMessage } from '../../types';
import { X } from 'lucide-react';

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
}

export default function MessageQueue({ queue, onRemove }: MessageQueueProps) {
  if (queue.length === 0) return null;

  return (
    <div className="message-queue">
      {queue.map((msg, i) => (
        <div key={msg.id} className="message-queue-card">
          <span className="message-queue-index">{i + 1}.</span>
          <span className="message-queue-text">{msg.text}</span>
          <button
            className="message-queue-remove"
            title="Remove from queue"
            onClick={() => onRemove(msg.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <style>{`
        .message-queue {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 8px 4px;
          flex-shrink: 0;
        }
        .message-queue-card {
          display: flex;
          align-items: center;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
          height: 24px;
          color: var(--text-secondary, #c4c4e0);
        }
        .message-queue-index {
          opacity: 0.4;
          margin-right: 6px;
          font-size: 11px;
          min-width: 14px;
          flex-shrink: 0;
        }
        .message-queue-text {
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .message-queue-remove {
          margin-left: 8px;
          opacity: 0.35;
          cursor: pointer;
          background: none;
          border: none;
          color: inherit;
          padding: 0 2px;
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .message-queue-remove:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/Chat/MessageQueue.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/MessageQueue.tsx tests/unit/components/Chat/MessageQueue.test.tsx
git commit -m "feat(queue): add MessageQueue component with tests"
```

---

### Task 3: Add Ctrl+Enter queue handler to ChatInput (TDD)

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (props interface at line 14, handleKeyDown at line 449)
- Modify: `tests/unit/components/Chat/ChatInput.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/components/Chat/ChatInput.test.tsx`:

```typescript
  describe('message queueing', () => {
    it('calls onQueue on Ctrl+Enter when streaming and queue not full', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).toHaveBeenCalledWith('queued message');
    });

    it('clears input after queueing', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(textarea.value).toBe('');
    });

    it('does not queue when at max capacity (5)', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={5}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });

    it('does not queue when not streaming (Ctrl+Enter is no-op)', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={false}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });

    it('does not queue when input is empty', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx`
Expected: FAIL — `onQueue` prop not recognized / not called

- [ ] **Step 3: Add onQueue and queueCount props to ChatInput**

In `src/components/Chat/ChatInput.tsx`, add to the `ChatInputProps` interface (after line 19, the `onStop` prop):

```typescript
  onQueue?: (text: string) => void;
  queueCount?: number;
```

- [ ] **Step 4: Add Ctrl+Enter handler to handleKeyDown**

In `src/components/Chat/ChatInput.tsx`, add this block immediately before the existing `if (e.key === 'Enter' && !e.shiftKey)` check at line 449:

```typescript
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && isStreaming && onQueue && (queueCount ?? 0) < 5) {
        onQueue(trimmed);
        setValue('');
      }
      return;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx`
Expected: PASS (all existing + 5 new tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatInput.tsx tests/unit/components/Chat/ChatInput.test.tsx
git commit -m "feat(queue): add Ctrl+Enter queue handler to ChatInput"
```

---

### Task 4: Add queue counter display to ChatInput

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (the input-toolbar area around line 620)

- [ ] **Step 1: Add queue counter next to the input toolbar**

In `src/components/Chat/ChatInput.tsx`, find the `input-toolbar` div (line 620). Add the queue counter inside it, after the existing children but before the closing `</div>`:

```typescript
{(queueCount ?? 0) > 0 && (
  <span className="queue-counter">{queueCount}/5 queued</span>
)}
```

- [ ] **Step 2: Add CSS for the counter**

Add inside the existing `<style>` block in ChatInput:

```css
.queue-counter {
  font-size: 10px;
  opacity: 0.3;
  white-space: nowrap;
  margin-left: auto;
  padding-left: 8px;
}
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Open the app. The counter should not appear when queue is empty.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat(queue): add queue counter display to ChatInput"
```

---

### Task 5: Wire queue state into ChatPanel (TDD)

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (props interface at line 299, JSX at line 1079)

- [ ] **Step 1: Add queue props to ChatPanelProps**

In `src/components/Chat/ChatPanel.tsx`, add to the `ChatPanelProps` interface (after `onTurnComplete` at line 323):

```typescript
  messageQueue?: QueuedMessage[];
  onQueueAdd?: (sessionId: string, text: string) => void;
  onQueueRemove?: (sessionId: string, id: string) => void;
  onQueueShift?: (sessionId: string) => QueuedMessage | undefined;
  sessionId?: string;
```

Add the import at the top of the file:

```typescript
import type { QueuedMessage } from '../../types';
```

- [ ] **Step 2: Destructure new props in the component function**

In the component function signature (around line 483), destructure the new props:

```typescript
  const { messageQueue = [], onQueueAdd, onQueueRemove, onQueueShift, sessionId, ...existingProps } = props;
```

Note: keep all existing destructured props, just add the new ones alongside them.

- [ ] **Step 3: Add the onQueue handler**

Add after the `handleSend` function (around line 1026):

```typescript
  const handleQueue = (text: string) => {
    if (sessionId && onQueueAdd) {
      onQueueAdd(sessionId, text);
    }
  };
```

- [ ] **Step 4: Add auto-fire on turn completion**

Add a `useEffect` that watches `isStreaming` and fires the next queued message when streaming stops. Add after the existing useEffect hooks (around line 550):

```typescript
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && messageQueue.length > 0 && onQueueShift && sessionId) {
      const next = onQueueShift(sessionId);
      if (next) {
        // Small delay to let the UI settle before firing next message
        setTimeout(() => handleSend(next.text), 300);
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);
```

- [ ] **Step 5: Render MessageQueue and wire ChatInput props**

Import MessageQueue at the top:

```typescript
import MessageQueue from './MessageQueue';
```

In the JSX, add `<MessageQueue>` right before `<ChatInput>` (before line 1079):

```typescript
      <MessageQueue
        queue={messageQueue}
        onRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
      />
```

Add `onQueue` and `queueCount` props to the existing `<ChatInput>` JSX (after `onStop` prop at line 1088):

```typescript
        onQueue={handleQueue}
        queueCount={messageQueue.length}
```

- [ ] **Step 6: Run all tests to verify nothing is broken**

Run: `npx vitest run tests/unit/components/Chat/`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat(queue): wire queue state and auto-fire into ChatPanel"
```

---

### Task 6: Add queue state management to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add queue state**

In `src/App.tsx`, add the import for `QueuedMessage` (with the existing types import from `./types`):

```typescript
import type { ChatMessage, WorkspaceContext, OpenFile, QueuedMessage } from './types';
```

Add the queue state near the other workspace state (around line 130):

```typescript
const [messageQueues, setMessageQueues] = useState<Map<string, QueuedMessage[]>>(new Map());
```

- [ ] **Step 2: Add queue mutation functions**

Add after the state declaration:

```typescript
const handleQueueAdd = useCallback((sessionId: string, text: string) => {
  setMessageQueues(prev => {
    const queue = prev.get(sessionId) || [];
    if (queue.length >= 5) return prev;
    const next = new Map(prev);
    next.set(sessionId, [...queue, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text }]);
    return next;
  });
}, []);

const handleQueueRemove = useCallback((sessionId: string, id: string) => {
  setMessageQueues(prev => {
    const queue = prev.get(sessionId) || [];
    const next = new Map(prev);
    next.set(sessionId, queue.filter(m => m.id !== id));
    return next;
  });
}, []);

const handleQueueShift = useCallback((sessionId: string): QueuedMessage | undefined => {
  let shifted: QueuedMessage | undefined;
  setMessageQueues(prev => {
    const queue = prev.get(sessionId) || [];
    if (queue.length === 0) return prev;
    shifted = queue[0];
    const next = new Map(prev);
    next.set(sessionId, queue.slice(1));
    return next;
  });
  return shifted;
}, []);
```

- [ ] **Step 3: Pass queue props to ChatPanel**

In the `<ChatPanel>` JSX (around line 999), add the new props after the existing ones:

```typescript
                  messageQueue={messageQueues.get(ws.activeSession.id) || []}
                  onQueueAdd={handleQueueAdd}
                  onQueueRemove={handleQueueRemove}
                  onQueueShift={handleQueueShift}
                  sessionId={ws.activeSession.id}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(queue): add queue state management to App.tsx"
```

---

### Task 7: Integration testing

**Files:**
- Create: `tests/unit/components/Chat/MessageQueue.integration.test.tsx`

- [ ] **Step 1: Write integration tests for the queue flow**

```typescript
// tests/unit/components/Chat/MessageQueue.integration.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

describe('MessageQueue integration', () => {
  it('renumbers cards after removal', () => {
    const queue: QueuedMessage[] = [
      { id: '1', text: 'First' },
      { id: '2', text: 'Second' },
      { id: '3', text: 'Third' },
    ];
    const onRemove = vi.fn();
    const { rerender } = render(<MessageQueue queue={queue} onRemove={onRemove} />);

    // Remove middle item
    fireEvent.click(screen.getAllByTitle('Remove from queue')[1]);
    expect(onRemove).toHaveBeenCalledWith('2');

    // Simulate parent removing the item and re-rendering
    const updated = queue.filter(m => m.id !== '2');
    rerender(<MessageQueue queue={updated} onRemove={onRemove} />);

    // Should renumber to 1, 2
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.queryByText('3.')).toBeNull();
  });

  it('renders nothing after all items removed', () => {
    const { container, rerender } = render(
      <MessageQueue queue={[{ id: '1', text: 'Only one' }]} onRemove={vi.fn()} />
    );
    expect(container.firstChild).not.toBeNull();

    rerender(<MessageQueue queue={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('truncates long message text via CSS (card structure is correct)', () => {
    const longText = 'A'.repeat(200);
    render(<MessageQueue queue={[{ id: '1', text: longText }]} onRemove={vi.fn()} />);
    const textEl = screen.getByText(longText);
    expect(textEl.className).toContain('message-queue-text');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/unit/components/Chat/MessageQueue.integration.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/Chat/MessageQueue.integration.test.tsx
git commit -m "test(queue): add integration tests for MessageQueue"
```

---

### Task 8: Manual verification and cleanup

- [ ] **Step 1: Run dev server and verify end-to-end**

Run: `npm run dev`

Verify:
1. Send a message, while LLM is streaming type text and press Ctrl+Enter — card appears above input
2. Queue multiple messages (up to 5) — cards stack with correct numbering
3. 6th message via Ctrl+Enter is rejected (nothing happens)
4. Click × on a card — it is removed, remaining cards renumber
5. When LLM turn completes, first queued message fires automatically
6. Chain continues through all queued messages
7. Switch sessions — queue is independent per session
8. Switch back — queue is preserved
9. "N/5 queued" counter shows in input area
10. Enter still sends immediately / interrupts as normal
11. Ctrl+Enter when not streaming does nothing

- [ ] **Step 2: Run full test suite one more time**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "feat(queue): message queue for AI provider"
```
