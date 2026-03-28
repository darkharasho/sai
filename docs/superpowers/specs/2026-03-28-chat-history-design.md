# Chat History Feature

## Overview

Add a history dropdown next to the new chat icon in the title bar, allowing users to see recent conversations and resume them. Conversations are persisted to localStorage.

## UI

### Title Bar Buttons

Right side of title bar, left-to-right: `[History clock icon] [New Chat icon]`

- History button: `Clock` icon from lucide-react (16px), same styling as `new-chat-btn`
- Clicking toggles a dropdown anchored to the button's position

### History Dropdown

Dropdown styled like the existing project dropdown. Contents:

- Header label: "Recent Conversations"
- Up to 10 conversation items, grouped by date ("Today", "Yesterday", or "Mar 26" format)
- Each item shows:
  - **Title**: First user message, truncated to ~40 characters
  - **Timestamp**: Time only within date group (e.g. "2:30 PM")
- Active/current conversation highlighted with accent left border
- Click outside to close (same pattern as project dropdown)

### Behavior

- Clicking a conversation item restores that session's messages and makes it the active chat
- Clicking "New Chat" saves the current conversation (if it has messages) before starting fresh
- The current conversation auto-saves on each new message

## Data Model

### Session type

```typescript
interface ChatSession {
  id: string;           // crypto.randomUUID()
  title: string;        // first user message, truncated to 40 chars
  messages: ChatMessage[];
  createdAt: number;    // timestamp
  updatedAt: number;    // timestamp
}
```

### Storage

- **Key**: `vsai-chat-sessions` in localStorage
- **Value**: JSON array of `ChatSession` objects
- **Limit**: Keep last 10 sessions. When a new one is created and limit is exceeded, drop the oldest.
- Session with zero messages is not saved.

## State Management

### App.tsx changes

- Lift session state to App level:
  - `sessions: ChatSession[]` — loaded from localStorage on mount
  - `activeSessionId: string | null` — currently active session
- Replace `chatKey` remounting approach:
  - `handleNewChat`: saves current session, creates new session, sets it active
  - `handleSelectSession(id)`: saves current session, loads selected session
- Pass `activeSession` and save callback to ChatPanel
- Pass `sessions`, `activeSessionId`, `onSelectSession` to TitleBar

### TitleBar.tsx changes

- Add `Clock` icon button to the left of the new chat button
- Add history dropdown component (inline, same pattern as project dropdown)
- New props: `sessions`, `activeSessionId`, `onSelectSession`

### ChatPanel.tsx changes

- Accept initial messages from `activeSession` prop instead of starting empty
- Call save callback whenever messages change (debounced or on each message append)

## Date Grouping Logic

- **Today**: same calendar date
- **Yesterday**: one day before today
- **Older**: show as "Mar 26" format (short month + day)

## Edge Cases

- Empty session (no messages): not persisted, not shown in history
- localStorage quota exceeded: silently fail the save, keep working in-memory
- First launch (no history): dropdown shows "No recent conversations" placeholder text
