# Error Card Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Replace the existing red-on-red error card in `ChatMessage.tsx` with a terminal-diagnostic treatment (status bar with pulsing dot, prompt-style body, sectioned RAW RESPONSE details, primary filled retry, ghost details toggle) and add a two-step Clear-context button with a label-swap animation.

**Architecture:** Two tasks. Task 1 restructures the error card markup + CSS in `ChatMessage.tsx` and converts the details expand/collapse to a framer-motion `AnimatePresence` panel. Task 2 adds the new two-step `Clear context` button to the action bar and wires `onClearContext` through to `ChatPanel`'s existing `setMessages([])` path. Both tasks reuse the existing motion vocabulary (`SPRING.gentle`, `SPRING.flick`, `useReducedMotionTransition`).

**Tech Stack:** React 18, TypeScript, framer-motion (`motion/react`), Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-05-02-error-card-redesign-design.md`

---

## File Structure

**Modified files:**
- `src/components/Chat/ChatMessage.tsx` — replace error JSX + inline CSS; new `onClearContext?: () => void` prop in Task 2
- `src/components/Chat/ChatPanel.tsx` — add `handleClearContext` callback in Task 2; pass to error message instances
- `tests/unit/components/Chat/ChatMessage.test.tsx` — extend existing error tests with new structure; add clear-context behaviour tests in Task 2

No new files. The redesign stays inside the existing error-rendering branch in `ChatMessage.tsx`.

---

## Task 1: Restructure error card (terminal diagnostic look)

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx`
- Modify: `tests/unit/components/Chat/ChatMessage.test.tsx`

- [ ] **Step 1: Read context**

In `src/components/Chat/ChatMessage.tsx`, locate the error rendering branch (around line 416). It returns a `motion.div` with `className="chat-msg chat-msg-error-wrap..."` containing a `.chat-msg-error` div with header / body / meta / details / actions sub-blocks, plus a large inline `<style>` block. The whole thing needs replacing — but keep:
- The outer `motion.div` and its `entryProps` spread
- The `chat-msg-error-wrap` and `chat-msg-error-pulse` classes (existing entry pulse animation)
- `parseAiError` data fields (`title`, `status`, `errMsg`, `requestId`, `details`) — those come from `message.error` and stay as-is

Orientation only.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';

it('renders the new error status bar with error_type and HTTP status', () => {
  const { container, getByText } = render(
    <ChatMessage message={{
      id: 'e-1', role: 'system', content: 'Output blocked',
      timestamp: 0,
      error: {
        title: 'Invalid request',
        status: 400,
        message: 'Output blocked by content filtering policy',
        requestId: 'req_abc',
        errorType: 'invalid_request_error',
      } as any,
    }} />
  );
  const bar = container.querySelector('[data-testid="chat-msg-error-status-bar"]');
  expect(bar).toBeTruthy();
  expect(bar?.textContent).toContain('invalid_request_error');
  expect(bar?.textContent).toContain('HTTP 400');
});

it('renders the prompt-style body with the error message', () => {
  const { container } = render(
    <ChatMessage message={{
      id: 'e-2', role: 'system', content: 'Output blocked',
      timestamp: 0,
      error: { title: 'Invalid request', status: 400, message: 'Output blocked by content filtering policy' } as any,
    }} />
  );
  const body = container.querySelector('[data-testid="chat-msg-error-body"]');
  expect(body?.textContent).toContain('Output blocked by content filtering policy');
});

it('renders req_id meta when present and omits when absent', () => {
  const { container, rerender } = render(
    <ChatMessage message={{
      id: 'e-3', role: 'system', content: 'x', timestamp: 0,
      error: { title: 'X', message: 'x', requestId: 'req_abc' } as any,
    }} />
  );
  expect(container.querySelector('[data-testid="chat-msg-error-meta"]')?.textContent).toContain('req_abc');

  rerender(
    <ChatMessage message={{
      id: 'e-3', role: 'system', content: 'x', timestamp: 0,
      error: { title: 'X', message: 'x' } as any,
    }} />
  );
  expect(container.querySelector('[data-testid="chat-msg-error-meta"]')).toBeNull();
});

