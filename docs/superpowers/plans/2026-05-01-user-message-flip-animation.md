# User-Message FLIP Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user sends a message, animate the new user bubble from the composer's input box up into its final slot in the chat list (300ms `cubic-bezier(0.16, 1, 0.3, 1)`, origin-anchored translate + scale, always on, respects `prefers-reduced-motion`).

**Architecture:** `ChatInput` captures its `.input-wrapper` `getBoundingClientRect()` right before clearing the textarea on send and forwards it via a new `onBeforeSend` prop. `ChatPanel` stashes that rect in a `Map<messageId, DOMRect>` ref keyed to the freshly-generated user-message id, then passes the rect down to `ChatMessage` as a `flipFromRect` prop. `ChatMessage` runs a `useLayoutEffect` on mount (user role only) that measures its own bubble, computes deltas, sets the start transform synchronously, and on the next animation frame transitions to identity. The existing framer-motion `entryProps` are suppressed on the user message that owns a `flipFromRect` so the two animations don't compound.

**Tech Stack:** React 18 (existing), TypeScript, vanilla DOM `transition`/`transform` (no new deps). `framer-motion` is already in use for the existing entry animation; we sidestep it for the FLIP path because we need a pre-paint layout measurement that's awkward inside framer's lifecycle.

**Spec:** [`docs/superpowers/specs/2026-05-01-user-message-flip-animation-design.md`](../specs/2026-05-01-user-message-flip-animation-design.md)

---

## File Structure

- `src/components/Chat/flipRegistry.ts` — **new**, ~30 lines. Module-level `Map<string, DOMRect>` for pending FLIP source rects, plus `setFlipRect`/`consumeFlipRect` helpers. Module-level avoids prop-drilling a ref through ChatPanel → list → ChatMessage and avoids context-provider boilerplate. Pairs naturally with the existing module-level `SEEN_MESSAGES`/`TYPEWRITER_PROGRESS` pattern in `ChatMessage.tsx`.
- `src/components/Chat/ChatInput.tsx` — modify. Add `onBeforeSend?: (rect: DOMRect) => void` prop, call it in the three send paths (Enter key, send button click, queued-send) right before `onSend(...)` / `setValue('')`.
- `src/components/Chat/ChatPanel.tsx` — modify. In `handleSend`, generate the message id once at the top, register `onBeforeSend` on `<ChatInput>` to stash the rect under that id via `setFlipRect`.
- `src/components/Chat/ChatMessage.tsx` — modify. On mount for `message.role === 'user'`, call `consumeFlipRect(message.id)`; if a rect comes back and reduced-motion is off, run the FLIP `useLayoutEffect` and suppress `entryProps`.
- `tests/unit/components/Chat/flipRegistry.test.ts` — **new**. Unit tests for `setFlipRect`/`consumeFlipRect`.
- `tests/unit/components/Chat/ChatInput.test.tsx` — modify. Add a test that `onBeforeSend` is called with a `DOMRect` immediately before `onSend`.
- `tests/unit/components/Chat/ChatPanel.test.tsx` — modify. Add a test that sending registers a flip rect under the new user message's id.

---

## Task 1: Create the flip registry module

**Files:**
- Create: `src/components/Chat/flipRegistry.ts`
- Test: `tests/unit/components/Chat/flipRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Chat/flipRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setFlipRect, consumeFlipRect, hasFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

const fakeRect = (x = 0, y = 0, w = 100, h = 40): DOMRect => ({
  x, y, width: w, height: h,
  left: x, top: y, right: x + w, bottom: y + h,
  toJSON: () => ({}),
}) as DOMRect;

describe('flipRegistry', () => {
  beforeEach(() => { _resetFlipRegistry(); });

  it('returns undefined when no rect is registered for an id', () => {
    expect(consumeFlipRect('missing')).toBeUndefined();
    expect(hasFlipRect('missing')).toBe(false);
  });

  it('hasFlipRect is true after set and false after consume', () => {
    setFlipRect('msg-h', fakeRect());
    expect(hasFlipRect('msg-h')).toBe(true);
    consumeFlipRect('msg-h');
    expect(hasFlipRect('msg-h')).toBe(false);
  });

  it('returns a registered rect once and then deletes it', () => {
    const rect = fakeRect(10, 20, 300, 80);
    setFlipRect('msg-1', rect);
    expect(consumeFlipRect('msg-1')).toBe(rect);
    expect(consumeFlipRect('msg-1')).toBeUndefined();
  });

  it('keeps rects for different ids independent', () => {
    const a = fakeRect(1, 1);
    const b = fakeRect(2, 2);
    setFlipRect('a', a);
    setFlipRect('b', b);
    expect(consumeFlipRect('b')).toBe(b);
    expect(consumeFlipRect('a')).toBe(a);
  });

  it('overwrites an existing rect when set twice for the same id', () => {
    const a = fakeRect(1, 1);
    const b = fakeRect(2, 2);
    setFlipRect('x', a);
    setFlipRect('x', b);
    expect(consumeFlipRect('x')).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/flipRegistry.test.ts`
