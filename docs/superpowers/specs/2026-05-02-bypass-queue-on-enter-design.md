# Bypass Queue on Plain Enter

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/ChatPanel.tsx`

## Problem

Today, plain `Enter` on a non-empty composer always dispatches the
message immediately to the CLI. When there are already items in the
message queue and a turn is streaming, the user's intent ("send this
now") collides with the queue's auto-drain logic — the new message and
the queue items end up dispatched in rapid succession, which the user
perceives as "all 4 messages firing at once".

## Goal

Make plain `Enter` always behave like "send this NEXT", without
disturbing the queue. The user's message jumps the line; the queued
items stay queued and resume draining after the user's message
completes.

## Behaviour

Decision matrix for plain `Enter` (Ctrl+Enter still appends to queue
exactly as today, unchanged):

| State                                  | Today                                                                                              | New                                                                                                |
|----------------------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Not streaming, queue empty             | Send immediately                                                                                   | Send immediately (no change)                                                                       |
| Not streaming, queue non-empty         | Send immediately. Queue happens to not auto-drain because the trigger (streaming end) doesn't fire | Send immediately. Queue stays untouched until next streaming-end.                                  |
| Streaming, queue empty                 | Send immediately (CLI handles backpressure)                                                        | Send immediately (no change)                                                                       |
| **Streaming, queue non-empty**         | Send immediately AND queue auto-drains in serial after this turn → perceived as "burst"            | **Hold message in `pendingImmediateRef`. Fire it on next streaming-end, BEFORE queue resumes.**    |

After the held message's turn ends, the existing drain `useEffect`
continues to shift queue items as today (Q1 = C from brainstorming).

## Implementation

In `src/components/Chat/ChatPanel.tsx`:

```ts
const pendingImmediateRef = useRef<{ text: string; images?: string[] } | null>(null);
```

In `handleSend`, after the built-in command branches (`/clear`,
`/compact`, `/help`, `/fake-error`) but before the dispatch path:

```ts
if (isStreaming && messageQueue.length > 0) {
  pendingImmediateRef.current = { text, images };
  return;
}
```

Important: the message is held BEFORE the user-message bubble is
appended to `messages`. The bubble appears only when the message
actually fires (i.e. when the held message is later dispatched, the
existing `setMessages([..., user])` call inside `handleSend` will
add it then).

Extend the existing drain `useEffect` (around line 1268):

```ts
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

The pending message takes priority. Once it fires, its turn starts
streaming → on next streaming-end the queue resumes draining as
today.

## Visual feedback during the hold window

None. The hold window is normally short (in-flight turn just needs to
finish). The composer clears as if sent, which matches the user's
mental model. If usability testing reveals confusion about "where did
my message go?", a subtle `→ next` indicator can be added near the
queue badge in a follow-up.

## Files

- Modify: `src/components/Chat/ChatPanel.tsx` — add `pendingImmediateRef`, branch in `handleSend`, extend the drain `useEffect`.
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx` — three new tests.

## Testing

Unit tests:

1. **Plain send while streaming with non-empty queue holds the
   message** — render with `isStreaming` simulated true and a queue
   item; call `latestChatInputProps.onSend('new')`; assert `claudeSend`
   was NOT called yet, and no new user message appeared in the chat
   list.
2. **On streaming-end, the held message fires before the queue
   drains** — continue from above; simulate streaming ending; assert
   `claudeSend` is called with the held message's text, and the
   queue's `onQueueShift` was NOT called yet (the queue stays at its
   original length).
3. **After the held message's turn ends, queue drains from index 0** —
   continue from above; simulate the held message's turn streaming and
   ending; assert `onQueueShift` is called and `claudeSend` is called
   with the queue's first item.

Manual QA:

- Send a message; while it's streaming, Ctrl+Enter three more
  messages (queue=3). Type a fourth message and press Enter.
- Expected: composer clears. The current turn finishes. The fourth
  message's user bubble appears next, its turn runs. Then the
  three originally-queued messages drain in order.
- Old behaviour: all four would have appeared in rapid succession at
  the start of the next streaming-end.

## Out of scope

- Visual indicator for the held state (deferred).
- Stop-current-turn behaviour (Q2 option A in brainstorming was
  rejected in favour of Q2=B).
- Any change to Ctrl+Enter, the queue badge, or the queue popover.
- Persisting the held message across reloads (it lives only in a ref;
  page refresh loses it, same constraint as the queue itself today).
