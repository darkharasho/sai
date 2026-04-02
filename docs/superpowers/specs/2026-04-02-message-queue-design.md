# Message Queue Design

Queue messages to the AI provider while the LLM is still working. Queued messages fire sequentially after each turn completes. Displayed as compact bar cards above the chat input.

## Interaction

- **Ctrl+Enter** queues the current input text when `isStreaming` is true. Input clears after queueing.
- **Enter** behaves normally (sends immediately / interrupts).
- **Ctrl+Enter** is a no-op when `isStreaming` is false or queue is at capacity (5).
- Clicking **×** on a queued card removes it. Remaining cards renumber.

## UI: Queued Message Cards

Compact bar cards stacked directly above `ChatInput`, between the message list and input area.

Each card is a single row, ~24px tall, 2px gap between cards:
- Numbered index (1-based, dim)
- Truncated message text (ellipsis overflow)
- × remove button (dim, full opacity on hover)

Styling: `rgba(99,102,241,0.12)` background, `rgba(99,102,241,0.25)` border, 4px border-radius, 12px font.

When queue is non-empty, a "N/5 queued" label appears at the right edge of the input area.

When queue is empty, nothing renders — no extra vertical space.

## Queue Processing

1. When `isStreaming` transitions from `true` to `false` (turn complete), check the current session's queue.
2. If non-empty, shift the first message off the queue.
3. Call `handleSend(message.text)` — reuses the exact same send path as manual input.
4. The sent message appears in chat as a normal user message. The card disappears from the stack.
5. Chain continues: turn completes → next queued message fires → repeat until queue empty.
6. Fires regardless of whether the previous turn ended in error or success.

## State Management

- **Queue state**: `Map<string, QueuedMessage[]>` in `App.tsx`, keyed by session ID.
- **QueuedMessage**: `{ id: string, text: string }`
- **Lifetime**: In-memory only (React state). Survives session switches within the app. Resets on app close/reload.
- Each session has its own independent queue.
- Max 5 messages per session queue.

## Component Structure

### `MessageQueue` (new component)
- Location: `src/components/Chat/MessageQueue.tsx`
- Props: `queue: QueuedMessage[]`, `onRemove: (id: string) => void`
- Renders the stack of bar cards. Returns null when queue is empty.

### `ChatInput` (modified)
- New prop: `onQueue: (text: string) => void`
- `handleKeyDown` adds a Ctrl+Enter branch: if `isStreaming` is true and queue is not at capacity, calls `onQueue(text)` and clears the input.

### `ChatPanel` (modified)
- Receives queue state and mutation callbacks from `App.tsx`.
- Renders `MessageQueue` between message list and `ChatInput`.
- Passes `onQueue` callback to `ChatInput` that appends to the current session's queue.
- On turn completion (`isStreaming` → false): if queue is non-empty, shifts first message and calls `handleSend`.

### `App.tsx` (modified)
- Holds the `Map<string, QueuedMessage[]>` state.
- Provides queue access/mutation functions to `ChatPanel` per active session.

## Testing

- Unit test `MessageQueue` renders cards with correct text/numbering, × removes items.
- Unit test `ChatInput` Ctrl+Enter calls `onQueue` when streaming, calls `onSend` when not streaming.
- Unit test auto-fire logic: mock turn completion triggers next queued message send.
- Unit test max capacity: 6th queue attempt is rejected.
- Unit test session isolation: switching sessions shows the correct queue.
