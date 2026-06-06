# Chat Message List Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the message list read as a conversation — user messages become compact right-aligned bubbles; the assistant stays full-width left — and remove the between-turns dashed divider.

**Architecture:** Two small changes. (1) Remove the turn-divider element from `ChatPanel`'s message map and delete its CSS rule. (2) Restyle `.chat-msg-user` in `ChatMessage` into a right-aligned, shrink-wrapped bubble with a tail corner and an inter-turn top gap. Assistant rendering and the user-message FLIP/pin animation are untouched (the restyle is pure CSS; FLIP measures whatever box the element has).

**Tech Stack:** React + TypeScript, Vite, styled-jsx (in `ChatMessage`) + global stylesheet, Vitest + Testing Library (jsdom), `--maxWorkers=2`.

**Spec:** `docs/superpowers/specs/2026-06-05-chat-message-list-refresh-design.md`

---

## File Structure

- **`src/components/Chat/ChatPanel.tsx`** — message map: remove the `turnDivider` element and revert the map to return the message node directly (no `Fragment` wrapper). Remove the now-unused `Fragment` import.
- **`src/styles/globals.css`** — delete the `.chat-turn-divider` rule. Keep `--divider-dash`, `.dashed-divider-top` (cards), and `.dashed-rule` (generic hairline util).
- **`src/components/Chat/ChatMessage.tsx`** — restyle the `.chat-msg-user` styled-jsx rule into the right bubble. No JSX/structure change.
- **`tests/unit/components/Chat/ChatPanel.test.tsx`** — flip the existing turn-divider test to assert **zero** dividers.

The bubble restyle (Task 2) is CSS-only; jsdom can't assert alignment/visual layout, so it's verified by the full suite staying green plus manual checks (Task 3). The divider removal (Task 1) is verified by the flipped unit test.

---

## Task 1: Remove the between-turns turn divider

**Files:**
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx:988-1003`
- Modify: `src/components/Chat/ChatPanel.tsx` (the `import … from 'react'` line and the `visibleMessages.map(...)` block)
- Modify: `src/styles/globals.css` (delete the `.chat-turn-divider` rule)

- [ ] **Step 1: Update the test to expect zero dividers (it will now fail)**

In `tests/unit/components/Chat/ChatPanel.test.tsx`, replace the existing test at lines 988-1003:

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

with (turn dividers are removed in the chat refresh — turn separation is now alignment + spacing):

```tsx
  it('does not render between-turn dividers (removed in chat message list refresh)', async () => {
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
    const dividers = container.querySelectorAll('.chat-turn-divider');
    expect(dividers.length).toBe(0);
  });
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "does not render between-turn dividers" --maxWorkers=2`
Expected: FAIL — `expected 1 to be +0` (the divider is still rendered).

- [ ] **Step 3: Remove the divider from the message map**

In `src/components/Chat/ChatPanel.tsx`, replace the current map block:

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

with the divider-free version (returns the node directly with `key={msg.id}`):

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

- [ ] **Step 4: Remove the now-unused `Fragment` import**

In `src/components/Chat/ChatPanel.tsx`, change the first import line from:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
```

to:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
```

Then confirm `Fragment` is not referenced anywhere else in the file:
Run: `grep -n "Fragment" src/components/Chat/ChatPanel.tsx`
Expected: no matches. (If any remain, leave the import in place instead.)

- [ ] **Step 5: Delete the `.chat-turn-divider` CSS rule**

In `src/styles/globals.css`, remove this rule (leave `--divider-dash`, `.dashed-divider-top`, and `.dashed-rule` intact):

```css
.chat-turn-divider {
  margin: 14px 0;
}
```

- [ ] **Step 6: Run the test, verify it PASSES**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "does not render between-turn dividers" --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Run the full ChatPanel test file**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx --maxWorkers=2`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/styles/globals.css tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(ui): remove between-turn dividers from chat list"
```

---

## Task 2: Restyle the user message as a right-aligned bubble

The user branch already renders the green `>_` (Terminal) icon and markdown inside
`.chat-msg-content`. This task only changes the `.chat-msg-user` CSS rule — no JSX change.

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` (the `.chat-msg-user` rule, currently at ~lines 970-977)

