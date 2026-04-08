# Chat History Sidebar Redesign

## Overview

Replace the current 280-350px history dropdown with a full sidebar panel in the NavBar, matching the existing Files and Git sidebar pattern. Adds search, session management (rename/delete/pin/export), smarter titles, and richer session cards.

## Container: NavBar Sidebar

### NavBar Changes

- Add a **"Chats"** button to NavBar using lucide `Clock` icon (18px), positioned between Git and Term
- Label: "Chats" (matches "Files", "Git", "Term" pattern)
- Toggle behavior: same as Files/Git — `toggleSidebar('chats')` sets `sidebarOpen` to `'chats'` or `null`
- Disabled when terminal-mode is active (same as Files/Git)
- Keyboard shortcut: `Ctrl+H` toggles the sidebar

### Sidebar Component

- New component: `src/components/Chat/ChatHistorySidebar.tsx`
- Rendered in App.tsx alongside FileExplorerSidebar and GitSidebar: `{sidebarOpen === 'chats' && <ChatHistorySidebar ... />}`
- Uses the same `--sidebar-width` CSS variable (default 300px) and resizable drag handle

### Accordion Bar Cleanup

- **Remove**: Clock icon button and the entire history dropdown (`historyOpen`, `historyRef`, `groupedSessions` rendering, all `.chat-history-dropdown` CSS)
- **Keep**: New Chat button (MessageCirclePlus icon) — remains in the accordion bar

## Session Cards

Each session is rendered as a card with full preview density.

### Card Anatomy

```
┌─────────────────────────────────────┐
│ [provider-icon] Session Title       │
│ First 2 lines of first user msg...  │
│ 42 msgs · 2h ago · opus            │
└─────────────────────────────────────┘
```