Expected: FAIL with module-not-found error for `flipRegistry`.

- [ ] **Step 3: Implement the registry**

Create `src/components/Chat/flipRegistry.ts`:

```ts
// Pending source rects for user-message FLIP animations, keyed by message id.
// Module-level so ChatPanel (writer) and ChatMessage (reader) don't have to
// thread a ref through props. Mirrors the SEEN_MESSAGES / TYPEWRITER_PROGRESS
// pattern already used in ChatMessage.tsx.
const FLIP_RECTS = new Map<string, DOMRect>();

export function setFlipRect(messageId: string, rect: DOMRect): void {
  FLIP_RECTS.set(messageId, rect);
}

export function consumeFlipRect(messageId: string): DOMRect | undefined {
  const rect = FLIP_RECTS.get(messageId);
  if (rect) FLIP_RECTS.delete(messageId);
  return rect;
}

// Non-destructive check, used at render time to decide whether a message
// "owns" a pending FLIP. Consume happens later in a layout effect — a
// useState initializer can't consume safely because React 18 StrictMode
// double-invokes initializers in dev, which would lose the rect on the
// throwaway first render.
export function hasFlipRect(messageId: string): boolean {
  return FLIP_RECTS.has(messageId);
}

// Test-only. Not exported from any index — keeps prod code from depending on it.
export function _resetFlipRegistry(): void {
  FLIP_RECTS.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/flipRegistry.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/flipRegistry.ts tests/unit/components/Chat/flipRegistry.test.ts
git commit -m "feat(chat): add flipRegistry for user-message FLIP source rects"
```

---

## Task 2: Wire `onBeforeSend` into ChatInput

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (props interface ~line 19, send paths at lines 628, 647, 1190)
- Test: `tests/unit/components/Chat/ChatInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatInput.test.tsx` (place inside the existing top-level `describe('ChatInput', ...)`):

```tsx
it('calls onBeforeSend with a DOMRect immediately before onSend on Enter', async () => {
  const order: string[] = [];
  const onSend = vi.fn(() => { order.push('send'); });
  const onBeforeSend = vi.fn((rect: DOMRect) => {
    order.push('before');
    expect(rect).toBeDefined();
    expect(typeof rect.left).toBe('number');
  });

  render(
    <ChatInput
      onSend={onSend}
      onBeforeSend={onBeforeSend}
      permissionMode="default"
      onPermissionChange={() => {}}
      effortLevel="medium"
      onEffortChange={() => {}}
      modelChoice="default"
      onModelChange={() => {}}
    />
  );

  const textarea = screen.getByRole('textbox');
  await userEvent.type(textarea, 'hello');
  await userEvent.keyboard('{Enter}');

  expect(onBeforeSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['before', 'send']);
});
```

If `userEvent` isn't already imported in this file, add: `import userEvent from '@testing-library/user-event';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx -t "onBeforeSend"`
Expected: FAIL — `onBeforeSend` is not declared on `ChatInputProps` (TS error) and the callback is never invoked.

- [ ] **Step 3: Add the prop to the interface**

In `src/components/Chat/ChatInput.tsx`, in the `ChatInputProps` interface (starts ~line 19), add right after `onSend`:

```ts
  onBeforeSend?: (composerRect: DOMRect) => void;
```

Add `onBeforeSend` to the destructured props at the top of the `ChatInput` component body (find the existing `function ChatInput({ onSend, ...` destructuring and add it to the list).

