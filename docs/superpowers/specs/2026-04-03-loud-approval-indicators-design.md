# Loud Approval Indicators

**Date:** 2026-04-03
**Status:** Approved

## Problem

When a workspace has a pending approval (active or inactive), it's too quiet. The approval UI only appears inside that workspace's chat panel. If you're in a different workspace or not looking at the chat, you can miss it — blocking the agent until you notice.

## Solution

Make pending approvals louder across four surfaces:

1. **Blinking titlebar indicator** — amber dot replaces existing busy/completion indicators
2. **Dropdown workspace badge** — blinking "!" replaces spinner on the workspace row
3. **Persistent approval banner** — left-accent style bar between titlebar and chat
4. **Immediate system notification** — fires on approval-needed, separate from completion

## Design Decisions

- **Banner style:** Left-accent gradient (Style B) — amber left border with subtle gradient background. Urgent but not overwhelming in a dark UI.
- **Approval replaces spinner:** When a workspace is awaiting approval, it's effectively paused — showing a spinner would be misleading. The blinking "!" communicates "needs your attention" instead of "working."
- **Banner is persistent:** No auto-dismiss, no manual close. It stays until the approval is resolved. Approvals are blocking actions that need response.
- **System notification always fires:** Unlike completion notifications (suppressed when focused on same workspace), approval notifications fire regardless of focus state because they're time-sensitive.
- **Priority order in titlebar:** approval > completion > busy. Approval is the most actionable state.

## Architecture

### State Propagation

```
Backend (claude.ts)                    Renderer (App → TitleBar/Banner)
─────────────────                      ─────────────────────────────────
approval_needed IPC  ──────────────►  App adds to approvalWorkspaces Set
                                       ├── TitleBar receives as prop
                                       └── ApprovalBanner receives as prop

approval_resolved IPC ─────────────►  App removes from approvalWorkspaces Set
```

**New IPC event: `approval_resolved`** — emitted from `claudeApprove()` after both approve and deny paths complete. The `approval_needed` event already exists.

**New prop: `approvalWorkspaces: Set<string>`** — passed from App to TitleBar and ApprovalBanner, analogous to existing `busyWorkspaces` and `completedWorkspaces`.

### Component Changes

#### 1. TitleBar (`src/components/TitleBar.tsx`)

**New prop:** `approvalWorkspaces?: Set<string>`

**Titlebar indicator priority** (in `project-selector` button):

```
1. approvalWorkspaces has items → blinking amber dot (NEW)
2. completedWorkspaces has items → pulsing done dot (existing)
3. bgBusyCount > 0 → spinner + count (existing)
```

**Dropdown workspace rows** — left indicator priority:

```
1. approvalWorkspaces has workspace → blinking "!" badge + "Approval needed" label (NEW)
2. busyWorkspaces has workspace → spinner (existing)
3. otherwise → green dot (existing)
```

**CSS — new `approval-blink` animation:**
```css
@keyframes approval-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
```
- 1s cycle, drops to 0.2 opacity — faster/harder than `done-pulse` (2s, 0.4)

**CSS — blinking amber dot** (`.titlebar-approval-dot`):
- Same size/position as `.workspace-done-dot` (7px circle, margin-left 6px)
- Background: `var(--warning)` or `#f59e0b`
- Animation: `approval-blink 1s ease-in-out infinite`

**CSS — approval badge in dropdown** (`.workspace-approval-icon`):
- Same dimensions as `.workspace-completed-icon` (14px circle)
- Background: `#f59e0b`, color: `#000`, font-weight: 800
- Animation: `approval-blink 1s ease-in-out infinite`

#### 2. ApprovalBanner (NEW — `src/components/ApprovalBanner.tsx`)

**Props:**
```typescript
interface ApprovalBannerProps {
  approvalWorkspaces: Map<string, PendingApproval>;
  currentProjectPath: string;
  onSwitchToWorkspace: (path: string) => void;
}
```

Note: `approvalWorkspaces` is promoted from `Set<string>` to `Map<string, PendingApproval>` to carry tool name/command info for the banner text. The Set version is still used for simple presence checks in TitleBar.

**Rendering:**
- Positioned between TitleBar and the main content area
- Shows when `approvalWorkspaces.size > 0`
- Displays the oldest pending approval (first entry in the Map)
- If multiple: shows "+N more" indicator next to the workspace name

**Layout:**
```
┌─[!]──[workspace-name] — [toolName: command]──────────[Switch & Review]─┐
│  ▲        ▲                    ▲                            ▲          │
│  blink    bold              truncated                   action btn     │
└───────────────────────────────────────────────────────────────────────────┘
 ▲ 3px left border (amber)
 ▲ gradient background: rgba(245,158,11,0.18) → rgba(245,158,11,0.06)
```

**Button text logic:**
- Current workspace has approval → "Review"
- Different workspace has approval → "Switch & Review"

**Click behavior:**
- "Switch & Review" → calls `onSwitchToWorkspace(path)` which triggers `onProjectChange`
- "Review" → scrolls to / focuses the ApprovalPanel in current chat

**Multiple approvals:**
- Banner shows the oldest pending approval
- Shows "+1 more" / "+2 more" count if additional workspaces need approval
- When the displayed approval is resolved, the next one takes its place

#### 3. System Notification (`electron/services/notify.ts`)

**New function: `notifyApproval(workspaceName, toolName, command)`**

- **Title:** `Approval needed — {workspaceName}`
- **Body:** `{toolName}: {command}` (truncated to 100 chars)
- **Always fires:** Ignores focus state — approvals are always worth interrupting for
- **Respects `systemNotifications` setting:** Still honor the user's preference to disable all notifications
- **`win.flashFrame(true)`** for taskbar flash
- **Click handler:** Focus window + switch to workspace via IPC

#### 4. Backend (`electron/services/claude.ts`)

**Emit `approval_resolved`:**
- In the `claudeApprove()` handler, after both the approve path (line ~565) and deny path (line ~453) complete
- Payload: `{ projectPath: string }`
- Sent via same IPC channel pattern as `approval_needed`

**Trigger notification:**
- At the same point where `approval_needed` IPC is sent to renderer (around line 215)
- Call `notifyApproval(workspaceName, toolName, command)`

#### 5. App-Level Wiring (`src/App.tsx` or equivalent)

**New state:** `approvalWorkspaces: Map<string, PendingApproval>`

**IPC listeners:**
- `approval_needed` → add to map with projectPath as key
- `approval_resolved` → delete from map

**Pass down:**
- `TitleBar` receives `approvalWorkspaces` as a Set (keys only) for indicator logic
- `ApprovalBanner` receives the full Map for display content

## Files to Modify

| File | Change |
|------|--------|
| `electron/services/claude.ts` | Emit `approval_resolved` IPC, call `notifyApproval()` |
| `electron/services/notify.ts` | Add `notifyApproval()` function |
| `electron/preload.ts` | Expose `approval_resolved` listener if needed |
| `src/App.tsx` (or equivalent) | Track `approvalWorkspaces` Map, pass as props |
| `src/components/TitleBar.tsx` | Accept `approvalWorkspaces` prop, add indicator priority, dropdown badge |
| `src/components/ApprovalBanner.tsx` | New component — persistent left-accent banner |
| `src/types.ts` | No changes needed — `PendingApproval` already exists |
