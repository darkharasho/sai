# Chat Input Autocorrect

## Overview

Add an autocorrect feature to the chat textarea that detects misspelled words, shows a suggestion pill above the input, and auto-applies corrections on delimiter keys. Mimics modern mobile/desktop autocorrect behavior with brief highlight feedback and an undo option.

## Detection

- Use Electron's built-in spellcheck via `webFrame.getWordSuggestions(word)` in the renderer process. No additional dependencies or IPC needed.
- On input change, after a ~150ms debounce, extract the word the cursor just completed (triggered by space, punctuation, etc.).
- A word is "completed" when the user types a space, enter, tab, or punctuation after it.
- Only check completed words, not the word actively being typed.

### Skip Rules

Do not spell-check words that:
- Start with `/` (slash commands)
- Start with `@` (mentions)
- Start with `#` (tags)
- Contain dots or slashes (file paths, URLs)
- Are inside backtick-delimited regions

## Pill UI

### Appearance

- Small pill/chip positioned above the textarea, left-aligned to the input.
- Shows: suggested correction text + `X` dismiss button (Lucide `X` icon, matching existing context chip pattern).
- Styled with existing CSS variables: `--bg-elevated` background, `--border` border, `--text` for suggestion text, `--accent` subtle highlight on the correction.
- Slide-up entrance animation (similar to existing `approvalSlideUp` keyframe).

### Behavior

- Appears when a completed word has a spelling suggestion.
- Disappears when:
  - User clicks `X` to dismiss
  - Correction is auto-applied
  - User manually fixes the word
  - User keeps typing and moves past it (~5 second timeout)
- Only one pill visible at a time.

### Layout

- Rendered inside the existing textarea wrapper div, positioned above the textarea but below the context chips row.
- Uses absolute positioning above the textarea — does not shift the textarea or other elements.

## Auto-Apply

### Triggers

When the pill is visible and the user presses **space**, **enter**, **tab**, or punctuation (`. , ; : ! ?`):
- Replace the misspelled word in the textarea value with the suggested correction.
- Preserve the original word's start/end index and splice the correction in.
- **Escape** dismisses the suggestion (same as clicking `X`).

### Interaction with Existing Systems

- When the autocomplete dropdown (slash commands, @mentions) is active, autocorrect is **suppressed** — no pill, no auto-apply.
- Enter key priority: if autocomplete is open, Enter selects the autocomplete item. If only the autocorrect pill is showing, Enter auto-applies the correction AND sends the message (correction applied first).

## Feedback After Correction

### Brief Highlight

- After auto-applying, the corrected word gets a momentary background highlight.
- Implemented via a transparent overlay `<div>` behind the textarea that mirrors its text layout, with a highlight span at the corrected word's position.
- Uses `--accent` at low opacity, fades out over ~800ms.

### Undo Pill

- After auto-applying, the autocorrect pill transforms into an undo pill showing: `"[original]" — Undo`.
- Clicking "Undo" replaces the correction with the original misspelled word.
- The undo pill auto-dismisses after ~4 seconds.
- Only the most recent correction is undoable (one level of undo).

## Architecture

### New Hook: `useAutocorrect`

Located at `src/hooks/useAutocorrect.ts`.

```typescript
interface AutocorrectState {
  suggestion: string | null;       // current suggested correction
  original: string | null;         // the misspelled word
  wordStart: number;               // start index in textarea value
  wordEnd: number;                 // end index in textarea value
  undoAvailable: boolean;          // show undo pill?
  undoOriginal: string | null;     // original word before last correction
}

function useAutocorrect(
  value: string,
  cursorPosition: number,
  isAutocompleteActive: boolean
): {
  state: AutocorrectState;
  applySuggestion: () => string;   // returns new value with correction
  dismiss: () => void;
  undo: () => string;              // returns new value with undo
}
```

### Integration with ChatInput

- `useAutocorrect` is called inside `ChatInput`, fed the current `value`, cursor position, and whether autocomplete is active.
- `handleKeyDown` is extended: before existing key handlers, check if autocorrect pill is visible and handle space/enter/tab/escape/punctuation accordingly.
- `applySuggestion()` returns the new textarea value; ChatInput calls `setValue()` with it.
- Pill JSX and styles live inline in `ChatInput.tsx`, matching the existing pattern.
- Highlight overlay is rendered as a sibling of the textarea inside the existing wrapper div.

### New Files

| File | Purpose |
|------|---------|
| `src/hooks/useAutocorrect.ts` | Autocorrect logic hook |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/Chat/ChatInput.tsx` | Wire up hook, render pill + highlight overlay, extend `handleKeyDown` |