- [ ] **Step 4: Add a helper and call it from all three send paths**

Near the top of the component body (after the existing `wrapperRef` declaration), add:

```ts
  const fireBeforeSend = () => {
    if (!onBeforeSend) return;
    const node = wrapperRef.current;
    if (!node) return;
    onBeforeSend(node.getBoundingClientRect());
  };
```

Then insert `fireBeforeSend();` immediately before each `onSend(...)` call. There are exactly three:

1. `src/components/Chat/ChatInput.tsx:647` — Enter-key handler. Insert `fireBeforeSend();` on the line before `onSend(buildMessage(sendValue.trim()), ...)`.
2. `src/components/Chat/ChatInput.tsx:1190` — send-button click handler. Insert `fireBeforeSend();` on the line before `onSend(buildMessage(value.trim()), ...)`.
3. `src/components/Chat/ChatInput.tsx:818` — `<ContextRing onClick={() => onSend('/compact')} />`. **Skip this one** — `/compact` doesn't append a user message to the chat list, so there's nothing to animate. (`handleSend` in ChatPanel returns early for `/compact` at lines 1053-1055.)

Do **not** add it to the `onQueue(...)` path at line 622 — queued messages don't append to the list at queue time. They go through `handleSend` later (ChatPanel.tsx:1118), at which point ChatInput will fire `onBeforeSend` again on whatever the composer currently shows… except by then the queued message isn't being typed in the composer at all. **Acceptable behavior:** queued messages still FLIP from the composer's *then-current* rect when they actually fire, because the auto-send in `ChatPanel.tsx:1118` calls `handleSend` directly (not through ChatInput). For queued sends, `onBeforeSend` will not fire and no FLIP happens — they appear with the existing framer-motion entry animation. This is fine and consistent with the spec ("Acceptable").

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx -t "onBeforeSend"`
Expected: PASS.

- [ ] **Step 6: Run the full ChatInput suite to check for regressions**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatInput.tsx tests/unit/components/Chat/ChatInput.test.tsx
git commit -m "feat(chat): emit onBeforeSend with composer rect ahead of send"
```

---

## Task 3: Register flip rects from ChatPanel.handleSend

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (handleSend at lines 1046-1092, ChatInput JSX around line 1189)
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx` (place inside the existing `describe('ChatPanel', ...)`):

```tsx
import { consumeFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

// ...existing describe block...

it('registers a flip rect for the new user message id when the composer fires onBeforeSend', async () => {
  _resetFlipRegistry();

  // Render ChatPanel with whatever minimal props the existing tests use.
  // Re-use the existing test harness/helpers in this file.
  const { findByRole } = renderChatPanel(); // <-- use the existing helper

  const textarea = await findByRole('textbox');
  // Freeze Date.now so we know the generated message id
  const fakeNow = 1700000000000;
  vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

  await userEvent.type(textarea, 'hi there');
  await userEvent.keyboard('{Enter}');

  const rect = consumeFlipRect(String(fakeNow));
  expect(rect).toBeDefined();
  expect(typeof rect!.left).toBe('number');
});
```

If `renderChatPanel` doesn't exist as a helper, copy the render call pattern from the nearest existing test in the file and use it inline. If `Date.now` mocking conflicts with other tests, scope the mock with `beforeEach`/`afterEach` `vi.restoreAllMocks()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "flip rect"`
Expected: FAIL — `consumeFlipRect` returns undefined because nothing is registering rects yet.

- [ ] **Step 3: Hoist message id generation in `handleSend`**

In `src/components/Chat/ChatPanel.tsx`, modify `handleSend` (starts at line 1046). Replace the body from line 1046 down to (and including) the `setMessages(...)` call ending at line 1074 with:

```ts
  const handleSend = async (text: string, images?: string[]) => {
    // Handle built-in commands locally
    if (text === '/clear') {
      setMessages([]);
      setRenderStart(0);
      pendingComposerRectRef.current = null;
      return;
    }
    if (text === '/compact' && aiProvider === 'claude') {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice);
      pendingComposerRectRef.current = null;
      return;
    }

    const newMessageId = Date.now().toString();

    if (text === '/help') {
      if (pendingComposerRectRef.current) {
        setFlipRect(newMessageId, pendingComposerRectRef.current);
        pendingComposerRectRef.current = null;
      }
      setMessages(prev => [...prev,
        { id: newMessageId, role: 'user', content: text, timestamp: Date.now() },
        { id: `help-${Date.now()}`, role: 'system', content:
          buildHelpMessage(aiProvider, slashCommands),
          timestamp: Date.now() },
      ]);
      return;
    }

    isAtBottomRef.current = true;
    if (pendingComposerRectRef.current) {
      setFlipRect(newMessageId, pendingComposerRectRef.current);
      pendingComposerRectRef.current = null;
    }
    setMessages(prev => [...prev, {
      id: newMessageId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    }]);
```

(Lines from 1076 onward — the `imagePaths` block and provider dispatch — stay unchanged.)

- [ ] **Step 4: Add the pending-rect ref and import**

Near the top of the `ChatPanel` component body (alongside the other `useRef` declarations), add:

```ts
  const pendingComposerRectRef = useRef<DOMRect | null>(null);
```

At the top of the file with the other imports from `./`, add:

```ts
import { setFlipRect } from './flipRegistry';
```

- [ ] **Step 5: Wire `onBeforeSend` on `<ChatInput>`**

Find the `<ChatInput onSend={handleSend} ... />` JSX (~line 1189). Add a new prop right after `onSend`:

```tsx
        onBeforeSend={(rect) => { pendingComposerRectRef.current = rect; }}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "flip rect"`
Expected: PASS.

- [ ] **Step 7: Run the full ChatPanel suite**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx`
Expected: all tests pass. The handleSend refactor preserves existing behavior — the only observable change is that user message ids are now generated once at the top instead of inline.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): register flip rect under new user-message id on send"
```

---

## Task 4: Run the FLIP animation in ChatMessage

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` (component body at lines 260-270, top-level wrapper at line 536)

