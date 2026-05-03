# Follow Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Replace the centered "new messages" pill in the chat panel with a single bottom-right anchored follow button that appears when scrolled away from bottom and carries an unread-dot when assistant messages arrive while you're scrolled up.

**Architecture:** Single component change inside `src/components/Chat/ChatPanel.tsx`. Add a `followOn` state mirror of `isAtBottomRef` (the ref stays the source of truth for scroll handlers; state syncs at the small set of boundaries where the ref changes). Replace the existing `showNewMessages` boolean with an `unreadCount` integer that increments on assistant message arrival while follow is off. Render a `motion.button` in the bottom-right corner with a `flick` spring entry/exit, gated on `!followOn`, plus a small accent dot when `unreadCount > 0`. Click handler clears the dot, sets follow back on, and tweens to bottom via the existing `tweenScrollToBottom` helper. Remove the old `new-messages-btn` markup, anchor div, CSS, keyframe, and the `prevLenRef` pulse effect.

**Tech Stack:** React 18, TypeScript, framer-motion (`motion/react`), Vitest, lucide-react icons. Motion vocabulary from `src/components/Chat/motion.ts`.

**Spec:** `docs/superpowers/specs/2026-05-02-follow-button-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/ChatPanel.tsx` — replaces `showNewMessages` with `followOn` + `unreadCount`, replaces `new-messages-btn` markup + CSS + pulse effect with a single bottom-right `follow-btn`
- `tests/unit/components/Chat/ChatPanel.test.tsx` — extend existing `new-messages-btn` test (now follow-button); add unread-dot test and click-clears-state test

No new files. The new button is small enough to live inline in `ChatPanel.tsx` alongside the rest of its JSX. Splitting into its own component would just relocate the wiring without simplifying it.

---

## Task 1: Replace new-messages-btn with bottom-right follow button

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Read the relevant ChatPanel sections**

Read `src/components/Chat/ChatPanel.tsx` to locate:
- The `showNewMessages` state declaration (around line 548 in current code)
- All call sites that read or write `showNewMessages`
- The `prevLenRef` + `useEffect` that pulses the old button (around lines 1093–1106)
- The `new-messages-btn` JSX block (around lines 1310–1330) and its `new-messages-anchor` wrapper
- The `.new-messages-btn`, `.new-messages-pulse`, and `@keyframes new-messages-pulse` CSS in the inline `<style>` block

This is purely orientation; no edits in this step.

- [ ] **Step 2: Write the failing tests**

