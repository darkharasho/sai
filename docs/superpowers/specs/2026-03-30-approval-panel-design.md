# Approval Panel Design

## Overview

A slide-up approval panel for Claude's tool/command permission requests. When Claude is in `acceptEdits` mode and wants to run a tool that requires permission (e.g., Bash commands), a panel slides up from the bottom of the chat, replacing the input area temporarily. The user can approve, deny, edit the command before approving, or always-allow the tool.

**Scope:** Claude provider only. Codex and Gemini use upfront permission modes (CLI flags) with no interactive per-command approval.

## Features

- Slide-up panel anchored to the bottom of the chat area (VS Code style)
- Tool name, editable command/args, description display
- Approve / Deny / Always Allow actions
- Keyboard shortcuts: Enter to approve, Esc to deny
- Editable command field for Bash tool calls (modify before approving)
- "Always Allow" writes to `.claude/settings.local.json` — uses Claude CLI's native permission system
- Input box dimmed and disabled while approval is pending

## Message Flow

1. Claude CLI sends `type: 'assistant'` message with `tool_use` content block, then `stop_reason: "tool_use"` and `message_stop`
2. Main process (`claude.ts`): Detects the CLI has paused after a tool_use (no `tool_result` follows). Forwards the tool_use message to the renderer with an `approval_needed` flag
3. Renderer (`ChatPanel.tsx`): Sets `pendingApproval` state with tool details. Passes to `ChatInput` which renders the `ApprovalPanel` component
4. User acts: Approve / Deny / Edit+Approve / Always Allow
5. Renderer sends decision back via IPC (`claude:approve`)
6. Main process: Writes the approval response to the CLI's stdin as JSON
7. CLI executes (or skips) the tool and resumes streaming

## Always Allow

Uses Claude CLI's native permission system rather than a separate SAI-managed list:

- "Always Allow" button reads `.claude/settings.local.json` from the project directory
- Adds the tool pattern to `permissions.allow` (e.g., `"Bash(*)"`)
- Writes the file back
- Claude CLI respects these rules immediately on next tool call — no restart needed
- To revoke: user edits `.claude/settings.local.json` (future: UI for managing rules)

## Components

### `ApprovalPanel.tsx` (new)

Renders inside the `ChatInput` area, above the dimmed input box.

**Visual design:**
- Background: `var(--bg-elevated)` (#1c2027)
- Border: `1px solid var(--border)`, border-radius: 10px
- Shadow: `0 -4px 24px rgba(0,0,0,0.4)`
- Slide-up animation: translateY(20px) + opacity, 200ms ease-out

**Header row:**
- Lucide `shield-alert` icon in accent color
- Tool name in monospace, accent color
- Label: "wants to run a command" (or appropriate per tool type)

**Command field:**
- Editable textarea for Bash commands
- Read-only preview for file operations (Edit, Write) showing file path and content/diff
- Monospace font, dark background (`var(--bg-secondary)`)
- Focus border: accent color

**Description:**
- 11px muted text showing the tool's description field if present

**Action buttons:**
- **Approve**: Gold accent background (`var(--accent)`), black text, Lucide `check` icon. Keyboard: `Enter`
- **Deny**: Outlined, muted text, Lucide `x` icon. Keyboard: `Esc`
- **Always Allow**: Outlined, muted text, Lucide `shield-check` icon. Writes to `.claude/settings.local.json` then approves
- Keyboard hint text on the right: `Enter approve · Esc deny`

### ChatPanel.tsx (modified)

**New state:**
- `pendingApproval: { toolName: string, toolUseId: string, command: string, description: string, input: Record<string, any> } | null`

**Message handling:**
- After receiving a `message_stop` with `stop_reason: "tool_use"`, extract the tool_use details from the preceding assistant message content blocks
- Detection: if the CLI sends a `tool_use` content block followed by `message_stop` and no `tool_result` arrives within a short window (~100ms), the CLI is waiting for approval. If a `tool_result` arrives immediately, the tool was auto-approved and no panel is needed
- Set `pendingApproval` with the tool details extracted from the preceding `tool_use` content block
- Clear `pendingApproval` when approval response is sent or when a `tool_result` arrives

### ChatInput.tsx (modified)

- Accepts `pendingApproval` prop
- When non-null, renders `ApprovalPanel` above the input box
- Input box gets `opacity: 0.4` and `pointer-events: none` while approval is pending

## IPC Changes

### Preload (`preload.ts`)

Update existing stub:
```typescript
claudeApprove: (projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string) =>
  ipcRenderer.send('claude:approve', projectPath, toolUseId, approved, modifiedCommand),
```

Add new:
```typescript
claudeAlwaysAllow: (projectPath: string, toolPattern: string) =>
  ipcRenderer.invoke('claude:alwaysAllow', projectPath, toolPattern),
```

### Main process (`claude.ts`)

**`claude:approve` handler:**
- Receives `(projectPath, toolUseId, approved, modifiedCommand?)`
- Writes approval response to the CLI's stdin as JSON
- Exact stdin format TBD — needs testing with Claude CLI's stream-json protocol

**`claude:alwaysAllow` handler:**
- Reads `<projectPath>/.claude/settings.local.json`
- Adds tool pattern to `permissions.allow` array (creates file/structure if needed)
- Writes file back
- Then sends approval for the current pending request

## Open Questions

- **Stdin approval format**: The exact JSON format Claude CLI expects for approval/denial responses in `--input-format stream-json` mode needs to be determined during implementation. Will test by examining CLI behavior.
- **Tool-specific display**: For non-Bash tools (Edit, Write, Read), what content to show in the panel — file path only, or also the file content/diff? Start with file path + input args, iterate.

## Mockup

See `.superpowers/brainstorm/` for the interactive HTML mockup showing the panel layout with Lucide icons and the app's color scheme.