- [ ] **Step 1: Add the import**

At the top of `src/components/Chat/ChatMessage.tsx` (with the other `./` imports), add:

```ts
import { consumeFlipRect, hasFlipRect } from './flipRegistry';
```

Also confirm `useLayoutEffect` is in the React import at the top of the file. If not, add it:

```ts
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
```

- [ ] **Step 2: Add a ref for the bubble wrapper**

Inside the `ChatMessage` function body, alongside the other `useRef` calls (near line 281), add:

```ts
  const flipNodeRef = useRef<HTMLDivElement | null>(null);
```

- [ ] **Step 3: Decide whether this message owns a FLIP**

Right after the `entryProps` declaration (currently line 267-269), add:

```ts
  // User-message FLIP: peek (non-destructive) at the registry during render to
  // decide whether to suppress the default framer entry animation. The actual
  // consume happens inside the layout effect, exactly once per real mount —
  // doing it in a useState initializer would be wrong because React 18
  // StrictMode double-invokes initializers in dev and would drop the rect.
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flipActive = message.role === 'user'
    && !reducedMotion
    && hasFlipRect(message.id);

  const effectiveEntryProps = flipActive
    ? { initial: false as const, animate: { opacity: 1, y: 0 } }
    : entryProps;
```

(`useState` with an initializer ensures `consumeFlipRect` runs exactly once per mount, never on re-render.)

- [ ] **Step 4: Add the FLIP layout effect**

Right after the block from Step 3, add:

