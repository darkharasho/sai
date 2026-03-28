# VSAI Desktop App — Design Spec

## Overview

A focused Electron + React desktop app that wraps Claude Code CLI in a nice GUI with an integrated terminal and git operations panel. No VS Code fork — built from scratch.

## Layout

```
┌──────────────────────────────────────────────────┐
│  [project-name ▾]              [⚙]               │
├──┬───────────────────────────────────────────────┤
│  │                                               │
│  │   Claude Code Chat (main content)             │
│☰ │   - Rendered markdown with syntax highlighting│
│  │   - Code blocks with copy button              │
│  │   - Inline diffs for file edits               │
│  │   - Tool call cards (expandable)              │
│  │   - File references (clickable)               │
│  │                                               │
│  │   [multi-line input area]                     │
├──┴───────────────────────────────────────────────┤
│  Terminal (xterm.js)                             │
└──────────────────────────────────────────────────┘
```

Left nav icon bar (VS Code style). Clicking an icon expands a sidebar panel between the nav and the chat. Clicking again collapses it.

### Nav Icons

1. **Git** — changed files, staging area, commit message input, push/pull buttons, Claude's recent commits with diffs

Future additions (not in v1): file explorer, search.

## Tech Stack

- **Electron** — desktop shell
- **React** — UI framework
- **xterm.js** + **node-pty** — terminal emulator
- **simple-git** — git operations
- **marked** or **react-markdown** — markdown rendering
- **Prism.js** or **Shiki** — syntax highlighting in code blocks
- **Claude Code CLI** — spawned as a child process via node-pty or child_process

## Components

### 1. Chat Panel (center, always visible)

The main content area. Displays the conversation with Claude Code.

**Claude Code integration:**
- Spawn `claude` CLI as a child process
- Parse its streaming output (markdown, tool calls, file edits)
- Render messages as styled markdown with:
  - Syntax-highlighted code blocks
  - Inline file diffs (red/green unified diff style)
  - Expandable tool call cards ("Edited src/app.ts", "Ran npm test")
  - Clickable file paths
- Input area at the bottom: multi-line text input, send on Enter (Shift+Enter for newline)
- Support pasting images (pass to Claude as base64)

**Message types:**
- User messages (right-aligned or visually distinct)
- Claude responses (markdown rendered)
- Tool calls (collapsible cards showing what Claude did)
- System messages (errors, status updates)

### 2. Terminal Panel (bottom, resizable)

- **xterm.js** terminal emulator with **node-pty** backend
- Resizable by dragging the top edge
- Supports multiple terminal tabs
- Default shell (bash/zsh)
- CWD set to the active project directory

### 3. Git Sidebar (left, collapsible)

Expands from the left nav bar when the git icon is clicked.

**Sections:**

**Changes** — unstaged modified/added/deleted files
- Click to stage
- Click filename to see diff (opens in chat area or a diff overlay)

**Staged** — files ready to commit
- Click to unstage

**Commit** — message input + commit button

**Push/Pull** — buttons for push, pull, current branch display

**Claude's Activity** — recent commits made by Claude Code
- Shows commit messages and changed files
- Click to expand and see diffs
- Distinguishes Claude's commits from user's commits

### 4. Title Bar

- Project name dropdown (switch between recent projects or open new folder)
- Settings gear icon
- Minimize/maximize/close buttons (or native titlebar)

### 5. Left Nav Bar

Thin icon strip (like VS Code's activity bar):
- Git icon (toggles git sidebar)
- Visually indicates which sidebar is active

## Project Management

- Recent projects stored in app config (~/.vsai-app/config.json)
- Project = a folder path
- Switching projects changes: terminal CWD, git context, Claude Code working directory
- No multi-project tabs in v1 — just a dropdown to switch

## Claude Code Integration Details

Claude Code CLI outputs structured content to the terminal. We spawn it and capture output:

```
spawn('claude', ['--chat'], { cwd: projectPath })
```

The CLI supports:
- Streaming markdown responses
- Tool use notifications
- File edit diffs
- Terminal command execution

We parse the CLI's output stream and render it in the chat UI. The exact parsing depends on Claude Code's output format — we may need to use `--output-format json` or parse the ANSI output.

**Alternative approach:** Use Claude Code's MCP server or API if available, rather than parsing CLI output. Check if `claude` CLI has a `--json` or programmatic output mode.

## File Structure

```
vsai-app/
├── package.json
├── electron/
│   ├── main.ts          — Electron main process
│   ├── preload.ts       — Preload script (IPC bridge)
│   └── pty.ts           — node-pty terminal backend
├── src/
│   ├── App.tsx          — Root component
│   ├── main.tsx         — React entry point
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatPanel.tsx      — Chat message list + input
│   │   │   ├── ChatMessage.tsx    — Single message renderer
│   │   │   ├── ChatInput.tsx      — Multi-line input with image paste
│   │   │   ├── ToolCallCard.tsx   — Expandable tool call display
│   │   │   └── DiffView.tsx       — Inline diff renderer
│   │   ├── Terminal/
│   │   │   └── TerminalPanel.tsx  — xterm.js wrapper
│   │   ├── Git/
│   │   │   ├── GitSidebar.tsx     — Full git sidebar
│   │   │   ├── ChangedFiles.tsx   — File list with stage/unstage
│   │   │   ├── CommitBox.tsx      — Commit message + button
│   │   │   └── ClaudeActivity.tsx — Claude's recent commits
│   │   ├── Nav/
│   │   │   └── NavBar.tsx         — Left icon bar
│   │   └── TitleBar/
│   │       └── TitleBar.tsx       — Project selector + settings
│   ├── services/
│   │   ├── claude.ts    — Claude Code CLI process management
│   │   ├── git.ts       — Git operations via simple-git
│   │   ├── terminal.ts  — Terminal session management
│   │   └── projects.ts  — Project config persistence
│   └── styles/
│       └── globals.css  — Global styles, VS Code-like dark theme
├── index.html
└── vite.config.ts       — Vite for React bundling
```

## Styling

- Dark theme by default (VS Code dark inspired)
- CSS variables for theming
- Monospace font for code/terminal, system font for UI
- Subtle borders between panels
- Smooth sidebar expand/collapse animation

## Out of Scope (v1)

- File explorer sidebar
- Search sidebar
- Multiple AI providers (Claude only)
- Extension system
- Settings UI (config file only)
- Multi-project tabs (dropdown switch only)
- Custom themes
