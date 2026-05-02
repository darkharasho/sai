# User-Message FLIP Animation — Design

## Goal

When the user sends a message, the new user bubble appears to fly up from the composer's input box into its final slot in the chat list, then settles. The effect makes send feel like a physical handoff between the input and the conversation.

## Effect

- Duration: **300ms**
- Easing: **`cubic-bezier(0.16, 1, 0.3, 1)`** (deliberate ease-out)
- Animated properties: `transform` (translate + uniform scale) and `opacity`
- Always on. Skipped only when `prefers-reduced-motion: reduce` is set.

This is an **origin-anchored animation**, not a true rect-matching FLIP — the composer is much wider than a chat bubble, so matching width 1:1 squishes the bubble. We use the composer's rect only as the source position, with a uniform start scale of `0.92`.

## Architecture

The animation is driven by three pieces:

1. **Composer rect capture** in `ChatInput`
2. **Pending-rect map** held on a ref in `ChatPanel`
3. **One-shot mount effect** in `ChatMessage` (user role only)

### 1. Composer rect capture (`ChatInput.tsx`)

`ChatInput` already has `wrapperRef` on its `.input-wrapper`. Add a new optional prop:

```ts
onBeforeSend?: (rect: DOMRect) => void;
```

Right before the existing `onSend(...)` call inside the send handler (and right before clearing the textarea value), invoke:

```ts
onBeforeSend?.(wrapperRef.current!.getBoundingClientRect());
```

The rect is captured *before* the textarea clears so the composer is still at its full multi-line height — that height is what should appear to launch.

### 2. Pending-rect map (`ChatPanel.tsx`)

Add a ref:

```ts
const pendingFlipRectsRef = useRef<Map<string, DOMRect>>(new Map());
```

Refactor `handleSend` so the new message id is generated *before* the `setMessages` call (today it inlines `Date.now().toString()`). Pass an `onBeforeSend` callback to `ChatInput` that stashes the rect under a "pending" key, and on actual send, move it under the new message id:

```ts
const pendingComposerRectRef = useRef<DOMRect | null>(null);
// passed to <ChatInput onBeforeSend={(r) => { pendingComposerRectRef.current = r; }} />

// inside handleSend, after generating id:
const id = Date.now().toString();
if (pendingComposerRectRef.current) {
  pendingFlipRectsRef.current.set(id, pendingComposerRectRef.current);
  pendingComposerRectRef.current = null;
}
```

Pass a getter (or the relevant rect) down to `ChatMessage`. Simplest: pass a `flipFromRect?: DOMRect` prop to *every* ChatMessage, computed as `pendingFlipRectsRef.current.get(message.id)`. ChatMessage clears the entry from the map after consuming it (or ChatPanel clears via callback).

A cleaner alternative: pass `pendingFlipRectsRef` down via a small context (`ChatFlipContext`) so we don't widen ChatMessage's prop list. Either is fine — pick whichever fits the file's existing style.

### 3. One-shot mount effect (`ChatMessage.tsx`)

In `ChatMessage`, gate on `message.role === 'user'` and the existence of a `flipFromRect`. Use `useLayoutEffect` (not `useEffect`) so the start transform is applied before paint:

```ts
useLayoutEffect(() => {
  if (message.role !== 'user') return;
  const fromRect = consumeFlipRect(message.id); // reads + deletes from map
  if (!fromRect) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const node = bubbleRef.current;
  if (!node) return;
  const toRect = node.getBoundingClientRect();
  const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
  const dy = fromRect.top - toRect.top;
  const startScale = 0.92;

  node.style.transition = 'none';
  node.style.transform = `translate(${dx}px, ${dy}px) scale(${startScale})`;
  node.style.opacity = '0.7';
  node.style.transformOrigin = 'bottom right';

  requestAnimationFrame(() => {
    node.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms cubic-bezier(0.16, 1, 0.3, 1)';
    node.style.transform = '';
    node.style.opacity = '';
  });

  const cleanup = () => {
    node.style.transition = '';
    node.style.transform = '';
    node.style.opacity = '';
    node.style.transformOrigin = '';
  };
  node.addEventListener('transitionend', cleanup, { once: true });
  return () => node.removeEventListener('transitionend', cleanup);
}, []);
```

`bubbleRef` attaches to whatever DOM node represents the user message bubble (the existing top-level wrapper for the user role branch in ChatMessage).

## Edge cases

- **Reduced motion:** Skip the FLIP entirely; the bubble appears in place.
- **Queued messages** (`handleSend` called via the `setTimeout` queue path at `ChatPanel.tsx:1118`): These also FLIP from the composer's *current* rect. The user can see the queued message arrive — same effect, no special-case code, since these go through the same `handleSend`.
- **Retry path** (`handleRetry` at `ChatPanel.tsx:1094`): No new user bubble is added (the old one is already in the list), so nothing to animate. No special handling needed.
- **`/help` and `/clear` commands:** `/clear` short-circuits before any message is appended. `/help` does append a user message — it should FLIP too, no special-case.
- **Scroll behavior:** `isAtBottomRef.current = true` is already set at the top of `handleSend`, so the list is at the bottom when the new bubble appears. The FLIP starts from a real on-screen rect and lands at the real on-screen slot, so no scroll math is needed.
- **Streaming/typing concurrent with send:** ChatInput's send is gated on `isStreaming` for the primary path (otherwise it queues). When a queued message later fires, the composer is empty/short — the rect captured at that moment is whatever the composer shows. Acceptable.

## Files touched

- `src/components/Chat/ChatInput.tsx` — add `onBeforeSend?: (rect: DOMRect) => void` prop, call it right before `onSend` + clear
- `src/components/Chat/ChatPanel.tsx` — add `pendingFlipRectsRef`, wire `onBeforeSend`, hoist message-id generation in `handleSend`, pass `flipFromRect` (or context) to ChatMessage
- `src/components/Chat/ChatMessage.tsx` — `useLayoutEffect` mount animation for user-role messages with a flip rect

No new dependencies. No CSS file changes (transitions are inline so they're easy to clear).

## Out of scope

- Animating assistant messages, system messages, tool blocks
- Composer outgoing animation (text shrinking/fading toward the list)
- A user-facing toggle
