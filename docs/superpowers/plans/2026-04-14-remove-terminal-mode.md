# Remove Terminal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Terminal Mode feature (fullscreen AI-powered terminal) from SAI, since it now lives in the separate TAI app.

**Architecture:** Delete the `src/components/TerminalMode/` directory and its test directory, then surgically remove all Terminal Mode integration points from App.tsx, NavBar.tsx, SettingsModal.tsx, and types.ts. The standard bottom TerminalPanel and all its supporting code stays untouched.

**Tech Stack:** React, TypeScript, Electron

---

### Task 1: Delete Terminal Mode source files

**Files:**
- Delete: `src/components/TerminalMode/` (entire directory — 14 files)
- Delete: `tests/unit/components/TerminalMode/` (entire directory — 9 test files)

- [ ] **Step 1: Delete the TerminalMode component directory**

```bash
rm -rf src/components/TerminalMode
```

- [ ] **Step 2: Delete the TerminalMode test directory**

```bash
rm -rf tests/unit/components/TerminalMode
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: delete Terminal Mode source and test files"
```

---

### Task 2: Clean up NavBar

**Files:**
- Modify: `src/components/NavBar.tsx`

- [ ] **Step 1: Remove the `activeTerminal` prop and Term button**

Replace the entire file content with:

```tsx
import { FolderClosed, GitBranch, Clock } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
}

export default function NavBar({ activeSidebar, onToggle, gitChangeCount = 0 }: NavBarProps) {
  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;

  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''}`}
        onClick={() => onToggle('files')}
        title="Explorer"
      >
        <FolderClosed size={18} />
        <span className="nav-label">Files</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <GitBranch size={18} />
        <span className="nav-label">Git</span>
        {gitChangeCount > 0 && <span className="git-badge">{badgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'chats' ? 'active' : ''}`}
        onClick={() => onToggle('chats')}
        title="Chat History"
      >
        <Clock size={18} />
        <span className="nav-label">Chats</span>
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 2px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 42px;
          height: 44px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 8px;
          position: relative;
          transition: color 0.15s, background 0.15s;
        }
        .nav-label {
          font-size: 8px;
          font-weight: 500;
          font-family: 'Geist', sans-serif;
          letter-spacing: 0.3px;
          line-height: 1;
        }
        .git-badge {
          position: absolute;
          top: 2px;
          right: 0px;
          background: var(--accent);
          color: #000;
          font-size: 9px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 16px;
          height: 16px;
          line-height: 16px;
          text-align: center;
          border-radius: 8px;
          padding: 0 3px;
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          background: rgba(199, 145, 12, 0.08);
          border-left: 2px solid var(--accent);
          border-radius: 0 8px 8px 0;
        }
      `}</style>
    </div>
  );
}
```

Changes: removed `SquareTerminal` import, removed `activeTerminal` prop and its `disabled` logic from all buttons, removed the Term button entirely, removed `.nav-btn.disabled` CSS.

- [ ] **Step 2: Commit**

```bash
git add src/components/NavBar.tsx
git commit -m "refactor: remove Terminal Mode button and disabled logic from NavBar"
```

---

### Task 3: Remove Terminal Mode fields from types.ts

**Files:**
- Modify: `src/types.ts:95-110`

- [ ] **Step 1: Remove termMode fields from WorkspaceContext**

In `src/types.ts`, replace the `WorkspaceContext` interface:

```typescript
export interface WorkspaceContext {
  projectPath: string;
  sessions: ChatSession[];
  activeSession: ChatSession;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalIds: number[];
  terminalTabs: TerminalTab[];
  activeTerminalId: number | null;
  status: WorkspaceStatus;
  lastActivity: number;
}
```

This removes `termModeActivated`, `termModeTabs`, and `termModeActiveTabId`.

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "refactor: remove Terminal Mode fields from WorkspaceContext"
```

---

### Task 4: Remove defaultView setting from SettingsModal

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Remove defaultView state and handler**

Remove these pieces:

1. The state declaration (line 81):
   ```typescript
   const [defaultView, setDefaultView] = useState<'default' | 'terminal-mode'>('default');
   ```

2. The settings load (lines 106-108):
   ```typescript
   window.sai.settingsGet('defaultView', 'default').then((v: string) => {
     if (v === 'default' || v === 'terminal-mode') setDefaultView(v);
   });
   ```

3. The handler function (lines 298-302):
   ```typescript
   const handleDefaultViewChange = (value: 'default' | 'terminal-mode') => {
     setDefaultView(value);
     window.sai.settingsSet('defaultView', value);
     onSettingChange?.('defaultView', value);
   };
   ```

4. The UI row in `renderGeneralPage` (lines 446-459):
   ```tsx
   <div className="settings-row">
     <div className="settings-row-info">
       <div className="settings-row-name">Default view</div>
       <div className="settings-row-desc">Choose which view to show when the app launches</div>
     </div>
     <select
       className="settings-select"
       value={defaultView}
       onChange={e => handleDefaultViewChange(e.target.value as 'default' | 'terminal-mode')}
     >
       <option value="default">Workspace</option>
       <option value="terminal-mode">Terminal</option>
     </select>
   </div>
   ```

