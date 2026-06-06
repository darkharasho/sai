# Assistant Message Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flaky "Typewriter streaming" setting and the bouncy assistant entrance with a reflow-free crisp word-reveal (snap + traveling caret) for complete replies, plus a calm fade entrance.

**Architecture:** A new isolated DOM engine `wordReveal.ts` wraps prose words in `opacity:0` spans (code blocks/tables/images stay atomic) and reveals them in sequence with a caret, under a duration budget. `ChatMessage` drops all typewriter code, renders full markdown directly, and runs the reveal once on first paint of a *fresh, non-streamed* assistant message. The bouncy `SPRING.pop` entrance becomes a calm fade for assistant messages. The setting and its IPC are deleted.

**Tech Stack:** React + TypeScript, Vite, framer-motion (`motion/react`), styled-jsx + global stylesheet, Vitest + Testing Library (jsdom), `--maxWorkers=2`.

**Spec:** `docs/superpowers/specs/2026-06-05-assistant-message-reveal-design.md`

---

## File Structure

- **`src/components/Chat/wordReveal.ts`** (new) — the reveal engine: `revealWords(container, opts) → { cancel() }`. Pure DOM, no React. One responsibility.
- **`tests/unit/components/Chat/wordReveal.test.ts`** (new) — unit tests for the engine (jsdom + fake timers).
- **`src/components/Chat/motion.ts`** — add `FADE_IN` transition.
- **`src/components/Chat/ChatMessage.tsx`** — remove typewriter machinery; render full markdown; wire the reveal + calm entrance.
- **`src/styles/globals.css`** — `.rv-word` / `.rv-caret` styles (+ reduced-motion).
- **`src/components/SettingsModal.tsx`** — delete the "Typewriter streaming" row + plumbing.

Order is deletion-first where safe, engine built and tested in isolation before wiring.

---

## Task 1: Remove the "Typewriter streaming" setting

Pure deletion in `SettingsModal.tsx`. After this, the setting is gone from the UI and no longer written; `ChatMessage` still reads the (now-absent) pref harmlessly until Task 3 removes that read.

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Remove the state declaration**

Delete this line (around line 94):

```tsx
  const [typewriterEnabled, setTypewriterEnabled] = useState(true);
```

- [ ] **Step 2: Remove the settings hydration**

Delete this line (around line 123):

```tsx
    window.sai.settingsGet('typewriterEnabled', true).then((v: boolean) => setTypewriterEnabled(v));
```

- [ ] **Step 3: Remove the remote-sync line**

Delete this line (around line 165):

```tsx
      if ('typewriterEnabled' in remote) setTypewriterEnabled(remote.typewriterEnabled);
```

- [ ] **Step 4: Remove the change handler**

Delete this whole handler (around lines 337-342):

```tsx
  const handleTypewriterEnabledChange = (value: boolean) => {
    setTypewriterEnabled(value);
    window.sai.settingsSet('typewriterEnabled', value);
    window.dispatchEvent(new CustomEvent('sai-pref-typewriter', { detail: value }));
    onSettingChange?.('typewriterEnabled', value);
  };
```

- [ ] **Step 5: Remove the settings row**

Delete this whole row (around lines 565-578):

```tsx
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Typewriter streaming</div>
            <div className="settings-row-desc">Reveal assistant replies word-by-word as they stream. Off renders each chunk instantly.</div>
          </div>
          <button
            className={`settings-toggle${typewriterEnabled ? ' on' : ''}`}
            onClick={() => handleTypewriterEnabledChange(!typewriterEnabled)}
            role="switch"
            aria-checked={typewriterEnabled}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
```

- [ ] **Step 6: Verify no dangling references**

Run: `grep -n "typewriter" src/components/SettingsModal.tsx`
Expected: no matches.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Run any SettingsModal tests**

Run: `npx vitest run tests/unit/components -t "Settings" --maxWorkers=2`
Expected: PASS (or "no tests found", which is fine — verified by typecheck + Task 5 manual).

