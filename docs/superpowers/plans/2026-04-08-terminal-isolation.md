# Terminal Isolation & Per-Workspace AI Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix terminal data cross-contamination between workspace and AI terminals, and make AI terminal tabs per-workspace instead of global.

**Architecture:** Two independent fixes. Fix 1 adds a `scope` parameter to `terminal:create` so terminal-mode PTYs skip workspace registration, and changes TerminalModeView to only listen to its own PTY. Fix 2 moves `termTabs`, `activeTermTabId`, and `terminalModeActivated` from global App state into per-workspace `WorkspaceContext`.

**Tech Stack:** TypeScript, React, Electron IPC, node-pty

---

### Task 1: Add scope parameter to terminal:create IPC

**Files:**
- Modify: `electron/preload.ts:5`
- Modify: `electron/services/pty.ts:52-104`

- [ ] **Step 1: Update preload bridge to pass scope parameter**

In `electron/preload.ts`, change line 5:

```ts
// Before
terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),

// After
terminalCreate: (cwd: string, scope?: string) => ipcRenderer.invoke('terminal:create', cwd, scope),
```

- [ ] **Step 2: Update pty.ts to accept scope and skip workspace registration**

In `electron/services/pty.ts`, change the `terminal:create` handler (line 52) to accept the scope parameter, and conditionally skip workspace registration:

```ts
// Before (line 52)
ipcMain.handle('terminal:create', (_event, cwd: string) => {

// After
ipcMain.handle('terminal:create', (_event, cwd: string, scope?: string) => {
```

Then change the workspace registration block (lines 87-92):

```ts
// Before
const ws = get(cwd);
if (ws) {
  ws.terminals.set(id, term);
  terminalOwner.set(id, cwd);
}

// After
if (scope !== 'terminal-mode') {
  const ws = get(cwd);
  if (ws) {
    ws.terminals.set(id, term);
    terminalOwner.set(id, cwd);
  }
}
```

- [ ] **Step 3: Run existing pty tests**

Run: `npx vitest run tests/unit/services/pty.test.ts`
Expected: All existing tests pass (scope param is optional, no behavior change for default calls).

- [ ] **Step 4: Add test for terminal-mode scope skipping workspace registration**

In `tests/unit/services/pty.test.ts`, add a test:

```ts
it('does not register terminal-mode PTYs with workspace', async () => {
  const mockWs = { terminals: new Map(), claudeScopes: new Map() };
  mockWorkspaceGet.mockReturnValue(mockWs);
  const id = await handlers['terminal:create']({} as any, '/test/path', 'terminal-mode');
  expect(id).toBeGreaterThan(0);
  expect(mockWs.terminals.size).toBe(0);
});
```

- [ ] **Step 5: Run tests to verify the new test passes**

Run: `npx vitest run tests/unit/services/pty.test.ts`
Expected: All tests pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts electron/services/pty.ts tests/unit/services/pty.test.ts
git commit -m "fix: add scope param to terminal:create, skip workspace registration for terminal-mode"
```

---

### Task 2: Isolate TerminalModeView to use only its own PTY

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeView.tsx:381-402,423-433`

- [ ] **Step 1: Change data handler to only listen to fallback PTY**

In `TerminalModeView.tsx`, change the `terminalOnData` handler (around line 381-393):

```ts
// Before (line 382-384)
const cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
  if (cancelled) return;
  const expectedId = getActiveTerminalId() ?? fallbackPtyRef.current;
  if (ptyId === expectedId) {

// After
const cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
  if (cancelled) return;
  if (ptyId !== fallbackPtyRef.current) return;
  {
```

Note: The opening brace maintains the existing block structure — the rest of the handler body (lines 385-392) stays exactly as-is.

- [ ] **Step 2: Pass 'terminal-mode' scope when creating fallback PTY**

In the same file, change the PTY creation (around line 396):

```ts
// Before
const ptyPromise = window.sai.terminalCreate(projectPath).then((id: number) => {

// After
const ptyPromise = window.sai.terminalCreate(projectPath, 'terminal-mode').then((id: number) => {
```

- [ ] **Step 3: Update executeCommand to only use fallback PTY**

In `executeCommand` (around line 423-433):

```ts
// Before (lines 427-431)
let termId = getActiveTerminalId() ?? fallbackPtyRef.current;
if (termId === null && fallbackPtyReadyRef.current) {
  termId = await fallbackPtyReadyRef.current;
}

// After
let termId = fallbackPtyRef.current;
if (termId === null && fallbackPtyReadyRef.current) {
  termId = await fallbackPtyReadyRef.current;
}
```

- [ ] **Step 4: Remove unused import**

Remove `getActiveTerminalId` from the import at line 6 if it's no longer used elsewhere in the file. Check first:

```ts
// If getActiveTerminalId is only used in those two locations, change line 6:
// Before
import { getActiveTerminalId } from '../../terminalBuffer';
// After — remove the import entirely if unused
```

