# Approval Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slide-up approval panel for Claude's per-command permission requests, with approve/deny/edit/always-allow actions.

**Architecture:** Main process (`claude.ts`) detects when Claude CLI pauses after a `tool_use` (waiting for approval) and sends an `approval_needed` message to the renderer. A new `ApprovalPanel` component renders inside ChatInput with action buttons. Approval responses go back through IPC to the CLI's stdin. "Always Allow" writes to `.claude/settings.local.json`.

**Tech Stack:** React, Electron IPC, Lucide React icons, Claude CLI stream-json protocol

---

### Task 1: Validate Claude CLI Approval Protocol

**Files:**
- None (research only)

This task determines the exact stdin/stdout format for approval in stream-json mode. The rest of the plan depends on these findings.

- [ ] **Step 1: Test approval prompt in stream-json mode**

Run Claude with `acceptEdits` and a prompt that triggers a bash command needing approval:

```bash
source ~/.nvm/nvm.sh
echo '{"type":"user","message":{"role":"user","content":"run the command: echo hello world"}}' | timeout 15 claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode default 2>/dev/null | cat
```

Observe the output. Look for:
- Does the CLI auto-approve in `-p` mode, or does it pause and send a permission message?
- If it pauses, what message type does it send? (e.g., `type: "permission_request"`, or a system message?)
- Check if there's a difference between `--permission-mode default` vs `--permission-mode acceptEdits`

- [ ] **Step 2: Test with a destructive command**

```bash
source ~/.nvm/nvm.sh
echo '{"type":"user","message":{"role":"user","content":"delete the file /tmp/test-approval-sai.txt"}}' | timeout 15 claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits 2>/dev/null | cat
```

If the CLI auto-approves everything in `-p` mode, try without `-p`:

```bash
source ~/.nvm/nvm.sh
echo '{"type":"user","message":{"role":"user","content":"run: echo hello"}}' | timeout 15 claude --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode default 2>/dev/null | cat
```

- [ ] **Step 3: Determine approval response format**

Based on what the CLI sends, test sending approval back. Likely candidates:
- `{"type": "permission_response", "permission_response": {"id": "<id>", "allowed": true}}`
- `{"type": "approval", "approved": true, "tool_use_id": "<id>"}`

If the CLI doesn't natively support interactive approval in `-p` + `stream-json` mode, the fallback approach is:
1. SAI intercepts the `tool_use` message BEFORE the CLI auto-executes
2. SAI uses the `--permission-mode default` with `--allowedTools` to control what auto-runs
3. For tools not in the allowed list, SAI shows the panel and then dynamically updates `.claude/settings.local.json` or restarts with updated `--allowedTools`

Document the exact protocol in a comment at the top of the approval handler code.

- [ ] **Step 4: Commit findings**

```bash
git add docs/superpowers/plans/2026-03-30-approval-panel.md
git commit -m "docs: add approval panel implementation plan with protocol findings"
```

---

### Task 2: Add Approval Types and Preload IPC

**Files:**
- Modify: `src/types.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add PendingApproval type to types.ts**

Add after the `ToolCall` interface (line 25):

```typescript
export interface PendingApproval {
  toolName: string;
  toolUseId: string;
  command: string;
  description: string;
  input: Record<string, any>;
}
```

- [ ] **Step 2: Update preload.ts — modify claudeApprove**

Replace line 16:

```typescript
claudeApprove: (approved: boolean) => ipcRenderer.send('claude:approve', approved),
```

with:

```typescript
claudeApprove: (projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string) =>
  ipcRenderer.send('claude:approve', projectPath, toolUseId, approved, modifiedCommand),
```

- [ ] **Step 3: Add claudeAlwaysAllow to preload.ts**

Add after the `claudeApprove` line:

```typescript
claudeAlwaysAllow: (projectPath: string, toolPattern: string) =>
  ipcRenderer.invoke('claude:alwaysAllow', projectPath, toolPattern),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