- [ ] **Step 2: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "refactor: remove defaultView setting from SettingsModal"
```

---

### Task 5: Clean up App.tsx

This is the largest change. Remove all Terminal Mode integration from App.tsx.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Remove Terminal Mode imports (lines 5-6)**

Remove these two import lines:

```typescript
import TerminalModeView from './components/TerminalMode/TerminalModeView';
import TerminalTabBar from './components/TerminalMode/TerminalTabBar';
```

Also remove `TerminalSquare` from the lucide-react import on line 22 (keep `MessageSquare`, `Code2`, `ChevronRight`, `MessageCirclePlus`).

Also remove `TerminalTab` from the type import on line 19 if it's only used for Terminal Mode types (check: `TerminalTab` is used for the standard terminal tabs, so keep it).

- [ ] **Step 2: Remove the `activeView` state (line 92)**

Remove:
```typescript
const [activeView, setActiveView] = useState<'default' | 'terminal-mode'>('default');
```

- [ ] **Step 3: Remove `PanelId` `'terminal'` member is NOT for Terminal Mode**

`PanelId = 'chat' | 'editor' | 'terminal'` on line 33 refers to the standard accordion terminal panel, not Terminal Mode. **Keep it as-is.**

- [ ] **Step 4: Remove termMode fields from all WorkspaceContext initializations**

There are 4 places where WorkspaceContext objects are created. In each, remove the three `termMode*` fields and the `defaultTab` variable they depend on.

**Location 1 — `getWorkspace` callback (~line 185):**

Remove:
```typescript
const defaultTab = { id: crypto.randomUUID(), name: 'Tab 1', createdAt: Date.now() };
```
And from the returned object, remove:
```typescript
termModeActivated: false,
termModeTabs: [defaultTab],
termModeActiveTabId: defaultTab.id,
```

**Location 2 — `updateWorkspace` fallback (~line 210):**

Same pattern — remove `defaultTab` and the three `termMode*` fields.

**Location 3 — initial workspace setup (~line 497):**

Remove `defaultTab` and the three `termMode*` fields from the workspace object literal.

**Location 4 — `handleProjectSwitch` (~line 1090):**

Remove `defaultTab` and the three `termMode*` fields from the new workspace object.

- [ ] **Step 5: Remove derived terminal mode state and workspace-aware setters (lines 232-261)**

Remove this entire block:
```typescript
// Derived terminal mode state from active workspace
const terminalModeActivated = activeWorkspace?.termModeActivated ?? false;
const termTabs = activeWorkspace?.termModeTabs ?? [];
const activeTermTabId = activeWorkspace?.termModeActiveTabId ?? '';

// Workspace-aware setters for terminal mode state
const setTerminalModeActivated = useCallback((v: boolean) => {
  if (!activeProjectPath) return;
  updateWorkspace(activeProjectPath, ws => ({ ...ws, termModeActivated: v }));
}, [activeProjectPath, updateWorkspace]);

const setTermTabs = useCallback((updater: (prev: { id: string; name: string; createdAt: number }[]) => { id: string; name: string; createdAt: number }[]) => {
  if (!activeProjectPath) return;
  updateWorkspace(activeProjectPath, ws => ({ ...ws, termModeTabs: updater(ws.termModeTabs) }));
}, [activeProjectPath, updateWorkspace]);

const setActiveTermTabId = useCallback((id: string) => {
  if (!activeProjectPath) return;
  updateWorkspace(activeProjectPath, ws => ({ ...ws, termModeActiveTabId: id }));
}, [activeProjectPath, updateWorkspace]);

// Sync activeTermTabId when tabs change (use primitive deps to avoid infinite loops)
const termTabIds = termTabs.map(t => t.id).join(',');
useEffect(() => {
  if (!activeProjectPath || !termTabIds) return;
  const ids = termTabIds.split(',');
  if (ids.length > 0 && !ids.includes(activeTermTabId)) {
    updateWorkspace(activeProjectPath, ws => ({ ...ws, termModeActiveTabId: ws.termModeTabs[0]?.id ?? '' }));
  }
}, [activeProjectPath, termTabIds, activeTermTabId, updateWorkspace]);
```

- [ ] **Step 6: Remove Terminal Mode tab helper functions (lines 876-902)**

Remove `createTermTab`, `closeTermTab`, and `renameTermTab`:

```typescript
const createTermTab = useCallback(() => {
  const num = termTabs.length + 1;
  const tab = { id: crypto.randomUUID(), name: `Tab ${num}`, createdAt: Date.now() };
  setTermTabs(prev => [...prev, tab]);
  setActiveTermTabId(tab.id);
}, [termTabs.length, setTermTabs, setActiveTermTabId]);