Search the file for other uses of `getActiveTerminalId` before removing.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalMode/TerminalModeView.tsx
git commit -m "fix: isolate terminal mode to use only its own PTY, prevent cross-contamination"
```

---

### Task 3: Add terminal mode state to WorkspaceContext

**Files:**
- Modify: `src/types.ts:91-102`
- Modify: `src/App.tsx:90-104,195-229`

- [ ] **Step 1: Add terminal mode fields to WorkspaceContext type**

In `src/types.ts`, add fields to the `WorkspaceContext` interface (after line 101):

```ts
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
  // Terminal mode (AI terminal) state — per-workspace
  termModeActivated: boolean;
  termModeTabs: { id: string; name: string; createdAt: number }[];
  termModeActiveTabId: string;
}
```

- [ ] **Step 2: Update workspace defaults in App.tsx**

In `src/App.tsx`, update `getWorkspace` (line 195-210) to include defaults for new fields:

```ts
const getWorkspace = useCallback((path: string): WorkspaceContext => {
  const existing = workspaces.get(path);
  if (existing) return existing;
  const defaultTab = { id: crypto.randomUUID(), name: 'Tab 1', createdAt: Date.now() };
  return {
    projectPath: path,
    sessions: loadSessions(path),
    activeSession: createSession(),
    openFiles: [],
    activeFilePath: null,
    terminalIds: [],
    terminalTabs: [],
    activeTerminalId: null,
    status: 'recent',
    lastActivity: Date.now(),
    termModeActivated: false,
    termModeTabs: [defaultTab],
    termModeActiveTabId: defaultTab.id,
  };
}, [workspaces]);
```

Also update the identical default object inside `updateWorkspace` (lines 217-228) with the same three new fields.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in App.tsx where old global state is referenced (expected — we fix these in the next task).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "feat: add terminal mode state fields to WorkspaceContext"
```

---

### Task 4: Replace global terminal tab state with per-workspace state

**Files:**
- Modify: `src/App.tsx:90-104,342,811-837,946-1007,1147-1156,1567-1584`

- [ ] **Step 1: Remove global terminal mode state**

In `src/App.tsx`, remove these lines (90-104):

```ts
// DELETE these lines:
const [activeView, setActiveView] = useState<'default' | 'terminal-mode'>('default');
const [terminalModeActivated, setTerminalModeActivated] = useState(false);

// Terminal tabs state
const [termTabs, setTermTabs] = useState<{ id: string; name: string; createdAt: number }[]>([
  { id: crypto.randomUUID(), name: 'Tab 1', createdAt: Date.now() },
]);
const [activeTermTabId, setActiveTermTabId] = useState<string>(() => '');

// Initialize activeTermTabId from first tab
useEffect(() => {
  if (termTabs.length > 0 && !termTabs.find(t => t.id === activeTermTabId)) {
    setActiveTermTabId(termTabs[0].id);
  }
}, [termTabs, activeTermTabId]);
```