source ~/.nvm/nvm.sh && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts electron/preload.ts
git commit -m "feat: add approval types and IPC channels for tool approval panel"
```

---

### Task 3: Main Process — Approval Detection and Handlers

**Files:**
- Modify: `electron/services/claude.ts`

- [ ] **Step 1: Add approval state tracking to workspace**

Add a `pendingToolUse` field and an `approvalTimer` to track when the CLI is waiting. At the top of `ensureProcess`, after the process is attached to the workspace, add tracking state. Insert after line 105 (`ws.claude.buffer = '';`):

```typescript
ws.claude.pendingToolUse = null;
ws.claude.approvalTimer = null;
```

Note: These fields are dynamic (not in the WorkspaceClaude interface) — JavaScript allows adding arbitrary properties. If TypeScript complains, update the interface in `electron/services/workspace.ts`.

- [ ] **Step 2: Add approval detection in stdout handler**

In the `proc.stdout?.on('data', ...)` handler, after forwarding messages (line 144: `safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });`), add detection logic. Insert before the `} catch` on line 145:

```typescript
        // Track tool_use from assistant messages for approval detection
        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') {
              ws.claude.pendingToolUse = {
                toolName: block.name,
                toolUseId: block.id,
                input: block.input || {},
              };
            }
          }
        }

        // When message_stop arrives after a tool_use, start approval timer
        if (msg.type === 'stream_event' && msg.event?.type === 'message_stop' && ws.claude.pendingToolUse) {
          if (ws.claude.approvalTimer) clearTimeout(ws.claude.approvalTimer);
          ws.claude.approvalTimer = setTimeout(() => {
            // No tool_result arrived — CLI is waiting for approval
            if (ws.claude.pendingToolUse) {
              const tu = ws.claude.pendingToolUse;
              const command = tu.input.command || tu.input.file_path || JSON.stringify(tu.input);
              const description = tu.input.description || '';
              safeSend(win, 'claude:message', {
                type: 'approval_needed',
                toolName: tu.toolName,
                toolUseId: tu.toolUseId,
                command,
                description,
                input: tu.input,
                projectPath: ws.projectPath,
              });
            }
          }, 200);
        }

        // Tool result arrived — tool was auto-approved, cancel timer
        if (msg.type === 'user' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_result') {
              if (ws.claude.approvalTimer) {
                clearTimeout(ws.claude.approvalTimer);
                ws.claude.approvalTimer = null;
              }
              ws.claude.pendingToolUse = null;
            }
          }
        }
```

- [ ] **Step 3: Add claude:approve IPC handler**

In `registerClaudeHandlers`, after the `claude:stop` handler (after line 222), add:

```typescript
  // claude:approve — send approval/denial for a pending tool use
  ipcMain.on('claude:approve', (_event, projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string) => {
    const ws = get(projectPath);
    if (!ws?.claude.process) return;

    // Clear pending state
    ws.claude.pendingToolUse = null;
    if (ws.claude.approvalTimer) {
      clearTimeout(ws.claude.approvalTimer);
      ws.claude.approvalTimer = null;
    }

    // Write approval response to CLI stdin
    // NOTE: Update this format based on Task 1 protocol findings
    const response = JSON.stringify({
      type: 'permission_response',
      permission_response: {
        id: toolUseId,
        allowed: approved,
        ...(modifiedCommand ? { updated_input: { command: modifiedCommand } } : {}),
      },
    });

    const proc = ws.claude.process;
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(response + '\n');
    }
  });
```

- [ ] **Step 4: Add claude:alwaysAllow IPC handler**

After the `claude:approve` handler, add:

```typescript
  // claude:alwaysAllow — add tool to .claude/settings.local.json permissions
  ipcMain.handle('claude:alwaysAllow', async (_event, projectPath: string, toolPattern: string) => {
    const settingsPath = path.join(projectPath, '.claude', 'settings.local.json');

    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch { /* file doesn't exist yet */ }

    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    if (!settings.permissions.allow.includes(toolPattern)) {
      settings.permissions.allow.push(toolPattern);
    }

    // Ensure .claude directory exists
    const claudeDir = path.join(projectPath, '.claude');
    try { fs.mkdirSync(claudeDir, { recursive: true }); } catch { /* exists */ }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  });
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
source ~/.nvm/nvm.sh && npx tsc --noEmit
```

Expected: No errors (or only errors about the dynamic workspace properties — fix by updating WorkspaceClaude interface if needed).

- [ ] **Step 6: Commit**

```bash
git add electron/services/claude.ts electron/services/workspace.ts
git commit -m "feat: add approval detection and IPC handlers in main process"
```

---

### Task 4: Create ApprovalPanel Component

**Files:**
- Create: `src/components/Chat/ApprovalPanel.tsx`

- [ ] **Step 1: Create the ApprovalPanel component**

```tsx
import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { ShieldAlert, Check, X, ShieldCheck } from 'lucide-react';
import type { PendingApproval } from '../../types';