const closeTermTab = useCallback((tabId: string) => {
  setTermTabs(prev => {
    const idx = prev.findIndex(t => t.id === tabId);
    const next = prev.filter(t => t.id !== tabId);
    if (next.length === 0) {
      const fresh = { id: crypto.randomUUID(), name: 'Tab 1', createdAt: Date.now() };
      setActiveTermTabId(fresh.id);
      return [fresh];
    }
    if (tabId === activeTermTabId) {
      const neighbor = next[Math.min(idx, next.length - 1)];
      setActiveTermTabId(neighbor.id);
    }
    return next;
  });
}, [activeTermTabId, setTermTabs, setActiveTermTabId]);

const renameTermTab = useCallback((tabId: string, name: string) => {
  setTermTabs(prev => prev.map(t => t.id === tabId ? { ...t, name } : t));
}, [setTermTabs]);
```

- [ ] **Step 7: Remove defaultView settings load (line 379-381)**

Remove:
```typescript
window.sai.settingsGet('defaultView', 'default').then((v: string) => {
  if (v === 'terminal-mode') { setActiveView('terminal-mode'); setTerminalModeActivated(true); }
});
```

- [ ] **Step 8: Remove the Ctrl+H terminal-mode guard (line 639)**

Change:
```typescript
if (activeView !== 'terminal-mode') {
  setSidebarOpen(prev => prev === 'chats' ? null : 'chats');
}
```

To:
```typescript
setSidebarOpen(prev => prev === 'chats' ? null : 'chats');
```

- [ ] **Step 9: Remove the terminal tab hotkeys useEffect (lines 1024-1077)**

Remove the entire `useEffect` block that starts with `if (activeView !== 'terminal-mode') return;` and handles Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab for Terminal Mode tabs.

- [ ] **Step 10: Clean up handleProjectSwitch (lines 1082-1084)**

Remove the terminal-mode view switching logic:
```typescript
// Only leave terminal-mode if the target workspace hasn't activated it
if (activeView === 'terminal-mode' && !targetWs?.termModeActivated) {
  setActiveView('default');
}
```

- [ ] **Step 11: Simplify toggleSidebar (lines 1222-1229)**

Remove the `terminal-mode` handling:
```typescript
if (id === 'terminal-mode') {
  setActiveView(prev => {
    const entering = prev !== 'terminal-mode';
    if (entering) { setTerminalModeActivated(true); setSidebarOpen(null); }
    return entering ? 'terminal-mode' : 'default';
  });
  return;
}
```

- [ ] **Step 12: Update NavBar prop (line 1660)**

Change:
```tsx
<NavBar activeSidebar={sidebarOpen} activeTerminal={activeView === 'terminal-mode'} onToggle={toggleSidebar} gitChangeCount={gitChangeCount} />
```

To:
```tsx
<NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} gitChangeCount={gitChangeCount} />
```

- [ ] **Step 13: Remove Terminal Mode rendering (lines 1675-1696)**

Remove the entire `tm-views-wrapper` conditional block that renders `TerminalTabBar` and `TerminalModeView`:

```tsx
<div className="tm-views-wrapper">
  {terminalModeActivated && (
    <div style={{ display: activeView === 'terminal-mode' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <TerminalTabBar
        tabs={termTabs}
        activeTabId={activeTermTabId}
        onSelect={setActiveTermTabId}
        onClose={closeTermTab}
        onCreate={createTermTab}
        onRename={renameTermTab}
      />
      {termTabs.map((tab) => (
        <div
          key={tab.id}
          style={{ display: tab.id === activeTermTabId ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <TerminalModeView projectPath={projectPath} aiProvider={aiProvider} active={tab.id === activeTermTabId} />
        </div>
      ))}
    </div>
  )}
  <div className="main-content" ref={mainContentRef} style={activeView === 'terminal-mode' ? { display: 'none' } : undefined}>
```

Replace with just:
```tsx
<div className="tm-views-wrapper">
  <div className="main-content" ref={mainContentRef}>
```

And remove the extra closing `</div>` that paired with the removed conditional block.

- [ ] **Step 14: Remove unused imports**

After all the above, check that `TerminalSquare` is removed from the lucide-react import. The import should become:

```typescript
import { MessageSquare, Code2, ChevronRight, MessageCirclePlus } from 'lucide-react';
```

- [ ] **Step 15: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: remove all Terminal Mode integration from App.tsx"
```

---

### Task 6: Verify the build

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are errors, they'll point to remaining references to deleted Terminal Mode code — fix them.

- [ ] **Step 2: Run the test suite**

```bash
npm test
```

Expected: all tests pass. The deleted TerminalMode tests won't run since their files are gone. The standard terminal tests (`tests/e2e/terminal.spec.ts`, `tests/unit/terminalBuffer.test.ts`) should still pass.

- [ ] **Step 3: Start the dev server and verify the app**

```bash
npm run dev
```

Verify:
- App launches without errors
- NavBar shows Files, Git, Chats — no Term button
- Standard terminal panel works in the bottom accordion
- Settings modal has no "Default view" dropdown
- Sidebar buttons are never disabled

- [ ] **Step 4: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "refactor: remove Terminal Mode from SAI"
```
