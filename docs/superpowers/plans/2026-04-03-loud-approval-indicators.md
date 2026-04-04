# Loud Approval Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pending approvals highly visible across titlebar, dropdown, banner, and system notifications so they get acted on quickly.

**Architecture:** Add an `approval_resolved` IPC event to complement the existing `approval_needed` event. Track approval state in a `Map<string, PendingApproval>` in App.tsx. Feed this into a new ApprovalBanner component and augmented TitleBar. Fire an immediate system notification from notify.ts.

**Tech Stack:** React, Electron IPC, CSS keyframe animations

---

### Task 1: Backend — Emit `approval_resolved` IPC and trigger notification

**Files:**
- Modify: `electron/services/claude.ts:449-451` (deny path cleanup), `electron/services/claude.ts:542-545` (approve path cleanup)
- Modify: `electron/services/notify.ts` (add `notifyApproval` function)
- Modify: `electron/services/claude.ts:210-218` (approval_needed — add notification call)

- [ ] **Step 1: Add `notifyApproval` to notify.ts**

Add after the existing `notifyCompletion` function (after line 85):

```typescript
/**
 * Fire an immediate system notification when a workspace needs approval.
 * Unlike completion notifications, this always fires regardless of focus.
 */
export function notifyApproval(win: BrowserWindow, workspaceName: string, toolName: string, command: string) {
  if (win.isDestroyed()) return;
  if (!isEnabled()) return;

  win.flashFrame(true);

  if (Notification.isSupported()) {
    const cmdSnippet = command.length > 100 ? command.slice(0, 100) + '…' : command;
    new Notification({
      title: `Approval needed — ${workspaceName}`,
      body: `${toolName}: ${cmdSnippet}`,
    }).show();
  }
}
```

- [ ] **Step 2: Import `notifyApproval` in claude.ts**

At the top of `electron/services/claude.ts`, find the existing import from `./notify` (it imports `notifyCompletion`). Add `notifyApproval` to the same import:

```typescript
import { notifyCompletion, notifyApproval } from './notify';
```

If there's no existing import from `./notify`, add:

```typescript
import { notifyCompletion, notifyApproval } from './notify';
```

- [ ] **Step 3: Call `notifyApproval` when `approval_needed` is sent**

In `electron/services/claude.ts`, right after the `safeSend(win, 'claude:message', { type: 'approval_needed', ... })` block (line 218), add:

```typescript
const wsName = ws.projectPath.split('/').pop() || ws.projectPath;
notifyApproval(win, wsName, tu.toolName, command);
```

- [ ] **Step 4: Emit `approval_resolved` on deny path**

In `electron/services/claude.ts`, in the deny path, right after line 451 (`ws.claude.pendingToolUse = null;`) and before the `return;` on line 452, add:

```typescript
safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath });
```

- [ ] **Step 5: Emit `approval_resolved` on approve path**

In `electron/services/claude.ts`, in the approve path, right after line 545 (`ws.claude.pendingToolUse = null;`), add:

```typescript
safeSend(win, 'claude:message', { type: 'approval_resolved', projectPath: ws.projectPath });
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build` (or the project's build command)
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add electron/services/claude.ts electron/services/notify.ts
git commit -m "feat(approval): emit approval_resolved IPC, add notifyApproval system notification"
```

---

### Task 2: App.tsx — Track approval state and pass as props

**Files:**
- Modify: `src/App.tsx:107-108` (state declarations), `src/App.tsx:510-545` (message listener), `src/App.tsx:1263-1278` (TitleBar props)

- [ ] **Step 1: Add `approvalWorkspaces` state**

In `src/App.tsx`, after line 108 (`const [busyWorkspaces, setBusyWorkspaces] = ...`), add:

```typescript
const [approvalWorkspaces, setApprovalWorkspaces] = useState<Map<string, PendingApproval>>(new Map());
```

Make sure `PendingApproval` is imported from `./types` (check existing imports at top of file — it may already be imported; if not, add it).

- [ ] **Step 2: Handle `approval_needed` and `approval_resolved` in the message listener**

In `src/App.tsx`, inside the `useEffect` that listens to `claudeOnMessage` (around line 510-545), add handling for the two new message types. After the `if (msg.type === 'streaming_start')` block (line 516) and before the `if (msg.type === 'result' || msg.type === 'done')` block (line 519), add:

```typescript
if (msg.type === 'approval_needed') {
  setApprovalWorkspaces(prev => {
    const next = new Map(prev);
    next.set(msg.projectPath, {
      toolName: msg.toolName,
      toolUseId: msg.toolUseId,
      command: msg.command,
      description: msg.description,
      input: msg.input,
    });
    return next;
  });
}
if (msg.type === 'approval_resolved') {
  setApprovalWorkspaces(prev => {
    if (!prev.has(msg.projectPath)) return prev;
    const next = new Map(prev);
    next.delete(msg.projectPath);
    return next;
  });
}
```

- [ ] **Step 3: Pass `approvalWorkspaces` to TitleBar**

In `src/App.tsx`, in the `<TitleBar>` JSX (around line 1263), add the new prop:

```tsx
<TitleBar
  projectPath={projectPath}
  onProjectChange={handleProjectSwitch}
  completedWorkspaces={completedWorkspaces}
  busyWorkspaces={busyWorkspaces}
  approvalWorkspaces={new Set(approvalWorkspaces.keys())}
  onSettingChange={(key, value) => {
```

- [ ] **Step 4: Render ApprovalBanner after TitleBar**

In `src/App.tsx`, right after the `<TitleBar ... />` closing tag (around line 1278) and before `<div className="app-body">` (line 1279), add:

```tsx
<ApprovalBanner
  approvalWorkspaces={approvalWorkspaces}
  currentProjectPath={projectPath}
  onSwitchToWorkspace={handleProjectSwitch}
/>
```

Add the import at the top of the file:

```typescript
import ApprovalBanner from './components/ApprovalBanner';
```

Note: `ApprovalBanner` doesn't exist yet — the build will fail until Task 4. That's fine.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(approval): track approvalWorkspaces state, wire to TitleBar and ApprovalBanner"
```

---

### Task 3: TitleBar — Blinking approval indicator and dropdown badge

**Files:**
- Modify: `src/components/TitleBar.tsx:27` (props interface), `src/components/TitleBar.tsx:29` (destructure), `src/components/TitleBar.tsx:136-147` (titlebar indicator), `src/components/TitleBar.tsx:170-176` (dropdown row)

- [ ] **Step 1: Add `approvalWorkspaces` to TitleBarProps interface**

In `src/components/TitleBar.tsx`, at line 26 in the `TitleBarProps` interface, add after `busyWorkspaces`:

```typescript
approvalWorkspaces?: Set<string>;
```

- [ ] **Step 2: Destructure the new prop**

At line 29, add `approvalWorkspaces` to the destructured props:

```typescript
export default function TitleBar({ projectPath, onProjectChange, completedWorkspaces, busyWorkspaces, approvalWorkspaces, onSettingChange, onOpenWhatsNew }: TitleBarProps) {
```

- [ ] **Step 3: Update titlebar indicator priority**

Replace the indicator logic inside the `project-selector` button (lines 137-147). The current code:

```tsx
{(() => {
  const bgBusyCount = busyWorkspaces ? [...busyWorkspaces].filter(p => p !== projectPath).length : 0;
  if (completedWorkspaces && completedWorkspaces.size > 0) return <span className="workspace-done-dot" />;
  if (bgBusyCount > 0) return (
    <span className="titlebar-busy-indicator">
      <span className="titlebar-busy-spinner" />
      {bgBusyCount > 1 && <span className="titlebar-busy-count">{bgBusyCount}</span>}
    </span>
  );
  return null;
})()}
```

Replace with:

```tsx
{(() => {
  const approvalCount = approvalWorkspaces ? approvalWorkspaces.size : 0;
  const bgBusyCount = busyWorkspaces ? [...busyWorkspaces].filter(p => p !== projectPath).length : 0;
  if (approvalCount > 0) return <span className="titlebar-approval-dot" />;
  if (completedWorkspaces && completedWorkspaces.size > 0) return <span className="workspace-done-dot" />;
  if (bgBusyCount > 0) return (
    <span className="titlebar-busy-indicator">
      <span className="titlebar-busy-spinner" />
      {bgBusyCount > 1 && <span className="titlebar-busy-count">{bgBusyCount}</span>}
    </span>
  );
  return null;
})()}
```

- [ ] **Step 4: Update dropdown workspace row indicator**

In the dropdown active workspace rows (around line 172-174), replace the current left indicator:

```tsx
{busyWorkspaces?.has(w.projectPath)
  ? <span className="workspace-spinner" title="Working..." />
  : <span className="workspace-status-dot workspace-dot-active" />}
```

With:

```tsx
{approvalWorkspaces?.has(w.projectPath)
  ? <span className="workspace-approval-icon" title="Approval needed">!</span>
  : busyWorkspaces?.has(w.projectPath)
    ? <span className="workspace-spinner" title="Working..." />
    : <span className="workspace-status-dot workspace-dot-active" />}
```

- [ ] **Step 5: Add "Approval needed" label next to workspace name**

On the same workspace row, after the `<span className="dropdown-item-name">` (line 175), add a conditional label. Replace:

```tsx
<span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
{completedWorkspaces?.has(w.projectPath) && <span className="workspace-completed-icon" title="Response complete">!</span>}
```

With:

```tsx
<span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
{approvalWorkspaces?.has(w.projectPath)
  ? <span className="workspace-approval-label">Approval needed</span>
  : completedWorkspaces?.has(w.projectPath) && <span className="workspace-completed-icon" title="Response complete">!</span>}
```

- [ ] **Step 6: Add CSS for new approval indicators**

In the `<style>` block inside TitleBar.tsx, add after the existing `.workspace-completed-icon` styles (after line 536):

```css
@keyframes approval-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
.titlebar-approval-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  margin-left: 6px;
  vertical-align: middle;
  animation: approval-blink 1s ease-in-out infinite;
}
.workspace-approval-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f59e0b;
  color: #000;
  font-size: 10px;
  font-weight: 800;
  flex-shrink: 0;
  animation: approval-blink 1s ease-in-out infinite;
}
.dropdown-item.active .workspace-approval-icon {
  background: #000;
  color: #f59e0b;
}
.workspace-approval-label {
  font-size: 11px;
  color: #f59e0b;
  margin-left: 4px;
}
.dropdown-item.active .workspace-approval-label {
  color: #000;
  opacity: 0.8;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat(approval): blinking titlebar dot and dropdown badge for pending approvals"
```

---

### Task 4: ApprovalBanner — New persistent banner component

**Files:**
- Create: `src/components/ApprovalBanner.tsx`

- [ ] **Step 1: Create the ApprovalBanner component**

Create `src/components/ApprovalBanner.tsx`:

```tsx
import { PendingApproval } from '../types';

interface ApprovalBannerProps {
  approvalWorkspaces: Map<string, PendingApproval>;
  currentProjectPath: string;
  onSwitchToWorkspace: (path: string) => void;
}

export default function ApprovalBanner({ approvalWorkspaces, currentProjectPath, onSwitchToWorkspace }: ApprovalBannerProps) {
  if (approvalWorkspaces.size === 0) return null;

  const entries = [...approvalWorkspaces.entries()];
  const [projectPath, approval] = entries[0];
  const wsName = projectPath.split('/').pop() || projectPath;
  const isCurrent = projectPath === currentProjectPath;
  const extraCount = entries.length - 1;

  const commandSnippet = approval.command.length > 60
    ? approval.command.slice(0, 60) + '…'
    : approval.command;

  return (
    <div className="approval-banner">
      <span className="approval-banner-icon">!</span>
      <span className="approval-banner-text">
        <strong>{wsName}</strong>
        {extraCount > 0 && <span className="approval-banner-extra"> +{extraCount} more</span>}
        <span className="approval-banner-tool"> — {approval.toolName}: {commandSnippet}</span>
      </span>
      <button
        className="approval-banner-action"
        onClick={() => onSwitchToWorkspace(projectPath)}
      >
        {isCurrent ? 'Review' : 'Switch & Review'}
      </button>
      <style>{`
        .approval-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          font-size: 12px;
          background: linear-gradient(90deg, rgba(245, 158, 11, 0.18) 0%, rgba(245, 158, 11, 0.06) 100%);
          border-bottom: 1px solid rgba(245, 158, 11, 0.25);
          border-left: 3px solid #f59e0b;
          color: var(--text);
          flex-shrink: 0;
        }
        .approval-banner-icon {
          font-size: 14px;
          font-weight: 800;
          color: #f59e0b;
          animation: approval-banner-blink 1s ease-in-out infinite;
        }
        @keyframes approval-banner-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .approval-banner-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .approval-banner-extra {
          color: var(--text-muted);
          font-size: 11px;
        }
        .approval-banner-tool {
          opacity: 0.8;
        }
        .approval-banner-action {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 4px;
          border: 1px solid #f59e0b;
          background: transparent;
          color: #f59e0b;
          cursor: pointer;
          flex-shrink: 0;
        }
        .approval-banner-action:hover {
          background: rgba(245, 158, 11, 0.15);
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: No TypeScript errors. The ApprovalBanner now exists, so the import in App.tsx from Task 2 should resolve.

- [ ] **Step 3: Commit**

```bash
git add src/components/ApprovalBanner.tsx
git commit -m "feat(approval): add persistent ApprovalBanner component with left-accent style"
```

---

### Task 5: Manual testing

**Files:** None (testing only)

- [ ] **Step 1: Start the app in dev mode**

Run: `npm run dev` (or the project's dev command)
Expected: App launches without errors

- [ ] **Step 2: Test approval flow**

1. Open a workspace with a CLI-level permission mode that requires approval (e.g., default mode)
2. Send a message that triggers a tool use (e.g., ask Claude to run a bash command)
3. Verify:
   - System notification appears immediately with "Approval needed — {workspace}"
   - Taskbar flashes
   - Blinking amber dot appears in titlebar next to project name
   - Approval banner appears between titlebar and content with left-accent style
   - Banner shows workspace name, tool name, and command

- [ ] **Step 3: Test dropdown indicators**

1. While approval is pending, click the project dropdown
2. Verify:
   - The workspace with pending approval shows a blinking "!" instead of a spinner
   - "Approval needed" label appears next to workspace name in amber

- [ ] **Step 4: Test banner action button**

1. If viewing the workspace with the pending approval, banner button should say "Review"
2. Switch to a different workspace — banner should say "Switch & Review"
3. Click "Switch & Review" — should switch to the workspace with the pending approval

- [ ] **Step 5: Test resolution**

1. Approve or deny the pending tool
2. Verify:
   - Banner disappears
   - Blinking amber dot disappears from titlebar
   - Dropdown indicator returns to normal (spinner if busy, green dot if idle)

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed during testing:

```bash
git add -A
git commit -m "fix(approval): address issues found during manual testing"
```