```ts
  useLayoutEffect(() => {
    if (!flipActive) return;
    const node = flipNodeRef.current;
    if (!node) return;
    const fromRect = consumeFlipRect(message.id);
    if (!fromRect) return;

    const toRect = node.getBoundingClientRect();
    const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
    const dy = fromRect.top - toRect.top;
    const startScale = 0.92;

    const prevTransition = node.style.transition;
    const prevTransform = node.style.transform;
    const prevOpacity = node.style.opacity;
    const prevOrigin = node.style.transformOrigin;

    node.style.transition = 'none';
    node.style.transformOrigin = 'bottom right';
    node.style.transform = `translate(${dx}px, ${dy}px) scale(${startScale})`;
    node.style.opacity = '0.7';

    // Force a layout flush so the start state is committed before we set the
    // end state — otherwise the browser collapses both writes into one and
    // skips the transition entirely.
    void node.getBoundingClientRect();

    const raf = requestAnimationFrame(() => {
      node.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms cubic-bezier(0.16, 1, 0.3, 1)';
      node.style.transform = '';
      node.style.opacity = '';
    });

    const cleanup = (e?: TransitionEvent) => {
      // Only react to our own transform transition, not nested children's.
      if (e && e.target !== node) return;
      node.style.transition = prevTransition;
      node.style.transform = prevTransform;
      node.style.opacity = prevOpacity;
      node.style.transformOrigin = prevOrigin;
      node.removeEventListener('transitionend', cleanup as EventListener);
    };
    node.addEventListener('transitionend', cleanup as EventListener);

    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('transitionend', cleanup as EventListener);
    };
  }, [flipActive]);
```

- [ ] **Step 5: Attach the ref and use the effective entry props**

At line 536 (the top-level `<motion.div>` for non-error messages), change:

```tsx
    <motion.div className={`chat-msg chat-msg-${message.role}${isAssistantStreaming ? ' chat-msg-streaming' : ''}${isTyping ? ' chat-msg-typing' : ''}`} {...entryProps}>
```

to:

```tsx
    <motion.div ref={flipNodeRef} className={`chat-msg chat-msg-${message.role}${isAssistantStreaming ? ' chat-msg-streaming' : ''}${isTyping ? ' chat-msg-typing' : ''}`} {...effectiveEntryProps}>
```

(The error-message branch at line 366 only renders for `role === 'error'` and never owns a FLIP, so leave it alone.)

- [ ] **Step 6: Smoke test in the running app**

Run: `npm run dev` (or whatever the project uses — check `package.json` scripts).

Open the app, open a chat, type a message, press Enter. The user bubble should visibly fly up from the input area into its slot, taking ~300ms with an ease-out feel.

Verify:
- The animation plays on every send (not just the first).
- Sending several messages rapidly doesn't break (each one animates from wherever the composer was at send time).
- `/help` typed in the composer also animates the user-message echo.
- Reduced-motion: in DevTools, open the rendering panel → emulate CSS media `prefers-reduced-motion: reduce`, send a message — the bubble appears in place with no FLIP.
- No regression in the existing fade/slide entry animation for assistant messages.
- No console errors or warnings.

If the animation flickers or the bubble snaps in before transitioning, double-check that `useLayoutEffect` (not `useEffect`) is being used and that the `void node.getBoundingClientRect()` reflow is present.

- [ ] **Step 7: Run the full ChatMessage suite**

Run: `npx vitest run tests/unit/components/Chat/ChatMessage.test.tsx`
Expected: all existing tests pass. (No new unit test here — JSDOM doesn't run CSS transitions, so the animation itself is verified manually in Step 6. The branching logic — that `flipActive` consumes the registry entry and `effectiveEntryProps` is set — is implicitly covered by the registry test in Task 1 and the panel test in Task 3.)

- [ ] **Step 8: Run the full unit suite**

Run: `npx vitest run`
Expected: full suite passes.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "feat(chat): FLIP user-message bubble from composer into list slot"
```

---

## Task 5: Final sweep

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint` (skip if no lint script exists in `package.json`).
Expected: no new errors or warnings in the files touched.

- [ ] **Step 3: Manual end-to-end check**

In the running app:
- Send 5+ messages in a row, including a multi-line message (Shift+Enter then Enter). The animation should play for each.
- Trigger a queued send (start a stream, type and queue a follow-up). When the queue auto-fires, the queued bubble should appear with the existing fade-up entry, **not** the FLIP — this is expected per the spec.
- Trigger a retry (cause an error message, click Retry). No FLIP, no new user bubble — the existing one is reused.
- Switch workspaces and come back. Old user messages should not re-animate on remount (the registry has no rect for those ids; `consumeFlipRect` returns `undefined`; framer's `entryProps` is gated on `SEEN_MESSAGES` which already contains them).

- [ ] **Step 4: Final commit if any cleanup was needed**

If steps 1-3 surfaced no changes, skip. Otherwise:

```bash
git add -A
git commit -m "chore(chat): cleanup after FLIP animation rollout"
```