- [ ] **Step 9: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(ui): remove Typewriter streaming setting"
```

---

## Task 2: Build the `wordReveal` engine (TDD)

A standalone DOM module. No React, no app imports — fully unit-testable.

**Files:**
- Create: `src/components/Chat/wordReveal.ts`
- Test: `tests/unit/components/Chat/wordReveal.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/Chat/wordReveal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revealWords } from '../../../../src/components/Chat/wordReveal';

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('revealWords', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('wraps prose words in spans and leaves code blocks atomic', () => {
    const el = mount('<p>hello brave world</p><pre><code>const x = 1;</code></pre>');
    revealWords(el);
    expect(el.querySelectorAll('.rv-word').length).toBe(3);
    expect(el.querySelector('pre')).toBeTruthy();
    expect(el.querySelector('pre .rv-word')).toBeNull();
  });

  it('reveals every item and removes the caret after all timers run', () => {
    const el = mount('<p>one two three</p>');
    revealWords(el);
    vi.runAllTimers();
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('renders instantly (all visible, no caret) when word count exceeds maxWords', () => {
    const many = Array.from({ length: 50 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p>');
    revealWords(el, { maxWords: 10 });
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });

  it('completes within the duration budget for many words (shrunk cadence)', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'w' + i).join(' ');
    const el = mount('<p>' + many + '</p>');
    revealWords(el, { budgetMs: 200, maxWords: 100 });
    // step = floor(200/20) = 10ms; 20 items => ~200ms total. Advance with slack.
    vi.advanceTimersByTime(300);
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
  });

  it('cancel() forces the final visible state and removes the caret', () => {
    const el = mount('<p>alpha beta gamma delta</p>');
    const ctrl = revealWords(el);
    ctrl.cancel();
    el.querySelectorAll<HTMLElement>('.rv-word').forEach(w => {
      expect(w.style.opacity).toBe('1');
    });
    expect(el.querySelector('.rv-caret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `npx vitest run tests/unit/components/Chat/wordReveal.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `wordReveal`.

- [ ] **Step 3: Implement the engine**

Create `src/components/Chat/wordReveal.ts`:

```ts
// Reveal a finished assistant message's DOM word-by-word with a traveling caret,
// without reflow: every word is wrapped (opacity 0) up front so layout is final,
// then words fade in left-to-right. Code blocks / tables / images reveal as atomic
// units. Pure DOM — no React.

export interface RevealController {
  cancel(): void;
}

export interface RevealOpts {
  cadenceMs?: number; // delay between items
  snapMs?: number;    // per-item opacity transition
  budgetMs?: number;  // soft cap on total duration; shrinks cadence for long replies
  maxWords?: number;  // beyond this, render instantly (no animation)
}

// Block-level elements that should not be split into words.
const ATOMIC_TAGS = new Set(['PRE', 'TABLE', 'IMG', 'CANVAS', 'SVG', 'VIDEO']);

function collectItems(root: HTMLElement, snapMs: number): HTMLElement[] {
  const doc = root.ownerDocument;
  const items: HTMLElement[] = [];

  const walk = (node: Node) => {
    // Snapshot children: we mutate the tree (replace text nodes) while iterating.
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text.trim() === '') continue;
        const frag = doc.createDocumentFragment();
        // Keep whitespace runs as plain text; wrap non-space tokens.
        for (const part of text.split(/(\s+)/)) {
          if (part === '') continue;
          if (/^\s+$/.test(part)) {
            frag.appendChild(doc.createTextNode(part));
          } else {
            const span = doc.createElement('span');
            span.className = 'rv-word';
            span.textContent = part;
            span.style.opacity = '0';
            span.style.transition = `opacity ${snapMs}ms linear`;
            frag.appendChild(span);
            items.push(span);
          }
        }
        child.parentNode?.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (ATOMIC_TAGS.has(el.tagName)) {
          el.style.opacity = '0';
          el.style.transition = `opacity ${snapMs}ms linear`;
          items.push(el);
        } else {
          walk(el);
        }
      }
    }
  };

  walk(root);
  return items;
}

export function revealWords(container: HTMLElement, opts: RevealOpts = {}): RevealController {
  const cadenceMs = opts.cadenceMs ?? 52;
  const snapMs = opts.snapMs ?? 70;
  const budgetMs = opts.budgetMs ?? 1200;
  const maxWords = opts.maxWords ?? 600;

  const items = collectItems(container, snapMs);

  const showAll = () => { for (const el of items) el.style.opacity = '1'; };

  if (items.length === 0 || items.length > maxWords) {
    showAll();
    return { cancel() {} };
  }

  const step = Math.max(8, Math.min(cadenceMs, Math.floor(budgetMs / items.length)));

  const caret = container.ownerDocument.createElement('span');
  caret.className = 'rv-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▋';

  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    if (i >= items.length) {
      caret.remove();
      return;
    }
    const el = items[i++];
    el.style.opacity = '1';
    el.parentNode?.insertBefore(caret, el.nextSibling);
    timer = setTimeout(tick, step);
  };
  tick();

  return {
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      showAll();
      caret.remove();
    },
  };
}
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx vitest run tests/unit/components/Chat/wordReveal.test.ts --maxWorkers=2`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/wordReveal.ts tests/unit/components/Chat/wordReveal.test.ts
git commit -m "feat(ui): add wordReveal engine for assistant message reveal"
```

---

## Task 3: Remove the typewriter machinery from ChatMessage

Delete all typewriter state/effects/util and render the full markdown directly. Keep `saiAnimationPref`/`saiAnimationEnabled` and real-streaming logic intact.

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx`

- [ ] **Step 1: Remove the module-level typewriter state**

Delete the `TYPEWRITER_PROGRESS` map and its comment (around lines 26-28):

```tsx
// message survives unmount/remount (workspace swap, list re-keying) without
// replaying the typewriter from zero.
const TYPEWRITER_PROGRESS = new Map<string, number>();
```

And delete ONLY the `typewriterPref` line and its hydration (around lines 34 and 37), leaving `saiAnimationPref` intact. Remove:

```tsx
let typewriterPref = true;
```

and

```tsx
  (window as any).sai.settingsGet('typewriterEnabled', true).then((v: boolean) => { typewriterPref = v !== false; });
```

- [ ] **Step 2: Remove `snapToWordBoundary`**

Delete the whole function (around lines 44-52):

```tsx
function snapToWordBoundary(text: string, len: number): number {
  if (len >= text.length) return text.length;
  if (len <= 0) return 0;
  for (let i = len; i > 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 32 /* space */ || c === 10 /* \n */ || c === 9 /* \t */) return i;
  }
  return 0;
}
```

- [ ] **Step 3: Remove the `rawAssistantContent` / `isAssistantStreamingFlag` locals**

Delete (around lines 428-431):

```tsx
  const rawAssistantContent = (message.role === 'assistant' && typeof message.content === 'string')
    ? message.content
    : '';
  const isAssistantStreamingFlag = isStreaming && message.role === 'assistant';
```

- [ ] **Step 4: Remove the `typewriterEnabled` state + its pref listener**

Delete (around lines 432-437) — keep the `saiAnimationEnabled` block that follows it:

```tsx
  const [typewriterEnabled, setTypewriterEnabled] = useState(typewriterPref);
  useEffect(() => {
    const onPref = (e: Event) => setTypewriterEnabled(!!(e as CustomEvent).detail);
    window.addEventListener('sai-pref-typewriter', onPref);
    return () => window.removeEventListener('sai-pref-typewriter', onPref);
  }, []);
```

- [ ] **Step 5: Remove the typewriter refs and cleanup effect**

Delete the two refs (around lines 444-445):

```tsx
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenContentLenRef = useRef(0);
```

And delete the ref-cleanup effect and its comment (around lines 446-457):

```tsx
  // Null the ref alongside clearing — otherwise the typewriter effect's
  // `if (tickTimerRef.current) return` early-out treats the canceled timer ID
  // as a still-pending timer and never schedules a replacement, freezing the
  // typewriter at displayLen=0. (Surfaces in StrictMode dev: cleanup-between-
  // effect-runs cancels the just-scheduled timer; without nulling, the second
  // run bails and no tick ever fires.)
  useEffect(() => () => {
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);
```

- [ ] **Step 6: Remove `typewriterActive`, `displayLen`, and the typewriter effect**

Delete the comment + `typewriterActive` + `displayLen` state + the entire big effect (around lines 458-518), i.e. from the `// Typewriter stays active...` comment through the end of the `}, [typewriterActive, rawAssistantContent.length, displayLen, message.id]);` effect. (It is the block beginning:

```tsx
  const typewriterActive = typewriterEnabled && message.role === 'assistant' && (isAssistantStreamingFlag || TYPEWRITER_PROGRESS.has(message.id));
  const [displayLen, setDisplayLen] = useState(() => {
```

and ending at the effect's closing `}, [typewriterActive, rawAssistantContent.length, displayLen, message.id]);`.) Delete the whole span including the leading explanatory comment above `typewriterActive`.

- [ ] **Step 7: Remove the `isTyping` local**

Delete (around line 818):

```tsx
  const isTyping = typewriterActive && displayLen < rawAssistantContent.length;
```

- [ ] **Step 8: Remove the `chat-msg-typing` class toggle**

In the `motion.div` className (around line 835), change:

```tsx
      className={`chat-msg chat-msg-${message.role}${isAssistantStreaming ? ' chat-msg-streaming' : ''}${isTyping ? ' chat-msg-typing' : ''}`}
```

to:

```tsx
      className={`chat-msg chat-msg-${message.role}${isAssistantStreaming ? ' chat-msg-streaming' : ''}`}
```

- [ ] **Step 9: Render full markdown (drop the typewriter slice)**

In the ReactMarkdown children function (around lines 900-907), change:

```tsx
              >{(() => {
                const raw = typeof message.content === 'string' ? message.content : String(message.content ?? '');
                // Preserve user newlines as hard line breaks (trailing double-space)
                // so Shift+Enter in the chat input renders visually.
                if (message.role === 'user') return raw.replace(/\n/g, '  \n');
                if (typewriterActive && displayLen < rawAssistantContent.length) return raw.slice(0, snapToWordBoundary(raw, displayLen));
                return raw;
              })()}</ReactMarkdown>
```

to (remove only the typewriter slice line):

```tsx
              >{(() => {
                const raw = typeof message.content === 'string' ? message.content : String(message.content ?? '');
                // Preserve user newlines as hard line breaks (trailing double-space)
                // so Shift+Enter in the chat input renders visually.
                if (message.role === 'user') return raw.replace(/\n/g, '  \n');
                return raw;
              })()}</ReactMarkdown>
```

- [ ] **Step 10: Remove the now-dead typing-cursor CSS**

In the styled-jsx block, delete the `.chat-msg-typing` cursor rule and its `@keyframes chat-cursor-blink` + comment (around lines 942-960):

```css
        /* Typing cursor — pseudo-element on the last block of the rendered
           markdown so it sits inline at the end of the streaming text instead
           of dropping to a new line below the last paragraph. */
        .chat-msg-typing .chat-msg-body > *:last-child::after {
          content: '';
          display: inline-block;
          width: 7px;
          height: 1em;
          margin-left: 3px;
          vertical-align: -2px;
          background: var(--accent);
          border-radius: 1px;
          box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
          animation: chat-cursor-blink 1.1s ease-in-out infinite;
        }
        @keyframes chat-cursor-blink {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 1; }
        }
```

- [ ] **Step 11: Verify no dangling typewriter references**

Run: `grep -n "typewriter\|TYPEWRITER\|displayLen\|snapToWordBoundary\|isTyping\|rawAssistantContent\|chat-msg-typing\|sai-pref-typewriter" src/components/Chat/ChatMessage.tsx`
Expected: no matches.

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `useState`/`useEffect` become unused, they won't — many other hooks remain.)

- [ ] **Step 13: Run the chat tests**

Run: `npx vitest run tests/unit/components/Chat/ --maxWorkers=2`
Expected: all PASS (no test asserted typewriter behavior).

- [ ] **Step 14: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "feat(ui): remove typewriter drip from ChatMessage"
```

---

## Task 4: Wire the reveal + calm fade entrance

Add `FADE_IN`, the `.rv-*` CSS, the streamed-message tracker, and the layout-effect that runs `revealWords` once for a fresh, non-streamed, complete assistant message; swap the assistant entrance to the calm fade.

**Files:**
- Modify: `src/components/Chat/motion.ts`
- Modify: `src/styles/globals.css`
- Modify: `src/components/Chat/ChatMessage.tsx`
- Test: `tests/unit/components/Chat/ChatMessage.test.tsx`

- [ ] **Step 1: Add `FADE_IN` to motion.ts**

In `src/components/Chat/motion.ts`, after the `EASING` export (around line 14), add:

```ts
// Calm, no-overshoot entrance for assistant messages (the word reveal carries the motion).
export const FADE_IN = { duration: 0.18, ease: EASING.out } as const satisfies Transition;
```

- [ ] **Step 2: Add the reveal CSS to globals.css**

Append to `src/styles/globals.css`:

```css
/* Assistant message word-reveal (see specs/2026-06-05-assistant-message-reveal-design.md) */
.rv-word { will-change: opacity; }
.rv-caret {
  color: var(--accent);
  margin-left: 1px;
  animation: rv-caret-blink 1s steps(2) infinite;
}
@keyframes rv-caret-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .rv-caret { animation: none; }
}
```

- [ ] **Step 3: Write the failing wiring tests**

Add these tests to `tests/unit/components/Chat/ChatMessage.test.tsx` (inside its top-level `describe`). They render the real `ChatMessage`. Match the file's existing render/import style; the snippets below assume `render` from `@testing-library/react` and the default `ChatMessage` import already present in that file.

```tsx
  it('word-reveals a fresh, complete assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'r1', role: 'assistant', content: 'hello brave new world', timestamp: Date.now() }}
        projectPath="/p"
        isStreaming={false}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBeGreaterThan(0);
  });

  it('does not reveal a streaming assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'r2', role: 'assistant', content: 'partial text', timestamp: Date.now() }}
        projectPath="/p"
        isStreaming={true}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBe(0);
  });

  it('does not reveal an old (history) assistant message', () => {
    const { container } = render(
      <ChatMessage
        message={{ id: 'r3', role: 'assistant', content: 'old reply', timestamp: 1 }}
        projectPath="/p"
        isStreaming={false}
      />
    );
    expect(container.querySelectorAll('.rv-word').length).toBe(0);
  });
```

If `ChatMessage` requires additional required props in this test file, copy them from the file's existing `ChatMessage` render calls so these three compile; do not change behavior.

- [ ] **Step 4: Run the wiring tests, verify they FAIL**

Run: `npx vitest run tests/unit/components/Chat/ChatMessage.test.tsx -t "reveal" --maxWorkers=2`
Expected: FAIL — the first test finds 0 `.rv-word` (reveal not wired yet).

- [ ] **Step 5: Add imports + the streamed-message tracker**

In `src/components/Chat/ChatMessage.tsx`:

Add `useLayoutEffect` to the React import (find `import { ... } from 'react';` and include `useLayoutEffect`).

Add these imports near the other `./` imports:

```tsx
import { revealWords } from './wordReveal';
import { prefersReducedMotion } from './motion';
import { FADE_IN } from './motion';
```

(If `./motion` is already imported, add `prefersReducedMotion` and `FADE_IN` to that existing import instead of adding new lines.)

Add a module-level set near `SEEN_MESSAGES` (around line 24):

```tsx
// Records ids that streamed token-by-token this session, so their post-stream
// re-render is NOT word-revealed (the live append already showed them).
const STREAMED_MESSAGES = new Set<string>();
// A message counts as "fresh" (vs. history) if it arrived within this window.
const REVEAL_FRESH_MS = 8000;
```

- [ ] **Step 6: Mark streamed messages + change the assistant entrance**

Find (around lines 332-334):

```tsx
  const flipNodeRef = useRef<HTMLDivElement | null>(null);
  const entryTransition = useReducedMotionTransition(SPRING.pop);
  const entryDistance = DISTANCE.slide;
```

Replace with (assistant gets the calm fade + no slide; others keep the pop):

```tsx
  const flipNodeRef = useRef<HTMLDivElement | null>(null);
  const isAssistantMsg = message.role === 'assistant';
  const entryTransition = useReducedMotionTransition(isAssistantMsg ? FADE_IN : SPRING.pop);
  const entryDistance = isAssistantMsg ? 0 : DISTANCE.slide;
```

- [ ] **Step 7: Add the reveal ref + layout effect**

Add near the other refs/effects in the component body (after the `isAssistantStreaming` local is available — place the effect after line 817's `const isAssistantStreaming = ...`; declare the refs up with the other `useRef`s, e.g. just after `flipNodeRef`):

Refs (with the other refs):

```tsx
  const mdRef = useRef<HTMLDivElement | null>(null);
  const revealedRef = useRef(false);
```

Effect (place it after `const isAssistantStreaming = isStreaming && message.role === 'assistant';`, around line 817):

```tsx
  useLayoutEffect(() => {
    if (isAssistantStreaming) STREAMED_MESSAGES.add(message.id);
    if (revealedRef.current) return;
    if (message.role !== 'assistant' || isAssistantStreaming) return;
    if (!message.content) return;
    if (STREAMED_MESSAGES.has(message.id)) return;
    if (prefersReducedMotion()) return;
    if (Date.now() - (message.timestamp ?? 0) > REVEAL_FRESH_MS) return;
    const el = mdRef.current;
    if (!el) return;
    revealedRef.current = true;
    const ctrl = revealWords(el);
    return () => ctrl.cancel();
  }, [isAssistantStreaming, message.id, message.role, message.content]);
```

- [ ] **Step 8: Attach the ref to the rendered markdown**

Wrap the non-streaming `<ReactMarkdown>` in a ref'd div. Find the start of the markdown branch (around line 864):

```tsx
            ) : (
              <ReactMarkdown
```

Change it to open a wrapper div:

```tsx
            ) : (
              <div ref={mdRef} className="chat-msg-md">
              <ReactMarkdown
```

Then find the matching close of that `<ReactMarkdown>` element — the `)})()}</ReactMarkdown>` line (around line 907) followed by `)` that closes the ternary branch. Close the new wrapper div before that branch-closing paren. Concretely, change:

```tsx
              })()}</ReactMarkdown>
            )}
