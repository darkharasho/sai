# Papery Dash UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a faint, accent-tinted dashed hairline ("papery dash") between chat turns and inside expandable cards, driven by one themed CSS token.

**Architecture:** Define a single CSS custom property `--divider-dash` (a `repeating-linear-gradient` referencing `var(--accent)`) plus two small global utility classes. Apply them in three spots: a divider element between chat turns, and the header↔body separator in `ToolCallCard` and `PlanReviewCard`. Because the token references `var(--accent)` — which `applyTheme` sets per theme on `:root` — the dash re-tints automatically (amber / purple / blue) with no per-theme duplication.

**Tech Stack:** React + TypeScript, Vite, styled-jsx (in card components) + a global stylesheet (`src/styles/globals.css`), Vitest + Testing Library (jsdom), `--maxWorkers=2` per repo config.

**Spec:** `docs/superpowers/specs/2026-06-05-ui-papery-dash-refresh-design.md`

---

## File Structure

- **`src/styles/globals.css`** — owns the `--divider-dash` token and the two reusable utility classes (`.dashed-rule`, `.dashed-divider-top`) plus the `.chat-turn-divider` spacing. Single source of truth for the dash.
- **`src/components/Chat/ChatPanel.tsx`** — inserts the turn-divider element into the message list (the only JSX change in the refresh).
- **`src/components/Chat/ToolCallCard.tsx`** — applies `.dashed-divider-top` to its expand region (styled-jsx left as-is; class added in JSX).
- **`src/components/Chat/PlanReviewCard.tsx`** — swaps its solid header↔body border for `.dashed-divider-top`.
- **`tests/unit/components/Chat/ChatPanel.test.tsx`** — gains one test asserting the turn divider renders between turns and not before the first turn.

Card separators (Tasks 3–4) are CSS-only; jsdom cannot meaningfully assert a `background-size: 100% 1px` line, so they are verified by the full suite staying green plus a manual multi-theme screenshot (Task 5). The turn divider (Task 2) is a real DOM element and is unit-tested.

---

## Task 1: Add the `--divider-dash` token and utility classes

**Files:**
- Modify: `src/styles/globals.css` (the `:root { … }` block near the top, and append the utility classes)

- [ ] **Step 1: Add the token to `:root`**

In `src/styles/globals.css`, inside the `:root { … }` block, add the token immediately after the existing `--turquoise: #38c7bd;` line (it must sit with the other color tokens so it can read `var(--accent)`):

```css
  /* Papery dash divider — tracks the active theme's accent. */
  --divider-dash: repeating-linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 45%, transparent) 0 7px,
    transparent 7px 13px
  );
```

- [ ] **Step 2: Add the reusable utility classes**

Append to the end of `src/styles/globals.css`:

```css
/* Papery dash — reusable dividers (see specs/2026-06-05-ui-papery-dash-refresh-design.md) */
.dashed-rule {
  height: 1px;
  border: 0;
  background: var(--divider-dash);
}

.dashed-divider-top {
  background-image: var(--divider-dash);
  background-repeat: no-repeat;
  background-position: top left;
  background-size: 100% 1px;
}

.chat-turn-divider {
  margin: 14px 0;
}
```

- [ ] **Step 3: Verify the app still builds/typechecks**

