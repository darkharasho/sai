# Workspace Manual Suspend Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `···` overflow menu to active workspace rows in the dropdown that lets users manually suspend or close a workspace.

**Architecture:** New `workspace:suspend` IPC handler wired to the existing `suspend()` backend function. Preload exposes `workspaceSuspend`. TitleBar gains per-row overflow state and a new `CloseWorkspaceModal` component for the close confirmation.

**Tech Stack:** Electron 33, React 19, TypeScript — no test framework in project, verification is done by running the dev server.

---

### Task 1: Add `workspace:suspend` IPC handler

**Files:**
- Modify: `electron/main.ts:9` (import line)
- Modify: `electron/main.ts:62-64` (after `workspace:close` handler)

- [ ] **Step 1: Add `suspend` to the workspace service import**

In `electron/main.ts` line 9, change:
```ts
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove } from './services/workspace';
```
to:
```ts
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove, suspend } from './services/workspace';
```

- [ ] **Step 2: Add the IPC handler after `workspace:close`**

In `electron/main.ts`, after line 64 (`});` closing `workspace:close`), add:
```ts
  ipcMain.handle('workspace:suspend', (_event, projectPath: string) => {
    suspend(projectPath, mainWindow!);
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit -p electron/tsconfig.json 2>&1 | head -20
```
Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add workspace:suspend IPC handler"
```

---

### Task 2: Expose `workspaceSuspend` in the preload bridge

**Files:**
- Modify: `electron/preload.ts:74` (after `workspaceClose` line)

- [ ] **Step 1: Add `workspaceSuspend` after `workspaceClose`**

In `electron/preload.ts`, after line 74:
```ts
  workspaceClose: (projectPath: string) => ipcRenderer.invoke('workspace:close', projectPath),
```
add:
```ts
  workspaceSuspend: (projectPath: string) => ipcRenderer.invoke('workspace:suspend', projectPath),
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p electron/tsconfig.json 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose workspaceSuspend in preload bridge"
```

---

### Task 3: Create `CloseWorkspaceModal` component

**Files:**
- Create: `src/components/CloseWorkspaceModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect } from 'react';

