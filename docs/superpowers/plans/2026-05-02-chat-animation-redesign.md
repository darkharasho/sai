# Chat Animation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign chat panel motion to feel buttery smooth — physical with a cinematic lean — driven by a single shared motion vocabulary, with a bottom-anchored conversation list and per-provider thinking personalities.

**Architecture:** Introduce one `motion.ts` module that exports spring/easing/stagger/distance constants plus a `useReducedMotionTransition()` hook. All chat surfaces consume from there. Use framer-motion (`motion/react`) declaratively — `initial`/`animate`/`exit`/`layout`/`layoutId` rather than imperative WAAPI. A `LayoutGroup` wraps the auxiliary stack above the composer so reflows are animated. The pinned-prompt bar and its in-list source share `layoutId` for dock/undock motion. The chat list anchors content to the bottom via leading-flex-spacer.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, framer-motion (imported as `motion/react`), CSS-in-JS via inline `<style>` blocks.

**Spec:** `docs/superpowers/specs/2026-05-02-chat-animation-redesign-design.md`

---

## File Structure

**New files:**
- `src/components/Chat/motion.ts` — spring/easing/stagger/distance tokens + `useReducedMotionTransition()` hook
- `src/components/Chat/MotionPresence.tsx` — preconfigured `AnimatePresence` wrapper (`mode="popLayout"`)
- `src/components/Chat/Stagger.tsx` — preconfigured stagger container
- `tests/unit/components/Chat/motion.test.ts`
- `tests/unit/components/Chat/MotionPresence.test.tsx`
- `tests/unit/components/Chat/Stagger.test.tsx`

**Modified files:**
- `src/components/Chat/ChatPanel.tsx` — bottom-anchored list, `LayoutGroup`, pinned-prompt `layoutId`, scroll tween, sentinel slide-in, empty-state float
- `src/components/Chat/ChatMessage.tsx` — retune entry transitions to motion vocabulary, error pulse, streaming-tail shimmer
- `src/components/Chat/ToolCallCard.tsx` — stagger wrapper, per-type signatures, status badge transition
- `src/components/Chat/MessageQueue.tsx` — chip stagger, retune to `gentle` spring
- `src/components/Chat/TodoProgress.tsx` — spring fill, `flick` color crossfade on item state change
- `src/components/Chat/ApprovalPanel.tsx` — pop entry, gentle exit
- `src/components/Chat/flipRegistry.ts` — no signature change; FLIP timing changes happen in ChatMessage
- `tests/unit/components/Chat/ChatPanel.test.tsx` — extend with bottom-anchor, layoutId, LayoutGroup assertions
- `tests/unit/components/Chat/ChatMessage.test.tsx` — extend with motion-prop and reduced-motion assertions
- `tests/unit/components/Chat/ToolCallCard.test.tsx` — per-type signature assertions
- `tests/unit/components/Chat/MessageQueue.integration.test.tsx` — presence-based queries

---

## Task 1: Motion vocabulary module

**Files:**
- Create: `src/components/Chat/motion.ts`
- Test: `tests/unit/components/Chat/motion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/components/Chat/motion.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SPRING, EASING, STAGGER, DISTANCE, useReducedMotionTransition } from '@/components/Chat/motion';

describe('motion vocabulary', () => {
  it('exports spring tokens', () => {
    expect(SPRING.gentle).toEqual({ type: 'spring', stiffness: 220, damping: 28, mass: 0.9 });
    expect(SPRING.pop).toEqual({ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 });
    expect(SPRING.flick).toEqual({ type: 'spring', stiffness: 520, damping: 32 });
    expect(SPRING.dock).toEqual({ type: 'spring', stiffness: 300, damping: 30, mass: 1.0 });
  });

  it('exports easing tokens', () => {
    expect(EASING.out).toEqual([0.22, 1, 0.36, 1]);
    expect(EASING.inOut).toEqual([0.65, 0, 0.35, 1]);
  });

  it('exports stagger and distance constants', () => {
    expect(STAGGER).toEqual({ tight: 30, default: 55, loose: 90 });
    expect(DISTANCE).toEqual({ nudge: 4, slide: 12, lift: 24 });
  });
});

describe('useReducedMotionTransition', () => {
  let mql: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mql = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => mql));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the configured transition when reduced motion is not preferred', () => {
    const { result } = renderHook(() => useReducedMotionTransition(SPRING.pop));
    expect(result.current).toEqual(SPRING.pop);
  });

  it('returns { duration: 0 } when reduced motion is preferred', () => {
    mql.matches = true;
    const { result } = renderHook(() => useReducedMotionTransition(SPRING.pop));
    expect(result.current).toEqual({ duration: 0 });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test:unit -- motion.test.ts`
Expected: FAIL — module `@/components/Chat/motion` cannot be resolved.

- [ ] **Step 3: Implement the module**

```ts
// src/components/Chat/motion.ts
import { useEffect, useState } from 'react';
import type { Transition } from 'motion/react';

export const SPRING = {
  gentle: { type: 'spring', stiffness: 220, damping: 28, mass: 0.9 },
  pop:    { type: 'spring', stiffness: 380, damping: 26, mass: 0.7 },
  flick:  { type: 'spring', stiffness: 520, damping: 32 },
  dock:   { type: 'spring', stiffness: 300, damping: 30, mass: 1.0 },
} as const satisfies Record<string, Transition>;

export const EASING = {
  out:   [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};

export const STAGGER = { tight: 30, default: 55, loose: 90 } as const;
export const DISTANCE = { nudge: 4, slide: 12, lift: 24 } as const;

const REDUCED = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED).matches;
}

export function useReducedMotionTransition<T extends Transition>(
  transition: T
): T | { duration: 0 } {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced ? { duration: 0 } : transition;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- motion.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/motion.ts tests/unit/components/Chat/motion.test.ts
git commit -m "feat(chat): add motion vocabulary module"
```

---

## Task 2: MotionPresence and Stagger wrappers

**Files:**
- Create: `src/components/Chat/MotionPresence.tsx`
- Create: `src/components/Chat/Stagger.tsx`
- Test: `tests/unit/components/Chat/MotionPresence.test.tsx`
- Test: `tests/unit/components/Chat/Stagger.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/components/Chat/MotionPresence.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import MotionPresence from '@/components/Chat/MotionPresence';

describe('MotionPresence', () => {
  it('renders children', () => {
    const { getByText } = render(
      <MotionPresence><div>hello</div></MotionPresence>
    );
    expect(getByText('hello')).toBeTruthy();
  });
});
```

```tsx
// tests/unit/components/Chat/Stagger.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Stagger from '@/components/Chat/Stagger';

describe('Stagger', () => {
  it('renders children with the requested cadence', () => {
    const { getByText } = render(
      <Stagger cadence="default"><span>a</span><span>b</span></Stagger>
    );
    expect(getByText('a')).toBeTruthy();
    expect(getByText('b')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- MotionPresence.test.tsx Stagger.test.tsx`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement the wrappers**