Run: `npm run build` (or the project's typecheck script, e.g. `npx tsc --noEmit`)
Expected: completes with no new errors (CSS-only change; nothing consumes the token yet, so the UI is unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(ui): add --divider-dash token and dashed-divider utilities"
```

---

## Task 2: Render the dashed divider between chat turns

A "turn" begins at each user message. Insert a divider before every user message except the first one in the rendered window, so consecutive turns are separated but the top of the list is clean.

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx:1` (import) and `src/components/Chat/ChatPanel.tsx:1809-1833` (message map)
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('ChatPanel', () => { … })` block in `tests/unit/components/Chat/ChatPanel.test.tsx` (it uses the existing `baseProps()` helper defined later in the file; Vitest hoists `describe` bodies so ordering within the block is fine):

```tsx
it('renders a dashed turn divider between turns but not before the first turn', async () => {
  const props = {
    ...baseProps(),
    initialMessages: [
      { id: 'u1', role: 'user' as const, content: 'first', timestamp: 0 },
      { id: 'a1', role: 'assistant' as const, content: 'reply one', timestamp: 1 },
      { id: 'u2', role: 'user' as const, content: 'second', timestamp: 2 },
      { id: 'a2', role: 'assistant' as const, content: 'reply two', timestamp: 3 },
    ],
  };
  const { container } = render(<ChatPanel {...props} />);
  await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
  // Two turns => exactly one divider (before the second user message).
  const dividers = container.querySelectorAll('.chat-turn-divider');
  expect(dividers.length).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "dashed turn divider" --maxWorkers=2`
Expected: FAIL — `expect(0).toBe(1)` (no `.chat-turn-divider` exists yet).

- [ ] **Step 3: Import `Fragment`**

Change the first import line of `src/components/Chat/ChatPanel.tsx` from:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
```

to:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
```

- [ ] **Step 4: Insert the divider in the message map**

Replace the message map at `src/components/Chat/ChatPanel.tsx:1809-1833`. The current code is:

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
                      projectPath={projectPath}
                      onFileOpen={onFileOpen}
                      aiProvider={aiProvider}
                      toolCallsExpanded={toolCallsExpanded}
                      pinnedLayoutId={`pinned-${msg.id}`}
                      isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId}
                      renderToolCall={renderToolCall}
                      renderMessage={renderMessage}
                      metaRuntime={activeMetaRuntime}
                      onAnswerQuestion={handleAnswerQuestion}
                      onAnswerPlanReview={handleAnswerPlanReview}
                    />
                  </div>
                )
                : <ChatMessage key={msg.id} message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} onClearContext={msg.error ? handleClearContext : undefined} isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId} isStreaming={isStreaming && msg.id === lastAssistantId && !streamSettled} renderToolCall={renderToolCall} renderMessage={renderMessage} metaRuntime={activeMetaRuntime} onAnswerQuestion={handleAnswerQuestion} onAnswerPlanReview={handleAnswerPlanReview} watcherUrlAllowlist={watcherUrlsByMessageId.get(msg.id) ?? EMPTY_URL_SET} />
              )}
```

Replace it with (adds the `(msg, i)` index, wraps each item in a keyed `Fragment`, and prepends the divider before non-first user messages):

```tsx
            {visibleMessages.map((msg, i) => {
              const turnDivider = msg.role === 'user' && i > 0
                ? <div className="dashed-rule chat-turn-divider" aria-hidden="true" />
                : null;
              const node = msg.role === 'user'
                ? (
                  <div
                    ref={el => { if (el) userMsgRefs.current.set(msg.id, el); else userMsgRefs.current.delete(msg.id); }}
                    data-layout-id={`pinned-${msg.id}`}
                  >
                    <ChatMessage
                      message={msg}
                      projectPath={projectPath}
                      onFileOpen={onFileOpen}
                      aiProvider={aiProvider}
                      toolCallsExpanded={toolCallsExpanded}
                      pinnedLayoutId={`pinned-${msg.id}`}
                      isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId}
                      renderToolCall={renderToolCall}
                      renderMessage={renderMessage}
                      metaRuntime={activeMetaRuntime}
                      onAnswerQuestion={handleAnswerQuestion}
                      onAnswerPlanReview={handleAnswerPlanReview}
                    />
                  </div>
                )
                : <ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} onClearContext={msg.error ? handleClearContext : undefined} isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId} isStreaming={isStreaming && msg.id === lastAssistantId && !streamSettled} renderToolCall={renderToolCall} renderMessage={renderMessage} metaRuntime={activeMetaRuntime} onAnswerQuestion={handleAnswerQuestion} onAnswerPlanReview={handleAnswerPlanReview} watcherUrlAllowlist={watcherUrlsByMessageId.get(msg.id) ?? EMPTY_URL_SET} />;
              return <Fragment key={msg.id}>{turnDivider}{node}</Fragment>;
            })}
```

Note: the inner `key={msg.id}` props were removed from the `<div>` and the assistant `<ChatMessage>` because the key now lives on the wrapping `Fragment`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "dashed turn divider" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Run the full ChatPanel test file to confirm no regressions**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx --maxWorkers=2`
Expected: all tests PASS (the Fragment refactor must not break existing rendering/keys).

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(ui): dashed divider between chat turns"
```

---

## Task 3: Dashed header↔body separator in ToolCallCard

`ToolCallCard` currently shows no rule between its header and expanded body. Add the dashed divider to the top of the expand region.

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx:828-836` (the `motion.div` with `className="tool-call-expand"`)

- [ ] **Step 1: Add the utility class to the expand container**

In `src/components/Chat/ToolCallCard.tsx`, find the expand element (around line 828-836):

```tsx
            <motion.div
              key="tool-call-expand"
              className="tool-call-expand"
              initial={{ height: 0, opacity: 0 }}
```

Change the `className` to include the global utility:

```tsx
            <motion.div
              key="tool-call-expand"
              className="tool-call-expand dashed-divider-top"
              initial={{ height: 0, opacity: 0 }}
```

(No styled-jsx change is needed — `.dashed-divider-top` paints a 1px dashed line at the top of the element via `background-size: 100% 1px`. The card's `overflow: hidden` keeps it clipped to the rounded corners.)

- [ ] **Step 2: Verify build/typecheck**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: no new errors.

- [ ] **Step 3: Run the ToolCallCard tests**

Run: `npx vitest run tests/unit/components/Chat/ -t "tool" --maxWorkers=2`
Expected: existing tool-call tests still PASS (class addition does not change behavior or DOM structure).

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx
git commit -m "feat(ui): dashed header/body separator in ToolCallCard"
```

---

## Task 4: Swap PlanReviewCard's solid separator for the dash

`PlanReviewCard` already draws a solid `border-top` between header and body via `.plan-review-body`. Replace that solid rule with the dashed divider so it matches `ToolCallCard`.

**Files:**
- Modify: `src/components/Chat/PlanReviewCard.tsx:108` (JSX `className`) and `src/components/Chat/PlanReviewCard.tsx:171-173` (styled-jsx rule)

- [ ] **Step 1: Remove the solid border in styled-jsx**

In `src/components/Chat/PlanReviewCard.tsx`, change the `.plan-review-body` rule (around line 171):

```css
  .plan-review-body {
    border-top: 1px solid var(--border);
  }
```

to:

```css
  .plan-review-body {
    /* dashed header↔body separator supplied by .dashed-divider-top */
  }
```

- [ ] **Step 2: Add the utility class in JSX**

Find the body element (around line 108):

```tsx
                <div className="plan-review-body">
```

Change it to:

```tsx
                <div className="plan-review-body dashed-divider-top">
```

- [ ] **Step 3: Verify build/typecheck**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: no new errors.

- [ ] **Step 4: Run PlanReviewCard / chat tests**

Run: `npx vitest run tests/unit/components/Chat/ --maxWorkers=2`
Expected: all chat-component tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/PlanReviewCard.tsx
git commit -m "feat(ui): use dashed separator in PlanReviewCard"
```

---

## Task 5: Full-suite + manual multi-theme verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: the whole suite PASSES (no regressions from the refresh).

- [ ] **Step 2: Manual visual check across themes**

Launch the app (`npm run dev` / the project's run skill). Confirm by eye:
- A faint dashed divider appears **between chat turns** and **at the top of an expanded tool-call card** and an expanded plan-review card.
- No dashed lines appear on sidebar section breaks, above the chat input, or on other separators.
- Switch theme Default → Midnight → Steel (Settings): the dash retints **amber → purple → blue** automatically, staying faint.
- No layout shift / jitter is introduced between turns when toggling the chat.

- [ ] **Step 3: Capture before/after screenshots (optional but recommended)**

Use the `readme-screenshots` skill or existing screenshot tooling to capture the chat (two turns) and one expanded card in at least Default + one other theme, for the PR description.

- [ ] **Step 4: Final commit (only if Step 2 required any tuning)**

If the opacity (45%) or stroke/gap (7px/6px) needed adjusting during the visual check, edit `--divider-dash` in `src/styles/globals.css` and commit:

```bash
git add src/styles/globals.css
git commit -m "style(ui): tune --divider-dash opacity/spacing"
```

---

## Self-Review Notes

- **Spec coverage:** token (Task 1) ✓; between-chat-turns application (Task 2) ✓; inside-cards header↔body application (Tasks 3–4, covering both card types that have an expand/separator) ✓; themed via `var(--accent)` with no hardcoding (Task 1) ✓; scope guardrail — nothing else gets dashes (verified Task 5 Step 2) ✓; no-layout-shift + reduced-motion-N/A (Task 5 Step 2; the dash is static so no motion gating is added) ✓.
- **Type consistency:** class names are stable across tasks — `--divider-dash`, `.dashed-rule`, `.dashed-divider-top`, `.chat-turn-divider`. The test queries `.chat-turn-divider`, which Task 2 Step 4 renders.
- **No placeholders:** every code step shows exact before/after content and exact run commands.