- **Provider icon**: Small colored circle (12px) — Claude (#d4a574), Codex/OpenAI (#74aa9c), Gemini (#8b9cf7). Use the existing SVG provider icons at reduced size.
- **Title**: Font-weight 500, single line, ellipsis overflow
- **Preview**: First ~2 lines of the first user message, 11px, muted color, `-webkit-line-clamp: 2`. If the first user message has no text content (e.g., image-only), show the second user message or omit the preview.
- **Metadata row**: Message count, relative time ("just now", "2h ago", "yesterday 4pm"), model name in provider accent color
- **Active session**: Accent left border (2px) + filled background `rgba(accent, 0.12)` + "ACTIVE" badge (9px, accent bg, black text)
- **Hover state**: `rgba(255,255,255,0.04)` background with 0.15s transition

### Card Interactions

- **Click**: Load session (same as current `handleSelectSession`)
- **Right-click**: Context menu (see Session Management below)

## Session Grouping

### Sections

1. **Pinned** — shown first if any pinned sessions exist, with a lucide `Pin` icon header
2. **Today** — sessions updated today
3. **Yesterday** — sessions updated yesterday
4. **Date headers** — "Apr 7", "Apr 6", etc. for older sessions

Same grouping logic as current `formatSessionDate()`, with the addition of the pinned section.

### Provider Filtering

Maintain existing behavior: only show sessions matching the active AI provider (`providerSessions` filter). This keeps the sidebar focused and avoids confusion.

## Search

### Search Bar

- Fixed at the top of the sidebar, below the header
- Lucide `Search` icon (11px) + placeholder "Search conversations..."
- Keyboard shortcut hint: "Ctrl+H" badge (only shown when sidebar is closed — when open, the search input is already visible)
- Debounced input: 300ms delay before executing search

### Search Behavior

- **Full-text search** across all session messages (Option B from brainstorming)
- Loads messages from localStorage for each session via `loadSessionMessages()`
- Searches: session title + all message content (both user and assistant)
- Case-insensitive substring match
- Results replace the date-grouped list while search is active
- Clear button (lucide `X`) to reset search and return to grouped view
- Empty state: "No matching conversations" with muted text

### Performance

- On first search, load and cache all session messages in memory
- Cache invalidated when sessions change (new message, session switch)
- For 200 sessions, localStorage reads should complete in <100ms

## Session Management

### Context Menu

Right-click on any session card shows a context menu with lucide icons:

| Action | Icon | Behavior |
|--------|------|----------|
| Rename | `Pencil` | Inline edit — title becomes an input field, Enter to save, Escape to cancel |
| Pin to top | `Pin` | Toggles `pinned: boolean` on the session, moves to/from pinned section |
| Export as Markdown | `Download` | Generates a `.md` file with all messages formatted as `## User\n{content}\n\n## Assistant\n{content}`, triggers browser download via Blob URL. Filename: `{title}-{date}.md` |
| Delete | `Trash2` | Confirmation prompt, then removes session from index and deletes messages from localStorage |

### Context Menu Styling

- Same pattern as existing `ContextMenu.tsx` in FileExplorer
- Background: `var(--bg-elevated)`, border: `1px solid var(--border)`, border-radius: 6px
- Delete item in red (`var(--red)`)
- Divider line above Delete

### Delete Confirmation

- Inline confirmation within the context menu: "Delete this conversation?" with Cancel / Delete buttons
- No modal dialog — keeps it lightweight

## Session Titles

### Smart Truncation (Default)

Strip common filler prefixes from the first user message before truncating to 40 chars:

```
Prefixes to strip (case-insensitive):
- "can you ", "could you ", "would you "
- "please ", "help me ", "I need to ", "I want to "
- "let's ", "let me ", "we need to ", "we should "
```

After stripping, capitalize the first letter and truncate to 40 chars.

Examples:
- "Can you help me fix the border on code blocks" → "Fix the border on code blocks"
- "I need to implement a command palette" → "Implement a command palette"
- "let's build a chat history sidebar" → "Build a chat history sidebar"

### AI-Generated Titles (Optional, Per-Provider Setting)

- Setting: `aiTitleGeneration: boolean` (default: `false`), stored in provider settings
- When enabled: after the first assistant response completes, send a lightweight prompt to generate a 3-5 word title
- Prompt: `"Summarize this conversation in 3-5 words as a title. Respond with only the title, no quotes or punctuation. User said: {first_user_message}"`
- Uses the current provider and model
- Title updates asynchronously — smart truncation is used as the initial title, then replaced when the AI responds
- Setting location: Provider section in settings (alongside model choice, permission mode, etc.)

## Data Model Changes

### ChatSession Type Update

```typescript
interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  claudeSessionId?: string;
  pinned?: boolean;        // NEW: pin to top of sidebar
  titleEdited?: boolean;   // NEW: true if user manually renamed (skip auto-title)
}
```

### Storage

No changes to the storage strategy. Sessions remain in localStorage with the existing two-tier approach (index + per-session messages). The 200-session cap remains.

## New Chat Button

The "New Chat" button (MessageCirclePlus) stays in the accordion bar header. Additionally, add a "New Chat" button at the top of the sidebar:

- Lucide `Plus` icon + "New Chat" text
- Styled as a subtle button at the top of the sidebar, below the search bar
- Same behavior as existing `handleNewChat()`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+H` | Toggle chat history sidebar |

Note: `Ctrl+H` is chosen because H = History. It doesn't conflict with existing shortcuts (Ctrl+K is command palette).

## Files Changed

| File | Change |
|------|--------|
| `src/components/Chat/ChatHistorySidebar.tsx` | **New** — sidebar component |
| `src/components/Chat/ChatHistoryContextMenu.tsx` | **New** — right-click context menu |
| `src/components/NavBar.tsx` | Add "Chats" button |
| `src/App.tsx` | Wire sidebar, remove dropdown, add Ctrl+H handler, pass props |
| `src/types.ts` | Add `pinned`, `titleEdited` to ChatSession |
| `src/sessions.ts` | Add smart truncation, pin/unpin helpers, export helper |
| `src/styles/globals.css` | Minor adjustments if needed |

## Out of Scope (Future)

- IndexedDB migration (current localStorage is sufficient for 200 sessions)
- In-conversation bookmarks / turn navigation
- Collapsible tool call regions (separate feature)
- Session forking
- Storage usage indicator