```tsx
// src/components/Chat/MotionPresence.tsx
import { AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

export default function MotionPresence({ children, initial = false }: { children: ReactNode; initial?: boolean }) {
  return <AnimatePresence mode="popLayout" initial={initial}>{children}</AnimatePresence>;
}
```

```tsx
// src/components/Chat/Stagger.tsx
import { motion } from 'motion/react';
import { STAGGER } from './motion';
import type { ReactNode } from 'react';

type Cadence = keyof typeof STAGGER;

export default function Stagger({ children, cadence = 'default', delay = 0 }: { children: ReactNode; cadence?: Cadence; delay?: number }) {
  const ms = STAGGER[cadence];
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: ms / 1000, delayChildren: delay / 1000 } },
      }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- MotionPresence.test.tsx Stagger.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/MotionPresence.tsx src/components/Chat/Stagger.tsx \
  tests/unit/components/Chat/MotionPresence.test.tsx tests/unit/components/Chat/Stagger.test.tsx
git commit -m "feat(chat): add MotionPresence and Stagger wrappers"
```

---

## Task 3: Bottom-anchored chat list

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (the `.chat-messages` block and its inline style)
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
import { render } from '@testing-library/react';

it('renders a leading flex spacer so messages stack from the bottom', () => {
  const { container } = renderChatPanel({
    initialMessages: [{ id: '1', role: 'user', content: 'hi', timestamp: 0 }],
  });
  const spacer = container.querySelector('.chat-messages-spacer');
  expect(spacer).toBeTruthy();
  expect(getComputedStyle(spacer!).flexGrow).toBe('1');
});
```

(`renderChatPanel` is the existing helper in this file — reuse it. If it doesn't expose `initialMessages`, extend it to thread that prop.)

- [ ] **Step 2: Run the failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "leading flex spacer"`
Expected: FAIL — `.chat-messages-spacer` is null.

- [ ] **Step 3: Add the spacer and update CSS**

In `ChatPanel.tsx`, change the `.chat-messages` JSX to:

```tsx
<div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
  {messages.length === 0 ? (
    <div className="chat-empty">
      {/* unchanged */}
    </div>
  ) : (
    <>
      <div className="chat-messages-spacer" aria-hidden="true" />
      {hasHiddenMessages && (
        <div ref={sentinelRef} className="chat-load-sentinel">
          <span className="chat-load-sentinel-text">Loading earlier messages...</span>
        </div>
      )}
      {visibleMessages.map(msg => /* unchanged */)}
    </>
  )}
  {/* ...thinking indicator + messagesEndRef unchanged */}
</div>
```

In the inline `<style>` block, add:

```css
.chat-messages {
  display: flex;
  flex-direction: column;
  /* keep existing flex:1, overflow-y:auto, padding, min-height:0 */
}
.chat-messages-spacer {
  flex: 1 1 auto;
  min-height: 0;
}
```

