# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a history dropdown in the title bar that persists conversations to localStorage and lets users resume them.

**Architecture:** Add a `ChatSession` type and localStorage persistence layer. Lift session state to App.tsx. TitleBar gets a new clock icon + dropdown. ChatPanel accepts initial messages from the active session instead of always starting empty.

**Tech Stack:** React, TypeScript, lucide-react (Clock icon), localStorage

---

### Task 1: Add ChatSession type to types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add ChatSession interface**

Add after the existing `ChatMessage` interface:

```typescript
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ChatSession type for history persistence"
```

---

### Task 2: Add session persistence helpers

**Files:**
- Create: `src/sessions.ts`

- [ ] **Step 1: Create sessions.ts with load/save/helpers**

```typescript
import type { ChatSession } from './types';

const STORAGE_KEY = 'vsai-chat-sessions';
const MAX_SESSIONS = 10;

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage quota exceeded — silently fail
  }
}

export function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  // Don't save empty sessions
  if (session.messages.length === 0) {
    return sessions.filter(s => s.id !== session.id);
  }

  // Set title from first user message if not set
  if (!session.title) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      session.title = firstUserMsg.content.slice(0, 40);
    }
  }

  session.updatedAt = Date.now();

  const existing = sessions.findIndex(s => s.id === session.id);
  let updated: ChatSession[];
  if (existing >= 0) {
    updated = [...sessions];
    updated[existing] = session;
  } else {
    updated = [session, ...sessions];
  }

  // Sort by updatedAt descending, keep max
  updated.sort((a, b) => b.updatedAt - a.updatedAt);
  return updated.slice(0, MAX_SESSIONS);
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDate.getTime() === today.getTime()) return 'Today';
  if (sessionDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sessions.ts
git commit -m "feat: add session persistence helpers"
```

---

### Task 3: Lift session state to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update App.tsx imports and state**

Replace the existing imports and state setup. The full updated `App.tsx`:

```typescript
import { useState, useCallback } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage } from './types';

type PermissionMode = 'default' | 'bypass';

function getStoredPermission(): PermissionMode {
  try {
    const v = localStorage.getItem('vsai-permission-mode');
    return v === 'bypass' ? 'bypass' : 'default';
  } catch {
    return 'default';
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);

  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSession, setActiveSession] = useState<ChatSession>(createSession);

  const persistSession = useCallback((session: ChatSession) => {
    setSessions(prev => {
      const updated = upsertSession(prev, session);
      saveSessions(updated);
      return updated;
    });
  }, []);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  const handleNewChat = () => {
    // Save current session before creating new one
    persistSession(activeSession);
    setActiveSession(createSession());
  };

  const handleSelectSession = (id: string) => {
    // Save current session first
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      setActiveSession({ ...selected });
    }
  };

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    setActiveSession(prev => {
      const updated = { ...prev, messages, updatedAt: Date.now() };
      // Set title from first user message
      if (!updated.title) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          updated.title = firstUserMsg.content.slice(0, 40);
        }
      }
      return updated;
    });
  }, []);

  // Persist active session whenever it changes and has messages
  const handleSessionSave = useCallback(() => {
    setActiveSession(prev => {
      if (prev.messages.length > 0) {
        persistSession(prev);
      }
      return prev;
    });
  }, [persistSession]);

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem('vsai-permission-mode', mode);
  };

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={setProjectPath}
        onNewChat={handleNewChat}
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={handleSelectSession}
      />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} />}
        <div className="main-content">
          <ChatPanel
            key={activeSession.id}
            projectPath={projectPath}
            permissionMode={permissionMode}
            onPermissionChange={handlePermissionChange}
            initialMessages={activeSession.messages}
            onMessagesChange={handleMessagesChange}
            onTurnComplete={handleSessionSave}
          />
          <TerminalPanel projectPath={projectPath} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: lift session state to App with persistence"
```

---

### Task 4: Update ChatPanel to accept and report messages

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Update ChatPanelProps and initialization**

Update the interface and component signature at the top of ChatPanel:

```typescript
interface ChatPanelProps {
  projectPath: string;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  initialMessages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
  onTurnComplete?: () => void;
}

export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, initialMessages, onMessagesChange, onTurnComplete }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(initialMessages || []);
```