```

to:

```tsx
              })()}</ReactMarkdown>
              </div>
            )}
```

(There is exactly one `</ReactMarkdown>` in this file.)

- [ ] **Step 9: Run the wiring tests, verify they PASS**

Run: `npx vitest run tests/unit/components/Chat/ChatMessage.test.tsx -t "reveal" --maxWorkers=2`
Expected: all three PASS. (The fresh one finds `.rv-word` spans; streaming and old ones find none.)

- [ ] **Step 10: Run the full chat suite**

Run: `npx vitest run tests/unit/components/Chat/ --maxWorkers=2`
Expected: all PASS.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/components/Chat/motion.ts src/styles/globals.css src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(ui): crisp word-reveal + calm fade entrance for assistant messages"
```

---

## Task 5: Full-suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: whole suite PASSES (no regressions).

- [ ] **Step 2: Manual check (reload the dev app first)**

- The **"Typewriter streaming"** setting is gone from Settings.
- A **short/fast reply** reveals word-by-word with the amber caret, no line reflow.
- A **long streamed reply** appends live as before, with a **calm** entrance (no bounce).
- **Reopening an old chat** renders every message instantly (no mass reveal, no bounce).
- **Reduced motion** (`prefers-reduced-motion: reduce`) renders instantly with no caret.
- Themes Default/Midnight/Steel: the caret uses the accent and re-tints.