The spacer collapses to 0 once content overflows the viewport — the standard iMessage/Discord trick. The `chat-load-sentinel` deliberately renders *after* the spacer so when older messages are hidden, the "Loading earlier messages…" indicator sits at the top of the actual content, not floating in dead space.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "leading flex spacer"`
Expected: PASS.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev` (or the project's normal dev script), open a fresh conversation, confirm the first message sits at the bottom and the empty state still centers correctly.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): bottom-anchor chat list via leading flex spacer"
```

---

## Task 4: Retune user-message FLIP to `dock` spring

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — replace the existing `ENTER_TRANSITION` usage for FLIPped messages with the `dock` spring from motion.ts

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
import { setFlipRect, _resetFlipRegistry } from '@/components/Chat/flipRegistry';
import { SPRING } from '@/components/Chat/motion';

afterEach(() => _resetFlipRegistry());

it('uses dock spring transition for FLIPped user messages', () => {
  setFlipRect('msg-1', new DOMRect(0, 600, 200, 40));
  const { container } = render(
    <ChatMessage message={{ id: 'msg-1', role: 'user', content: 'hi', timestamp: 0 }} />
  );
  const node = container.querySelector('[data-testid="chat-msg"]');
  expect(node?.getAttribute('data-flip-transition')).toBe(JSON.stringify(SPRING.dock));
});
```

(If the test file already mounts ChatMessage via a helper, use the helper. Add a `data-testid="chat-msg"` and a `data-flip-transition={JSON.stringify(transition)}` attribute on the FLIP `motion.div` in the next step.)

- [ ] **Step 2: Run the failing test**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "dock spring"`
Expected: FAIL — attribute is missing or has the old WAAPI timing.

- [ ] **Step 3: Update ChatMessage to use the dock spring**

In `ChatMessage.tsx`:

1. Add imports near the top:

```tsx
import { SPRING, useReducedMotionTransition } from './motion';
```

2. Inside the `ChatMessage` component, replace the FLIP transition with the dock spring. Find the place where the FLIP `motion.div` is rendered (the one driven by `flipPhase`). Change its transition prop from the existing constant to:

```tsx
const flipTransition = useReducedMotionTransition(SPRING.dock);
// ...
<motion.div
  data-testid="chat-msg"
  data-flip-transition={JSON.stringify(flipTransition)}
  initial={flipPhase === 'flipping' ? { y: flipOffsetRef.current, opacity: 0 } : false}
  animate={{ y: 0, opacity: 1 }}
  transition={flipTransition}
  /* ...rest unchanged */
>
```

The `data-flip-transition` attribute is purely for the test. Leave the existing `ENTER_TRANSITION` constant in place — it still drives the non-FLIP entry, which Task 5 will retune.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "dock spring"`
Expected: PASS.

- [ ] **Step 5: Run the full FLIP test suite to check for regressions**

Run: `npm run test:unit -- ChatMessage.test.tsx flipRegistry.test.ts`
Expected: PASS — all existing FLIP tests still green.

- [ ] **Step 6: Manual smoke check**

Run dev, send a message in a fresh conversation, confirm the bubble FLIPs from the composer with a slight overshoot/spring (heavier feel than before).

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "refactor(chat): retune user-message FLIP to dock spring"
```

---

## Task 5: Assistant message entry retune

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — change non-FLIP `entryProps` to use `pop` spring + `y: DISTANCE.slide`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
import { SPRING, DISTANCE } from '@/components/Chat/motion';

it('uses pop spring with slide distance for assistant message entry', () => {
  const { container } = render(
    <ChatMessage message={{ id: 'a-1', role: 'assistant', content: 'hello', timestamp: 0 }} />
  );
  const node = container.querySelector('[data-testid="chat-msg"]');
  expect(node?.getAttribute('data-entry-transition')).toBe(JSON.stringify(SPRING.pop));
  expect(node?.getAttribute('data-entry-y')).toBe(String(DISTANCE.slide));
});

it('strips entry transition under reduced motion', () => {
  const original = window.matchMedia;
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
  const { container } = render(
    <ChatMessage message={{ id: 'a-2', role: 'assistant', content: 'hello', timestamp: 0 }} />
  );
  const node = container.querySelector('[data-testid="chat-msg"]');
  expect(node?.getAttribute('data-entry-transition')).toBe(JSON.stringify({ duration: 0 }));
  window.matchMedia = original;
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "pop spring"`
Expected: FAIL — attributes missing.

- [ ] **Step 3: Update entry transition**

In `ChatMessage.tsx`, replace the `ENTER_TRANSITION` constant logic with motion-vocabulary values:

```tsx
// near the top of the file — remove the old ENTER_TRANSITION constant
// (no longer needed; SPRING.pop replaces it)

// inside ChatMessage, after `shouldAnimateEntry`:
const entryTransition = useReducedMotionTransition(SPRING.pop);
const entryDistance = DISTANCE.slide;

const entryProps = shouldAnimateEntry
  ? {
      initial: { opacity: 0, y: entryDistance },
      animate: { opacity: 1, y: 0 },
      transition: entryTransition,
    }
  : { initial: false as const, animate: { opacity: 1, y: 0 } };
```

Add `data-entry-transition` and `data-entry-y` attributes on the *non-FLIP* `motion.div` (the one used when `flipPhase === 'done'` and `!flipActive`):

```tsx
<motion.div
  data-testid="chat-msg"
  data-entry-transition={JSON.stringify(entryTransition)}
  data-entry-y={String(entryDistance)}
  /* ...entryProps spread unchanged */
>
```

Add `DISTANCE` to the imports from `./motion`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- ChatMessage.test.tsx`
Expected: PASS — all tests including the new ones and the FLIP tests.

- [ ] **Step 5: Manual smoke check**

Send a message, watch the assistant reply land. Should feel slightly springy on entry (not the previous dampened ease).

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "refactor(chat): retune assistant message entry to pop spring"
```

---

## Task 6: Error message pulse

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — add a 200ms accent outline pulse for messages with `message.error`
- Modify: inline `<style>` block in ChatMessage to define the keyframe

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
it('applies error-pulse class to messages with an error', () => {
  const { container } = render(
    <ChatMessage message={{ id: 'e-1', role: 'system', content: 'oops', timestamp: 0, error: { message: 'oops', kind: 'unknown' } as any }} />
  );
  expect(container.querySelector('.chat-msg-error-pulse')).toBeTruthy();
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "error-pulse"`
Expected: FAIL — class not present.

- [ ] **Step 3: Add the class and keyframe**

In the JSX where error messages render, add `chat-msg-error-pulse` to the wrapping `motion.div`'s className when `message.error` is set. Then in the inline `<style>` block:

```css
@keyframes chat-msg-error-pulse {
  0%   { box-shadow: 0 0 0 1px var(--accent); }
  100% { box-shadow: 0 0 0 1px transparent; }
}
@media (prefers-reduced-motion: no-preference) {
  .chat-msg-error-pulse {
    animation: chat-msg-error-pulse 200ms ease-out 1;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "error-pulse"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(chat): pulse error messages on entry"
```

---

## Task 7: Streaming-tail shimmer

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — add a CSS variable + class on the streaming-text node, with a gradient mask animation

The shimmer is purely CSS-driven (`background-position` keyframe), so no React state is needed for the animation itself.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
it('marks streaming text with chat-streaming-tail class', () => {
  const { container } = render(
    <ChatMessage isStreaming message={{ id: 's-1', role: 'assistant', content: 'partial', timestamp: 0 }} />
  );
  expect(container.querySelector('.chat-streaming-tail')).toBeTruthy();
});

it('does not mark non-streaming text with chat-streaming-tail', () => {
  const { container } = render(
    <ChatMessage message={{ id: 's-2', role: 'assistant', content: 'done', timestamp: 0 }} />
  );
  expect(container.querySelector('.chat-streaming-tail')).toBeFalsy();
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "streaming-tail"`
Expected: FAIL.

- [ ] **Step 3: Add the class and keyframe**

In `ChatMessage.tsx`, when `isStreaming && message.role === 'assistant'`, add `chat-streaming-tail` to the className of the rendered text container (the one inside the assistant bubble's text region). In the inline `<style>` block:

```css
@keyframes chat-streaming-tail-sweep {
  from { background-position: -120% 0; }
  to   { background-position:  120% 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .chat-streaming-tail {
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      transparent 70%,
      color-mix(in srgb, var(--accent) 35%, transparent) 85%,
      transparent 100%
    );
    background-size: 200% 100%;
    background-repeat: no-repeat;
    background-position: 100% 0;
    animation: chat-streaming-tail-sweep 1.6s ease-in-out infinite;
    -webkit-background-clip: text;
            background-clip: text;
  }
}
```

This is a non-destructive overlay — the underlying text color is unaffected; the gradient just lives on top via `background-clip: text`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "streaming-tail"`
Expected: PASS.

- [ ] **Step 5: Manual smoke check**

Send a message, watch streaming text — a subtle accent-colored shimmer should sweep along the trailing characters of the message while it streams.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(chat): shimmer trailing tokens of streaming messages"
```

---

## Task 8: Tool card stagger + base entry retune

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — wrap `toolCalls.map(...)` in `Stagger`
- Modify: `src/components/Chat/ToolCallCard.tsx` — change card root to a `motion.div` with `pop` spring entry + `layout`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`:

```tsx
import { SPRING, DISTANCE } from '@/components/Chat/motion';

it('uses pop spring + slide distance for entry', () => {
  const { container } = render(
    <ToolCallCard toolCall={{ id: 't1', type: 'other', name: 'Foo', input: '' }} />
  );
  const card = container.querySelector('[data-testid="tool-card"]');
  expect(card?.getAttribute('data-entry-transition')).toBe(JSON.stringify(SPRING.pop));
  expect(card?.getAttribute('data-entry-y')).toBe(String(10));
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ToolCallCard.test.tsx -t "pop spring"`
Expected: FAIL.

- [ ] **Step 3: Update ToolCallCard**

In `ToolCallCard.tsx`:

```tsx
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

// inside the component, near the top:
const entryTransition = useReducedMotionTransition(SPRING.pop);

// change the outer `<div>` of the card to:
<motion.div
  data-testid="tool-card"
  data-entry-transition={JSON.stringify(entryTransition)}
  data-entry-y={String(10)}
  layout
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={entryTransition}
  variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
  className="tool-call-card"
>
  {/* existing card body */}
</motion.div>
```

The `variants` are needed because the parent `Stagger` (added in the next part of this task) uses `staggerChildren` which requires variant-driven children.

- [ ] **Step 4: Wrap the toolCalls map in Stagger**

In `ChatMessage.tsx`, find the JSX where `message.toolCalls?.map(...)` renders. Wrap it:

```tsx
import Stagger from './Stagger';

{message.toolCalls && message.toolCalls.length > 0 && (
  <Stagger cadence="default">
    {message.toolCalls.map(tc => (
      <ToolCallCard key={tc.id} toolCall={tc} /* existing props */ />
    ))}
  </Stagger>
)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- ToolCallCard.test.tsx ChatMessage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

Trigger a multi-tool assistant turn (anything that fires more than one tool call in a single response). Confirm cards appear in sequence with a clear ~55ms stagger, each spring-landing.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(chat): stagger tool cards with pop spring entry"
```

---

## Task 9: Per-type tool-card signatures

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx` — add per-type entry signature on the header strip

Each signature is a small CSS animation applied to a wrapping `<span>` around the tool icon/header text, gated on `tool.type`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`:

```tsx
it.each([
  ['file_edit', 'tool-sig-wipe'],
  ['terminal_command', 'tool-sig-typed'],
  ['web_fetch', 'tool-sig-shimmer'],
  ['file_read', null],
  ['other', null],
] as const)('applies signature class for %s', (type, expectedClass) => {
  const { container } = render(
    <ToolCallCard toolCall={{ id: 't', type, name: 'X', input: '' }} />
  );
  if (expectedClass) {
    expect(container.querySelector(`.${expectedClass}`)).toBeTruthy();
  } else {
    expect(container.querySelector('.tool-sig-wipe, .tool-sig-typed, .tool-sig-shimmer')).toBeFalsy();
  }
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- ToolCallCard.test.tsx -t "signature class"`
Expected: FAIL.

- [ ] **Step 3: Add per-type wrapper class**

In `ToolCallCard.tsx`, wrap the existing header strip (icon + tool name) with a span:

```tsx
const sigClass =
  toolCall.type === 'file_edit'        ? 'tool-sig-wipe' :
  toolCall.type === 'terminal_command' ? 'tool-sig-typed' :
  toolCall.type === 'web_fetch'        ? 'tool-sig-shimmer' : '';

<span className={`tool-card-header ${sigClass}`}>
  {/* existing icon + name JSX */}
</span>
```

- [ ] **Step 4: Add the keyframes (in the inline style block of ToolCallCard, or a new <style> if none exists)**

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes tool-sig-wipe {
    from { clip-path: inset(0 100% 0 0); }
    to   { clip-path: inset(0 0 0 0); }
  }
  .tool-sig-wipe {
    animation: tool-sig-wipe 380ms cubic-bezier(0.22, 1, 0.36, 1) 1;
  }

  @keyframes tool-sig-typed {
    from { max-width: 0; }
    to   { max-width: 100%; }
  }
  .tool-sig-typed {
    display: inline-block;
    overflow: hidden;
    white-space: nowrap;
    animation: tool-sig-typed 400ms steps(20, end) 1;
  }

  @keyframes tool-sig-shimmer {
    0%   { background-position: -120% 0; }
    100% { background-position:  220% 0; }
  }
  .tool-sig-shimmer {
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--accent) 25%, transparent) 50%,
      transparent 100%
    );
    background-size: 60% 100%;
    background-repeat: no-repeat;
    animation: tool-sig-shimmer 700ms ease-out 1;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- ToolCallCard.test.tsx -t "signature class"`
Expected: PASS — all 5 cases pass.

- [ ] **Step 6: Manual smoke check**

Trigger an assistant turn with a mix of edits, bash commands, and web searches. Each card's header should have a recognizable signature on entry.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(chat): per-type tool card entry signatures"
```

---

## Task 10: Tool card status badge transition

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx` — animate the running/done/error badge

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`:

```tsx
import { SPRING } from '@/components/Chat/motion';

it('uses flick spring for status badge transitions', () => {
  const { container } = render(
    <ToolCallCard toolCall={{ id: 't', type: 'other', name: 'X', input: '', output: 'done' }} />
  );
  const badge = container.querySelector('[data-testid="tool-status-badge"]');
  expect(badge?.getAttribute('data-status-transition')).toBe(JSON.stringify(SPRING.flick));
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ToolCallCard.test.tsx -t "flick spring"`
Expected: FAIL.

- [ ] **Step 3: Animate the badge**

Find the JSX in `ToolCallCard.tsx` that renders the running/done/error indicator. Convert it to a `motion.span` with a stable identity that crossfades on state change:

```tsx
const status: 'running' | 'done' | 'error' =
  toolCall.error ? 'error' :
  toolCall.output ? 'done' : 'running';

const badgeTransition = useReducedMotionTransition(SPRING.flick);

<AnimatePresence mode="popLayout" initial={false}>
  <motion.span
    key={status}
    data-testid="tool-status-badge"
    data-status-transition={JSON.stringify(badgeTransition)}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.8 }}
    transition={badgeTransition}
    className={`tool-status tool-status-${status}`}
  >
    {/* existing badge content for this status */}
  </motion.span>
</AnimatePresence>
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test:unit -- ToolCallCard.test.tsx -t "flick spring"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(chat): animate tool status badge transitions"
```

---

## Task 11: Thinking indicator entry + morph-into-message

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` — wrap thinking indicator in motion.div with `pop` entry + `layoutId="active-response-anchor"`
- Modify: `src/components/Chat/ChatMessage.tsx` — add the same `layoutId` to the *first* assistant bubble of the active turn

The morph works because framer-motion sees the same `layoutId` exit one tree (the indicator) and enter another (the bubble) and animates between their bounding rects.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('renders thinking indicator with morph layoutId', () => {
  const { container } = renderChatPanel({ isStreamingOverride: true });
  expect(container.querySelector('[data-layout-id="active-response-anchor"]')).toBeTruthy();
});
```

(Extend `renderChatPanel` to expose `isStreamingOverride` if it doesn't already; alternatively trigger streaming via the existing message-handling test path.)

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "morph layoutId"`
Expected: FAIL.

- [ ] **Step 3: Wrap the thinking indicator**

In `ChatPanel.tsx`, replace the inline `{isStreaming && (...)}` block with:

```tsx
import { motion } from 'motion/react';
import { SPRING, DISTANCE, useReducedMotionTransition } from './motion';

// inside the component:
const thinkingTransition = useReducedMotionTransition(SPRING.pop);

// in JSX:
<MotionPresence>
  {isStreaming && (
    <motion.div
      key="thinking"
      layoutId="active-response-anchor"
      data-layout-id="active-response-anchor"
      initial={{ opacity: 0, y: DISTANCE.lift }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={thinkingTransition}
    >
      {aiProvider === 'gemini' ? <GeminiThinkingAnimation loadingPhrases={geminiLoadingPhrases} />
        : aiProvider === 'codex' ? <CodexThinkingAnimation />
        : <ThinkingAnimation />}
    </motion.div>
  )}
</MotionPresence>
```

`MotionPresence` is the wrapper from Task 2.

- [ ] **Step 4: Mark first-assistant-bubble-of-turn with layoutId**

In `ChatPanel.tsx`, before rendering messages, compute the id of the first assistant message that follows the most recent `streaming_start`. The simplest reliable approach: track the index of the streaming start in state, then pass `isFirstAssistantOfTurn` to the corresponding `ChatMessage` as a prop.

Add to `ChatPanel`:

```tsx
const [turnStartIndex, setTurnStartIndex] = useState<number | null>(null);

// when a streaming_start arrives:
setTurnStartIndex(messagesRef.current.length);

// when 'done' arrives:
setTurnStartIndex(null);
```

Compute the id once per render:

```tsx
const firstAssistantOfTurnId = useMemo(() => {
  if (turnStartIndex == null) return null;
  for (let i = turnStartIndex; i < messages.length; i++) {
    if (messages[i].role === 'assistant') return messages[i].id;
  }
  return null;
}, [messages, turnStartIndex]);
```

Pass to ChatMessage:

```tsx
<ChatMessage
  key={msg.id}
  message={msg}
  /* ...existing props */
  isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId}
/>
```

In `ChatMessage.tsx`, accept the prop and apply `layoutId` to the outer `motion.div` when set:

```tsx
function ChatMessage({ /* ...existing */, isFirstAssistantOfTurn = false }: { /* ... */; isFirstAssistantOfTurn?: boolean }) {
  // ...
  <motion.div
    layoutId={isFirstAssistantOfTurn ? 'active-response-anchor' : undefined}
    /* ...rest unchanged */
  >
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- ChatPanel.test.tsx ChatMessage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

Send a message, watch the thinking indicator → first assistant bubble. The thinking indicator's position should visibly slide/morph into the bubble's position rather than disappearing and the bubble appearing separately.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/components/Chat/ChatMessage.tsx \
  tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): morph thinking indicator into first assistant bubble"
```

---

## Task 12: Per-provider thinking personalities

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` — extend the three thinking-animation components

Each lives inline in `ChatPanel.tsx` today. Edit them in place.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('Claude thinking has breathing-cursor class', () => {
  const { container } = renderChatPanel({ aiProvider: 'claude', isStreamingOverride: true });
  expect(container.querySelector('.thinking-cursor.thinking-cursor-breathing')).toBeTruthy();
});

it('Codex thinking applies wave to Working text', () => {
  const { container } = renderChatPanel({ aiProvider: 'codex', isStreamingOverride: true });
  expect(container.querySelector('.codex-working-wave')).toBeTruthy();
});

it('Gemini thinking hint has cross-slide class', () => {
  const { container } = renderChatPanel({ aiProvider: 'gemini', isStreamingOverride: true });
  expect(container.querySelector('.gemini-hint-slide')).toBeTruthy();
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "thinking"`
Expected: FAIL.

- [ ] **Step 3: Implement personalities**

In `ChatPanel.tsx`'s inline `<style>` block, add:

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes thinking-cursor-breathe {
    0%, 100% { transform: scaleY(1.0); }
    50%      { transform: scaleY(1.08); }
  }
  .thinking-cursor-breathing {
    display: inline-block;
    transform-origin: bottom;
    animation: thinking-cursor-breathe 1.6s ease-in-out infinite;
  }

  @keyframes codex-working-wave {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-0.5px); }
  }
  .codex-working-wave > span {
    display: inline-block;
    animation: codex-working-wave 1.4s ease-in-out infinite;
  }
}
```

For the Claude blink cursor: locate the existing `.thinking-cursor` in `ThinkingAnimation` (or wherever it's rendered) and add the `thinking-cursor-breathing` class alongside it. (The breathing animates `scaleY` and won't interfere with the existing opacity blink.)

For Codex's "Working" text in `CodexThinkingAnimation`, wrap each letter in a `<span>` with `animation-delay: ${i * 50}ms`:

```tsx
function CodexThinkingAnimation() {
  return (
    <div className="codex-thinking">
      <span className="codex-thinking-dot">•</span>
      <span className="codex-working codex-working-wave">
        {'Working'.split('').map((c, i) => (
          <span key={i} style={{ animationDelay: `${i * 50}ms` }}>{c}</span>
        ))}
      </span>
    </div>
  );
}
```

For the Gemini hint: in `GeminiThinkingAnimation`, replace the existing `gemini-hint` `<span>` rendering with an `AnimatePresence` swap keyed on `hintIndex`:

```tsx
import { AnimatePresence, motion } from 'motion/react';
import { EASING } from './motion';

<AnimatePresence mode="popLayout" initial={false}>
  <motion.span
    key={hintIndex}
    className="gemini-hint gemini-hint-slide"
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 0.85, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    transition={{ duration: 0.18, ease: EASING.out }}
  >
    {hints.length > 0 ? hints[hintIndex] : 'Thinking...'}
  </motion.span>
</AnimatePresence>
```

Remove the existing `gemini-hint-fade` keyframe (it's superseded by the AnimatePresence swap).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "thinking"`
Expected: PASS — 3 cases.

- [ ] **Step 5: Manual smoke check (per provider)**

- Claude: cursor should subtly breathe (vertical) while idle-thinking
- Codex: each letter of "Working" should have a slow wave traveling left-to-right
- Gemini: hint swaps should slide+fade rather than plain crossfade

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): per-provider thinking personalities"
```

---

## Task 13: Pinned-prompt dock/undock with `layoutId`

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` — share `layoutId` between the docked bar and the in-list user-message wrapper
- Modify: `src/components/Chat/ChatMessage.tsx` — accept a `pinnedLayoutId` prop and apply it to the outer wrapper for user messages

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('docked pinned bar and in-list user message share a layoutId', () => {
  const { container } = renderChatPanel({
    initialMessages: [
      { id: 'u1', role: 'user', content: 'first', timestamp: 0 },
      { id: 'a1', role: 'assistant', content: 'reply', timestamp: 1 },
    ],
    forcedPinnedId: 'u1', // test-only override on the helper
  });
  const matches = container.querySelectorAll('[data-layout-id="pinned-u1"]');
  expect(matches.length).toBe(2); // one in the bar, one in the list wrapper
});
```

(Extend `renderChatPanel` with `forcedPinnedId` test prop that sets `pinnedUserMessage` directly. If extending is awkward, simulate by stubbing the IntersectionObserver; pick whichever route is shorter in the existing test infrastructure.)

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "share a layoutId"`
Expected: FAIL.

- [ ] **Step 3: Apply layoutId to both nodes**

In `ChatPanel.tsx`, change the docked bar:

```tsx
import { motion } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

const dockTransition = useReducedMotionTransition(SPRING.dock);

{pinnedUserMessage && (
  <motion.div
    className="pinned-prompt-bar"
    layoutId={`pinned-${pinnedUserMessage.id}`}
    data-layout-id={`pinned-${pinnedUserMessage.id}`}
    transition={dockTransition}
  >
    {/* existing pinned-prompt-bar contents — accent, label, text, jump button */}
  </motion.div>
)}
```

In the list rendering, change the `<div>` wrapper around user messages to pass through `pinnedLayoutId`:

```tsx
{visibleMessages.map(msg => msg.role === 'user'
  ? (
    <div
      key={msg.id}
      ref={el => { if (el) userMsgRefs.current.set(msg.id, el); else userMsgRefs.current.delete(msg.id); }}
      data-layout-id={`pinned-${msg.id}`}
    >
      <ChatMessage
        message={msg}
        pinnedLayoutId={`pinned-${msg.id}`}
        /* ...existing props */
      />
    </div>
  )
  : <ChatMessage key={msg.id} /* ...existing props */ />
)}
```

In `ChatMessage.tsx`, accept `pinnedLayoutId` and apply it to the outer `motion.div` for user messages only (so the layoutId doesn't conflict with the FLIP, which uses `initial`/`animate` for translation):

```tsx
function ChatMessage({ /* ...existing */, pinnedLayoutId }: { /* ... */; pinnedLayoutId?: string }) {
  // ...
  <motion.div
    layoutId={pinnedLayoutId}
    /* ...rest */
  >
}
```

**Important**: framer animates `layoutId` matches via *layout* transitions (size/position diffs), not via the `initial`/`animate` pipeline. The FLIP `initial`/`animate` and `layoutId` can coexist on the same element, but the FLIP runs first (on mount) and the layout animation only kicks in on subsequent layout changes. If glitching shows up, fall back to `pinnedLayoutId` undefined while `flipPhase !== 'done'`.

- [ ] **Step 4: Always-mount the bar at zero height when no target**

To prevent the dock animation from skipping when `pinnedUserMessage` toggles between `null` and a value, render the bar always:

```tsx
<motion.div
  className="pinned-prompt-bar"
  data-layout-id={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
  layoutId={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
  animate={{ height: pinnedUserMessage ? 32 : 0, opacity: pinnedUserMessage ? 1 : 0 }}
  transition={dockTransition}
  style={{ overflow: 'hidden' }}
>
  {pinnedUserMessage && (/* existing inner contents */)}
</motion.div>
```

Remove the existing `pinned-slide-in` keyframe and the `animation: pinned-slide-in 0.2s` rule from the inline style block — the layout animation replaces it.

- [ ] **Step 5: Run test to verify pass**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "share a layoutId"`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

Open a long conversation with multiple user messages. Scroll up past the most recent one — the prompt should visibly travel from its in-list slot up to the bar position (instead of the bar appearing from above). Click "Jump" — the bar should travel back down to the message slot before the scroll completes.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/components/Chat/ChatMessage.tsx \
  tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): dock/undock pinned prompt via shared layoutId"
```

---

## Task 14: LayoutGroup around the auxiliary stack

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` — wrap `<TodoProgress>`, `<MessageQueue>`, and `<ChatInput>` in a `LayoutGroup`

This is the foundation for Tasks 15–16 (queue chips and approval panel reflow).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('wraps the bottom strip in a LayoutGroup', () => {
  const { container } = renderChatPanel({});
  expect(container.querySelector('[data-testid="chat-bottom-strip"]')).toBeTruthy();
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "LayoutGroup"`
Expected: FAIL.

- [ ] **Step 3: Wrap in LayoutGroup**

In `ChatPanel.tsx`, wrap the bottom-strip JSX:

```tsx
import { LayoutGroup } from 'motion/react';

<LayoutGroup>
  <div data-testid="chat-bottom-strip" className="chat-bottom-strip">
    <TodoProgress messages={messages} isStreaming={isStreaming} />
    <MessageQueue
      queue={messageQueue}
      onRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
    />
    <ChatInput /* ...existing props */ />
  </div>
</LayoutGroup>
```

Add `.chat-bottom-strip { display: flex; flex-direction: column; }` to the inline style block.

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "LayoutGroup"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): group bottom strip for shared layout animation"
```

---

## Task 15: MessageQueue + TodoProgress + ApprovalPanel retune

**Files:**
- Modify: `src/components/Chat/MessageQueue.tsx`
- Modify: `src/components/Chat/TodoProgress.tsx`
- Modify: `src/components/Chat/ApprovalPanel.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/MessageQueue.integration.test.tsx`:

```tsx
import { SPRING, STAGGER } from '@/components/Chat/motion';

it('queue chips use gentle spring with tight stagger', () => {
  const { container } = render(
    <MessageQueue queue={[
      { id: '1', text: 'a', fullText: 'a' },
      { id: '2', text: 'b', fullText: 'b' },
    ]} onRemove={() => {}} />
  );
  const chip = container.querySelector('[data-testid="queue-chip"]');
  expect(chip?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.gentle));
  const stagger = container.querySelector('[data-testid="queue-stagger"]');
  expect(stagger?.getAttribute('data-cadence-ms')).toBe(String(STAGGER.tight));
});
```

Add to `tests/unit/components/Chat/TodoProgress.test.tsx` (create if absent):

```tsx
import { render } from '@testing-library/react';
import TodoProgress from '@/components/Chat/TodoProgress';
import { SPRING } from '@/components/Chat/motion';

it('uses gentle spring on the fill', () => {
  const messages = [{ id: '1', role: 'assistant' as const, content: '', timestamp: 0, todos: [{ content: 'a', status: 'completed' as const }, { content: 'b', status: 'pending' as const }] }];
  const { container } = render(<TodoProgress messages={messages} isStreaming={false} />);
  const fill = container.querySelector('[data-testid="todo-progress-fill"]');
  expect(fill?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.gentle));
});
```

Add to `tests/unit/components/Chat/ApprovalPanel.test.tsx` (create if absent):

```tsx
import { render } from '@testing-library/react';
import ApprovalPanel from '@/components/Chat/ApprovalPanel';
import { SPRING } from '@/components/Chat/motion';

it('uses pop spring entry transition', () => {
  const { container } = render(
    <ApprovalPanel
      approval={{ toolName: 'Bash', toolUseId: '1', command: 'ls', description: '', input: {} }}
      onApprove={() => {}} onDeny={() => {}} onAlwaysAllow={() => {}}
    />
  );
  const root = container.querySelector('[data-testid="approval-panel"]');
  expect(root?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.pop));
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- MessageQueue.integration.test.tsx TodoProgress.test.tsx ApprovalPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Update MessageQueue**

In `MessageQueue.tsx`:

```tsx
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, STAGGER, useReducedMotionTransition } from './motion';

// inside component:
const chipTransition = useReducedMotionTransition(SPRING.gentle);

return (
  <div data-testid="queue-stagger" data-cadence-ms={String(STAGGER.tight)}>
    <AnimatePresence initial={false}>
      {queue.map((item, i) => (
        <motion.div
          key={item.id}
          data-testid="queue-chip"
          data-transition={JSON.stringify(chipTransition)}
          layout
          initial={{ opacity: 0, x: -6, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, x: 0, height: 28, marginTop: i === 0 ? 0 : 3 }}
          exit={{ opacity: 0, x: -6, height: 0, marginTop: 0 }}
          transition={{ ...chipTransition, delay: (i * STAGGER.tight) / 1000 }}
          /* ...existing className + onClick */
        >
          {/* existing chip body */}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);
```

- [ ] **Step 4: Update TodoProgress**

In `TodoProgress.tsx`, find where the progress fill width is set. Convert to a `motion.div`:

```tsx
import { motion } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

const fillTransition = useReducedMotionTransition(SPRING.gentle);

<motion.div
  data-testid="todo-progress-fill"
  data-transition={JSON.stringify(fillTransition)}
  className="todo-progress-fill"
  animate={{ width: `${pct}%` }}
  transition={fillTransition}
/>
```

For the per-item color crossfade, wrap each todo's status indicator in a `motion.span` keyed on status with the `flick` spring (same pattern as Task 10).

- [ ] **Step 5: Update ApprovalPanel**

In `ApprovalPanel.tsx`, convert the outer container to a `motion.div`:

```tsx
import { motion } from 'motion/react';
import { SPRING, DISTANCE, useReducedMotionTransition } from './motion';

const entryTransition = useReducedMotionTransition(SPRING.pop);
const exitTransition = useReducedMotionTransition(SPRING.gentle);

<motion.div
  data-testid="approval-panel"
  data-transition={JSON.stringify(entryTransition)}
  layout
  initial={{ opacity: 0, y: DISTANCE.slide }}
  animate={{ opacity: 1, y: 0, transition: entryTransition }}
  exit={{ opacity: 0, y: -DISTANCE.nudge, transition: exitTransition }}
>
  {/* existing approval panel body */}
</motion.div>
```

If `ApprovalPanel` is rendered inside `ChatInput`, wrap its mount/unmount in an `AnimatePresence` at the parent so the exit transition runs.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit -- MessageQueue.integration.test.tsx TodoProgress.test.tsx ApprovalPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Manual smoke check**

- Type then queue 3 messages while a turn is streaming — chips should stagger in
- Watch a turn with a todo list — progress fill should ease with a slight spring instead of linear
- Trigger an approval — panel should pop in, exit smoothly when resolved, and the composer above should reflow (not jump)

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/MessageQueue.tsx src/components/Chat/TodoProgress.tsx \
  src/components/Chat/ApprovalPanel.tsx tests/unit/components/Chat/MessageQueue.integration.test.tsx \
  tests/unit/components/Chat/TodoProgress.test.tsx tests/unit/components/Chat/ApprovalPanel.test.tsx
git commit -m "feat(chat): retune queue, todo, approval to motion vocabulary"
```

---

## Task 16: rAF auto-scroll tween + sentinel slide-in

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
import { vi } from 'vitest';

it('auto-scroll uses rAF tween instead of scrollIntoView smooth', () => {
  const scrollSpy = vi.fn();
  const messagesEnd = document.createElement('div');
  messagesEnd.scrollIntoView = scrollSpy;
  // Render and trigger an autoscroll path…
  // Assert scrollSpy was called with { behavior: 'instant' } or not at all,
  // and that requestAnimationFrame was used.
});
```

If wiring this assertion into the existing test setup is awkward, use a behavioural shim instead — assert that the scroll container's `scrollTop` advances incrementally across multiple `requestAnimationFrame` ticks rather than jumping in one frame. Implementation hint: spy on `requestAnimationFrame` and verify it's called.

- [ ] **Step 2: Run failing test**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "auto-scroll"`
Expected: FAIL.

- [ ] **Step 3: Replace scrollIntoView with rAF tween**

In `ChatPanel.tsx`, add a helper:

```tsx
import { EASING } from './motion';

function tweenScrollToBottom(container: HTMLElement, durationMs = 280) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  const start = container.scrollTop;
  const target = container.scrollHeight - container.clientHeight;
  if (target <= start) return;
  const t0 = performance.now();
  const ease = (t: number) => {
    const [, , , p4] = EASING.out;
    return 1 - Math.pow(1 - t, 1 / p4);
  };
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / durationMs);
    container.scrollTop = start + (target - start) * ease(k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
```

> **Note on the easing approximation**: this isn't a true cubic-bezier evaluation — it's a single-power approximation that's close enough for a 280ms tween where users won't notice the curve difference. If precision matters later, swap in a proper bezier solver. The assertion in the test only checks that rAF is used, not the exact curve shape.

Replace the two `messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })` calls with:

```tsx
if (chatContainerRef.current) tweenScrollToBottom(chatContainerRef.current);
```

Cancellation on user wheel/touch: hook into the existing `onWheel` listener — set a `userScrollingRef` flag and bail out of the tween's next rAF tick if it's set. Reset on auto-scroll completion or after 200ms of no wheel events.

- [ ] **Step 4: Sentinel slide-in for prepended history**

Wrap the prepended messages in `MotionPresence` and animate `y` on enter for the *prepended-only* case. The simplest approach: use framer's `layout` prop on the visible-messages container so messages prepending to the front trigger layout animations automatically. Add to the messages container:

```tsx
<motion.div layout="position" /* ...existing className */>
  {visibleMessages.map(/* ... */)}
</motion.div>
```

Combined with `chat-load-sentinel` already animating in via the surrounding `MotionPresence`, prepended history will slide rather than pop.

- [ ] **Step 5: Run test to verify pass**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "auto-scroll"`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

- Streaming long assistant turn: scroll-to-bottom should follow the tail without jerking
- Scroll up to load earlier messages: prepended messages should slide into view, not pop

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): rAF auto-scroll tween + sentinel slide-in"
```

---

## Task 17: New-messages button + empty-state float

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
import { SPRING } from '@/components/Chat/motion';

it('new-messages button uses flick spring entry', () => {
  // Trigger showNewMessages = true via the existing test path
  const { container } = renderChatPanel({ showNewMessagesOverride: true });
  const btn = container.querySelector('[data-testid="new-messages-btn"]');
  expect(btn?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.flick));
});

it('empty-state logo has float class', () => {
  const { container } = renderChatPanel({ initialMessages: [] });
  expect(container.querySelector('.chat-empty-logo-float')).toBeTruthy();
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "new-messages button|empty-state logo"`
Expected: FAIL.

- [ ] **Step 3: Animate the button**

Wrap the existing `<button className="new-messages-btn">` in `motion.button`:

```tsx
import { motion, AnimatePresence } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

const btnTransition = useReducedMotionTransition(SPRING.flick);

<AnimatePresence>
  {showNewMessages && (
    <motion.button
      data-testid="new-messages-btn"
      data-transition={JSON.stringify(btnTransition)}
      className="new-messages-btn"
      initial={{ opacity: 0, y: 6, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.92 }}
      transition={btnTransition}
      onClick={scrollToBottom}
    >
      <ChevronDown size={12} />
      new messages
    </motion.button>
  )}
</AnimatePresence>
```

For the pulse-when-already-visible: track the previous `messages.length`. If `showNewMessages` is true and `messages.length` increased, run a one-shot scale tween via framer's imperative `animate()` API on a ref, or attach a CSS class that animates `1 → 1.04 → 1` over 220ms and remove it on `animationend`. CSS-class approach:

```tsx
const btnRef = useRef<HTMLButtonElement | null>(null);
const prevLenRef = useRef(messages.length);
useEffect(() => {
  if (showNewMessages && messages.length > prevLenRef.current && btnRef.current) {
    btnRef.current.classList.remove('new-messages-pulse');
    void btnRef.current.offsetWidth; // restart animation
    btnRef.current.classList.add('new-messages-pulse');
  }
  prevLenRef.current = messages.length;
}, [messages.length, showNewMessages]);
```

In the inline style block:

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes new-messages-pulse {
    0%, 100% { transform: translateX(-50%) scale(1); }
    50%      { transform: translateX(-50%) scale(1.04); }
  }
  .new-messages-pulse {
    animation: new-messages-pulse 220ms ease-out 1;
  }
}
```

Wire `btnRef` to the `motion.button`.

- [ ] **Step 4: Float the empty-state logo**

Add `chat-empty-logo-float` to the logo's className. In the inline style block:

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes chat-empty-logo-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-2px); }
  }
  .chat-empty-logo-float {
    animation: chat-empty-logo-float 4s ease-in-out infinite;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- ChatPanel.test.tsx -t "new-messages button|empty-state logo"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(chat): animate new-messages button and float empty-state logo"
```

---

## Task 18: Reduced motion verification + manual QA

**Files:**
- Verify: all chat surfaces respect `prefers-reduced-motion: reduce`

- [ ] **Step 1: Audit `useReducedMotionTransition` coverage**

Run: `grep -rn "transition=" src/components/Chat/ | grep -v "useReducedMotionTransition\|node_modules"`
Expected: every result either uses a transition resolved through `useReducedMotionTransition`, or is a CSS-only animation gated by `@media (prefers-reduced-motion: no-preference)`.

If any direct `transition={SPRING.x}` without the hook appears, wrap it.

- [ ] **Step 2: Audit CSS keyframe coverage**

Run: `grep -rn "@keyframes" src/components/Chat/`
Expected: every keyframe usage in chat components is gated by `@media (prefers-reduced-motion: no-preference)` — either the keyframe itself wrapped, or the class that applies it.

- [ ] **Step 3: Add a single integration test for reduced-motion**

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('passes duration:0 transitions to all motion children when reduced motion is preferred', () => {
  const original = window.matchMedia;
  window.matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
  const { container } = renderChatPanel({
    initialMessages: [{ id: 'a-1', role: 'assistant', content: 'hi', timestamp: 0 }],
  });
  const all = container.querySelectorAll('[data-entry-transition], [data-transition], [data-flip-transition]');
  expect(all.length).toBeGreaterThan(0);
  for (const el of all) {
    const t = el.getAttribute('data-entry-transition') || el.getAttribute('data-transition') || el.getAttribute('data-flip-transition');
    expect(t).toBe(JSON.stringify({ duration: 0 }));
  }
  window.matchMedia = original;
});
```

- [ ] **Step 4: Run all chat tests**

Run: `npm run test:unit -- src/components/Chat tests/unit/components/Chat`
Expected: PASS — no regressions across the suite.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Manual QA pass**

Walk through each item from the spec's manual QA checklist:

- [ ] Send first message in a fresh conversation — bottom anchor + FLIP feels right
- [ ] Send while scrolled to top of long history — auto-scroll catches up smoothly
- [ ] Tool-heavy assistant response — staggered tool cards, no jank
- [ ] Trigger an approval mid-response — composer reflow looks intentional
- [ ] Scroll up past 3+ user messages — pinned bar docks/swaps cleanly
- [ ] Click Jump on pinned bar — undock animates back into the list
- [ ] `/clear` mid-conversation — exit animations don't fight each other
- [ ] Toggle OS reduced-motion — everything goes instant
- [ ] Provider switch (Claude → Codex → Gemini) — thinking states behave per-provider
- [ ] Empty state — SAI logo floats subtly; cycling hints cross-fade

- [ ] **Step 7: Performance spot-check**

Open Chrome DevTools Performance, record a 5-second window during a multi-tool assistant turn, confirm no sustained dropped-frame periods. If any frame budget concerns surface, investigate `LayoutGroup` re-layouts and the streaming-tail shimmer first (per spec — both have escape hatches).

- [ ] **Step 8: Commit**

```bash
git add tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "test(chat): integration coverage for reduced motion"
```

---

## Self-Review Notes

This plan was authored against the spec at `docs/superpowers/specs/2026-05-02-chat-animation-redesign-design.md`. Verification:

- **Spec §1 (motion vocabulary)** → Task 1
- **Spec §2 (tech & architecture)** → Task 1 + Task 2 + Task 14 (LayoutGroup) + Task 13 (layoutId)
- **Spec §3 (bottom-anchored list)** → Task 3
- **Spec §4 message entry** → Tasks 4, 5, 6, 7
- **Spec §4 tool cards** → Tasks 8, 9, 10
- **Spec §4 thinking indicator** → Tasks 11, 12
- **Spec §4 pinned-prompt bar** → Task 13
- **Spec §4 auxiliary stack** → Tasks 14, 15
- **Spec §4 scroll & sentinel** → Task 16
- **Spec §4 new-messages button** → Task 17
- **Spec §4 empty state** → Task 17
- **Spec §4 reduced motion** → Task 18 (audit) + per-task usage of `useReducedMotionTransition`
- **Spec §5 testing approach** → tests in every task + the manual QA list embedded in Task 18
