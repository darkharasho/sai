# Terminal Mode — Design Spec

A Warp-inspired terminal-first view where commands and their output render as structured blocks, with inline AI assistance and an approval flow for AI-suggested commands.

## Visual Reference

Mockups live in `.superpowers/brainstorm/933730-1775439729/content/` (v5 is final). Key visual decisions:

- All block headers share the same `#0d1117` background as the body — separated by a faint `#21262d` border, not a distinct header bar.
- Connected blocks share a single thin `#21262d` separator, not double borders.
- 4px border-radius everywhere. Gradient input border matches ChatInput exactly.
- Lucide icons throughout: Copy, Sparkles, RotateCw, Check, X, Pencil, SquarePlus, SquareSlash, ChevronDown, PanelRightClose, CornerDownLeft.

## Architecture

### Navigation

A `SquareTerminal` icon is added to `NavBar.tsx` as a third button. Unlike files/git (which open sidebars), this triggers a full view switch.

`App.tsx` gains a new state: `activeView: 'default' | 'terminal-mode'`. When `terminal-mode` is active, the main content area renders `<TerminalModeView>` instead of the accordion panels. The nav bar and file/git sidebars remain functional.

### Component Tree

```
App.tsx
  NavBar (+ SquareTerminal button)
  if activeView === 'default':
    existing accordion panels (chat, editor, terminal)
  if activeView === 'terminal-mode':
    TerminalModeView/
      TerminalModeBlockList    (scrollable block area, centered ~70% width)
        CommandBlock            (command + output + status)
        AIResponseBlock         (purple-bordered AI message)
        ApprovalBlock           (pending command with approve/reject/edit)
      TerminalModeInput         ($ prompt with Tab→AI toggle)
      TerminalModeEditor        (collapsible right-side code panel)
```

### New Files

| File | Purpose |
|------|---------|
| `src/components/TerminalMode/TerminalModeView.tsx` | Top-level view container, owns block state and PTY lifecycle |
| `src/components/TerminalMode/TerminalModeBlockList.tsx` | Scrollable block renderer, handles grouping and connectors |
| `src/components/TerminalMode/CommandBlock.tsx` | Single command block: command row, output, status, action icons |
| `src/components/TerminalMode/AIResponseBlock.tsx` | AI response with purple border, markdown rendering |
| `src/components/TerminalMode/ApprovalBlock.tsx` | Pending command with approve/reject/edit buttons |
| `src/components/TerminalMode/TerminalModeInput.tsx` | Input bar with shell/AI toggle |
| `src/components/TerminalMode/TerminalModeEditor.tsx` | Collapsible right-side read-only code panel |
| `src/components/TerminalMode/types.ts` | Block type definitions |

## Block Data Model

```typescript
type CommandBlock = {
  type: 'command'
  id: string
  command: string
  output: string
  exitCode: number | null    // null = still running
  startTime: number
  duration: number | null
  groupId?: string           // links consecutive commands
}

type AIResponseBlock = {
  type: 'ai-response'
  id: string
  content: string            // markdown
  parentBlockId: string      // which command triggered it
}

type ApprovalBlock = {
  type: 'approval'
  id: string
  command: string
  parentBlockId: string      // which AI response suggested it
  status: 'pending' | 'approved' | 'rejected' | 'edited'
}

type Block = CommandBlock | AIResponseBlock | ApprovalBlock
```

### Grouping

Consecutive `CommandBlock`s share a `groupId` and render as connected blocks (shared border, no gap between them). A new group starts after an AI response block, an approval block, or a pause in user input.

### Connectors

Colored vertical lines (2px, left-aligned at 16px margin) link related blocks:
- **Purple** (`#a371f744`) — connects a command to its AI response
- **Amber** (`#d2992233`) — connects an AI response to its approval block
- **Gray** (`#30363d33`) — connects an approval to the next group

## PTY Integration

Terminal Mode creates its own PTY via `window.sai.terminalCreate(cwd)` when the view mounts. This is separate from the regular terminal tabs.

### Command Execution Flow