it('details toggle expands the RAW RESPONSE panel', () => {
  const { container, getByText } = render(
    <ChatMessage message={{
      id: 'e-4', role: 'system', content: 'x', timestamp: 0,
      error: { title: 'X', message: 'x', details: '{"raw":"yes"}' } as any,
    }} />
  );
  expect(container.querySelector('[data-testid="chat-msg-error-details-panel"]')).toBeNull();
  fireEvent.click(getByText(/Details/i));
  expect(container.querySelector('[data-testid="chat-msg-error-details-panel"]')).toBeTruthy();
  expect(container.textContent).toContain('RAW RESPONSE');
});

it('retry button calls onRetry', () => {
  const onRetry = vi.fn();
  const { getByText } = render(
    <ChatMessage
      onRetry={onRetry}
      message={{
        id: 'e-5', role: 'system', content: 'x', timestamp: 0,
        error: { title: 'X', message: 'x' } as any,
      }} />
  );
  fireEvent.click(getByText(/Retry/i));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
```

(If `errorType` isn't already part of the `ParsedError` type, the test passes through the existing `as any` cast and we'll thread it through in step 4.)

- [ ] **Step 3: Run failing tests**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "status bar|prompt-style|req_id meta|RAW RESPONSE|retry button calls onRetry"`
Expected: FAIL — new structure doesn't exist yet.

- [ ] **Step 4: Replace the error rendering branch in `ChatMessage.tsx`**

In `src/components/Chat/ChatMessage.tsx`, ensure the imports at the top include:

```tsx
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronRight, Copy, RotateCw } from 'lucide-react';
import { SPRING, useReducedMotionTransition } from './motion';
```

(Most are already imported. Add `AnimatePresence` to the existing `motion` import line if missing. Drop `AlertTriangle` from the lucide-react import line — the new design uses a status dot instead of a triangle icon.)

If `parseAiError.ts`'s `ParsedError` type doesn't already have an optional `errorType?: string` field, extend it now:

```ts
// In src/components/Chat/parseAiError.ts, inside the ParsedError-shaped return — already returns `errorType` if it parses one. Verify the existing type. The current code does set `errorType` locally but may not export it on the return shape. If not, add it.
```

(Read the existing return shape; if `errorType` is already present in the `ParsedError` type, no change is needed here.)

Inside the `ChatMessage` component, in the error-rendering branch, replace the entire `return (...)` block with:

```tsx
const detailsTransition = useReducedMotionTransition(SPRING.gentle);

return (
  <motion.div
    className={`chat-msg chat-msg-error-wrap${message.error ? ' chat-msg-error-pulse' : ''}`}
    {...entryProps}
  >
    <div className="chat-msg-error">
      <div className="chat-msg-error-status-bar" data-testid="chat-msg-error-status-bar">
        <span className="chat-msg-error-dot" aria-hidden="true" />
        <span className="chat-msg-error-status-label">
          ERROR{errorType ? ` · ${errorType}` : ''}
        </span>
        {status != null && (
          <span className="chat-msg-error-status-http">HTTP {status}</span>
        )}
      </div>

      <div className="chat-msg-error-body" data-testid="chat-msg-error-body">
        <span className="chat-msg-error-prompt" aria-hidden="true">{'›'}</span>{' '}
        <span className="chat-msg-error-msg">{errMsg}</span>
      </div>

      {requestId && (
        <div className="chat-msg-error-meta" data-testid="chat-msg-error-meta">
          <span className="chat-msg-error-meta-key">req_id</span>{' '}
          <span className="chat-msg-error-meta-val">{requestId}</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {errorDetailsOpen && details && (
          <motion.div
            key="details-panel"
            data-testid="chat-msg-error-details-panel"
            className="chat-msg-error-details-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={detailsTransition}
            style={{ overflow: 'hidden' }}
          >
            <div className="chat-msg-error-details-header">
              <span className="chat-msg-error-details-label">RAW RESPONSE</span>
              <button
                type="button"
                className="chat-msg-error-copy"
                onClick={handleCopyDetails}
                title="Copy raw error"
              >
                {errorDetailsCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <pre className="chat-msg-error-details-pre">{details}</pre>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="chat-msg-error-actions">
        {onRetry && (
          <button
            type="button"
            className="chat-msg-error-retry"
            data-testid="chat-msg-error-retry"
            onClick={onRetry}
          >
            <RotateCw size={12} /> Retry
          </button>
        )}
        {details && (
          <button
            type="button"
            className="chat-msg-error-toggle"
            onClick={() => setErrorDetailsOpen(o => !o)}
          >
            <ChevronRight
              size={12}
              className={`chat-msg-error-chev ${errorDetailsOpen ? 'open' : ''}`}
            />
            Details
          </button>
        )}
      </div>
    </div>

    <style>{`
      @media (prefers-reduced-motion: no-preference) {
        @keyframes chat-msg-error-pulse {
          0%   { box-shadow: 0 0 0 1px var(--accent); }
          100% { box-shadow: 0 0 0 1px transparent; }
        }
        .chat-msg-error-pulse { animation: chat-msg-error-pulse 200ms ease-out 1; }

        @keyframes chat-msg-error-dot-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 6px var(--red); }
          50%      { transform: scale(1.15); box-shadow: 0 0 10px var(--red); }
        }
        .chat-msg-error-dot {
          animation: chat-msg-error-dot-pulse 1.4s ease-in-out infinite;
        }
      }
      .chat-msg-error-wrap { margin-bottom: 16px; }
      .chat-msg-error {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
        color: var(--text);
        font-size: 13px;
        line-height: 1.55;
      }
      .chat-msg-error-status-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: var(--bg-input);
        border-bottom: 1px solid var(--border);
        font-size: 11px;
        letter-spacing: 0.06em;
      }
      .chat-msg-error-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--red);
        box-shadow: 0 0 6px var(--red);
        flex-shrink: 0;
      }
      .chat-msg-error-status-label {
        color: var(--red);
        font-weight: 600;
      }
      .chat-msg-error-status-http {
        margin-left: auto;
        color: var(--text-muted);
        font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      }
      .chat-msg-error-body {
        padding: 10px 12px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .chat-msg-error-prompt {
        color: var(--red);
        user-select: none;
      }
      .chat-msg-error-msg { color: var(--text); }
      .chat-msg-error-meta {
        padding: 4px 12px 10px;
        font-size: 11px;
        font-family: 'Geist Mono', 'JetBrains Mono', monospace;
      }
      .chat-msg-error-meta-key { color: var(--text-muted); }
      .chat-msg-error-meta-val { color: var(--text-secondary); }
      .chat-msg-error-details-panel {
        border-top: 1px solid var(--border);
      }
      .chat-msg-error-details-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px;
        font-size: 10px;
        letter-spacing: 0.08em;
      }
      .chat-msg-error-details-label {
        color: var(--text-muted);
        font-weight: 600;
      }
      .chat-msg-error-copy {
        margin-left: auto;
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        padding: 2px;
        border-radius: 3px;
        transition: color 0.15s;
      }
      .chat-msg-error-copy:hover { color: var(--text); }
      .chat-msg-error-details-pre {
        padding: 8px 12px 10px;
        margin: 0;
        background: var(--bg-secondary);
        font-family: 'Geist Mono', 'JetBrains Mono', monospace;
        font-size: 11px;
        color: var(--text-secondary);
        overflow-x: auto;
        max-height: 200px;
        overflow-y: auto;
      }
      .chat-msg-error-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: var(--bg-input);
        border-top: 1px solid var(--border);
      }
      .chat-msg-error-retry {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--red);
        color: var(--bg-primary);
        border: none;
        font-weight: 600;
        font-size: 12px;
        padding: 5px 12px;
        border-radius: 5px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .chat-msg-error-retry:hover {
        background: color-mix(in srgb, var(--red) 80%, white 20%);
      }
      .chat-msg-error-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 11px;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        transition: color 0.15s, background 0.15s;
      }
      .chat-msg-error-toggle:hover {
        color: var(--text);
        background: rgba(255, 255, 255, 0.04);
      }
      .chat-msg-error-chev { transition: transform 0.15s; }
      .chat-msg-error-chev.open { transform: rotate(90deg); }
    `}</style>
  </motion.div>
);
```