Open `tests/unit/components/Chat/ChatPanel.test.tsx`. Find the existing test that checks for `[data-testid="new-messages-btn"]` (it's the one Task 17 of the previous plan added). Replace it and add two more tests:

```tsx
it('does not render the follow button when at-bottom', () => {
  const props = baseProps();
  const { container } = render(<ChatPanel {...props} />);
  expect(container.querySelector('[data-testid="follow-btn"]')).toBeNull();
});

it('renders the follow button when the user has scrolled away from the bottom', async () => {
  const props = baseProps();
  const { container } = render(<ChatPanel {...props} />);

  // Simulate scroll-away: dispatch a wheel-up on the messages container.
  const list = container.querySelector('.chat-messages') as HTMLElement;
  expect(list).toBeTruthy();
  await act(async () => {
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });

  expect(container.querySelector('[data-testid="follow-btn"]')).toBeTruthy();
});

it('shows the unread dot when an assistant message arrives while follow is off', async () => {
  const props = baseProps();
  const { container } = render(<ChatPanel {...props} />);

  await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

  const list = container.querySelector('.chat-messages') as HTMLElement;
  await act(async () => {
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });

  await act(async () => {
    for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
      (handler as (msg: any) => void)({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'hello' }] },
      });
    }
  });

  expect(container.querySelector('[data-testid="follow-btn-unread"]')).toBeTruthy();
});

it('click on the follow button clears unread and re-engages follow', async () => {
  const props = baseProps();
  const { container } = render(<ChatPanel {...props} />);

  await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

  const list = container.querySelector('.chat-messages') as HTMLElement;
  await act(async () => {
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  await act(async () => {
    for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
      (handler as (msg: any) => void)({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'hi' }] },
      });
    }
  });

  const btn = container.querySelector('[data-testid="follow-btn"]') as HTMLButtonElement;
  expect(btn).toBeTruthy();
  await act(async () => { btn.click(); });

  expect(container.querySelector('[data-testid="follow-btn"]')).toBeNull();
  expect(container.querySelector('[data-testid="follow-btn-unread"]')).toBeNull();
});
```

`baseProps()` is the existing helper in the test file. If it doesn't exist, build a full props object inline matching the pattern used by the other tests in this file (e.g. the "renders thinking indicator while streaming" test).

If the test file still has the old test referencing `[data-testid="new-messages-btn"]` (called something like "new-messages button uses flick spring entry"), delete it — the new tests above replace it.

- [ ] **Step 3: Run the failing tests**

Run: `npm run test:unit -- ChatPanel.test.tsx`
Expected: the four new tests fail (no `follow-btn` exists). All other tests still pass.

- [ ] **Step 4: Add follow state and unread tracking to ChatPanel**

In `src/components/Chat/ChatPanel.tsx`:

1. Replace the `showNewMessages` state declaration with two pieces of state:

```tsx
const [followOn, setFollowOn] = useState(true);
const [unreadCount, setUnreadCount] = useState(0);
```

(Delete the line that declares `const [showNewMessages, setShowNewMessages] = useState(false);`.)

2. Find every `setShowNewMessages(false)` and replace with both:

```tsx
setFollowOn(true);
setUnreadCount(0);
```

3. Find every `setShowNewMessages(true)` and replace with:

```tsx
setUnreadCount(c => c + 1);
```

(The button visibility is now derived from `followOn`, not from `showNewMessages` — so the only thing the assistant-arrival path does is bump the unread counter.)

4. In the `onWheel` listener (around line 967–971), set `followOn` to false when the user scrolls up:

```tsx
const onWheel = (e: WheelEvent) => {
  if (e.deltaY < 0) {
    isAtBottomRef.current = false;
    setFollowOn(false);
  }
};
```

5. In `handleScroll` (the at-bottom check around line 1062–1065), sync `followOn` when the user scrolls back to the bottom:

```tsx
if (atBottom) {
  isAtBottomRef.current = true;
  setFollowOn(true);
  setUnreadCount(0);
}
```

6. The existing `scrollToBottom` function already sets `isAtBottomRef.current = true; setShowNewMessages(false)`. After the substitutions in step 2, it now sets `isAtBottomRef.current = true; setFollowOn(true); setUnreadCount(0)`. Confirm that's correct after edits — no extra changes needed here.

7. Delete the `prevLenRef` declaration and the `useEffect` that pulses the old button (around lines 1093–1106). They're no longer needed — the unread dot is driven by `unreadCount`, not by a manual class toggle.

8. Delete the `btnRef = useRef<HTMLButtonElement | null>(null)` declaration that the old button used (around line 1093, just above the pulse effect).

- [ ] **Step 5: Replace the new-messages-btn JSX with the follow button**

Find the `<div className="new-messages-anchor">…</div>` block (around lines 1310–1331) and replace the entire block with:

```tsx
<AnimatePresence>
  {!followOn && (
    <motion.button
      data-testid="follow-btn"
      className="follow-btn"
      initial={{ opacity: 0, y: 6, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.85 }}
      transition={useReducedMotionTransition(SPRING.flick)}
      onClick={scrollToBottom}
      title="Jump to latest"
    >
      <ChevronDown size={16} />
      {unreadCount > 0 && (
        <span data-testid="follow-btn-unread" className="follow-btn-unread" aria-label={`${unreadCount} new`} />
      )}
    </motion.button>
  )}
</AnimatePresence>
```

Important: the `transition` prop calls `useReducedMotionTransition` inside the JSX, which would violate the rules of hooks (the call would be inside a conditional render). Hoist it above the `return`:

```tsx
const followBtnTransition = useReducedMotionTransition(SPRING.flick);
```

Then use `transition={followBtnTransition}` in the JSX. (Place this declaration alongside the other transition hook calls near the top of the component body.)

`AnimatePresence`, `motion`, `SPRING`, and `useReducedMotionTransition` are already imported in this file. `ChevronDown` is also already imported. No new imports needed.

- [ ] **Step 6: Replace the inline CSS for the old button with new CSS for the follow button**

In the inline `<style>` block, find and delete:

- The `.new-messages-anchor` rule
- The `.new-messages-btn` rule (and its `:hover` variant)
- The `@keyframes new-messages-pulse` block
- The `.new-messages-pulse` rule

Add in their place:

```css
.follow-btn {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--accent);
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  transition: background 0.15s, border-color 0.15s;
}
.follow-btn:hover {
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--accent) 10%);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
}
.follow-btn-unread {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--bg-secondary);
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes follow-btn-unread-pulse {
    0%   { transform: scale(1); opacity: 1; }
    50%  { transform: scale(1.4); opacity: 0.7; }
    100% { transform: scale(1); opacity: 1; }
  }
  .follow-btn-unread {
    animation: follow-btn-unread-pulse 1.4s ease-in-out infinite;
  }
}
```

The `position: absolute` is anchored against `.chat-messages` (which is the scroll container). To make that work, ensure `.chat-messages` has `position: relative;`. Find the existing `.chat-messages { … }` rule and add `position: relative;` if it isn't already there.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:unit -- ChatPanel.test.tsx`
Expected: all tests in this file pass — the four new follow-button tests plus all existing tests.

If a test that previously asserted on `new-messages-btn` is still around and now failing, delete it (its replacement is in Step 2).

- [ ] **Step 8: Manual smoke check**

Run the app with `npm run dev`. In a chat with enough messages to overflow:

- Scroll up — the bottom-right circular arrow appears with a springy entry.
- Wait for an assistant message to arrive — a small accent dot appears on the button (with a subtle pulse).
- Click the button — page tweens to bottom, button disappears, follow re-engages. Send another message and confirm it auto-scrolls into view.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): bottom-right follow button with unread dot"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Spec "Behavior — visible when not at bottom, hidden when at-bottom" → Step 4 (followOn state) + Step 5 (`{!followOn && …}` gate)
  - Spec "Click scrolls + clears unread + re-engages follow" → Step 5 (`onClick={scrollToBottom}`) which after Step 4's substitutions clears `unreadCount` and sets `followOn`
  - Spec "Unread dot when assistant arrives while follow off" → Step 4 (substitution from `setShowNewMessages(true)` → `setUnreadCount(c => c + 1)`) + Step 5 (`{unreadCount > 0 && …}` rendering)
  - Spec "Visual: 32px circle, accent chevron, bottom-right inset 12px, flick spring entry, pulse on dot" → Step 5 (motion props) + Step 6 (CSS)
  - Spec "Removed: new-messages-btn markup, CSS, pulse keyframe, prevLenRef effect" → Step 4 (delete refs/effects) + Step 5 (replace JSX) + Step 6 (delete CSS)
  - Spec "Test: not rendered when followOn true; rendered when false; unread dot appears; click clears" → Step 2 (all four cases)

- **Placeholder scan:** none.

- **Type consistency:** `followOn` (boolean), `unreadCount` (number), `setFollowOn`, `setUnreadCount` used consistently across steps.
