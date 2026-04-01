# Chat Input Autocorrect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an autocorrect system to the chat textarea that detects misspelled words via Electron's built-in spellcheck, shows a suggestion pill, auto-applies on delimiter keys, highlights corrections, and offers undo.

**Architecture:** A new `useAutocorrect` hook encapsulates all spellcheck logic, exposed via IPC from the preload (since `webFrame` is not available in the renderer due to context isolation). ChatInput wires up the hook, renders the pill/undo UI inline, and extends its `handleKeyDown` to intercept delimiter keys.

**Tech Stack:** Electron 36 (Chromium spellcheck + `webFrame.getWordSuggestions`), React 19, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/preload.ts` | Modify | Expose `spellSuggest(word)` via IPC bridge using `webFrame.getWordSuggestions` |
| `src/hooks/useAutocorrect.ts` | Create | Hook: debounced word extraction, skip rules, suggestion state, apply/dismiss/undo |
| `src/components/Chat/ChatInput.tsx` | Modify | Wire hook, render pill + highlight overlay, extend `handleKeyDown` |

---

### Task 1: Expose Spellcheck Suggestions via Preload

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add webFrame import and spellSuggest to preload bridge**

In `electron/preload.ts`, add `webFrame` to the import and expose a `spellSuggest` method:

```typescript
// At the top, change the import:
import { contextBridge, ipcRenderer, webFrame } from 'electron';

// Inside the contextBridge.exposeInMainWorld('sai', { ... }) object, add:
  spellSuggest: (word: string): string[] => {
    return webFrame.getWordSuggestions(word);
  },
```

Add it after the `openExternal` line (line 106).

- [ ] **Step 2: Verify the preload compiles**

Run:
```bash
npx tsc --noEmit electron/preload.ts
```

If `getWordSuggestions` is not on the `webFrame` type in Electron 36, fall back to using `session.listWordsInSpellCheckerDictionary` via IPC. But it should exist — it was added in Electron 8.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(autocorrect): expose spellSuggest via preload bridge"
```

---

### Task 2: Create the useAutocorrect Hook — Core State and Skip Logic

**Files:**
- Create: `src/hooks/useAutocorrect.ts`

- [ ] **Step 1: Create the hook file with types and skip-rule helpers**

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';

export interface AutocorrectState {
  suggestion: string | null;
  original: string | null;
  wordStart: number;
  wordEnd: number;
  undoAvailable: boolean;
  undoOriginal: string | null;
  undoCorrected: string | null;
  undoWordStart: number;
  undoWordEnd: number;
}

const SKIP_PREFIXES = ['/', '@', '#'];
const DELIMITERS = new Set([' ', '.', ',', ';', ':', '!', '?']);