- [ ] **Step 3: If word-level reveal misbehaves on complex markdown**

If a reply with nested lists/links/code renders wrong (mis-wrapped words, broken links), report DONE_WITH_CONCERNS describing the markdown that broke. The documented fallback is a block-level reveal (reveal top-level block children of `mdRef` in sequence instead of words). Do not ship visibly broken markdown.

---

## Self-Review Notes

- **Spec coverage:** remove setting (Task 1) ✓; `wordReveal.ts` engine w/ atomic blocks + budget + maxWords (Task 2) ✓; remove typewriter drip / render full markdown (Task 3) ✓; calm fade entrance for assistant (Task 4 Step 6) ✓; reveal trigger = assistant + not-streaming + content + reduced-motion-off + not-streamed-this-session + fresh (Task 4 Step 7) ✓; `.rv-*` CSS + reduced-motion (Task 4 Step 2) ✓; tests for engine + wiring (Tasks 2,4) ✓; reduced-motion/history/streamed = instant (Task 4 tests + Step 7) ✓.
- **Type consistency:** `revealWords(container, opts) → { cancel() }`, `.rv-word`, `.rv-caret`, `STREAMED_MESSAGES`, `REVEAL_FRESH_MS`, `FADE_IN`, `mdRef`, `revealedRef` used consistently across tasks.
- **No placeholders:** every code step shows exact before/after; the one judgment step (Task 5 Step 3) is a conditional fallback, not a placeholder.
- **Risk note:** the only nontrivial integration is Task 4 Step 8 (wrapping `<ReactMarkdown>` and matching its close) — exact strings given; there is a single `</ReactMarkdown>` in the file.
```
