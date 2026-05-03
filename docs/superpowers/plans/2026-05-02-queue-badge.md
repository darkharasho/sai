# Queued Messages Badge + Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Replace the standalone vertical stack of queued-message cards above the chat input with an accent-gold badge in the chat input's left toolbar. Click opens a popover with promote-to-next (`↑`) and remove (`×`) per item.

**Architecture:** Two tasks. Task 1 rewrites `MessageQueue.tsx` as a self-contained badge + popover that returns `null` when the queue is empty, accepts a new `onPromote(id)` prop, and renders inside `toolbar-left`. Task 2 adds `handleQueuePromote` to `App.tsx` and threads `onQueuePromote` through `ChatPanel` → `ChatInput`, drops the standalone `<MessageQueue>` row from `chat-bottom-strip`, and renders the new MessageQueue inside `ChatInput`'s `toolbar-left` after the existing `<TodoProgress>` widget.

**Tech Stack:** React 18, TypeScript, framer-motion (`motion/react`), Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-05-02-queue-badge-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/MessageQueue.tsx` — full rewrite from row stack to badge + popover; accept new `onPromote` prop
- `src/components/Chat/ChatInput.tsx` — accept `messageQueue?`, `onQueueRemove?`, `onQueuePromote?`; render `<MessageQueue>` in `toolbar-left` after `<TodoProgress>`
- `src/components/Chat/ChatPanel.tsx` — drop standalone `<MessageQueue>` line from `chat-bottom-strip`; thread `messageQueue`, `onQueueRemove`, `onQueuePromote` through to `<ChatInput>`; accept new `onQueuePromote` prop
- `src/App.tsx` — add `handleQueuePromote(sessionId, id)` callback; pass to `<ChatPanel>`
- `tests/unit/components/Chat/MessageQueue.test.tsx` — new file (or repurpose `MessageQueue.integration.test.tsx`) with badge/popover tests
- `tests/unit/components/Chat/ChatPanel.test.tsx` — extend with negative assertion that `<MessageQueue>` is no longer a child of `chat-bottom-strip`

No new components.

---

## Task 1: Rewrite MessageQueue as badge + popover

**Files:**
- Modify: `src/components/Chat/MessageQueue.tsx`
- Modify: `tests/unit/components/Chat/MessageQueue.integration.test.tsx` (rename in place to `MessageQueue.test.tsx` if you prefer, or just rewrite the existing file's tests; pick the simpler path)

- [ ] **Step 1: Read context**

Open `src/components/Chat/MessageQueue.tsx` to see the existing row-stack implementation. The component currently takes `{ queue, onRemove }` and renders an `AnimatePresence`-wrapped vertical list of accent-bordered cards. Everything but the data prop shape (and the `onRemove` callback) gets replaced.

Open `tests/unit/components/Chat/MessageQueue.integration.test.tsx` — it asserts on the existing chip class. We'll replace the tests entirely.

- [ ] **Step 2: Replace the test file with new badge/popover tests**

Overwrite `tests/unit/components/Chat/MessageQueue.integration.test.tsx` with the following (note the rename is optional — keep the same filename for minimum churn):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

const buildQueue = (count: number): QueuedMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `q-${i}`,
    text: `message ${i + 1}`,
    fullText: `message ${i + 1}`,
  }));

describe('MessageQueue (badge + popover)', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <MessageQueue queue={[]} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the badge with "<n> queued" when the queue has items', () => {
    const { container, getByText } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.querySelector('[data-testid="queue-badge"]')).toBeTruthy();
    expect(getByText('3 queued')).toBeTruthy();
  });

  it('click opens the popover with all queued items', () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.querySelector('[data-testid="queue-popover"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const popover = container.querySelector('[data-testid="queue-popover"]');
    expect(popover).toBeTruthy();
    expect(popover?.textContent).toContain('message 1');
    expect(popover?.textContent).toContain('message 2');
    expect(popover?.textContent).toContain('message 3');
  });

  it('click outside closes the popover', async () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    expect(container.querySelector('[data-testid="queue-popover"]')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="queue-popover"]')).toBeNull();
    });
  });

  it('promote button is hidden on item at index 0', () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="queue-item"]');
    expect(items[0].querySelector('[data-testid="queue-promote"]')).toBeNull();
    expect(items[1].querySelector('[data-testid="queue-promote"]')).toBeTruthy();
  });

  it('promote button calls onPromote with the item id', () => {
    const onPromote = vi.fn();
    const { container } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={onPromote} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="queue-item"]');
    const promoteBtn = items[2].querySelector('[data-testid="queue-promote"]') as HTMLElement;
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledWith('q-2');
  });

  it('remove button calls onRemove with the item id', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={onRemove} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const removeBtn = container.querySelector('[data-testid="queue-remove"]') as HTMLElement;
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('q-0');
  });

  it('renders attachment glyphs when an item has attachments', () => {
    const queue: QueuedMessage[] = [{
      id: 'q-att',
      text: 'msg with attachments',
      fullText: 'msg with attachments',
      attachments: { images: 2, files: 1, terminal: true },
    }];
    const { container } = render(
      <MessageQueue queue={queue} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    expect(container.querySelector('[data-testid="queue-attachments"]')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `npm run test:unit -- MessageQueue`
Expected: FAIL — the new component shape doesn't exist yet.

- [ ] **Step 4: Rewrite `MessageQueue.tsx`**

Replace the entire contents of `src/components/Chat/MessageQueue.tsx` with:

```tsx
import { useState, useEffect, useRef } from 'react';
import type { QueuedMessage } from '../../types';
import { ArrowUp, FileText, Image, ListOrdered, Terminal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

interface MessageQueueProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onPromote: (id: string) => void;
}

