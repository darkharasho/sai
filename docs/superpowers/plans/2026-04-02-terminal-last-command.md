# @terminal:last Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@terminal:last` to attach the output from the last terminal command (from prompt line to bottom) to the AI prompt.

**Architecture:** New `getTerminalLastCommand()` function in `terminalBuffer.ts` uses prompt pattern regex to scan backwards through the xterm buffer and find the last command boundary. `ChatInput.tsx` gets new autocomplete and menu entries that call this function and attach the result as a terminal context item.

**Tech Stack:** React, TypeScript, xterm.js buffer API, Vitest

---

### Task 1: Add `getTerminalLastCommand()` with tests (TDD)

**Files:**
- Modify: `src/terminalBuffer.ts`
- Create: `tests/unit/terminalBuffer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/terminalBuffer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock xterm Terminal
function createMockTerminal(lines: string[]) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) => ({
          translateToString: () => lines[i] ?? '',
        }),
      },
    },
  };
}

// We need to mock the module internals. Import after mocking.
vi.mock('@xterm/xterm', () => ({}));

import {
  registerTerminal,
  unregisterTerminal,
  setActiveWorkspace,
  getTerminalLastCommand,
} from '../../src/terminalBuffer';

describe('getTerminalLastCommand', () => {
  beforeEach(() => {
    // Clean up any registered terminals
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('returns null when no terminals are registered', () => {
    expect(getTerminalLastCommand()).toBeNull();
  });

  it('returns content from last prompt to bottom, skipping idle prompt', () => {
    // Simulates: user ran "npm run dev", it crashed, and now they're at an idle prompt
    const lines = [
      'some older output',
      'user@host:~$ npm run dev',
      '> app@1.0.0 dev',
      '> vite',
      '',
      'Error: port 3000 already in use',
      'user@host:~$ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      'user@host:~$ npm run dev\n' +
      '> app@1.0.0 dev\n' +
      '> vite\n' +
      '\n' +
      'Error: port 3000 already in use'
    );
  });

  it('returns content from last prompt to bottom when no idle prompt', () => {
    // Simulates: command is still running or just finished with no new prompt
    const lines = [
      'some older output',
      '$ npm run dev',
      'Server started on port 3000',
      'GET / 200 OK',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '$ npm run dev\n' +
      'Server started on port 3000\n' +
      'GET / 200 OK'
    );
  });

  it('returns only the last command when multiple commands exist', () => {
    const lines = [
      '$ git status',
      'On branch main',
      '$ npm test',
      'PASS all tests',
      '$ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '$ npm test\n' +
      'PASS all tests'
    );
  });

  it('falls back to full buffer when no prompt is detected', () => {
    const lines = [
      'some random output',
      'more output',
      'no prompt here',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      'some random output\n' +
      'more output\n' +
      'no prompt here'
    );
  });

  it('handles empty buffer', () => {
    const term = createMockTerminal(['', '', '']);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    expect(getTerminalLastCommand()).toBeNull();
  });

  it('recognizes various prompt styles', () => {
    // zsh with ❯
    const lines = [
      '❯ ls -la',
      'total 42',
      'drwxr-xr-x 5 user user 4096 file.txt',
      '❯ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(2, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '❯ ls -la\n' +
      'total 42\n' +
      'drwxr-xr-x 5 user user 4096 file.txt'
    );
  });

  it('recognizes root prompt with #', () => {
    const lines = [
      '# apt update',
      'Hit:1 http://archive.ubuntu.com',
      '# ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(3, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '# apt update\n' +
      'Hit:1 http://archive.ubuntu.com'
    );
  });

  it('recognizes % prompt (csh/tcsh)', () => {
    const lines = [
      '% make build',
      'Building...',
      'Done.',
      '% ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(4, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '% make build\n' +
      'Building...\n' +
      'Done.'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/terminalBuffer.test.ts`
Expected: FAIL — `getTerminalLastCommand` is not exported

- [ ] **Step 3: Implement `getTerminalLastCommand()`**

Add to the bottom of `src/terminalBuffer.ts`:

```typescript
/**
 * Regex matching common shell prompt patterns.
 * Matches: user@host:~$, $, %, ❯, #, >, and variants with path info.
 */
const PROMPT_RE = /^(\S+[@:]\S+[\$#%>❯]|[\$#%>❯])\s/;

/**
 * Extract the output from the last terminal command.
 * Scans backwards from the bottom of the buffer to find the last prompt line.
 * If the very last non-empty line is a prompt (idle input line), skips it
 * and finds the previous prompt — that's the start of the last command.
 * Falls back to full buffer content if no prompt is detected.
 */
export function getTerminalLastCommand(maxLines = 500): string | null {
  const target = getActiveTerminal();
  if (!target) return null;

  const buf = target.buffer.active;
  const totalLines = buf.length;
  const start = Math.max(0, totalLines - maxLines);
  const lines: string[] = [];

  for (let i = start; i < totalLines; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) return null;

  // If the last non-empty line is a prompt (idle input), skip it
  let searchEnd = lines.length;
  if (PROMPT_RE.test(lines[lines.length - 1]) && lines[lines.length - 1].trim().match(/^(\S+[@:]\S+)?[\$#%>❯]$/)) {
    searchEnd = lines.length - 1;
  }

  // Scan backwards to find the last prompt line (the command)
  for (let i = searchEnd - 1; i >= 0; i--) {
    if (PROMPT_RE.test(lines[i])) {
      // Found the command prompt — return from here to searchEnd
      const result = lines.slice(i, searchEnd);
      // Trim trailing empty lines from the result
      while (result.length > 0 && result[result.length - 1].trim() === '') {
        result.pop();
      }
      return result.length > 0 ? result.join('\n') : null;
    }
  }

  // No prompt found — fall back to full content
  const result = lines.slice(0, searchEnd);
  while (result.length > 0 && result[result.length - 1].trim() === '') {
    result.pop();
  }
  return result.length > 0 ? result.join('\n') : null;
}
```

Also, extract a shared helper from `getTerminalContent` so both functions use the same terminal selection logic. Add this right before `getTerminalContent`:

```typescript
/** Find the terminal for the active workspace, or fall back to the last registered one. */
function getActiveTerminal(): Terminal | null {
  let target: Terminal | null = null;

  if (activeWorkspacePath) {
    for (const [id, term] of terminals) {
      if (terminalWorkspace.get(id) === activeWorkspacePath) {
        target = term;
      }
    }
  }

  if (!target) {
    for (const [, term] of terminals) {
      target = term;
    }
  }

  return target;
}
```

Then simplify `getTerminalContent` to use it — replace lines 30-48 with:

```typescript
  const target = getActiveTerminal();
  if (!target) return null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/terminalBuffer.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/terminalBuffer.ts tests/unit/terminalBuffer.test.ts
git commit -m "feat: add getTerminalLastCommand() with prompt detection"
```

---

### Task 2: Add `@terminal:last` to autocomplete and Add menu

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (lines 81-86 ADD_MENU_ITEMS, lines 284-291 @ autocomplete, lines 311-325 handler, lines 327-344 applySuggestion)

- [ ] **Step 1: Add the import**

In `src/components/Chat/ChatInput.tsx`, update the import from terminalBuffer (line 9):

```typescript
import { getTerminalContent, getTerminalLastCommand } from '../../terminalBuffer';
```

- [ ] **Step 2: Add to ADD_MENU_ITEMS**

In `src/components/Chat/ChatInput.tsx`, add a new entry to `ADD_MENU_ITEMS` after the existing terminal entry (after line 82):

```typescript
  { label: 'Add Last Command', value: '__TERMINAL_LAST__', description: 'Attach output from last terminal command', icon: <Clock size={14} /> },
```

Note: `Clock` is already imported from lucide-react at line 7.

- [ ] **Step 3: Add to @ autocomplete suggestions**

In the `@` autocomplete section (around line 284-291), add `@terminal:last` alongside `@terminal`. Replace the existing block:

```typescript
    if (currentWord.startsWith('@') && currentWord.length > 1) {
      const query = currentWord.slice(1);
      const atItems: AutocompleteItem[] = [];
      if ('terminal'.startsWith(query)) {
        atItems.push({ label: '@terminal', value: '__TERMINAL__', description: 'Attach terminal output', icon: <TerminalIcon size={14} /> });
      }
      if ('terminal:last'.startsWith(query)) {
        atItems.push({ label: '@terminal:last', value: '__TERMINAL_LAST__', description: 'Attach output from last terminal command', icon: <Clock size={14} /> });
      }
      setSuggestions(atItems);
      setSelectedIndex(0);
```

- [ ] **Step 4: Add `handleAddTerminalLast` handler**

Add after the existing `handleAddTerminal` function (after line 325):

```typescript
  const handleAddTerminalLast = () => {
    const content = getTerminalLastCommand();
    if (content) {
      setContextItems(prev => {
        const filtered = prev.filter(c => c.type !== 'terminal');
        const lines = content.split('\n').length;
        return [...filtered, {
          label: `Terminal: last cmd (${lines} lines)`,
          type: 'terminal',
          data: content,
        }];
      });
    }
  };
```

- [ ] **Step 5: Wire up in `applySuggestion`**

In `applySuggestion` (around line 327), add a handler for `__TERMINAL_LAST__` right after the `__TERMINAL__` block (after line 344):

```typescript
    if (item.value === '__TERMINAL_LAST__') {
      if (!showAddMenu) {
        const cursorPos = textareaRef.current?.selectionStart ?? value.length;
        const textBeforeCursor = value.slice(0, cursorPos);
        const lastSpace = textBeforeCursor.lastIndexOf(' ');
        const lastNewline = textBeforeCursor.lastIndexOf('\n');
        const wordStart = Math.max(lastSpace, lastNewline) + 1;
        const before = value.slice(0, wordStart);
        const after = value.slice(cursorPos);
        setValue((before + after).trim() ? before + after : '');
      }
      handleAddTerminalLast();
      setSuggestions([]);
      setShowAddMenu(false);
      setSlashMenuOpen(false);
      return;
    }
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx`
Expected: PASS (all existing tests)

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat: add @terminal:last to autocomplete and add menu"
```

---

### Task 3: Add ChatInput tests for @terminal:last autocomplete

**Files:**
- Modify: `tests/unit/components/Chat/ChatInput.test.tsx`

- [ ] **Step 1: Add tests for @terminal:last autocomplete**

Add to the existing describe block in `tests/unit/components/Chat/ChatInput.test.tsx`:

```typescript
  describe('@terminal:last autocomplete', () => {
    it('shows @terminal:last suggestion when typing @t', async () => {
      render(<ChatInput {...defaultProps} slashCommands={STABLE_SLASH_COMMANDS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@t' } });
      // Both @terminal and @terminal:last should appear
      expect(await screen.findByText('@terminal')).toBeTruthy();
      expect(await screen.findByText('@terminal:last')).toBeTruthy();
    });

    it('shows only @terminal:last when typing @terminal:', async () => {
      render(<ChatInput {...defaultProps} slashCommands={STABLE_SLASH_COMMANDS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@terminal:' } });
      expect(await screen.findByText('@terminal:last')).toBeTruthy();
      // @terminal should NOT match since 'terminal:' doesn't start 'terminal'
      expect(screen.queryByText('@terminal')).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/components/Chat/ChatInput.test.tsx`
Expected: PASS (all tests including new ones)

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/Chat/ChatInput.test.tsx
git commit -m "test: add @terminal:last autocomplete tests"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Run dev server and verify**

Run: `npm run dev`

Verify:
1. Type `@t` in chat input — both `@terminal` and `@terminal:last` appear in dropdown
2. Type `@terminal:l` — only `@terminal:last` appears
3. Select `@terminal:last` — context chip shows "Terminal: last cmd (N lines)"
4. Click the Add (+) button — "Add Last Command" appears in menu
5. Open a terminal, run a command (e.g., `echo hello`), wait for it to finish
6. Use `@terminal:last` — should capture from the `echo hello` prompt line down
7. Verify the chip replaces any existing terminal context

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit if cleanup needed**

```bash
git add -A
git commit -m "feat: @terminal:last command output capture"
```
