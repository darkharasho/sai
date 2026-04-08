# Chat History Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat history dropdown with a full NavBar sidebar featuring search, session management, smarter titles, and richer session cards.

**Architecture:** New `ChatHistorySidebar` component follows the existing sidebar pattern (Files/Git). Data model adds `pinned` and `titleEdited` fields to `ChatSession`. Smart title truncation replaces naive first-40-chars. Context menu provides rename/pin/export/delete. Full-text search loads and caches session messages on demand.

**Tech Stack:** React, TypeScript, Vitest, lucide-react icons, localStorage

---

### Task 1: Data Model — Add `pinned` and `titleEdited` to ChatSession

**Files:**
- Modify: `src/types.ts:10-18`
- Modify: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Update ChatSession type**

In `src/types.ts`, add the two new optional fields to the `ChatSession` interface:

```typescript
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  claudeSessionId?: string;
  pinned?: boolean;
  titleEdited?: boolean;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run tests/unit/sessions.test.ts`
Expected: All existing tests pass (new optional fields don't break anything).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add pinned and titleEdited fields to ChatSession"
```

---

### Task 2: Smart Title Truncation in sessions.ts

**Files:**
- Modify: `src/sessions.ts`
- Modify: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Write tests for smart title generation**

Add to `tests/unit/sessions.test.ts`:

```typescript
import { generateSmartTitle } from '@/sessions';

describe('generateSmartTitle', () => {
  it('strips "can you" prefix', () => {
    expect(generateSmartTitle('Can you fix the border?')).toBe('Fix the border?');
  });

  it('strips "could you" prefix', () => {
    expect(generateSmartTitle('Could you help me debug this?')).toBe('Help me debug this?');
  });

  it('strips "would you" prefix', () => {
    expect(generateSmartTitle('Would you refactor this function?')).toBe('Refactor this function?');
  });

  it('strips "please" prefix', () => {
    expect(generateSmartTitle('Please update the config')).toBe('Update the config');
  });

  it('strips "help me" prefix', () => {
    expect(generateSmartTitle('help me fix the auth bug')).toBe('Fix the auth bug');
  });

  it('strips "I need to" prefix', () => {
    expect(generateSmartTitle('I need to implement a sidebar')).toBe('Implement a sidebar');
  });

  it('strips "I want to" prefix', () => {
    expect(generateSmartTitle('I want to add dark mode')).toBe('Add dark mode');
  });

  it('strips "let\'s" prefix', () => {
    expect(generateSmartTitle("let's build a command palette")).toBe('Build a command palette');
  });

  it('strips "let me" prefix', () => {
    expect(generateSmartTitle('let me see the logs')).toBe('See the logs');
  });

  it('strips "we need to" prefix', () => {
    expect(generateSmartTitle('we need to fix the tests')).toBe('Fix the tests');
  });

  it('strips "we should" prefix', () => {
    expect(generateSmartTitle('we should refactor this')).toBe('Refactor this');
  });

  it('strips multiple chained prefixes', () => {
    expect(generateSmartTitle('Can you please help me fix this?')).toBe('Fix this?');
  });

  it('capitalizes first letter after stripping', () => {
    expect(generateSmartTitle('can you fix it')).toBe('Fix it');
  });

  it('truncates to 40 characters', () => {
    const long = 'Fix ' + 'a'.repeat(50);
    expect(generateSmartTitle(long).length).toBeLessThanOrEqual(40);
  });

  it('returns original text when no prefix matches', () => {
    expect(generateSmartTitle('Fix the border on code blocks')).toBe('Fix the border on code blocks');
  });

  it('returns empty string for empty input', () => {
    expect(generateSmartTitle('')).toBe('');
  });

  it('handles whitespace-only input', () => {
    expect(generateSmartTitle('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sessions.test.ts`
Expected: FAIL — `generateSmartTitle` is not exported from `@/sessions`.

- [ ] **Step 3: Implement generateSmartTitle**

Add to `src/sessions.ts` before the `createSession` function:

```typescript
const FILLER_PREFIXES = [
  'can you ', 'could you ', 'would you ',
  'please ', 'help me ', 'i need to ', 'i want to ',
  "let's ", 'let me ', 'we need to ', 'we should ',
];

export function generateSmartTitle(text: string): string {
  let result = text.trim();
  if (!result) return '';

  // Strip filler prefixes repeatedly (handles "can you please help me...")
  let changed = true;
  while (changed) {
    changed = false;
    const lower = result.toLowerCase();
    for (const prefix of FILLER_PREFIXES) {
      if (lower.startsWith(prefix)) {
        result = result.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }

  if (!result) return '';

  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  // Truncate to 40 chars
  if (result.length > 40) {
    result = result.slice(0, 40);
  }

  return result;
}
```

- [ ] **Step 4: Update upsertSession to use generateSmartTitle**

In `src/sessions.ts`, replace the title-setting block in `upsertSession`:

```typescript
  // Set title from first user message if not set
  if (!session.title) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      session.title = generateSmartTitle(firstUserMsg.content);
    }
  }
```

- [ ] **Step 5: Update existing title tests to expect smart truncation**

In `tests/unit/sessions.test.ts`, update the auto-title test:

```typescript
  it('auto-sets title from first user message using smart truncation', () => {
    const session = makeSession({
      title: '',
      messages: [makeMessage({ role: 'user', content: 'Can you help me fix the meaning of life?' })],
    });
    const result = upsertSession([], session);
    expect(result[0].title).toBe('Fix the meaning of life?');
  });
```

Also update the "truncates auto-generated title to 40 characters" test — it uses raw `'A'.repeat(60)` which has no prefix to strip, so it still works. No change needed.

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run tests/unit/sessions.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sessions.ts tests/unit/sessions.test.ts
git commit -m "feat(sessions): add smart title truncation that strips filler prefixes"
```

---

### Task 3: Session Helper Functions — pin, delete, export

**Files:**
- Modify: `src/sessions.ts`
- Modify: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Write tests for pin/unpin, delete, and export helpers**

Add to `tests/unit/sessions.test.ts`:

```typescript
import {
  createSession,
  loadSessions,
  saveSessions,
  loadSessionMessages,
  saveSessionMessages,
  upsertSession,
  formatSessionDate,
  formatSessionTime,
  migrateLegacySessions,
  generateSmartTitle,
  toggleSessionPin,
  deleteSession,
  exportSessionAsMarkdown,
} from '@/sessions';

// ... existing tests ...

describe('toggleSessionPin', () => {
  it('pins an unpinned session', () => {
    const session = makeSession({ pinned: false });
    saveSessions('/project', [session]);
    const result = toggleSessionPin([session], session.id);
    expect(result.find(s => s.id === session.id)?.pinned).toBe(true);
  });

  it('unpins a pinned session', () => {
    const session = makeSession({ pinned: true });
    saveSessions('/project', [session]);
    const result = toggleSessionPin([session], session.id);
    expect(result.find(s => s.id === session.id)?.pinned).toBe(false);
  });

  it('returns unmodified list when session id not found', () => {
    const session = makeSession();
    const result = toggleSessionPin([session], 'nonexistent');
    expect(result).toEqual([session]);
  });
});

describe('deleteSession', () => {
  it('removes a session from the list', () => {
    const s1 = makeSession();
    const s2 = makeSession();
    const result = deleteSession([s1, s2], s1.id);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(s2.id);
  });

  it('removes session messages from localStorage', () => {
    const session = makeSession();
    saveSessionMessages(session.id, [makeMessage()]);
    deleteSession([session], session.id);
    expect(loadSessionMessages(session.id)).toEqual([]);
  });

  it('returns unmodified list when session id not found', () => {
    const session = makeSession();
    const result = deleteSession([session], 'nonexistent');
    expect(result).toHaveLength(1);
  });
});

describe('exportSessionAsMarkdown', () => {
  it('formats messages as markdown with role headers', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'user', content: 'Hello' }),
      makeMessage({ role: 'assistant', content: 'Hi there' }),
    ];
    const md = exportSessionAsMarkdown('Test Chat', messages);
    expect(md).toContain('# Test Chat');
    expect(md).toContain('## User');
    expect(md).toContain('Hello');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hi there');
  });

  it('skips system messages', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'system', content: 'System prompt' }),
      makeMessage({ role: 'user', content: 'Hello' }),
    ];
    const md = exportSessionAsMarkdown('Test', messages);
    expect(md).not.toContain('System prompt');
    expect(md).toContain('Hello');
  });

  it('handles empty messages array', () => {
    const md = exportSessionAsMarkdown('Empty', []);
    expect(md).toContain('# Empty');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sessions.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the helper functions**

Add to `src/sessions.ts`:

```typescript
export function toggleSessionPin(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.map(s =>
    s.id === sessionId ? { ...s, pinned: !s.pinned } : s
  );
}

export function deleteSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  // Remove messages from localStorage
  try {
    localStorage.removeItem(messagesKey(sessionId));
  } catch {
    // Ignore
  }
  return sessions.filter(s => s.id !== sessionId);
}

export function exportSessionAsMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${roleLabel}`, '', msg.content, '');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sessions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sessions.ts tests/unit/sessions.test.ts
git commit -m "feat(sessions): add pin toggle, delete, and markdown export helpers"
```

---

### Task 4: NavBar — Add "Chats" Button

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `tests/unit/components/NavBar.test.tsx`

- [ ] **Step 1: Write tests for the new Chats button**

Add to `tests/unit/components/NavBar.test.tsx`:

```typescript
  it('renders chats toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'Chat History')).toBeTruthy();
  });

  it('calls onToggle with "chats" when chats button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'Chat History'));
    expect(onToggle).toHaveBeenCalledWith('chats');
  });

  it('adds active class to chats button when activeSidebar is "chats"', () => {
    const { container } = render(<NavBar activeSidebar="chats" onToggle={vi.fn()} />);
    const chatsBtn = getNavButton(container, 'Chat History');
    expect(chatsBtn.className).toContain('active');
  });

  it('disables chats button when terminal mode is active', () => {
    const { container } = render(<NavBar activeSidebar={null} activeTerminal={true} onToggle={vi.fn()} />);
    const chatsBtn = getNavButton(container, 'Chat History');
    expect(chatsBtn.className).toContain('disabled');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: FAIL — no button with title "Chat History".

- [ ] **Step 3: Add the Chats button to NavBar**

In `src/components/NavBar.tsx`, add the `Clock` import and a new button between Git and Terminal:

```typescript
import { FolderClosed, GitBranch, SquareTerminal, Clock } from 'lucide-react';
```

Add this button JSX after the Git button and before the Terminal Mode button:

```tsx
      <button
        className={`nav-btn ${activeSidebar === 'chats' ? 'active' : ''} ${activeTerminal ? 'disabled' : ''}`}
        onClick={() => !activeTerminal && onToggle('chats')}
        title="Chat History"
        disabled={activeTerminal}
      >
        <Clock size={18} />
        <span className="nav-label">Chats</span>
      </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/NavBar.test.tsx`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/NavBar.tsx tests/unit/components/NavBar.test.tsx
git commit -m "feat(navbar): add Chat History button between Git and Terminal"
```

---

### Task 5: ChatHistoryContextMenu Component

**Files:**
- Create: `src/components/Chat/ChatHistoryContextMenu.tsx`
- Create: `tests/unit/components/Chat/ChatHistoryContextMenu.test.tsx`

- [ ] **Step 1: Write tests for context menu**

Create `tests/unit/components/Chat/ChatHistoryContextMenu.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ChatHistoryContextMenu from '../../../../src/components/Chat/ChatHistoryContextMenu';

describe('ChatHistoryContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    pinned: false,
    onAction: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders without crashing', () => {
    const { container } = render(<ChatHistoryContextMenu {...defaultProps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows "Pin to top" when session is not pinned', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} />);
    expect(getByText('Pin to top')).toBeTruthy();
  });

  it('shows "Unpin" when session is pinned', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} pinned={true} />);
    expect(getByText('Unpin')).toBeTruthy();
  });

  it('calls onAction with "rename" when Rename is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Rename'));
    expect(onAction).toHaveBeenCalledWith('rename');
  });

  it('calls onAction with "pin" when Pin is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Pin to top'));
    expect(onAction).toHaveBeenCalledWith('pin');
  });

  it('calls onAction with "export" when Export is clicked', () => {
    const onAction = vi.fn();
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Export as Markdown'));
    expect(onAction).toHaveBeenCalledWith('export');
  });

  it('shows delete confirmation when Delete is clicked', () => {
    const { getByText } = render(<ChatHistoryContextMenu {...defaultProps} />);
    fireEvent.click(getByText('Delete'));
    expect(getByText('Delete this conversation?')).toBeTruthy();
  });

  it('calls onAction with "delete" when confirming delete', () => {
    const onAction = vi.fn();
    const { getByText, getAllByText } = render(<ChatHistoryContextMenu {...defaultProps} onAction={onAction} />);
    fireEvent.click(getByText('Delete'));
    // Click the confirm "Delete" button (second one)
    const deleteButtons = getAllByText('Delete');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('hides confirmation and stays open when Cancel is clicked', () => {
    const onClose = vi.fn();
    const { getByText, queryByText } = render(<ChatHistoryContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(getByText('Delete'));
    fireEvent.click(getByText('Cancel'));
    expect(queryByText('Delete this conversation?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<ChatHistoryContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Chat/ChatHistoryContextMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ChatHistoryContextMenu**

Create `src/components/Chat/ChatHistoryContextMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Pencil, Pin, PinOff, Download, Trash2 } from 'lucide-react';

interface ChatHistoryContextMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  onAction: (action: 'rename' | 'pin' | 'export' | 'delete') => void;
  onClose: () => void;
}

export default function ChatHistoryContextMenu({ x, y, pinned, onAction, onClose }: ChatHistoryContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Reposition if overflowing viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [confirmingDelete]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 0',
    minWidth: 200,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: 2000,
    fontSize: 13,
  };

  const itemStyle: React.CSSProperties = {
    padding: '6px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text)',
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    fontSize: 13,
  };

  return (
    <div ref={ref} style={menuStyle}>
      {confirmingDelete ? (
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Delete this conversation?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setConfirmingDelete(false)}
              style={{
                padding: '4px 12px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => onAction('delete')}
              style={{
                padding: '4px 12px',
                background: 'var(--red)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            style={itemStyle}
            onClick={() => onAction('rename')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Pencil size={14} /> Rename
          </button>
          <button
            style={itemStyle}
            onClick={() => onAction('pin')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <button
            style={itemStyle}
            onClick={() => onAction('export')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Download size={14} /> Export as Markdown
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button
            style={{ ...itemStyle, color: 'var(--red)' }}
            onClick={() => setConfirmingDelete(true)}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/Chat/ChatHistoryContextMenu.test.tsx`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatHistoryContextMenu.tsx tests/unit/components/Chat/ChatHistoryContextMenu.test.tsx
git commit -m "feat: add ChatHistoryContextMenu with rename, pin, export, delete"
```

---

### Task 6: ChatHistorySidebar Component

**Files:**
- Create: `src/components/Chat/ChatHistorySidebar.tsx`
- Create: `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`

- [ ] **Step 1: Write tests for ChatHistorySidebar**

Create `tests/unit/components/Chat/ChatHistorySidebar.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import ChatHistorySidebar from '../../../../src/components/Chat/ChatHistorySidebar';
import type { ChatSession } from '../../../../src/types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ChatHistorySidebar', () => {
  const defaultProps = {
    sessions: [] as ChatSession[],
    activeSessionId: '',
    aiProvider: 'claude' as const,
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    onUpdateSessions: vi.fn(),
    projectPath: '/test/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    const { container } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders search input', () => {
    const { container } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(container.querySelector('input[placeholder*="Search"]')).toBeTruthy();
  });

  it('renders New Chat button', () => {
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(getByText('New Chat')).toBeTruthy();
  });

  it('calls onNewChat when New Chat button is clicked', () => {
    const onNewChat = vi.fn();
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} onNewChat={onNewChat} />);
    fireEvent.click(getByText('New Chat'));
    expect(onNewChat).toHaveBeenCalled();
  });

  it('shows "No conversations yet" when sessions list is empty', () => {
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(getByText('No conversations yet')).toBeTruthy();
  });

  it('renders session cards for provided sessions', () => {
    const sessions = [
      makeSession({ title: 'First chat' }),
      makeSession({ title: 'Second chat' }),
    ];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    expect(getByText('First chat')).toBeTruthy();
    expect(getByText('Second chat')).toBeTruthy();
  });

  it('highlights the active session', () => {
    const sessions = [makeSession({ title: 'Active one' })];
    const { container } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} activeSessionId={sessions[0].id} />
    );
    const activeCard = container.querySelector('.history-card-active');
    expect(activeCard).toBeTruthy();
  });

  it('calls onSelectSession when a session card is clicked', () => {
    const onSelectSession = vi.fn();
    const sessions = [makeSession({ title: 'Click me' })];
    const { getByText } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} onSelectSession={onSelectSession} />
    );
    fireEvent.click(getByText('Click me'));
    expect(onSelectSession).toHaveBeenCalledWith(sessions[0].id);
  });

  it('shows pinned section when pinned sessions exist', () => {
    const sessions = [makeSession({ title: 'Pinned one', pinned: true })];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    expect(getByText('Pinned')).toBeTruthy();
  });

  it('filters sessions by search query', async () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Auth middleware' }),
      makeSession({ id: 's2', title: 'Border fix' }),
    ];
    // Save messages so full-text search can find them
    localStorage.setItem(`sai-session-msgs-${sessions[0].id}`, JSON.stringify([
      { id: '1', role: 'user', content: 'Fix the auth middleware', timestamp: Date.now() },
    ]));
    localStorage.setItem(`sai-session-msgs-${sessions[1].id}`, JSON.stringify([
      { id: '2', role: 'user', content: 'The border is broken', timestamp: Date.now() },
    ]));

    const { container, getByText, queryByText } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} />
    );
    const input = container.querySelector('input')!;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'auth' } });
      // Wait for debounce
      await new Promise(r => setTimeout(r, 350));
    });

    expect(getByText('Auth middleware')).toBeTruthy();
    expect(queryByText('Border fix')).toBeNull();
  });

  it('shows context menu on right-click', () => {
    const sessions = [makeSession({ title: 'Right-click me' })];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    fireEvent.contextMenu(getByText('Right-click me'));
    expect(getByText('Rename')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ChatHistorySidebar**

Create `src/components/Chat/ChatHistorySidebar.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Plus, Pin } from 'lucide-react';
import { formatSessionDate, formatSessionTime, loadSessionMessages, toggleSessionPin, deleteSession, exportSessionAsMarkdown, saveSessions } from '../../sessions';
import ChatHistoryContextMenu from './ChatHistoryContextMenu';
import type { ChatSession } from '../../types';

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  aiProvider: 'claude' | 'codex' | 'gemini';
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onUpdateSessions: (sessions: ChatSession[]) => void;
  projectPath: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#d4a574',
  codex: '#74aa9c',
  gemini: '#8b9cf7',
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatSessionTime(timestamp);
}

function getSessionPreview(session: ChatSession): string {
  // Preview is loaded from the session's messages if available,
  // or from the title as fallback
  const messages = session.messages;
  if (messages && messages.length > 0) {
    const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
    if (firstUser) return firstUser.content;
    const secondUser = messages.find((m, i) => i > 0 && m.role === 'user' && m.content.trim());
    if (secondUser) return secondUser.content;
  }
  return '';
}

export default function ChatHistorySidebar({
  sessions,
  activeSessionId,
  aiProvider,
  onSelectSession,
  onNewChat,
  onUpdateSessions,
  projectPath,
}: ChatHistorySidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const searchCacheRef = useRef<Map<string, string>>(new Map());

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Focus rename input when editing
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  // Build search cache on first search
  const getSearchContent = useCallback((sessionId: string): string => {
    if (searchCacheRef.current.has(sessionId)) {
      return searchCacheRef.current.get(sessionId)!;
    }
    const messages = loadSessionMessages(sessionId);
    const content = messages.map(m => m.content).join(' ');
    searchCacheRef.current.set(sessionId, content.toLowerCase());
    return searchCacheRef.current.get(sessionId)!;
  }, []);

  // Invalidate cache when sessions change
  useEffect(() => {
    searchCacheRef.current.clear();
  }, [sessions]);

  // Filter sessions by provider
  const providerSessions = useMemo(
    () => sessions.filter(s => !s.aiProvider || s.aiProvider === aiProvider),
    [sessions, aiProvider]
  );

  // Filter by search query
  const filteredSessions = useMemo(() => {
    if (!debouncedQuery.trim()) return providerSessions;
    const q = debouncedQuery.toLowerCase();
    return providerSessions.filter(s => {
      if (s.title.toLowerCase().includes(q)) return true;
      return getSearchContent(s.id).includes(q);
    });
  }, [providerSessions, debouncedQuery, getSearchContent]);

  // Group sessions: pinned first, then by date
  const groupedSessions = useMemo(() => {
    if (debouncedQuery.trim()) {
      // When searching, show flat list (no grouping)
      return [{ label: 'Results', sessions: filteredSessions }];
    }

    const pinned = filteredSessions.filter(s => s.pinned);
    const unpinned = filteredSessions.filter(s => !s.pinned);

    const groups: { label: string; sessions: ChatSession[] }[] = [];

    if (pinned.length > 0) {
      groups.push({ label: 'Pinned', sessions: pinned });
    }

    for (const session of unpinned) {
      const label = formatSessionDate(session.updatedAt);
      const existing = groups.find(g => g.label === label);
      if (existing) existing.sessions.push(session);
      else groups.push({ label, sessions: [session] });
    }

    return groups;
  }, [filteredSessions, debouncedQuery]);

  // Count messages (from index, messages array is empty — use metadata or count from storage)
  const getMessageCount = useCallback((session: ChatSession): number => {
    if (session.messages && session.messages.length > 0) return session.messages.length;
    const msgs = loadSessionMessages(session.id);
    return msgs.length;
  }, []);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  const handleContextAction = (action: string) => {
    if (!contextMenu) return;
    const { sessionId } = contextMenu;

    switch (action) {
      case 'rename': {
        const session = sessions.find(s => s.id === sessionId);
        setRenamingId(sessionId);
        setRenameValue(session?.title || '');
        break;
      }
      case 'pin': {
        const updated = toggleSessionPin(sessions, sessionId);
        onUpdateSessions(updated);
        saveSessions(projectPath, updated);
        break;
      }
      case 'export': {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          const messages = loadSessionMessages(sessionId);
          const md = exportSessionAsMarkdown(session.title || 'Untitled', messages);
          const blob = new Blob([md], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const date = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `${(session.title || 'chat').replace(/[^a-zA-Z0-9]/g, '-')}-${date}.md`;
          a.click();
          URL.revokeObjectURL(url);
        }
        break;
      }
      case 'delete': {
        const updated = deleteSession(sessions, sessionId);
        onUpdateSessions(updated);
        saveSessions(projectPath, updated);
        break;
      }
    }
    setContextMenu(null);
  };

  const handleRenameSubmit = (sessionId: string) => {
    if (renameValue.trim()) {
      const updated = sessions.map(s =>
        s.id === sessionId ? { ...s, title: renameValue.trim(), titleEdited: true } : s
      );
      onUpdateSessions(updated);
      saveSessions(projectPath, updated);
    }
    setRenamingId(null);
  };

  const providerColor = PROVIDER_COLORS[aiProvider] || '#888';

  return (
    <div className="chat-history-sidebar">
      {/* Search bar */}
      <div className="chat-history-search">
        <Search size={12} className="chat-history-search-icon" />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="chat-history-search-input"
        />
        {searchQuery && (
          <button className="chat-history-search-clear" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* New Chat button */}
      <button className="chat-history-new-btn" onClick={onNewChat}>
        <Plus size={14} />
        New Chat
      </button>

      {/* Session list */}
      <div className="chat-history-list">
        {filteredSessions.length === 0 ? (
          <div className="chat-history-empty">
            {debouncedQuery ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label}>
              <div className="chat-history-group-label">
                {group.label === 'Pinned' && <Pin size={10} />}
                {group.label}
              </div>
              {group.sessions.map(session => (
                <div
                  key={session.id}
                  className={`chat-history-card ${session.id === activeSessionId ? 'history-card-active' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                  onContextMenu={e => handleContextMenu(e, session.id)}
                >
                  {renamingId === session.id ? (
                    <input
                      ref={renameRef}
                      className="chat-history-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(session.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit(session.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="chat-history-card-header">
                        <span
                          className="chat-history-provider-dot"
                          style={{ background: PROVIDER_COLORS[session.aiProvider || aiProvider] || providerColor }}
                        />
                        <span className="chat-history-card-title">{session.title || 'Untitled'}</span>
                        {session.id === activeSessionId && (
                          <span className="chat-history-active-badge">ACTIVE</span>
                        )}
                      </div>
                      {getSessionPreview(session) && (
                        <div className="chat-history-card-preview">
                          {getSessionPreview(session)}
                        </div>
                      )}
                      <div className="chat-history-card-meta">
                        <span>{getMessageCount(session)} msgs</span>
                        <span className="chat-history-meta-dot">&middot;</span>
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ChatHistoryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          pinned={sessions.find(s => s.id === contextMenu.sessionId)?.pinned || false}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <style>{`
        .chat-history-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
        }
        .chat-history-search {
          padding: 8px 10px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 6px;
          position: relative;
        }
        .chat-history-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .chat-history-search-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text);
          font-size: 12px;
          font-family: inherit;
          outline: none;
        }
        .chat-history-search-input::placeholder {
          color: var(--text-muted);
        }
        .chat-history-search-clear {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
        }
        .chat-history-search-clear:hover {
          color: var(--text);
        }
        .chat-history-new-btn {
          margin: 6px 10px;
          padding: 5px 10px;
          background: var(--bg-hover);
          border: 1px solid var(--border);
          border-radius: 5px;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .chat-history-new-btn:hover {
          background: var(--bg-elevated);
        }
        .chat-history-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        .chat-history-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }
        .chat-history-group-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .chat-history-card {
          padding: 8px 10px;
          margin: 1px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .chat-history-card:hover {
          background: rgba(255,255,255,0.04);
        }
        .history-card-active {
          border-left: 2px solid var(--accent);
          background: rgba(199,145,12,0.12);
        }
        .history-card-active:hover {
          background: rgba(199,145,12,0.15);
        }
        .chat-history-card-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 3px;
        }
        .chat-history-provider-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          opacity: 0.7;
        }
        .chat-history-card-title {
          font-weight: 500;
          font-size: 13px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .chat-history-active-badge {
          font-size: 9px;
          background: var(--accent);
          color: #000;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .chat-history-card-preview {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          margin-bottom: 4px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .chat-history-card-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0.7;
        }
        .chat-history-meta-dot {
          color: var(--text-muted);
          opacity: 0.4;
        }
        .chat-history-rename-input {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--accent);
          border-radius: 4px;
          padding: 4px 8px;
          color: var(--text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/Chat/ChatHistorySidebar.test.tsx`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx tests/unit/components/Chat/ChatHistorySidebar.test.tsx
git commit -m "feat: add ChatHistorySidebar with search, cards, grouping, and context menu"
```

---

### Task 7: Wire Sidebar into App.tsx and Remove Dropdown

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import for ChatHistorySidebar**

At the top of `src/App.tsx`, add:

```typescript
import ChatHistorySidebar from './components/Chat/ChatHistorySidebar';
```

- [ ] **Step 2: Add Ctrl+H keyboard shortcut**

Add a new `useEffect` after the existing Ctrl+K handler (around line 170):

```typescript
  // Global Ctrl+H handler for chat history sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'h' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (activeView !== 'terminal-mode') {
          setSidebarOpen(prev => prev === 'chats' ? null : 'chats');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeView]);
```

- [ ] **Step 3: Add handleUpdateSessions callback**

Add near `handleNewChat` and `handleSelectSession` (around line 1212):

```typescript
  const handleUpdateSessions = useCallback((updated: ChatSession[]) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      sessions: updated,
    }));
  }, [activeProjectPath, updateWorkspace]);
```

- [ ] **Step 4: Render ChatHistorySidebar in the app body**

In the JSX, after the GitSidebar line (around line 1563), add:

```tsx
        {sidebarOpen === 'chats' && (
          <ChatHistorySidebar
            sessions={sessions}
            activeSessionId={activeSession.id}
            aiProvider={aiProvider}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onUpdateSessions={handleUpdateSessions}
            projectPath={projectPath}
          />
        )}
```

- [ ] **Step 5: Remove the old history dropdown**

Remove these elements from `src/App.tsx`:

1. The `historyOpen` state and `historyRef` ref (lines 560-561):
   ```typescript
   // DELETE these two lines:
   const [historyOpen, setHistoryOpen] = useState(false);
   const historyRef = useRef<HTMLDivElement>(null);
   ```

2. The click-outside handler `useEffect` for `historyOpen` (lines 563-571): delete the entire block.

3. The `providerSessions` and `groupedSessions` computed values (lines 685-694): delete both.

4. In the accordion bar actions `div` (around line 1327), remove the `ref={historyRef}` attribute from the wrapper div, remove the Clock button and the entire `{historyOpen && (...)}` dropdown block. Keep only the New Chat button:

   ```tsx
   <div className="accordion-bar-actions">
     <button
       className="accordion-bar-btn"
       onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
       title="New conversation"
     >
       <MessageCirclePlus size={12} />
     </button>
   </div>
   ```

5. Remove the `Clock` import from lucide-react if it's no longer used elsewhere in App.tsx.

6. Delete all `.chat-history-dropdown` CSS rules (lines 1726-1795 approximately): the entire block from `.chat-history-dropdown {` through `.history-provider-icon {`.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS. Some existing tests may reference the old dropdown — fix any that fail.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire ChatHistorySidebar into App, remove old history dropdown"
```

---

### Task 8: Manual Smoke Test and Visual Polish

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx` (if adjustments needed)

- [ ] **Step 1: Start the app**

Run: `npm run dev` (or however the Electron app starts)

- [ ] **Step 2: Smoke test the sidebar**

Verify:
- [ ] "Chats" button appears in NavBar between Git and Terminal
- [ ] Clicking "Chats" opens the sidebar
- [ ] Clicking again closes it
- [ ] Ctrl+H toggles the sidebar
- [ ] Sidebar shows existing sessions grouped by date
- [ ] Active session is highlighted with accent border and ACTIVE badge
- [ ] Clicking a session switches to it
- [ ] "New Chat" button in sidebar creates a new session
- [ ] Search filters sessions (type and wait 300ms)
- [ ] Right-click shows context menu with Rename, Pin, Export, Delete
- [ ] Rename inline editing works (Enter to save, Escape to cancel)
- [ ] Pin moves session to Pinned section
- [ ] Export downloads a .md file
- [ ] Delete shows confirmation, then removes session
- [ ] Sidebar is disabled when terminal mode is active

- [ ] **Step 3: Fix any visual issues**

Adjust spacing, colors, or transitions in `ChatHistorySidebar.tsx` styles as needed.

- [ ] **Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "fix: visual polish for chat history sidebar"
```

---

### Task 9: AI Title Generation Setting (Optional Feature)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/sessions.ts`

- [ ] **Step 1: Add setting to provider settings persistence**

In the settings loading section of `src/App.tsx`, load the `aiTitleGeneration` setting for each provider. Add state:

```typescript
const [aiTitleGeneration, setAiTitleGeneration] = useState(false);
```

Load from settings alongside other provider settings:

```typescript
// In the settings loading useEffect:
window.sai.settingsGet('claude', {}).then((cfg: any) => {
  // ... existing setting loads ...
  if (cfg.aiTitleGeneration !== undefined) setAiTitleGeneration(cfg.aiTitleGeneration);
});
```

- [ ] **Step 2: Wire setting into the settings UI**

Add a toggle in the provider settings section (this follows the existing pattern for other boolean settings like `permissionMode`). The exact UI depends on how the settings modal is structured — add a checkbox/toggle labeled "AI-generated conversation titles" with a subtitle "Uses a small API call after the first response to generate better titles".

- [ ] **Step 3: Implement title generation on turn complete**

In the `onTurnComplete` handler in `src/App.tsx`, after upserting the session, check if AI title generation is enabled and the session is new (only 1 user message):

```typescript
// After upsertSession call in onTurnComplete:
if (aiTitleGeneration && !session.titleEdited && session.messages.filter(m => m.role === 'user').length === 1) {
  const firstUserMsg = session.messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    // Fire-and-forget lightweight title generation
    const prompt = `Summarize this conversation in 3-5 words as a title. Respond with only the title, no quotes or punctuation. User said: ${firstUserMsg.content}`;
    // Use the current provider's send mechanism to get a title
    // Implementation depends on the provider — for Claude, use a one-shot API call
    // This is async and updates the session title when complete
  }
}
```

Note: The exact implementation of the one-shot title API call depends on how the backend exposes lightweight requests. This may need a new IPC method like `window.sai.claudeGenerateTitle(projectPath, prompt)` that makes a single API call without affecting the conversation session.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add optional AI-generated conversation titles setting"
```

---

### Task 10: Final Test Run and Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Check for unused imports or dead code**

Verify that:
- `Clock` import is removed from `App.tsx` (now only in `NavBar.tsx`)
- `historyOpen`, `historyRef`, `providerSessions`, `groupedSessions` are fully removed from `App.tsx`
- All `.chat-history-dropdown` CSS is removed
- No console.log statements left from debugging

- [ ] **Step 4: Commit any final cleanup**

```bash
git add -A
git commit -m "chore: final cleanup for chat history sidebar feature"
```
