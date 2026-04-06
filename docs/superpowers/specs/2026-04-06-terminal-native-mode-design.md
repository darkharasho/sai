# Terminal-Native Mode Design

**Date:** 2026-04-06
**Status:** Draft
**Replaces:** Terminal Mode block-based architecture (2026-04-05-terminal-mode-design.md)

## Problem

Terminal Mode's block-based architecture creates a jarring experience for SSH and other long-running commands. Each SSH command triggers a LiveTerminal that takes over 70% of the viewport with a disruptive layout shift. Since SSH is inherently long-running, users who SSH frequently are constantly cycling through this 70/30 layout change. The block-first, terminal-second model doesn't match how people actually use terminals.

## Solution

Redesign Terminal Mode with the terminal as the primary layer. An always-live PTY/xterm is the base, and block rendering is a visual treatment applied on top of the terminal data stream — not a replacement for it. AI interactions appear inline in the terminal flow, Warp-style. SSH sessions are completely transparent because the PTY never changes.

## Core Architecture

### Always-Live PTY

- A single PTY (via node-pty) is always running, created when Terminal Mode mounts
- The PTY is the source of truth — everything else is a rendering concern
- SSH, interactive commands, and long-running processes all work naturally because the PTY is never interrupted

### Rendering Approach

The view does **not** use a raw xterm.js canvas. Instead, the PTY data stream feeds into the block segmenter, which produces structured block data (command, output, timestamps, exit codes). React components render these blocks as styled cards in a scrollable list. The xterm.js instance runs hidden — used only as a terminal state machine for ANSI parsing, cursor tracking, and alternate screen buffer detection. The visible UI is entirely React-rendered cards.

When the segmenter detects an interactive/full-screen program (alternate screen buffer), the hidden xterm canvas is promoted to visible and takes over rendering until the program exits. This is the only time raw xterm is shown.

### Block Segmenter

A new component that sits between the raw xterm data stream and the visual layer. It watches terminal output and segments it into visual blocks:

1. **Prompt detection** — regex matching against terminal output to find shell prompts (`user@host:~$`, `$`, `%`, `❯`, etc.). Uses the same `PROMPT_RE` pattern as the existing Terminal Mode.
2. **Block creation** — everything between two prompts (command + output) gets wrapped in a visual card.
3. **Duration tracking** — calculated from prompt-to-prompt timing.

The block segmenter does not need special SSH logic. When the user SSHes into a remote machine, the prompt pattern naturally changes (e.g., `mstephens@local` → `deploy@prod`). The segmenter detects whatever prompt the remote shell uses and continues grouping commands into blocks. The context badge in the header updates based on the current prompt pattern.

### What Stays from Current Terminal Mode

- Shell/AI mode toggle
- AI provider switching (Claude/Codex/Gemini)
- Command approval flow for AI-suggested commands
- Auto-detection of commands and context
- Input bar at the bottom

### What Changes

- No more `LiveTerminal` component — the terminal IS the view
- No more 300ms delay + layout shift for long-running commands
- Blocks are visual decorations on the terminal stream, not discrete state objects
- AI responses render inline in the terminal flow instead of as separate block types

## AI Interaction Model

### Triggering AI

`Cmd+K` opens an inline AI input field right in the terminal flow. No panel switch, no mode change. Type a question, hit Enter, and the response appears inline. `Escape` cancels back to shell mode.

### AI Response Rendering

AI responses appear as inline cards in the terminal flow, visually distinct with a purple accent border (`#2d2454` border, `#13111e` background). They contain:

- The user's question (shown as context in italics)
- The AI's response text with markdown rendering
- Suggested commands with **Run** / **Skip** buttons

### Running Suggested Commands

Clicking "Run" writes the command directly to the PTY — exactly like typing it. The command appears in the terminal flow as a normal command block, tagged with a subtle "via AI" label. This works identically whether local or SSHed — the command goes to whatever shell the PTY is connected to.

### AI Context

The AI sees recent command blocks (command + output) from the block segmenter's parsed output. Same principle as the current approach of passing terminal context, but sourced from the segmenter's structured data rather than raw buffer scraping.

### Approval Flow

When the AI provider wants to run a tool or command autonomously, the approval block appears inline in the flow — same approve/reject/edit UX, rendered as an inline card with the purple AI accent.

## Block Segmentation Details

### Block States