interface CloseWorkspaceModalProps {
  projectPath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CloseWorkspaceModal({ projectPath, onConfirm, onCancel }: CloseWorkspaceModalProps) {
  const projectName = projectPath.split('/').pop() || projectPath;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '24px 28px',
          width: 360,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Close Workspace
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{projectName}</span>
            {' '}will be removed from your workspace list. This cannot be undone.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: 'none',
              border: '1px solid #f87171',
              color: '#f87171',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(248,113,113,0.1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'none';
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CloseWorkspaceModal.tsx
git commit -m "feat: add CloseWorkspaceModal component"
```

---

### Task 4: Add overflow menu to active workspace rows in TitleBar

**Files:**
- Modify: `src/components/TitleBar.tsx`

This task restructures active workspace rows to include a `···` overflow button, a submenu (Suspend / Close), and wires up the `CloseWorkspaceModal`.

- [ ] **Step 1: Add imports and new state**

At the top of `TitleBar.tsx`, the import is already correct (`useState, useEffect, useRef`). Add two new state variables inside the component after the existing state declarations (after line 19 `const dropdownRef = ...`):

```tsx
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
```

Also add the import for `CloseWorkspaceModal` at the top of the file (after the existing imports):
```tsx
import CloseWorkspaceModal from './CloseWorkspaceModal';
```

- [ ] **Step 2: Close overflow menu when dropdown closes**

The existing `setOpen(false)` calls throughout already close the dropdown. Add a `useEffect` to clear `overflowOpen` when the dropdown closes. Add this after the existing outside-click `useEffect` (after line 50):

```tsx
  useEffect(() => {
    if (!open) setOverflowOpen(null);
  }, [open]);
```

- [ ] **Step 3: Add suspend and close handlers**

Add these two handlers inside the component, after `handleOpenNew` (after line 58):

```tsx
  const handleSuspend = async (path: string) => {
    setOverflowOpen(null);
    await window.sai.workspaceSuspend?.(path);
  };

  const handleCloseConfirm = async () => {
    if (!closeTarget) return;
    await window.sai.workspaceClose?.(closeTarget);
    setCloseTarget(null);
    setOpen(false);
  };
```

- [ ] **Step 4: Restructure active workspace rows**

Replace the entire `active.map(...)` block (lines 82–93) with this version that adds the wrapper div, overflow button, and submenu:

```tsx
                      {active.map(w => (
                        <div key={w.projectPath} className="workspace-row-wrapper">
                          <button
                            className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                            onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                          >
                            <span className="workspace-status-dot workspace-dot-active" />
                            <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                            <span className="dropdown-item-path">{w.projectPath}</span>
                          </button>
                          <button
                            className={`workspace-overflow-btn${overflowOpen === w.projectPath ? ' open' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOverflowOpen(overflowOpen === w.projectPath ? null : w.projectPath);
                            }}
                          >···</button>
                          {overflowOpen === w.projectPath && (
                            <div className="workspace-submenu">
                              <button className="workspace-submenu-item" onClick={() => handleSuspend(w.projectPath)}>
                                ⏸ Suspend
                              </button>
                              <button
                                className="workspace-submenu-item danger"
                                onClick={() => { setOverflowOpen(null); setCloseTarget(w.projectPath); }}
                              >
                                ✕ Close
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
```

- [ ] **Step 5: Render `CloseWorkspaceModal` at the end of the return**

Just before the closing `</div>` of the titlebar (before line 293 `</div>`), add:

```tsx
      {closeTarget && (
        <CloseWorkspaceModal
          projectPath={closeTarget}
          onConfirm={handleCloseConfirm}
          onCancel={() => setCloseTarget(null)}
        />
      )}
```

- [ ] **Step 6: Add CSS for the new elements**

Inside the existing `<style>` block (after the `.workspace-dot-suspended` rule, before the closing backtick), add:

```css
        .workspace-row-wrapper {
          position: relative;
        }
        .workspace-row-wrapper .dropdown-item {
          padding-right: 36px;
        }
        .workspace-overflow-btn {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          letter-spacing: 1px;
          padding: 2px 4px;
          border-radius: 3px;
          opacity: 0;
          -webkit-app-region: no-drag;
        }
        .workspace-row-wrapper:hover .workspace-overflow-btn,
        .workspace-overflow-btn.open {
          opacity: 1;
        }
        .workspace-overflow-btn:hover {
          background: var(--bg-secondary);
          color: var(--text);
        }
        .workspace-submenu {
          position: absolute;
          right: 8px;
          top: calc(100% - 4px);
          z-index: 200;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 4px 0;
          min-width: 120px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        }
        .workspace-submenu-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 7px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          text-align: left;
          -webkit-app-region: no-drag;
        }
        .workspace-submenu-item:hover {
          background: var(--bg-hover);
        }
        .workspace-submenu-item.danger {
          color: #f87171;
        }
        .workspace-submenu-item.danger:hover {
          background: rgba(248,113,113,0.08);
        }
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 8: Start dev server and manually verify**

```bash
npm run dev
```

Check:
1. Open the workspace dropdown — active rows show no `···` button by default.
2. Hover an active row — `···` appears on the right.
3. Click `···` — submenu appears with "⏸ Suspend" and "✕ Close".
4. Click "⏸ Suspend" — submenu closes, workspace moves to the Suspended section (yellow dot).
5. Click `···` on another active row, then "✕ Close" — `CloseWorkspaceModal` appears with the correct workspace name.
6. Click Cancel — modal dismisses, workspace is unchanged.
7. Click Close — workspace is removed, dropdown closes.
8. Press Escape while modal is open — modal dismisses.
9. Click the overlay behind the modal — modal dismisses.

- [ ] **Step 9: Commit**

```bash
git add src/components/TitleBar.tsx src/components/CloseWorkspaceModal.tsx
git commit -m "feat: add suspend/close overflow menu to workspace dropdown"
```