- [ ] **Step 1: Restyle `.chat-msg-user`**

In `src/components/Chat/ChatMessage.tsx`, find the rule:

```css
        .chat-msg-user {
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 14px;
          margin-left: 14px;
          margin-right: 14px;
        }
```

Replace it with:

```css
        .chat-msg-user {
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 14px 14px 4px 14px; /* chat tail (sharp bottom-right) */
          padding: 10px 14px;
          margin-left: auto;   /* push the bubble to the right */
          margin-right: 14px;
          margin-top: 18px;    /* inter-turn gap (replaces the removed divider) */
          width: fit-content;  /* shrink-wrap to the message text */
          max-width: 76%;      /* but never the full width */
        }
```

(`margin-left: auto` + `width: fit-content` right-aligns and shrink-wraps the bubble within its full-width wrapper; `max-width: 76%` caps long messages so they wrap.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (CSS-only change).

- [ ] **Step 3: Run chat-component tests (no behavioral change expected)**

Run: `npx vitest run tests/unit/components/Chat/ --maxWorkers=2`
Expected: all PASS. (The class name and DOM are unchanged; only CSS values differ.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "feat(ui): right-aligned user message bubble"
```

---

## Task 3: Verification — FLIP/pin animation, themes, full suite

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: whole suite PASSES (no regressions).

- [ ] **Step 2: Manual visual + animation check**

Launch the app (`npm run dev`). Confirm by eye:
- **User messages** sit as compact bubbles on the **right** (shrink-wrapped, with the tail corner and the green `>_` icon); long user messages wrap within ~76% width; short ones hug their text.
- **Assistant messages** are unchanged: full-width, left, with the SaiLogo avatar; code blocks / tool-call cards / todo rings keep full width.
- **No dashed divider** appears between turns; turns are separated by the right-bubble asymmetry and the inter-turn gap. (The in-card dashes — expanded tool-call / plan-review separators — are still present.)
- **FLIP/pin animation intact (the key risk):** send a prompt and, while the turn runs, confirm the user message still animates up into the pinned-prompt bar and back without breaking, glitching, or leaving the bubble mis-positioned. The transition from the right-aligned in-list bubble to the full-width pinned bar should read cleanly.
- **Themes:** switch Default → Midnight → Steel; the bubble re-tints via theme vars and stays legible.
- **Error / system messages** render exactly as before (not bubbled).

- [ ] **Step 3: If the FLIP transition looks jarring**

Only if Step 2 shows a broken/jarring FLIP: report it as DONE_WITH_CONCERNS with a description (what looks wrong, from/to positions). Do not guess-patch the animation system. The controller will decide whether to adjust the bubble's measured origin or accept the position shift. Do not mark Task 3 complete with a broken animation.

- [ ] **Step 4: Capture before/after screenshots (optional, for the PR)**

Use the `readme-screenshots` skill or existing tooling to capture a two-turn thread in at least Default + one other theme.

---

## Self-Review Notes

- **Spec coverage:** user right bubble = "subtle + tail", keeps `>_`, max-width 76% (Task 2) ✓; assistant unchanged (no task touches it) ✓; remove between-turns divider + delete `.chat-turn-divider`, keep in-card dash (Task 1) ✓; preserve FLIP/pin animation (Task 3 Step 2, plus the restyle is pure CSS so the FLIP code is untouched) ✓; themed via vars (Task 2, no hardcoded colors) ✓; error/system unchanged (verified Task 3) ✓; inter-turn gap replaces divider (Task 2 `margin-top`) ✓.
- **Placeholder scan:** every code step shows exact before/after content and exact commands. The only "judgment" step (Task 3 Step 3) is a conditional escalation, not a placeholder.
- **Consistency:** class names stable — `.chat-msg-user`, `.chat-turn-divider`, `Fragment`. The flipped test queries `.chat-turn-divider` (count 0), which Task 1 removes.