- [ ] **Step 2: Add effect to report message changes**

Add after the existing `messagesEndRef` scroll effect (after line 239):

```typescript
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]);
```

- [ ] **Step 3: Call onTurnComplete when streaming ends**

In the `claudeOnMessage` handler, inside the `msg.type === 'done'` block (around line 131), add the callback:

```typescript
      if (msg.type === 'done') {
        setIsStreaming(false);
        onTurnComplete?.();
        return;
      }
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat: ChatPanel reports messages and turn completion to parent"
```

---

### Task 5: Add history button and dropdown to TitleBar

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Update imports and props**

Update the imports and interface at the top of TitleBar.tsx:

```typescript
import { useState, useEffect, useRef } from 'react';
import { MessageCirclePlus, Clock } from 'lucide-react';
import type { ChatSession } from '../types';
import { formatSessionDate, formatSessionTime } from '../sessions';

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
}
```

- [ ] **Step 2: Add history dropdown state and close-on-outside-click**

Inside the component function, after the existing `dropdownRef` and project dropdown state, add:

```typescript
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  // Close history dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    if (historyOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);
```

- [ ] **Step 3: Add grouping helper inside component**

Add after the history close effect:

```typescript
  // Group sessions by date
  const groupedSessions = sessions.reduce<{ label: string; sessions: ChatSession[] }[]>((groups, session) => {
    const label = formatSessionDate(session.updatedAt);
    const existing = groups.find(g => g.label === label);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.push({ label, sessions: [session] });
    }
    return groups;
  }, []);
```

- [ ] **Step 4: Update JSX — add history button and dropdown before new-chat-btn**

Replace the new-chat-btn button and the area right before it. Insert the history dropdown wrapper just before the existing new-chat-btn:

```tsx
      <div className="history-dropdown-wrapper" ref={historyRef}>
        <button
          className="new-chat-btn"
          onClick={() => setHistoryOpen(!historyOpen)}
          title="Recent conversations"
        >
          <Clock size={16} />
        </button>
        {historyOpen && (
          <div className="history-dropdown">
            {sessions.length === 0 ? (
              <div className="dropdown-label" style={{ padding: '12px' }}>
                No recent conversations
              </div>
            ) : (
              groupedSessions.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && <div className="dropdown-divider" />}
                  <div className="dropdown-label">{group.label}</div>
                  {group.sessions.map(session => (
                    <button
                      key={session.id}
                      className={`dropdown-item history-item ${session.id === activeSessionId ? 'active' : ''}`}
                      onClick={() => {
                        onSelectSession(session.id);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="dropdown-item-name">{session.title || 'Untitled'}</span>
                      <span className="dropdown-item-path">{formatSessionTime(session.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <button className="new-chat-btn" onClick={onNewChat} title="New conversation">
        <MessageCirclePlus size={18} />
      </button>
```

- [ ] **Step 5: Add history dropdown CSS**

Add these styles inside the existing `<style>` tag, after the `.open-new` rule:

```css
        .history-dropdown-wrapper {
          -webkit-app-region: no-drag;
          position: relative;
        }
        .history-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          min-width: 280px;
          max-width: 350px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          z-index: 200;
        }
        .history-item.active {
          border-left: 2px solid var(--accent);
          background: rgba(126,184,247,0.05);
        }
        .history-item.active .dropdown-item-path {
          color: var(--text-muted);
        }
```

- [ ] **Step 6: Update the component's function signature**

Update the destructured props:

```typescript
export default function TitleBar({ projectPath, onProjectChange, onNewChat, sessions, activeSessionId, onSelectSession }: TitleBarProps) {
```

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat: add history clock icon and dropdown to title bar"
```

---

### Task 6: Manual testing and cleanup

- [ ] **Step 1: Run the dev build**

```bash
npm run dev
```

Expected: App compiles without errors.

- [ ] **Step 2: Verify functionality**

Test these flows:
1. Start a conversation, send a message — verify it appears
2. Click "New Chat" — verify old conversation appears in history dropdown
3. Click the clock icon — verify dropdown shows the conversation with truncated title and time
4. Click the conversation in history — verify messages are restored
5. Continue chatting in restored conversation — verify it works
6. Refresh the page — verify history persists from localStorage

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: chat history with localStorage persistence and title bar dropdown"
```