interface ApprovalPanelProps {
  approval: PendingApproval;
  onApprove: (modifiedCommand?: string) => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export default function ApprovalPanel({ approval, onApprove, onDeny, onAlwaysAllow }: ApprovalPanelProps) {
  const [command, setCommand] = useState(approval.command);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isBash = approval.toolName === 'Bash';

  useEffect(() => {
    setCommand(approval.command);
  }, [approval.command]);

  useEffect(() => {
    // Focus the command textarea (or the panel) for keyboard shortcuts
    if (isBash && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [approval.toolUseId, isBash]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const modified = command !== approval.command ? command : undefined;
      onApprove(modified);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onDeny();
    }
  };

  const toolLabel = isBash ? 'wants to run a command'
    : approval.toolName === 'Edit' ? 'wants to edit a file'
    : approval.toolName === 'Write' ? 'wants to write a file'
    : `wants to use ${approval.toolName}`;

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: 8,
      overflow: 'hidden',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      animation: 'approvalSlideUp 0.2s ease-out',
    }} onKeyDown={!isBash ? handleKeyDown : undefined} tabIndex={!isBash ? 0 : undefined}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' }}>
        <ShieldAlert size={16} style={{ color: 'var(--accent)' }} />
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12, fontWeight: 600, color: 'var(--accent)',
        }}>{approval.toolName}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{toolLabel}</span>
      </div>

      {/* Command field */}
      {isBash ? (
        <textarea
          ref={textareaRef}
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={Math.min(command.split('\n').length, 6)}
          style={{
            margin: '8px 14px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            color: 'var(--text)',
            lineHeight: 1.5,
            outline: 'none',
            width: 'calc(100% - 28px)',
            resize: 'none',
            minHeight: 36,
          }}
        />
      ) : (
        <div style={{
          margin: '8px 14px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 12px',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
          color: 'var(--text)',
          lineHeight: 1.5,
          maxHeight: 120,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{approval.command}</div>
      )}

      {/* Description */}
      {approval.description && (
        <div style={{ padding: '0 14px', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          {approval.description}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px 10px' }}>
        <button
          onClick={() => {
            const modified = command !== approval.command ? command : undefined;
            onApprove(modified);
          }}
          style={{
            background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <Check size={14} /> Approve
        </button>
        <button
          onClick={onDeny}
          style={{
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <X size={14} /> Deny
        </button>
        <button
          onClick={onAlwaysAllow}
          style={{
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <ShieldCheck size={14} /> Always Allow
        </button>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <kbd style={{
            background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3,
            padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: 'var(--text-secondary)',
          }}>Enter</kbd> approve
          <span>·</span>
          <kbd style={{
            background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 3,
            padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: 'var(--text-secondary)',
          }}>Esc</kbd> deny
        </span>
      </div>

      <style>{`
        @keyframes approvalSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
source ~/.nvm/nvm.sh && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/ApprovalPanel.tsx
git commit -m "feat: create ApprovalPanel slide-up component"
```

---

### Task 5: Wire ApprovalPanel into ChatInput and ChatPanel

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Add pendingApproval prop to ChatInput**

In `ChatInput.tsx`, add to the `ChatInputProps` interface (after line 27 `aiProvider?: ...`):

```typescript
pendingApproval?: PendingApproval | null;
onApprove?: (modifiedCommand?: string) => void;
onDeny?: () => void;
onAlwaysAllow?: () => void;
```

Add the import at the top:

```typescript
import type { PendingApproval } from '../../types';
import ApprovalPanel from './ApprovalPanel';
```

Destructure the new props in the component function signature.

- [ ] **Step 2: Render ApprovalPanel in ChatInput**

Find where the `.input-box` div is rendered (the main container with the textarea and toolbar). Immediately before it, add:

```tsx
{pendingApproval && onApprove && onDeny && onAlwaysAllow && (
  <ApprovalPanel
    approval={pendingApproval}
    onApprove={onApprove}
    onDeny={onDeny}
    onAlwaysAllow={onAlwaysAllow}
  />
)}
```

On the `.input-box` div itself, add conditional dimming:

```tsx
style={{
  ...existingStyles,
  opacity: pendingApproval ? 0.4 : 1,
  pointerEvents: pendingApproval ? 'none' : 'auto',
}}
```

- [ ] **Step 3: Add pendingApproval state and handlers in ChatPanel**

In `ChatPanel.tsx`, add the import:

```typescript
import type { PendingApproval } from '../../types';
```

Add state (after `slashCommands` state on line 486):

```typescript
const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
```

In the message handler (`window.sai.claudeOnMessage` callback), add handling for the `approval_needed` message type. Add before the `// Skip system noise` comment (line 614):

```typescript
      // Tool approval request from main process
      if (msg.type === 'approval_needed') {
        setPendingApproval({
          toolName: msg.toolName,
          toolUseId: msg.toolUseId,
          command: msg.command,
          description: msg.description,
          input: msg.input,
        });
        return;
      }
```

Also clear `pendingApproval` when a `tool_result` arrives. In the existing tool_result handler (around line 619-648), add at the start of the `if (results.length > 0)` block:

```typescript
setPendingApproval(null);
```

- [ ] **Step 4: Add approval action handlers in ChatPanel**

Add before the `handleSend` function (around line 857):

```typescript
  const handleApprove = (modifiedCommand?: string) => {
    if (!pendingApproval) return;
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true, modifiedCommand);
    setPendingApproval(null);
  };

  const handleDeny = () => {
    if (!pendingApproval) return;
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, false);
    setPendingApproval(null);
  };

  const handleAlwaysAllow = async () => {
    if (!pendingApproval) return;
    const pattern = `${pendingApproval.toolName}(*)`;
    await window.sai.claudeAlwaysAllow(projectPath, pattern);
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true);
    setPendingApproval(null);
  };
```

- [ ] **Step 5: Pass props to ChatInput**

In the `<ChatInput ... />` JSX (around line 955), add the new props:

```tsx
pendingApproval={pendingApproval}
onApprove={handleApprove}
onDeny={handleDeny}
onAlwaysAllow={handleAlwaysAllow}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
source ~/.nvm/nvm.sh && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatInput.tsx src/components/Chat/ChatPanel.tsx
git commit -m "feat: wire approval panel into chat UI with approve/deny/always-allow"
```

---

### Task 6: End-to-End Testing and Protocol Adjustment

**Files:**
- Modify: `electron/services/claude.ts` (if protocol format needs adjustment)

- [ ] **Step 1: Build the app**

```bash
source ~/.nvm/nvm.sh && npx tsc && npx vite build
```

- [ ] **Step 2: Run the app and test approval flow**

Launch the Electron app in dev mode:

```bash
source ~/.nvm/nvm.sh && npm run electron:dev
```

1. Open a project workspace
2. Ensure permission mode is set to "Default Approvals" (not bypass)
3. Send a message that triggers a Bash command: "list the files in this directory"
4. Observe: does the approval panel appear? Does the CLI pause?

- [ ] **Step 3: Adjust protocol format based on test results**

If the CLI auto-approves everything in `-p` mode:
- Switch from `-p` to using just `--input-format stream-json --output-format stream-json` without `-p`
- OR: Use `--permission-mode default` (which prompts for most tools) instead of `acceptEdits`
- Update `buildArgs()` in `claude.ts` accordingly

If the approval panel appears but the stdin response format is wrong:
- Check CLI stderr for error messages
- Adjust the `claude:approve` handler's response JSON format
- Common formats to try:
  - `{"type": "permission_response", "permission_response": {"id": "...", "allowed": true}}`
  - `{"type": "tool_result", "tool_use_id": "...", "approved": true}`

- [ ] **Step 4: Test approve action**

1. Trigger a bash command
2. When panel appears, click "Approve"
3. Verify: command executes and result appears in chat

- [ ] **Step 5: Test deny action**

1. Trigger a bash command
2. Click "Deny"
3. Verify: command is skipped, Claude acknowledges denial

- [ ] **Step 6: Test edit + approve**

1. Trigger a bash command (e.g., `rm -rf node_modules`)
2. Edit the command in the textarea to something safe (e.g., `echo "modified"`)
3. Click "Approve"
4. Verify: the modified command runs, not the original

- [ ] **Step 7: Test Always Allow**

1. Trigger a Bash command
2. Click "Always Allow"
3. Verify: `.claude/settings.local.json` now contains `"Bash(*)"`
4. Send another message that triggers Bash
5. Verify: no approval panel appears — CLI auto-approves

- [ ] **Step 8: Test keyboard shortcuts**

1. Trigger a command, press Enter → should approve
2. Trigger a command, press Esc → should deny
3. Trigger a command, edit text, press Enter → should approve with modified text

- [ ] **Step 9: Commit final adjustments**

```bash
git add -A
git commit -m "feat: complete approval panel with tested protocol integration"
```