1. **Collapsed** — command header only, dimmed (`opacity: 0.6`). Click to expand. Older blocks auto-collapse.
2. **Expanded** — full command + output visible. Recent blocks default to expanded. Click header to collapse.
3. **Active / Streaming** — currently running command. Output streams in real-time. Green pulse indicator. Cannot be collapsed.

### Prompt Changes (SSH)

The segmenter tracks the current prompt pattern. When SSH changes the prompt:
- A new block begins with the remote prompt
- The context badge in the header updates (e.g., "local" → `deploy@prod-server`)
- Prompt color changes from green (local) to amber (remote)
- No layout shift, no mode change — just visual indicators

### Interactive Programs (vim, htop, less)

The block segmenter detects full-screen programs by watching for the alternate screen buffer entry sequence (`\e[?1049h`). When detected, the hidden xterm canvas is promoted to visible and takes over the view. When the program exits (alternate screen buffer exit: `\e[?1049l`) and a prompt returns, the xterm canvas hides again and block rendering resumes.

### Long Output

Blocks with large output get a max-height with scroll within the block card. A "Show all" toggle expands to full height.

### Empty Commands / Ctrl+C

An Enter on empty input or a Ctrl+C on a partial command advances the prompt in the flow with a minimal empty block — same as hitting Enter in a real terminal.

### Rapid Commands

If the user pastes or runs multiple commands quickly, each still gets its own block. The segmenter buffers until it sees the next prompt before finalizing a block.

## Input Bar & Keybindings

### Input Bar

Stays at the bottom of the view. Shows the current prompt context (local user/path or remote user/host) and the cursor.

### Two Input Modes

- **Shell mode** (default) — keystrokes go directly to the PTY.
- **AI mode** — triggered by `Cmd+K`. Inline text field with purple accent. Type question, hit Enter, response appears inline. `Escape` cancels.

### Keybindings

| Key | Action |
|-----|--------|
| `Cmd+K` | Toggle AI input |
| `Enter` | Shell: send command to PTY. AI: send question to provider. |
| `Up/Down` | Shell history (handled by the shell via PTY) |
| `Ctrl+C` | Send SIGINT to PTY |
| `Cmd+Shift+K` | Collapse/expand all blocks |
| Click "Run" | Write suggested command to PTY |

### Tab Completion

Handled natively by the shell through the PTY. No custom `compgen` calls needed since the terminal is always live.

## Visual Design

### Layout

- Full-width terminal view with blocks as visual cards
- No sidebar, no split panes — everything inline
- Header bar with: view title, AI provider indicator, current path, local/remote badge
- Input bar at bottom with prompt context and `Cmd+K` hint

### Color System

**Command blocks:**
- Card background: `#111417`
- Card border: `#1a1e24`
- Output left-border: `#1e2328`
- Success accent: `#22c55e`
- Failure accent: `#ef4444`
- Local prompt: `#22c55e` (green)
- Remote prompt: `#f59e0b` (amber)

**AI blocks:**
- Card background: `#13111e`
- Card border: `#2d2454`
- AI accent: `#8b5cf6`
- AI icon: `⬡` with purple coloring

**General:**
- View background: `#0a0d0f`
- Input bar background: `#0c0e11`
- Font: JetBrains Mono / system monospace
- Font size: 12-13px

### Block Anatomy

```
┌─────────────────────────────────────────────────────────┐
│ ▼ user@host ~/path $ command                    exit 0 · 1.2s │
│ ┃ output line 1                                               │
│ ┃ output line 2                                               │
│ ┃ output line 3                                               │
└─────────────────────────────────────────────────────────┘
```

- `▼/▶` toggle for collapse/expand
- Prompt with user, path, and command
- Exit code + duration right-aligned
- Output indented with subtle left border
- "via AI" label when command originated from AI suggestion

## Error Handling

### SSH Connection Drops

The PTY is local and stays alive. The remote prompt disappears, the shell drops back to the local prompt, and the segmenter picks up the local prompt pattern. The context badge updates from remote back to local. No special handling needed.

### PTY Crash / Restart

If the PTY dies, recreate it and show a "Terminal restarted" indicator in the flow. Same restart logic as the current workspace suspension/resume handling.

## Out of Scope (v1)

- Multiple concurrent terminal instances within Terminal Mode
- Session persistence / replay across view switches
- Custom prompt pattern configuration
- Remote file editing through the terminal
- Split-pane multiple terminals within Terminal Mode