Keep `activeView`/`setActiveView` — that controls which view is showing and should remain global (it's the UI toggle, not per-workspace state). Only remove `terminalModeActivated`, `termTabs`, and `activeTermTabId`.

So the final state should be:

```ts
const [activeView, setActiveView] = useState<'default' | 'terminal-mode'>('default');
```

- [ ] **Step 2: Create derived state and workspace-aware setters**

Below the `activeWorkspace` derivation (line 212), add:

```ts
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
```

- [ ] **Step 3: Add a useEffect to sync activeTermTabId when tabs change**

Replace the removed `useEffect` (old lines 100-104) with one that reads from workspace state:

```ts
// Sync activeTermTabId when workspace tabs change
useEffect(() => {
  if (!activeProjectPath || !activeWorkspace) return;
  const tabs = activeWorkspace.termModeTabs;
  const activeId = activeWorkspace.termModeActiveTabId;
  if (tabs.length > 0 && !tabs.find(t => t.id === activeId)) {
    updateWorkspace(activeProjectPath, ws => ({ ...ws, termModeActiveTabId: ws.termModeTabs[0]?.id ?? '' }));
  }
}, [activeProjectPath, activeWorkspace, updateWorkspace]);
```

- [ ] **Step 4: Update createTermTab, closeTermTab, renameTermTab**

These functions (lines 811-837) use `setTermTabs` and `setActiveTermTabId` which are now workspace-aware. The function bodies should work as-is since we kept the same setter signatures. But verify `createTermTab` uses the derived `termTabs.length`:

```ts
const createTermTab = useCallback(() => {
  const num = termTabs.length + 1;
  const tab = { id: crypto.randomUUID(), name: `Tab ${num}`, createdAt: Date.now() };
  setTermTabs(prev => [...prev, tab]);
  setActiveTermTabId(tab.id);
}, [termTabs.length, setTermTabs, setActiveTermTabId]);
```

Update `closeTermTab` dependencies:

```ts
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
```

Update `renameTermTab` dependencies:

```ts
const renameTermTab = useCallback((tabId: string, name: string) => {
  setTermTabs(prev => prev.map(t => t.id === tabId ? { ...t, name } : t));
}, [setTermTabs]);
```

- [ ] **Step 5: Update tab hotkeys to use workspace-aware setters**

The tab hotkey handler (lines 946-1007) uses `setTermTabs` for read-only tab navigation (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1-9). These patterns call `setTermTabs(current => { ...; return current; })` just to read current state. Since `setTermTabs` is now workspace-aware, this still works — but we should use the derived `termTabs` instead:

```ts
// Ctrl+Tab / Ctrl+PageDown — next tab
if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'PageDown') {
  e.preventDefault();
  const idx = termTabs.findIndex(t => t.id === activeTermTabId);
  const next = termTabs[(idx + 1) % termTabs.length];
  if (next) setActiveTermTabId(next.id);
  return;
}

// Ctrl+Shift+Tab / Ctrl+PageUp — previous tab
if ((e.key === 'Tab' && e.shiftKey) || e.key === 'PageUp') {
  e.preventDefault();
  const idx = termTabs.findIndex(t => t.id === activeTermTabId);
  const prev = termTabs[(idx - 1 + termTabs.length) % termTabs.length];
  if (prev) setActiveTermTabId(prev.id);
  return;
}

// Ctrl+1 through Ctrl+9 — go to tab N
if (e.key >= '1' && e.key <= '9') {
  e.preventDefault();
  const n = parseInt(e.key) - 1;
  if (n < termTabs.length) {
    setActiveTermTabId(termTabs[n].id);
  }
  return;
}
```

Update the dependency array:

```ts
}, [activeView, activeTermTabId, termTabs, createTermTab, closeTermTab, setActiveTermTabId]);
```

- [ ] **Step 6: Update handleProjectSwitch to preserve terminal mode per-workspace**

In `handleProjectSwitch` (line 1009-1011), the current code always resets to default view. Change it to restore the new workspace's terminal mode state:

```ts
const handleProjectSwitch = useCallback((newPath: string) => {
  if (newPath === activeProjectPath) return;
  // Restore target workspace's view preference
  const targetWs = workspaces.get(newPath);
  setActiveView(targetWs?.termModeActivated ? 'terminal-mode' : 'default');
  window.sai.openRecentProject(newPath);
```

- [ ] **Step 7: Update toggleSidebar terminal-mode activation**

In `toggleSidebar` (line 1147-1156), update to use workspace-aware setter:

```ts
const toggleSidebar = (id: string) => {
  if (id === 'terminal-mode') {
    setActiveView(prev => {
      if (prev !== 'terminal-mode') {
        setTerminalModeActivated(true);
        setSidebarOpen(null);
      }
      return prev === 'terminal-mode' ? 'default' : 'terminal-mode';
    });
    return;
  }
```

This already calls `setTerminalModeActivated` which is now workspace-aware. No code change needed — just verify it works.

- [ ] **Step 8: Update the defaultView settings loader**

In the settings loader (line 350-351), update to use workspace-aware setter:

```ts
// Before
if (v === 'terminal-mode') { setActiveView('terminal-mode'); setTerminalModeActivated(true); }

// After
if (v === 'terminal-mode') { setActiveView('terminal-mode'); setTerminalModeActivated(true); }
```

This is the same code — `setTerminalModeActivated` is now workspace-aware. But note: this runs on mount before `activeProjectPath` is set, so it will be a no-op. Move the terminal mode activation to after workspace is loaded, or keep it as global `activeView` (which it already is) and let the workspace pick it up. The `activeView` state already handles the toggle correctly.

Actually, the better fix: the `defaultView` setting applies to the initial view toggle, and `setActiveView('terminal-mode')` is sufficient. The `setTerminalModeActivated(true)` call will work once a workspace is active. If it fires before `activeProjectPath` is set, the early-return in the setter handles it gracefully. No change needed.

- [ ] **Step 9: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: No errors.

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat: make terminal mode tabs and activation per-workspace"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 2: Manual testing checklist**

Launch the app and verify:

1. Open workspace A, switch to terminal mode — tabs appear
2. Create a second tab in workspace A
3. Switch to workspace B — terminal mode is NOT active (default view)
4. Activate terminal mode in workspace B — fresh "Tab 1" appears
5. Switch back to workspace A — terminal mode is active with 2 tabs preserved
6. In terminal mode, run a shell command — output appears only in terminal mode, not in workspace terminal
7. In workspace terminal, run a command — output does NOT appear in terminal mode's block list
8. Open two workspaces side by side (if supported) — each has independent terminal mode state

- [ ] **Step 3: Commit any fixups if needed**

```bash
git add -u
git commit -m "fix: address manual testing feedback for terminal isolation"
```