The `errorType` reference comes from the parsed error: `const errorType = message.error?.errorType;` — declare this alongside the existing `title`, `status`, `errMsg`, `requestId`, `details` destructuring. If those local names don't already exist in the surrounding scope, look at the current code — `parseAiError` returns `{ title, status, message, requestId, details, errorType? }` and the existing render branch destructures into similar local names. Match what's already there.

Make sure `entryProps`, `setErrorDetailsOpen`, `errorDetailsOpen`, `errorDetailsCopied`, `setErrorDetailsCopied`, and `handleCopyDetails` continue to be defined in the same scope where they were before — no change needed there.

- [ ] **Step 5: Run tests**

Run: `npm run test:unit -- ChatMessage.test.tsx`
Expected: PASS — new structural tests + existing tests (the existing `error-pulse` test still passes because we kept the class).

- [ ] **Step 6: Manual smoke check**

Run `npm run dev`. In a chat, type `/fake-error` → confirm the new card looks right (status bar with pulsing red dot, prompt-style body, req_id meta line, filled red Retry button, ghost Details toggle). Click Details → RAW RESPONSE panel slides down with copy button. Click again → slides up.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(chat): redesign error card with terminal diagnostic look"
```

---

## Task 2: Add two-step Clear-context button

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` — accept `onClearContext` prop, render the button, manage two-step state
- Modify: `src/components/Chat/ChatPanel.tsx` — add `handleClearContext` and pass it to error `ChatMessage` instances
- Modify: `tests/unit/components/Chat/ChatMessage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
import { act, fireEvent } from '@testing-library/react';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const errorMsg = (id = 'c-1') => ({
  id, role: 'system' as const, content: 'x', timestamp: 0,
  error: { title: 'X', message: 'x' } as any,
});

it('renders Clear context button when onClearContext is provided', () => {
  const { container } = render(
    <ChatMessage onClearContext={vi.fn()} message={errorMsg()} />
  );
  const btn = container.querySelector('[data-testid="chat-msg-error-clear"]');
  expect(btn).toBeTruthy();
  expect(btn?.textContent).toContain('Clear context');
});

it('does not render Clear context button without onClearContext', () => {
  const { container } = render(<ChatMessage message={errorMsg()} />);
  expect(container.querySelector('[data-testid="chat-msg-error-clear"]')).toBeNull();
});

it('first click on Clear context shows Confirm? and does not call onClearContext', () => {
  const onClearContext = vi.fn();
  const { container } = render(
    <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
  );
  const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
  fireEvent.click(btn);
  expect(btn.textContent).toContain('Confirm?');
  expect(onClearContext).not.toHaveBeenCalled();
});

it('second click within 3s calls onClearContext', () => {
  const onClearContext = vi.fn();
  const { container } = render(
    <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
  );
  const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
  fireEvent.click(btn);
  fireEvent.click(btn);
  expect(onClearContext).toHaveBeenCalledTimes(1);
});

it('confirming state resets after 3s of no second click', () => {
  const onClearContext = vi.fn();
  const { container } = render(
    <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
  );
  const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
  fireEvent.click(btn);
  expect(btn.textContent).toContain('Confirm?');
  act(() => { vi.advanceTimersByTime(3100); });
  expect(btn.textContent).toContain('Clear context');
});

it('outside click resets the confirming state', () => {
  const onClearContext = vi.fn();
  const { container } = render(
    <ChatMessage onClearContext={onClearContext} message={errorMsg()} />
  );
  const btn = container.querySelector('[data-testid="chat-msg-error-clear"]') as HTMLButtonElement;
  fireEvent.click(btn);
  expect(btn.textContent).toContain('Confirm?');
  fireEvent.mouseDown(document.body);
  expect(btn.textContent).toContain('Clear context');
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm run test:unit -- ChatMessage.test.tsx -t "Clear context|Confirm"`
Expected: FAIL — button doesn't exist yet.

