# Default Project Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `defaultProjectDir` setting that pre-fills the New Project modal's parent directory, replaces the single path input with parent-dir + project-name fields, and makes the Open Project folder picker start in the default directory.

**Architecture:** The setting is stored as `defaultProjectDir` in settings.json via existing `settings:get/set` IPC. `project:selectFolder` gets an optional `defaultPath` parameter so both the Open Project picker and the New Project Browse button open in the right place. The New Project modal shifts from a single computed path to a `parentDir` + `projectName` pair, deriving the final path at submit time.

**Tech Stack:** Electron IpcMain, React + TypeScript, existing `settings:get/set` IPC, `dialog.showOpenDialog` with `defaultPath`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `electron/main.ts` | Modify | Accept optional `defaultPath` arg in `project:selectFolder` handler |
| `electron/preload.ts` | Modify | Thread `defaultPath` param through to IPC invoke |
| `src/components/SettingsModal.tsx` | Modify | Add `defaultProjectDir` state, useEffect load, handler, and UI row in General section |
| `src/components/NewProjectModal.tsx` | Modify | Replace single `dir` field with `parentDir` + `projectName`; load setting on mount; show computed path preview |
| `src/components/TitleBar.tsx` | Modify | `handleOpenNew` reads setting, passes it as `defaultPath` to `selectFolder` |

---

## Task 1: Update selectFolder IPC to accept defaultPath

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Update the IPC handler in main.ts**

Find this block (around line 270):

```typescript
  ipcMain.handle('project:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    const folder = result.filePaths[0] || null;
    if (folder) addRecentProject(folder);
    return folder;
  });
```

Replace with:

```typescript
  ipcMain.handle('project:selectFolder', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
      ...(defaultPath ? { defaultPath } : {}),
    });
    const folder = result.filePaths[0] || null;
    if (folder) addRecentProject(folder);
    return folder;
  });
```

- [ ] **Step 2: Update preload.ts to thread the parameter**

Find:

```typescript
  selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
```

Replace with:

```typescript
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('project:selectFolder', defaultPath),
```

- [ ] **Step 3: Verify TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: add optional defaultPath to project:selectFolder IPC"
```

---

## Task 2: Add defaultProjectDir setting to SettingsModal

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add state variable**

In `SettingsModal.tsx`, find the block of `useState` declarations (around line 82). Add after the `mcpConfigPath` state:

```typescript
  const [defaultProjectDir, setDefaultProjectDir] = useState('');
```

- [ ] **Step 2: Load the setting on mount**

In the `useEffect` that calls `window.sai.settingsGet(...)` for other settings (around line 108), add:

```typescript
    window.sai.settingsGet('defaultProjectDir', '').then((v: string) => setDefaultProjectDir(v || ''));
```

- [ ] **Step 3: Add the save handler**

Find `handleMcpConfigChange` or similar handler. Add alongside it:

```typescript
  const handleDefaultProjectDirChange = (v: string) => {
    setDefaultProjectDir(v);
    window.sai.settingsSet('defaultProjectDir', v);
  };