1. User submits a command in the input bar.
2. A `CommandBlock` is created with `exitCode: null` (running state).
3. Command is written to PTY via `window.sai.terminalWrite(ptyId, command + '\n')`.
4. Output is captured via `window.sai.terminalOnData` — appended to the block's `output` field.
5. Command completion is detected by watching for the shell prompt pattern (reuse `PROMPT_RE` from `terminalBuffer.ts`).
6. `exitCode` is determined by injecting `; echo __EXIT:$?__` after each command. The PTY data listener watches for the `__EXIT:<code>__` marker, parses the exit code, and calculates `duration`.

### Output Capture

The PTY data listener accumulates raw output. The command row itself (the echoed input) is stripped from the output. ANSI escape codes are stripped for display in the structured blocks (use a lightweight ANSI stripper — the output renders as plain monospace text, not a full terminal emulator).

## Block Actions

Each command block has three icon actions in the top-right (muted, brighter on hover):

| Icon | Action | Behavior |
|------|--------|----------|
| Copy | Copy output | Copies the block's output text to clipboard |
| Sparkles | Ask AI | Sends `{command, output, exitCode}` to the active AI provider. Streams response into an `AIResponseBlock`. If the AI suggests a command, creates an `ApprovalBlock`. |
| RotateCw | Rerun | Re-executes the same command, creates a new `CommandBlock` |

AI response blocks have:
- **Copy** — copies the response text
- **ChevronDown** — collapse/expand the response

## Input Bar

### Shell Mode (default)

- Accent-colored `$` prompt
- Enter sends command to PTY
- Animated gradient border (same as ChatInput: accent → orange → red → orange → accent, 20s sweep, mask-composite trick, 0.7 opacity)

### AI Mode (Tab to toggle)

- Purple `✦` prompt
- Enter sends natural language to the AI provider
- Response appears as `AIResponseBlock`, suggested commands as `ApprovalBlock`
- Tab toggles back to shell mode

### Toolbar (bottom of input)

- Left: `SquarePlus` (attach context), `SquareSlash` (slash commands) — only in AI mode
- Right: `tab → ✦ ai` hint (shell mode) or `tab → $ shell` hint (AI mode), model selector, `CornerDownLeft` (submit)

## Approval Flow

When an `ApprovalBlock` is pending:

| Action | Icon/Button | Behavior |
|--------|-------------|----------|
| Approve | Green `Check` + "approve" label | Executes the command, creates a `CommandBlock` with result |
| Reject | Red `X` + "reject" label (0.5 opacity) | Marks block as rejected, no execution |
| Edit | `Pencil` icon | Populates input bar with the command text for modification |

## Editor Side Panel

- Collapsible right-side panel (260px wide), toggled by `PanelRightClose` icon.
- Tab bar at top for open files, active tab has accent-colored bottom border.
- Read-only Monaco editor instance showing file content with syntax highlighting.
- Problem lines highlighted with red background tint.

### Auto-open triggers:
- AI response references a specific file path → opens and scrolls to the relevant line.
- User clicks a file path in any block → opens in the side panel.

### Stays closed when:
- Pure shell usage with no AI involvement.
- User explicitly closes it.

## Styling

All styling uses CSS variables from the existing theme system (`var(--bg-secondary)`, `var(--border)`, `var(--text)`, `var(--accent)`, etc.) so terminal mode adapts to theme changes.

Block-specific colors (hardcoded in the mockup) map to CSS variables:
- Success status: `var(--green)`
- Failure status: `var(--red)`
- AI response border: `#a371f733` (purple, can be a new CSS variable `--purple`)
- Command text: `#58a6ff` (blue, can be `--blue`)

## Out of Scope for v1

- **Persistent sessions** — blocks are in-memory only, cleared on view switch.
- **Interactive programs** — `vim`, `htop`, etc. won't work. Users use the regular terminal tab.
- **Editor panel editing** — read-only in v1.
- **Command history/search** — up-arrow recall in the input is sufficient.
- **Streaming into approval blocks** — AI response completes fully before the approval block appears.
- **Multiple instances** — one terminal mode view per workspace.