export default function MessageQueue({ queue, onRemove, onPromote }: MessageQueueProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popoverTransition = useReducedMotionTransition(SPRING.pop);
  const badgeTransition = useReducedMotionTransition(SPRING.flick);
  const itemTransition = useReducedMotionTransition(SPRING.gentle);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Close popover automatically when the queue empties
  useEffect(() => {
    if (queue.length === 0 && open) setOpen(false);
  }, [queue.length, open]);

  if (queue.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.span
        ref={wrapRef}
        key="queue-badge-wrap"
        className="queue-badge-wrap"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={badgeTransition}
      >
        <button
          type="button"
          data-testid="queue-badge"
          className={`queue-badge${open ? ' queue-badge--open' : ''}`}
          onClick={() => setOpen(o => !o)}
          title={open ? undefined : `${queue.length} queued`}
        >
          <ListOrdered size={13} />
          <span className="queue-badge-count">{queue.length} queued</span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              data-testid="queue-popover"
              className="queue-popover"
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={popoverTransition}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="queue-popover-header">
                <span className="queue-popover-title">Queued messages</span>
                <span className="queue-popover-count">{queue.length}</span>
              </div>
              <ul className="queue-popover-list">
                <AnimatePresence initial={false}>
                  {queue.map((msg, i) => (
                    <motion.li
                      key={msg.id}
                      data-testid="queue-item"
                      className="queue-item"
                      layout
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6, height: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={itemTransition}
                    >
                      <span className="queue-index">{i + 1}</span>
                      {msg.attachments && (msg.attachments.terminal || msg.attachments.files > 0 || msg.attachments.images > 0) && (
                        <span className="queue-attachments" data-testid="queue-attachments">
                          {msg.attachments.terminal && <Terminal size={11} />}
                          {msg.attachments.files > 0 && <FileText size={11} />}
                          {msg.attachments.images > 0 && (
                            <>
                              <Image size={11} />
                              {msg.attachments.images > 1 && (
                                <span className="queue-attach-count">{msg.attachments.images}</span>
                              )}
                            </>
                          )}
                        </span>
                      )}
                      <span className="queue-text">{msg.text}</span>
                      <span className="queue-actions">
                        {i > 0 && (
                          <button
                            type="button"
                            data-testid="queue-promote"
                            className="queue-action queue-action--promote"
                            title="Move to next"
                            onClick={() => onPromote(msg.id)}
                          >
                            <ArrowUp size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="queue-remove"
                          className="queue-action queue-action--remove"
                          title="Remove"
                          onClick={() => onRemove(msg.id)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <style>{`
          .queue-badge-wrap {
            position: relative;
            display: inline-flex;
            align-items: center;
          }
          .queue-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px 3px 6px;
            border: none;
            border-radius: 5px;
            background: color-mix(in srgb, var(--accent) 6%, transparent);
            color: var(--accent);
            font-family: inherit;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
          }
          .queue-badge:hover {
            background: color-mix(in srgb, var(--accent) 12%, transparent);
          }
          .queue-badge--open {
            background: color-mix(in srgb, var(--accent) 16%, transparent);
          }
          .queue-badge-count {
            font-variant-numeric: tabular-nums;
          }

          .queue-popover {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            width: 360px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
            z-index: 10;
            color: var(--text);
            cursor: default;
          }
          .queue-popover-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-bottom: 1px solid var(--border);
            font-size: 11px;
          }
          .queue-popover-title { font-weight: 600; color: var(--text); }
          .queue-popover-count {
            color: var(--text-muted);
            margin-left: auto;
            font-variant-numeric: tabular-nums;
          }
          .queue-popover-list {
            list-style: none;
            padding: 4px 0;
            margin: 0;
            max-height: 280px;
            overflow-y: auto;
          }
          .queue-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 12px;
            font-size: 12px;
          }
          .queue-item:hover { background: rgba(255, 255, 255, 0.03); }
          .queue-index {
            color: var(--text-muted);
            font-weight: 600;
            font-size: 10px;
            width: 14px;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
          }
          .queue-attachments {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            color: var(--accent);
            opacity: 0.6;
            flex-shrink: 0;
          }
          .queue-attach-count {
            font-size: 9px;
            margin-left: -1px;
          }
          .queue-text {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            color: var(--text);
          }
          .queue-actions {
            display: inline-flex;
            gap: 2px;
            flex-shrink: 0;
            opacity: 0;
            transition: opacity 0.15s;
          }
          .queue-item:hover .queue-actions { opacity: 1; }
          .queue-action {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 3px;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            transition: color 0.15s, background 0.15s;
          }
          .queue-action:hover { color: var(--text); background: rgba(255, 255, 255, 0.06); }
          .queue-action--promote:hover {
            color: var(--accent);
            background: color-mix(in srgb, var(--accent) 10%, transparent);
          }
          .queue-action--remove:hover {
            color: var(--red);
            background: color-mix(in srgb, var(--red) 10%, transparent);
          }
        `}</style>
      </motion.span>
    </AnimatePresence>
  );
}
```

(`useReducedMotionTransition`, `SPRING.pop`, `SPRING.flick`, `SPRING.gentle` already live in `./motion`. lucide icons used: `ArrowUp`, `FileText`, `Image`, `ListOrdered`, `Terminal`, `X` — all available in the installed lucide-react version since they're used elsewhere in the codebase. If `ListOrdered` isn't available, fall back to `Layers`.)

- [ ] **Step 5: Run the tests**

Run: `npm run test:unit -- MessageQueue`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/MessageQueue.tsx tests/unit/components/Chat/MessageQueue.integration.test.tsx
git commit -m "feat(chat): rewrite MessageQueue as badge + popover with promote-to-next"
```

---

## Task 2: Wire promote handler + move MessageQueue into ChatInput toolbar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `src/components/Chat/ChatInput.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Read context**

In `src/App.tsx`, locate `handleQueueAdd`, `handleQueueRemove`, `handleQueueShift` (around line 397) and the `<ChatPanel>` JSX where they're passed (around line 1429).

In `src/components/Chat/ChatPanel.tsx`, locate the `chat-bottom-strip` block inside `<LayoutGroup>` — it currently renders `<MessageQueue queue={messageQueue} onRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)} />` between (where TodoProgress used to live) and `<ChatInput>`. Find the `<ChatInput …/>` props block and the `ChatPanelProps` interface (where `onQueueAdd`, `onQueueRemove`, `onQueueShift` are defined).

In `src/components/Chat/ChatInput.tsx`, locate the `ChatInputProps` interface and the `toolbar-left` JSX block (which already renders `<TodoProgress>` at the end).

Orientation only.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('does not render MessageQueue as a standalone child of the bottom strip', () => {
  const props = baseProps();
  const { container } = render(<ChatPanel {...props} />);
  const bottomStrip = container.querySelector('[data-testid="chat-bottom-strip"]');
  // Direct child queue badge would mean MessageQueue is still in the strip.
  // ChatInput is mocked in this test file, so any queue-badge rendered through
  // it won't appear; we just assert the standalone is gone.
  expect(bottomStrip?.querySelector('[data-testid="queue-badge"]')).toBeNull();
});
```

(`baseProps()` is the existing helper at the top of the file.)

- [ ] **Step 3: Run failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "MessageQueue as a standalone"`
Expected: PASS trivially (the mocked ChatInput emits nothing, and the existing standalone MessageQueue won't render a badge unless `messageQueue.length > 0` — default test props have an empty queue). That's acceptable: the assertion locks in the contract for future regressions.

If you want a stronger failing assertion, pass `messageQueue: [{ id: 'q-0', text: 'a', fullText: 'a' }]` in the test props — then the *current* code renders a queue-badge inside the bottom strip (via the standalone MessageQueue), and the assertion correctly fails until Task 2 step 5 removes the standalone. Use that variant if it fits cleanly.

- [ ] **Step 4: Add `handleQueuePromote` to `App.tsx`**

In `src/App.tsx`, just below the existing `handleQueueShift` callback (around line 424), add:

```tsx
const handleQueuePromote = useCallback((sessionId: string, id: string) => {
  setMessageQueues(prev => {
    const queue = prev.get(sessionId) || [];
    const idx = queue.findIndex(m => m.id === id);
    if (idx <= 0) return prev;
    const next = new Map(prev);
    const [item] = queue.slice(idx, idx + 1);
    const reordered = [item, ...queue.slice(0, idx), ...queue.slice(idx + 1)];
    next.set(sessionId, reordered);
    return next;
  });
}, []);
```

Behaviour: finds the item by id, moves it to index 0, preserves the relative order of every other item. No-op when the item is already first or not found.

In the `<ChatPanel>` JSX (around line 1429), add `onQueuePromote={handleQueuePromote}` next to the existing `onQueueShift={handleQueueShift}` line.

- [ ] **Step 5: Thread `onQueuePromote` through `ChatPanel.tsx` and drop the standalone MessageQueue**

In `src/components/Chat/ChatPanel.tsx`:

1. Extend the `ChatPanelProps` interface to include `onQueuePromote?: (sessionId: string, id: string) => void;` next to the existing `onQueueAdd / onQueueRemove / onQueueShift` lines.

2. Add `onQueuePromote` to the function-signature destructuring of props (alongside the other queue callbacks).

3. In the `chat-bottom-strip` block, REMOVE the `<MessageQueue …/>` line entirely. The bottom strip now contains only `<ChatInput …/>`.

4. Remove the `import MessageQueue from './MessageQueue';` line at the top of the file — no longer used here.

5. In the `<ChatInput …/>` props list, add three lines:

```tsx
messageQueue={messageQueue}
onQueueRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
onQueuePromote={(id) => sessionId && onQueuePromote?.(sessionId, id)}
```

(`messageQueue` and `sessionId` are already in scope. The local-callback wrappers preserve the existing pattern of `MessageQueue` not knowing about session ids.)

- [ ] **Step 6: Render `MessageQueue` inside `ChatInput`'s toolbar**

In `src/components/Chat/ChatInput.tsx`:

1. Add to imports near the top:

```tsx
import MessageQueue from './MessageQueue';
import type { QueuedMessage } from '../../types';
```

(`QueuedMessage` may already be imported — check before adding.)

2. Extend `ChatInputProps` with three new optional props (place near the existing TodoProgress-related `messages` and `isStreaming` props for cohesion):

```tsx
messageQueue?: QueuedMessage[];
onQueueRemove?: (id: string) => void;
onQueuePromote?: (id: string) => void;
```

3. In the function-signature destructuring add `messageQueue = [], onQueueRemove, onQueuePromote`.

4. In `toolbar-left`, immediately after the `<TodoProgress …/>` line, insert:

```tsx
<MessageQueue
  queue={messageQueue}
  onRemove={onQueueRemove ?? (() => {})}
  onPromote={onQueuePromote ?? (() => {})}
/>
```

The fallback no-op functions keep TypeScript happy when the parent doesn't supply the callbacks (shouldn't happen in production, but tests/storybook may).

- [ ] **Step 7: Run the tests**

Run: `npm run test:unit -- MessageQueue ChatPanel.test.tsx ChatInput.test.tsx`
Expected: PASS — all tests including the new bottom-strip assertion.

If `ChatInput.test.tsx` doesn't exist, skip it.

- [ ] **Step 8: Manual smoke check**

Run `npm run dev`. Send a message during a streaming turn (it gets queued). Open multiple, then:

- The standalone vertical card stack above the input is gone.
- Accent-gold `≡ N queued` badge is in the toolbar after the todo ring.
- Click the badge → popover opens with the items.
- Hover an item past the first → `↑` and `×` appear.
- Click `↑` on item 3 → it slides to position 1.
- Click `×` on any item → it removes.
- Empty the queue → badge fades out.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Chat/ChatPanel.tsx src/components/Chat/ChatInput.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): host queue badge inside chat input toolbar"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Visibility — show only when `queue.length > 0`, hide otherwise" → Task 1 step 4 (early `return null` guard)
  - "Idle display — list icon + `<n> queued`" → Task 1 step 4 (`<ListOrdered>` + `{queue.length} queued`)
  - "Click opens popover; outside-click / re-click closes" → Task 1 step 4 (`open` state, document mousedown listener)
  - "Promote `↑` hidden on index 0; calls `onPromote(id)`" → Task 1 step 4 (`{i > 0 && <button …>}`)
  - "Remove `×` calls `onRemove(id)`" → Task 1 step 4
  - "Attachment glyphs" → Task 1 step 4 (preserved from old component)
  - "Badge entry/exit + popover entry/exit + per-item layout reorder via framer" → Task 1 step 4 (`AnimatePresence` x3, `layout` on items)
  - "Reduced motion — instant transitions" → Task 1 step 4 (`useReducedMotionTransition` for all three transitions; CSS doesn't add new pulse-style keyframes)
  - "Reducer handles promote — moves item to index 0, preserves rest" → Task 2 step 4
  - "ChatInput renders MessageQueue in toolbar-left after TodoProgress" → Task 2 step 6
  - "ChatPanel drops standalone MessageQueue, threads onQueuePromote" → Task 2 step 5
  - "App.tsx adds handleQueuePromote and passes through" → Task 2 step 4
- **Placeholder scan:** none.
- **Type consistency:** `onPromote: (id: string) => void` declared in Task 1 step 4 (component prop), called in Task 1 step 4 (`onClick={() => onPromote(msg.id)}`), wired to `onQueuePromote(sessionId, id)` via the local closure in Task 2 step 5 (`(id) => sessionId && onQueuePromote?.(sessionId, id)`), and the App-level reducer signature is `(sessionId: string, id: string) => void` in Task 2 step 4. All consistent.