```

- [ ] **Step 4: Add the UI row in the General section**

Search for the `mcpConfigPath` settings row in the General section JSX. Add a new row directly before it:

```tsx
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-name">Default project directory</div>
                  <div className="settings-row-desc">New projects are created here. Also used as the starting folder when browsing.</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="~/projects"
                    value={defaultProjectDir}
                    onChange={e => handleDefaultProjectDirChange(e.target.value)}
                    style={{ width: 180, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={async () => {
                      const folder = await window.sai.selectFolder(defaultProjectDir || undefined);
                      if (folder) handleDefaultProjectDirChange(folder);
                    }}
                    style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Browse
                  </button>
                </div>
              </div>
```

- [ ] **Step 5: Verify TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: add defaultProjectDir setting to General settings"
```

---

## Task 3: Update TitleBar handleOpenNew to use default dir

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Update handleOpenNew**

Find this function (around line 99):

```typescript
  const handleOpenNew = async () => {
    const folder = await window.sai.selectFolder();
    if (folder) {
      onProjectChange(folder);
    }
    setOpen(false);
  };
```

Replace with:

```typescript
  const handleOpenNew = async () => {
    const defaultDir = await window.sai.settingsGet('defaultProjectDir', '');
    const folder = await window.sai.selectFolder(defaultDir || undefined);
    if (folder) {
      onProjectChange(folder);
    }
    setOpen(false);
  };
```

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat: open project folder picker starts in default project directory"
```

---

## Task 4: Redesign NewProjectModal with parentDir + projectName

**Files:**
- Modify: `src/components/NewProjectModal.tsx`

- [ ] **Step 1: Replace state and effects**

In `NewProjectModal.tsx`, replace the `dir` state with `parentDir` + `projectName`, add a load effect for the setting, and update the repoName sync:

Find:
```typescript
  const [dir, setDir] = useState('');
```

Replace with:
```typescript
  const [parentDir, setParentDir] = useState('');
  const [projectName, setProjectName] = useState('');
```

Find the `useEffect` that syncs repo name from dir:
```typescript
  useEffect(() => {
    if (!repoNameEdited && dir) setRepoName(dir.split('/').pop() || '');
  }, [dir, repoNameEdited]);
```

Replace with:
```typescript
  // Load default project directory on mount
  useEffect(() => {
    window.sai.settingsGet('defaultProjectDir', '').then((v: string) => {
      if (v) setParentDir(v);
    });
  }, []);

  useEffect(() => {
    if (!repoNameEdited) setRepoName(projectName);
  }, [projectName, repoNameEdited]);
```

- [ ] **Step 2: Update handleBrowse and handleCreate**

Find:
```typescript
  const handleBrowse = useCallback(async () => {
    const folder = await window.sai.selectFolder();
    if (folder) setDir(folder);
  }, []);
```

Replace with:
```typescript
  const handleBrowseParent = useCallback(async () => {
    const folder = await window.sai.selectFolder(parentDir || undefined);
    if (folder) setParentDir(folder);
  }, [parentDir]);
```

Find `handleCreate` — it uses `dir` in two places. Replace both with `computedPath`. The computed path is derived from `parentDir` and `projectName`. Update `handleCreate` to derive it:

Find the start of `handleCreate`:
```typescript
  const handleCreate = useCallback(async () => {
    if (!dir) return;
    setCreating(true);
    setError('');
    setWarnings([]);

    let result: any;
    try {
      result = await window.sai.scaffoldProject({
        path: dir,
```

Replace with:
```typescript
  const handleCreate = useCallback(async () => {
    const computedPath = parentDir && projectName
      ? parentDir.replace(/\/+$/, '') + '/' + projectName.trim()
      : '';
    if (!computedPath) return;
    setCreating(true);
    setError('');
    setWarnings([]);

    let result: any;
    try {
      result = await window.sai.scaffoldProject({
        path: computedPath,
```

Also find the `onCreated(dir)` call at the end of `handleCreate`:
```typescript
    onCreated(dir);
```
Replace with:
```typescript
    onCreated(computedPath);
```

And find `setCreatedPath(dir)`:
```typescript
      setCreatedPath(dir);
```
Replace with:
```typescript
      setCreatedPath(computedPath);
```

Update the `useCallback` deps array from `[dir, context, helpers, repoName, visibility, onCreated]` to:
```typescript
  }, [parentDir, projectName, context, helpers, repoName, visibility, onCreated]);
```

- [ ] **Step 3: Replace the Directory JSX section**

Find:
```tsx
        {/* Directory */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Directory</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={dir}
              onChange={e => setDir(e.target.value)}
              placeholder="/home/user/projects/my-app"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleBrowse}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Browse
            </button>
          </div>
        </div>
```

Replace with:
```tsx
        {/* Parent directory */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Parent directory</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={parentDir}
              onChange={e => setParentDir(e.target.value)}
              placeholder="/home/user/projects"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleBrowseParent}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* Project name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Project name</span>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="my-app"
            style={inputStyle}
            autoFocus
          />
          {parentDir && projectName && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
              → {parentDir.replace(/\/+$/, '')}/{projectName.trim()}
            </span>
          )}
        </div>
```

- [ ] **Step 4: Update the Create button disabled condition**

Find the Create button that checks `!dir || creating`:
```tsx
            disabled={!dir || creating}
            style={{
              background: 'none', border: `1px solid ${dir && !creating ? 'var(--accent)' : 'var(--border)'}`,
              color: dir && !creating ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: dir && !creating ? 'pointer' : 'not-allowed',
```

Replace with:
```tsx
            disabled={!parentDir || !projectName.trim() || creating}
            style={{
              background: 'none', border: `1px solid ${parentDir && projectName.trim() && !creating ? 'var(--accent)' : 'var(--border)'}`,
              color: parentDir && projectName.trim() && !creating ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: parentDir && projectName.trim() && !creating ? 'pointer' : 'not-allowed',
```

- [ ] **Step 5: Verify TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/NewProjectModal.tsx
git commit -m "feat: redesign new project modal with parent-dir + project-name fields"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Set default directory in Settings**
  - Open Settings → General
  - Find "Default project directory" row — should have a text input and Browse button
  - Set it to `/tmp/sai-projects` (type directly or use Browse)
  - Close Settings

- [ ] **Step 3: Test Open Project uses default dir**
  - Open the project dropdown → click "Open Project"
  - The native folder picker should open with `/tmp/sai-projects` pre-selected
  - Cancel without selecting

- [ ] **Step 4: Test New Project modal**
  - Click "New Project"
  - "Parent directory" field should be pre-filled with `/tmp/sai-projects`
  - Type `hello-world` in "Project name"
  - Path preview should show `→ /tmp/sai-projects/hello-world`
  - Click Create — workspace opens, `ls /tmp/sai-projects/hello-world` shows scaffolded files

- [ ] **Step 5: Test with no default dir set**
  - Clear the default directory in Settings
  - Open New Project modal — "Parent directory" is empty
  - Use Browse to pick a parent, type a name — preview appears
  - Create works as expected