function shouldSkipWord(word: string, fullText: string, wordStart: number): boolean {
  if (!word || word.length < 2) return true;
  if (SKIP_PREFIXES.some(p => word.startsWith(p))) return true;
  if (word.includes('.') || word.includes('/')) return true;

  // Check if inside backtick region
  const textBefore = fullText.slice(0, wordStart);
  const backtickCount = (textBefore.match(/`/g) || []).length;
  if (backtickCount % 2 !== 0) return true;

  return false;
}

function extractCompletedWord(
  value: string,
  prevValue: string,
  cursorPos: number
): { word: string; start: number; end: number } | null {
  // A word is "completed" when a delimiter is typed after it
  if (value.length <= prevValue.length) return null;
  const newChar = value[cursorPos - 1];
  if (!newChar || !DELIMITERS.has(newChar)) return null;

  // Scan backward from just before the delimiter to find the word
  const end = cursorPos - 1;
  let start = end;
  while (start > 0 && value[start - 1] !== ' ' && value[start - 1] !== '\n' && !DELIMITERS.has(value[start - 1])) {
    start--;
  }
  const word = value.slice(start, end);
  if (!word) return null;

  return { word, start, end };
}

export function useAutocorrect(
  value: string,
  cursorPosition: number,
  isAutocompleteActive: boolean
) {
  const [state, setState] = useState<AutocorrectState>({
    suggestion: null,
    original: null,
    wordStart: 0,
    wordEnd: 0,
    undoAvailable: false,
    undoOriginal: null,
    undoCorrected: null,
    undoWordStart: 0,
    undoWordEnd: 0,
  });

  const prevValueRef = useRef(value);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Check for completed words on value change
  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;

    if (isAutocompleteActive) return;

    const completed = extractCompletedWord(value, prev, cursorPosition);
    if (!completed) return;
    if (shouldSkipWord(completed.word, value, completed.start)) return;

    // Call Electron's spellcheck via preload bridge
    const sai = (window as any).sai;
    if (!sai?.spellSuggest) return;

    const suggestions: string[] = sai.spellSuggest(completed.word);
    if (suggestions.length === 0) {
      // Word is spelled correctly or unknown — no suggestion
      return;
    }

    // Show pill with top suggestion
    setState(s => ({
      ...s,
      suggestion: suggestions[0],
      original: completed.word,
      wordStart: completed.start,
      wordEnd: completed.end,
    }));

    // Auto-dismiss after 5 seconds
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setState(s => s.original === completed.word ? { ...s, suggestion: null, original: null } : s);
    }, 5000);
  }, [value, cursorPosition, isAutocompleteActive]);

  const applySuggestion = useCallback((): string | null => {
    if (!state.suggestion || !state.original) return null;

    const before = value.slice(0, state.wordStart);
    const after = value.slice(state.wordEnd);
    const newValue = before + state.suggestion + after;

    // Store undo info and clear suggestion
    const undoOriginal = state.original;
    const undoCorrected = state.suggestion;
    const undoStart = state.wordStart;
    const undoEnd = state.wordStart + state.suggestion.length;

    setState({
      suggestion: null,
      original: null,
      wordStart: 0,
      wordEnd: 0,
      undoAvailable: true,
      undoOriginal,
      undoCorrected,
      undoWordStart: undoStart,
      undoWordEnd: undoEnd,
    });

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);

    // Auto-dismiss undo after 4 seconds
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setState(s => ({ ...s, undoAvailable: false, undoOriginal: null, undoCorrected: null }));
    }, 4000);

    return newValue;
  }, [state, value]);

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setState(s => ({ ...s, suggestion: null, original: null }));
  }, []);

  const undo = useCallback((): string | null => {
    if (!state.undoAvailable || !state.undoOriginal) return null;

    const before = value.slice(0, state.undoWordStart);
    const after = value.slice(state.undoWordEnd);
    const newValue = before + state.undoOriginal + after;

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setState(s => ({
      ...s,
      undoAvailable: false,
      undoOriginal: null,
      undoCorrected: null,
    }));

    return newValue;
  }, [state, value]);

  return { state, applySuggestion, dismiss, undo };
}
```

- [ ] **Step 2: Verify the hook compiles**

Run:
```bash
npx tsc --noEmit src/hooks/useAutocorrect.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAutocorrect.ts
git commit -m "feat(autocorrect): add useAutocorrect hook with skip rules and undo"
```

---

### Task 3: Wire the Hook into ChatInput — Pill UI

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

- [ ] **Step 1: Import the hook**

At the top of `ChatInput.tsx`, add:

```typescript
import { useAutocorrect } from '../../hooks/useAutocorrect';
import { X } from 'lucide-react';
```

Note: `X` may already be imported from lucide-react. Check the existing import — if not present, add it.

- [ ] **Step 2: Call the hook inside the ChatInput component**

Inside the `ChatInput` function, after the existing state declarations (after line ~222), add:

```typescript
  const cursorPosRef = useRef(0);
  const isAutocompleteActive = suggestions.length > 0 || showAddMenu || slashMenuOpen;
  const { state: autocorrectState, applySuggestion: applyAutocorrect, dismiss: dismissAutocorrect, undo: undoAutocorrect } = useAutocorrect(
    value,
    cursorPosRef.current,
    isAutocompleteActive
  );
```

- [ ] **Step 3: Track cursor position**

Update the textarea `onChange` handler (line ~608) to also track cursor position:

```typescript
onChange={(e) => {
  setValue(e.target.value);
  cursorPosRef.current = e.target.selectionStart ?? e.target.value.length;
  setSlashMenuOpen(false);
}}
```

Also track it on `onSelect` for the textarea — add this prop to the `<textarea>`:

```typescript
onSelect={(e) => {
  cursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart ?? 0;
}}
```

- [ ] **Step 4: Render the autocorrect pill**

Inside the JSX, between the context-row section (line ~578) and the ApprovalPanel section (line ~581), add the autocorrect pill:

```tsx
      {/* Autocorrect suggestion pill */}
      {autocorrectState.suggestion && (
        <div className="autocorrect-pill" style={{ animation: 'autocorrectSlideUp 0.15s ease-out' }}>
          <span className="autocorrect-suggestion">{autocorrectState.suggestion}</span>
          <button className="autocorrect-dismiss" onClick={dismissAutocorrect}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Autocorrect undo pill */}
      {autocorrectState.undoAvailable && !autocorrectState.suggestion && (
        <div className="autocorrect-pill autocorrect-undo" style={{ animation: 'autocorrectSlideUp 0.15s ease-out' }}>
          <span className="autocorrect-undo-text">"{autocorrectState.undoOriginal}"</span>
          <button className="autocorrect-undo-btn" onClick={() => {
            const newVal = undoAutocorrect();
            if (newVal !== null) setValue(newVal);
          }}>
            Undo
          </button>
        </div>
      )}
```

- [ ] **Step 5: Add pill CSS**

In the `<style>` tag at the bottom of ChatInput.tsx, add after the `.context-remove` styles:

```css
        .autocorrect-pill {
          position: absolute;
          bottom: 100%;
          left: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px 3px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 12px;
          font-size: 12px;
          color: var(--text);
          z-index: 5;
          margin-bottom: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .autocorrect-suggestion {
          color: var(--accent);
          font-weight: 500;
        }
        .autocorrect-dismiss {
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          border-radius: 50%;
          line-height: 1;
        }
        .autocorrect-dismiss:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .autocorrect-undo {
          gap: 8px;
        }
        .autocorrect-undo-text {
          color: var(--text-secondary);
          font-style: italic;
        }
        .autocorrect-undo-btn {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          font-size: 12px;
          padding: 1px 4px;
          border-radius: 3px;
        }
        .autocorrect-undo-btn:hover {
          background: var(--bg-hover);
          color: var(--accent-hover);
        }
        @keyframes autocorrectSlideUp {
          0% { transform: translateY(4px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
```

- [ ] **Step 6: Ensure input-box has relative positioning for the pill**

The `.input-box` style needs `position: relative` for the absolute pill to anchor correctly. Check if it already has it; if not, add it. Look for `.input-box {` in the `<style>` tag and add `position: relative;`.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat(autocorrect): render suggestion and undo pills in ChatInput"
```

---

### Task 4: Wire Up Keyboard Handling for Auto-Apply

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`

- [ ] **Step 1: Add autocorrect key handling to handleKeyDown**

In the `handleKeyDown` function (starts at line ~369), add autocorrect handling **after** the autocomplete block (after the `if (items.length > 0) { ... }` block which ends around line 380) but **before** the Tab completion block (line ~382):

```typescript
    // Autocorrect: Escape dismisses, Enter applies then sends
    if (autocorrectState.suggestion) {
      if (e.key === 'Escape') {
        dismissAutocorrect();
        return;
      }
    }
```

Note: We do NOT intercept space/punctuation in `handleKeyDown` because the hook's `useEffect` already detects completed words reactively when the value changes after a delimiter is typed. The auto-apply happens through the `useEffect` in the hook itself.

However, for **Enter** (which sends the message), we need to apply the correction first. Modify the Enter-to-send block (line ~448):

```typescript
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      let sendValue = value;
      // Apply pending autocorrect before sending
      if (autocorrectState.suggestion) {
        const corrected = applyAutocorrect();
        if (corrected !== null) sendValue = corrected;
      }
      if (sendValue.trim()) {
        setHistory(prev => {
          const trimmed = sendValue.trim();
          if (prev[prev.length - 1] === trimmed) return prev;
          return [...prev, trimmed];
        });
        setHistoryIndex(-1);
        draftRef.current = '';
        const images = contextItems.filter(c => c.type === 'image' && c.data).map(c => c.data!);
        onSend(buildMessage(sendValue.trim()), images.length > 0 ? images : undefined);
        setValue('');
        setContextItems([]);
        setSuggestions([]);
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat(autocorrect): wire up keyboard handling for auto-apply on Enter"
```

---

### Task 5: Add Correction Highlight Overlay

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`
- Modify: `src/hooks/useAutocorrect.ts`

- [ ] **Step 1: Add highlight state to the hook**

In `src/hooks/useAutocorrect.ts`, add highlight tracking to `AutocorrectState`:

```typescript
export interface AutocorrectState {
  suggestion: string | null;
  original: string | null;
  wordStart: number;
  wordEnd: number;
  undoAvailable: boolean;
  undoOriginal: string | null;
  undoCorrected: string | null;
  undoWordStart: number;
  undoWordEnd: number;
  highlightWord: string | null;
  highlightStart: number;
  highlightEnd: number;
}
```

Update the initial state to include:
```typescript
  highlightWord: null,
  highlightStart: 0,
  highlightEnd: 0,
```

In the `applySuggestion` callback, set the highlight when applying:

```typescript
    setState({
      suggestion: null,
      original: null,
      wordStart: 0,
      wordEnd: 0,
      undoAvailable: true,
      undoOriginal,
      undoCorrected,
      undoWordStart: undoStart,
      undoWordEnd: undoEnd,
      highlightWord: undoCorrected,
      highlightStart: undoStart,
      highlightEnd: undoEnd,
    });
```

Add a timer to clear the highlight after 800ms — add a `highlightTimerRef`:

```typescript
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

In `applySuggestion`, after setting state, start the timer:

```typescript
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setState(s => ({ ...s, highlightWord: null }));
    }, 800);
```

Clean up on unmount:
```typescript
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
```

- [ ] **Step 2: Render the highlight overlay in ChatInput**

In `ChatInput.tsx`, inside the `.input-box` div, add a highlight overlay **before** the textarea:

```tsx
        {/* Autocorrect highlight overlay */}
        {autocorrectState.highlightWord && (
          <div
            className="autocorrect-highlight-overlay"
            aria-hidden="true"
          >
            <span className="highlight-text-transparent">
              {value.slice(0, autocorrectState.highlightStart)}
            </span>
            <span className="highlight-mark">
              {value.slice(autocorrectState.highlightStart, autocorrectState.highlightEnd)}
            </span>
            <span className="highlight-text-transparent">
              {value.slice(autocorrectState.highlightEnd)}
            </span>
          </div>
        )}
```

- [ ] **Step 3: Add highlight CSS**

In the `<style>` tag:

```css
        .autocorrect-highlight-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          line-height: 17px;
          white-space: pre-wrap;
          word-wrap: break-word;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .highlight-text-transparent {
          color: transparent;
        }
        .highlight-mark {
          color: transparent;
          background: var(--accent);
          opacity: 0.2;
          border-radius: 2px;
          animation: highlightFade 0.8s ease-out forwards;
        }
        @keyframes highlightFade {
          0% { opacity: 0.25; }
          100% { opacity: 0; }
        }
```

Ensure the `.input-box` has `position: relative;` and the textarea has `position: relative; z-index: 1;` so text sits above the overlay.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAutocorrect.ts src/components/Chat/ChatInput.tsx
git commit -m "feat(autocorrect): add correction highlight overlay with fade animation"
```

---

### Task 6: Manual Testing and Polish

**Files:**
- Possibly modify: `src/components/Chat/ChatInput.tsx`, `src/hooks/useAutocorrect.ts`

- [ ] **Step 1: Start the dev server**

Run:
```bash
npm run dev
```

- [ ] **Step 2: Test basic autocorrect flow**

1. Type a misspelled word (e.g., "teh ") in the chat input
2. Verify the pill appears above the textarea with the suggestion (e.g., "the")
3. Type another space or any character — verify the suggestion was applied to the text
4. Verify the corrected word briefly highlights
5. Verify the undo pill appears for ~4 seconds
6. Click "Undo" — verify the original misspelling is restored

- [ ] **Step 3: Test skip rules**

1. Type `/commit ` — verify NO autocorrect pill
2. Type `@terminal ` — verify NO pill
3. Type `src/components/foo ` — verify NO pill (contains dots/slashes)
4. Type `` `teh` `` — verify NO pill (inside backticks)

- [ ] **Step 4: Test interaction with autocomplete**

1. Type `/he` — verify autocomplete dropdown shows, NO autocorrect pill
2. Select a command with Enter/Tab — verify it works normally
3. Type `@t` — verify autocomplete works normally

- [ ] **Step 5: Test Enter-to-send with correction**

1. Type "teh" and wait for pill to appear
2. Press Enter — verify the corrected text is sent (not the misspelling)

- [ ] **Step 6: Test dismiss**

1. Type a misspelled word, wait for pill
2. Click the X button — verify pill disappears
3. Type a misspelled word, wait for pill
4. Press Escape — verify pill disappears

- [ ] **Step 7: Fix any issues found during testing**

Address any visual or behavioral issues. Common things to check:
- Pill positioning (not overlapping other elements)
- Highlight overlay alignment with textarea text
- Timer cleanup on rapid typing

- [ ] **Step 8: Commit**

```bash
git add -u
git commit -m "fix(autocorrect): polish from manual testing"
```

---

### Task 7: Handle Edge Case — Auto-Apply on Delimiter Keys

**Files:**
- Modify: `src/hooks/useAutocorrect.ts`

The current hook detects completed words and shows suggestions, but doesn't auto-replace on the next delimiter. The spec says the pill should auto-apply when the user presses space/enter/tab/punctuation while a suggestion is visible.

- [ ] **Step 1: Add auto-apply logic to the value change effect**

In the `useEffect` that watches `value`, add a check at the beginning: if a suggestion is currently showing and a delimiter was just typed, apply the correction:

```typescript
  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;

    if (isAutocompleteActive) return;

    // Auto-apply: if suggestion is visible and user typed a delimiter
    if (state.suggestion && state.original && value.length > prev.length) {
      const newChar = value[cursorPosition - 1];
      if (newChar && (DELIMITERS.has(newChar) || newChar === '\t')) {
        // The user typed a delimiter while pill was showing — apply correction
        const before = value.slice(0, state.wordStart);
        const after = value.slice(state.wordEnd);
        // The delimiter is already in `value` after the original word,
        // so we need to reconstruct: before + correction + everything after the original word
        const correctedValue = before + state.suggestion + value.slice(state.wordEnd);

        const undoOriginal = state.original;
        const undoCorrected = state.suggestion;
        const undoStart = state.wordStart;
        const undoEnd = state.wordStart + state.suggestion.length;

        setState({
          suggestion: null,
          original: null,
          wordStart: 0,
          wordEnd: 0,
          undoAvailable: true,
          undoOriginal,
          undoCorrected,
          undoWordStart: undoStart,
          undoWordEnd: undoEnd,
          highlightWord: undoCorrected,
          highlightStart: undoStart,
          highlightEnd: undoEnd,
        });

        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setState(s => ({ ...s, highlightWord: null }));
        }, 800);
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
          setState(s => ({ ...s, undoAvailable: false, undoOriginal: null, undoCorrected: null }));
        }, 4000);

        onValueChange(correctedValue);
        return;
      }
    }

    // Below this point, keep the existing word detection logic from Task 2
    // (extractCompletedWord, shouldSkipWord, spellSuggest, setState, dismiss timer)
    const completed = extractCompletedWord(value, prev, cursorPosition);
    if (!completed) return;
    if (shouldSkipWord(completed.word, value, completed.start)) return;

    const sai = (window as any).sai;
    if (!sai?.spellSuggest) return;

    const suggestions: string[] = sai.spellSuggest(completed.word);
    if (suggestions.length === 0) return;

    setState(s => ({
      ...s,
      suggestion: suggestions[0],
      original: completed.word,
      wordStart: completed.start,
      wordEnd: completed.end,
    }));

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setState(s => s.original === completed.word ? { ...s, suggestion: null, original: null } : s);
    }, 5000);
  }, [value, cursorPosition, isAutocompleteActive, state.suggestion, state.original]);
```

**Important design note:** Since `useEffect` can't directly modify parent state, we need to use an `onAutoApply` callback. Refactor the hook signature:

```typescript
export function useAutocorrect(
  value: string,
  cursorPosition: number,
  isAutocompleteActive: boolean,
  onValueChange: (newValue: string) => void
)
```

In the auto-apply branch, call `onValueChange(correctedValue)` instead of returning.

In ChatInput, pass `setValue` as the callback:

```typescript
const { state: autocorrectState, applySuggestion: applyAutocorrect, dismiss: dismissAutocorrect, undo: undoAutocorrect } = useAutocorrect(
  value,
  cursorPosRef.current,
  isAutocompleteActive,
  setValue
);
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAutocorrect.ts src/components/Chat/ChatInput.tsx
git commit -m "feat(autocorrect): auto-apply suggestion on delimiter keys via callback"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

- [ ] **Step 2: Run the dev build**

```bash
npm run dev
```

- [ ] **Step 3: End-to-end smoke test**

Repeat the manual tests from Task 6 to verify everything works together after the auto-apply refactor.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -u
git commit -m "fix(autocorrect): final polish"
```