- [ ] **Step 3: Add the prop and state to ChatMessage**

In `src/components/Chat/ChatMessage.tsx`:

1. Add to the imports near the top:

```tsx
import { Eraser } from 'lucide-react';
```

(Add `Eraser` alongside existing lucide imports. If Eraser isn't available in the installed lucide-react version, fall back to `Trash2` — check by importing and seeing if it resolves.)

2. Extend the function-signature destructuring to accept `onClearContext`:

```tsx
function ChatMessage({
  message,
  projectPath,
  onFileOpen,
  aiProvider = 'claude',
  toolCallsExpanded = true,
  onRetry,
  onClearContext,            // ← new
  isStreaming = false,
  isFirstAssistantOfTurn = false,
  pinnedLayoutId,
}: {
  message: ChatMessageType;
  projectPath?: string;
  onFileOpen?: (path: string, line?: number) => void;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  toolCallsExpanded?: boolean;
  onRetry?: () => void;
  onClearContext?: () => void;   // ← new
  isStreaming?: boolean;
  isFirstAssistantOfTurn?: boolean;
  pinnedLayoutId?: string;
}) {
```

3. In the error-rendering branch, just above the existing local state (`errorDetailsOpen`, `errorDetailsCopied`), add:

```tsx
const [confirmingClear, setConfirmingClear] = useState(false);
const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const cancelConfirm = useCallback(() => {
  setConfirmingClear(false);
  if (confirmTimerRef.current) {
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
  }
}, []);

const handleClearClick = useCallback(() => {
  if (confirmingClear) {
    cancelConfirm();
    onClearContext?.();
    return;
  }
  setConfirmingClear(true);
  if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  confirmTimerRef.current = setTimeout(() => {
    setConfirmingClear(false);
    confirmTimerRef.current = null;
  }, 3000);
}, [confirmingClear, cancelConfirm, onClearContext]);

useEffect(() => {
  if (!confirmingClear) return;
  const onDocMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (target && clearBtnRef.current?.contains(target)) return;
    cancelConfirm();
  };
  document.addEventListener('mousedown', onDocMouseDown);
  return () => document.removeEventListener('mousedown', onDocMouseDown);
}, [confirmingClear, cancelConfirm]);

useEffect(() => () => {
  if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
}, []);

const clearBtnRef = useRef<HTMLButtonElement | null>(null);
const clearLabelTransition = useReducedMotionTransition(SPRING.flick);
```

(Make sure `useEffect`, `useRef`, `useCallback`, `useState` are already imported at the top of the file. They are.)

- [ ] **Step 4: Render the Clear-context button in the actions bar**

In the actions bar JSX from Task 1, insert the new button between Retry and Details:

```tsx
<div className="chat-msg-error-actions">
  {onRetry && (
    <button
      type="button"
      className="chat-msg-error-retry"
      data-testid="chat-msg-error-retry"
      onClick={onRetry}
    >
      <RotateCw size={12} /> Retry
    </button>
  )}
  {onClearContext && (
    <motion.button
      ref={clearBtnRef}
      type="button"
      data-testid="chat-msg-error-clear"
      className={`chat-msg-error-clear${confirmingClear ? ' chat-msg-error-clear--confirming' : ''}`}
      layout
      onClick={handleClearClick}
    >
      <Eraser size={12} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={confirmingClear ? 'confirm' : 'idle'}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={clearLabelTransition}
        >
          {confirmingClear ? 'Confirm?' : 'Clear context'}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )}
  {details && (
    <button
      type="button"
      className="chat-msg-error-toggle"
      onClick={() => setErrorDetailsOpen(o => !o)}
    >
      <ChevronRight
        size={12}
        className={`chat-msg-error-chev ${errorDetailsOpen ? 'open' : ''}`}
      />
      Details
    </button>
  )}
</div>
```

- [ ] **Step 5: Add Clear-context button styles**

Add to the inline `<style>` block in the error branch (alongside the other `.chat-msg-error-*` rules):

```css
.chat-msg-error-clear {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.chat-msg-error-clear:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}
.chat-msg-error-clear--confirming {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border-color: color-mix(in srgb, var(--red) 30%, transparent);
}
.chat-msg-error-clear--confirming:hover {
  background: color-mix(in srgb, var(--red) 14%, transparent);
}
```

- [ ] **Step 6: Run the ChatMessage tests**

Run: `npm run test:unit -- ChatMessage.test.tsx`
Expected: PASS — new clear-context tests + existing tests.

- [ ] **Step 7: Wire `handleClearContext` in ChatPanel**

In `src/components/Chat/ChatPanel.tsx`, near the other message-handling helpers (e.g. just above `handleSend`), add:

```tsx
const handleClearContext = useCallback(() => {
  setMessages([]);
  setRenderStart(0);
  pendingComposerRectRef.current = null;
}, [setMessages]);
```

(`setRenderStart` and `pendingComposerRectRef` are already declared in the component — same names the existing `/clear` slash-command branch uses.)

Then find the `visibleMessages.map(...)` section. There are two render paths — one for user messages, one for non-user. The non-user path renders ChatMessage with `onRetry={msg.error ? () => handleRetry(msg.id) : undefined}`. Extend that to pass `onClearContext` when `msg.error` is set:

```tsx
: <ChatMessage
    key={msg.id}
    message={msg}
    projectPath={projectPath}
    onFileOpen={onFileOpen}
    aiProvider={aiProvider}
    toolCallsExpanded={toolCallsExpanded}
    onRetry={msg.error ? () => handleRetry(msg.id) : undefined}
    onClearContext={msg.error ? handleClearContext : undefined}
    isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId}
  />
```

- [ ] **Step 8: Run the full test suite to confirm no regressions**

Run: `npm run test:unit -- ChatPanel.test.tsx ChatMessage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Manual smoke check**

Run `npm run dev`. Type `/fake-error` → error card appears. Confirm:

- "Clear context" button is visible between Retry and Details.
- First click → label morphs to "Confirm?" with red text and a faint red background.
- Wait 3+ seconds without second click → button reverts to "Clear context".
- First click → click outside (anywhere else on the page) → reverts.
- First click → second click → chat history clears (the error message itself disappears with everything else).

- [ ] **Step 10: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(chat): two-step clear-context button on error card"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Status bar with pulsing dot + error_type + HTTP status → Task 1 step 4 (`chat-msg-error-status-bar` JSX + CSS)
  - Prompt-style body → Task 1 step 4 (`chat-msg-error-prompt` + body)
  - req_id meta with key/value styling → Task 1 step 4 (`chat-msg-error-meta`)
  - Sectioned RAW RESPONSE details panel with copy button → Task 1 step 4 (`AnimatePresence` + `chat-msg-error-details-panel`)
  - Filled red retry button → Task 1 step 4 (`chat-msg-error-retry` JSX + CSS)
  - Ghost details toggle → Task 1 step 4 (`chat-msg-error-toggle`)
  - Two-step clear-context button with label-swap animation → Task 2 (steps 3–5)
  - `onClearContext` wiring from ChatPanel → Task 2 step 7
  - All animations gated on `prefers-reduced-motion: no-preference` → Task 1 step 4 (`@media` blocks) + `useReducedMotionTransition` for framer transitions
- **Placeholder scan:** none.
- **Type consistency:** `onClearContext?: () => void` declared in Task 2 step 3, called from Task 2 step 7. `confirmingClear` boolean state, `confirmTimerRef`, `cancelConfirm`, `handleClearClick`, `clearBtnRef`, `clearLabelTransition` all declared together in Task 2 step 3 and used together in step 4. `errorType` referenced in Task 1 step 4 — assumes the existing `parseAiError` already exposes it on the returned `ParsedError` (the existing code computes it locally; verify it's exported on the return shape and add to the type if missing).
