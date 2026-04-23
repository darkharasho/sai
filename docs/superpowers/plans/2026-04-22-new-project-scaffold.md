# New Project Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Open New Project..." button in the project dropdown with two text links (Open Project / New Project), where New Project opens a modal that scaffolds a new workspace with optional helpers (CLAUDE.md, git init, .gitignore, README.md, .claude/settings.json, GitHub repo).

**Architecture:** A new `ScaffoldProject` IPC handler in the main process executes file system operations and the optional GitHub API call sequentially. A new `NewProjectModal` React component owns all modal state and calls `window.sai.scaffoldProject()`. `TitleBar.tsx` gets the split link row; `App.tsx` mounts the modal and passes open/close callbacks.

**Tech Stack:** React + TypeScript (frontend), Electron IpcMain (backend), Node.js `fs`/`child_process` (scaffold ops), existing `github-auth.ts` HTTPS helpers (GitHub repo creation), lucide-react icons.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `electron/services/scaffold.ts` | **Create** | All scaffold logic: dir creation, file writes, git init, GitHub repo |
| `electron/main.ts` | **Modify** | Import and register scaffold handler |
| `electron/preload.ts` | **Modify** | Expose `window.sai.scaffoldProject()` |
| `src/components/NewProjectModal.tsx` | **Create** | Modal UI: directory, context, helpers, GitHub sub-panel |
| `src/components/TitleBar.tsx` | **Modify** | Replace single button with split link row |
| `src/App.tsx` | **Modify** | Mount `NewProjectModal`, wire open/close state |

---

## Task 1: Scaffold service (main process)

**Files:**
- Create: `electron/services/scaffold.ts`

- [ ] **Step 1: Create the scaffold service file**

```typescript
// electron/services/scaffold.ts
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import https from 'node:https';
import { ipcMain } from 'electron';

export interface ScaffoldOptions {
  path: string;
  context: string;
  helpers: {
    claudeMd: boolean;
    gitInit: boolean;
    gitignore: boolean;
    readme: boolean;
    claudeSettings: boolean;
    githubRepo: boolean;
  };
  github?: {
    repoName: string;
    visibility: 'private' | 'public';
  };
}

export interface ScaffoldResult {
  ok: boolean;
  error?: string;        // blocking failure (directory creation)
  warnings: string[];    // non-blocking step failures
  repoUrl?: string;      // set if GitHub repo was created
}

function githubPost(endpoint: string, body: object, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: 'api.github.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'SAI-App',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export async function scaffoldProject(
  options: ScaffoldOptions,
  getToken: () => string | null,
): Promise<ScaffoldResult> {
  const warnings: string[] = [];
  const folderName = path.basename(options.path);

  // Step 1 — blocking: create directory
  try {
    fs.mkdirSync(options.path, { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `Could not create directory: ${e.message}`, warnings };
  }

  // Step 2 — CLAUDE.md
  if (options.helpers.claudeMd) {
    try {
      const content = options.context
        ? `## Project Context\n\n${options.context}\n`
        : `## Project Context\n\n_No context provided._\n`;
      fs.writeFileSync(path.join(options.path, 'CLAUDE.md'), content, 'utf8');
    } catch (e: any) {
      warnings.push(`CLAUDE.md: ${e.message}`);
    }
  }

  // Step 3 — git init
  if (options.helpers.gitInit) {
    try {
      execSync('git init', { cwd: options.path, stdio: 'ignore' });
    } catch (e: any) {
      warnings.push(`git init: ${e.message}`);
    }
  }

  // Step 4 — .gitignore
  if (options.helpers.gitignore) {
    try {
      const content = [
        'node_modules',
        '.env',
        '.env.*',
        '.DS_Store',
        'dist',
        'build',
        '*.log',
        '.superpowers',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(options.path, '.gitignore'), content, 'utf8');
    } catch (e: any) {
      warnings.push(`.gitignore: ${e.message}`);
    }
  }

  // Step 5 — README.md
  if (options.helpers.readme) {
    try {
      const desc = options.context ? `\n${options.context}\n` : '';
      fs.writeFileSync(path.join(options.path, 'README.md'), `# ${folderName}${desc}`, 'utf8');
    } catch (e: any) {
      warnings.push(`README.md: ${e.message}`);
    }
  }

  // Step 6 — .claude/settings.json
  if (options.helpers.claudeSettings) {
    try {
      const dir = path.join(options.path, '.claude');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), '{}\n', 'utf8');
    } catch (e: any) {
      warnings.push(`.claude/settings.json: ${e.message}`);
    }
  }

  // Step 7 — GitHub repo
  let repoUrl: string | undefined;
  if (options.helpers.githubRepo && options.github) {
    const token = getToken();
    if (!token) {
      warnings.push('GitHub repo: not authenticated');
    } else {
      try {
        const repo = await githubPost('/user/repos', {
          name: options.github.repoName,
          private: options.github.visibility === 'private',
          auto_init: false,
        }, token);
        if (repo.clone_url) {
          repoUrl = repo.clone_url;
          try {
            execSync(`git remote add origin ${repo.clone_url}`, { cwd: options.path, stdio: 'ignore' });
          } catch (e: any) {
            warnings.push(`git remote add origin: ${e.message}`);
          }
        } else {
          warnings.push(`GitHub repo: ${repo.message || 'unknown error'}`);
        }
      } catch (e: any) {
        warnings.push(`GitHub repo: ${e.message}`);
      }
    }
  }

  return { ok: true, warnings, repoUrl };
}

export function registerScaffoldHandler(
  readSettings: () => Record<string, any>,
) {
  ipcMain.handle('project:scaffold', async (_event, options: ScaffoldOptions) => {
    const getToken = () => readSettings().github_auth?.token ?? null;
    return scaffoldProject(options, getToken);
  });
}
```

- [ ] **Step 2: Verify the file exists and TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `electron/services/scaffold.ts`

- [ ] **Step 3: Commit**

```bash
git add electron/services/scaffold.ts
git commit -m "feat: add scaffold service for new project creation"
```

---

## Task 2: Register IPC handler + preload bridge

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Import and register in main.ts**

In `electron/main.ts`, add the import after the existing service imports:

```typescript
import { registerScaffoldHandler } from './services/scaffold';
```

Then inside the `app.whenReady()` block, alongside the other `register*` calls (after `registerGithubAuthHandlers` is a good spot):

```typescript
registerScaffoldHandler(readSettings);
```

- [ ] **Step 2: Expose in preload.ts**

In `electron/preload.ts`, add alongside the other `selectFolder`/`github*` entries in the `contextBridge.exposeInMainWorld` object:

```typescript
scaffoldProject: (options: any) => ipcRenderer.invoke('project:scaffold', options),
```

- [ ] **Step 3: Verify TypeScript is clean**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: register project:scaffold IPC handler and preload bridge"
```

---

## Task 3: NewProjectModal component

**Files:**
- Create: `src/components/NewProjectModal.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/NewProjectModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { FolderPlus } from 'lucide-react';

interface GitHubUser {
  login: string;
}

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (path: string) => void;
}

const DEFAULT_HELPERS = {
  claudeMd: true,
  gitInit: true,
  gitignore: true,
  readme: true,
  claudeSettings: false,
  githubRepo: false,
};

export default function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [dir, setDir] = useState('');
  const [context, setContext] = useState('');
  const [helpers, setHelpers] = useState(DEFAULT_HELPERS);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [repoName, setRepoName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [createdPath, setCreatedPath] = useState('');

  useEffect(() => {
    window.sai.githubGetUser().then((u: GitHubUser | null) => setGithubUser(u));
  }, []);

  useEffect(() => {
    const onAuthComplete = (user: GitHubUser) => setGithubUser(user);
    const unsub = window.sai.githubOnAuthComplete(onAuthComplete);
    return unsub;
  }, []);

  // Sync repo name with folder name
  useEffect(() => {
    if (dir) setRepoName(dir.split('/').pop() || '');
  }, [dir]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBrowse = useCallback(async () => {
    const folder = await window.sai.selectFolder();
    if (folder) setDir(folder);
  }, []);

  const handleConnectGitHub = useCallback(async () => {
    await window.sai.githubStartAuth();
  }, []);

  const toggleHelper = (key: keyof typeof DEFAULT_HELPERS) => {
    setHelpers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreate = async () => {
    if (!dir) return;
    setCreating(true);
    setError('');
    setWarnings([]);

    const result = await window.sai.scaffoldProject({
      path: dir,
      context,
      helpers,
      github: helpers.githubRepo ? { repoName, visibility } : undefined,
    });

    setCreating(false);

    if (!result.ok) {
      setError(result.error || 'Failed to create project');
      return;
    }

    if (result.warnings?.length) {
      // Keep modal open so user can read warnings; "Continue" button calls onCreated
      setWarnings(result.warnings);
      setCreatedPath(dir);
      return;
    }
    onCreated(dir);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    width: '100%',
    boxSizing: 'border-box',
  };

  const checkRow = (
    key: keyof typeof DEFAULT_HELPERS,
    label: string,
    description: string,
    extra?: React.ReactNode,
  ) => (
    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
        <div
          onClick={() => {
            if (key === 'githubRepo' && !githubUser) return;
            toggleHelper(key);
          }}
          style={{
            width: 15, height: 15, borderRadius: 3, flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${helpers[key] ? 'var(--accent)' : 'var(--border)'}`,
            background: helpers[key] ? 'var(--accent)' : 'var(--bg-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: key === 'githubRepo' && !githubUser ? 'not-allowed' : 'pointer',
            opacity: key === 'githubRepo' && !githubUser ? 0.4 : 1,
          }}
        >
          {helpers[key] && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: key === 'githubRepo' && !githubUser ? 'var(--text-muted)' : 'var(--text)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
            {label}
            {key === 'githubRepo' && githubUser && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '1px 7px', borderRadius: 3, background: '#0e2018', color: '#4caf80', border: '1px solid #1a3a28' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf80', display: 'inline-block' }} />
                @{githubUser.login}
              </span>
            )}
            {key === 'githubRepo' && !githubUser && (
              <span
                onClick={handleConnectGitHub}
                style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Connect GitHub
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
        </div>
      </div>
      {extra}
    </div>
  );

  const githubSubPanel = helpers.githubRepo && githubUser ? (
    <div style={{ marginLeft: 25, marginBottom: 4, padding: 10, background: 'var(--bg-secondary)', borderRadius: 5, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Name</span>
        <input
          value={repoName}
          onChange={e => setRepoName(e.target.value)}
          style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", padding: '5px 8px', fontSize: 12 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>Visibility</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['private', 'public'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${visibility === v ? 'var(--accent)' : 'var(--border)'}`,
                color: visibility === v ? 'var(--accent)' : 'var(--text-muted)',
                background: visibility === v ? 'rgba(199,145,12,0.1)' : 'transparent',
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '24px 28px', width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderPlus size={15} color="var(--accent)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>New Project</span>
        </div>

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

        {/* Context */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Context <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--bg-elevated)', opacity: 0.6 }}>— optional</span>
          </span>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="What is this project for? e.g. 'A CLI tool for processing CSV files.'"
            rows={3}
            style={{ ...inputStyle, fontFamily: 'system-ui, sans-serif', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Helpers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Setup helpers</span>
          {checkRow('claudeMd', 'CLAUDE.md', 'Seeds AI memory with your project context')}
          {checkRow('gitInit', 'Git init', 'Initializes a local repo — enables the git panel immediately')}
          {checkRow('gitignore', '.gitignore', 'Common ignores: node_modules, .env, .DS_Store, dist, build')}
          {checkRow('readme', 'README.md', 'One-liner stub using your project context as the description')}
          {checkRow('claudeSettings', '.claude/settings.json', 'Empty project-level Claude settings, ready to configure')}
          {checkRow('githubRepo', 'Create GitHub repo', 'Creates a remote repo and sets it as origin', githubSubPanel)}
        </div>

        {/* Error / warnings */}
        {error && (
          <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 5, padding: '8px 10px' }}>
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--accent)', background: 'rgba(199,145,12,0.06)', border: '1px solid rgba(199,145,12,0.2)', borderRadius: 5, padding: '8px 10px' }}>
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '7px 12px', borderRadius: 5 }}
          >
            Cancel
          </button>
          {createdPath ? (
            <button
              onClick={() => onCreated(createdPath)}
              style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FolderPlus size={13} />
              Open Project
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!dir || creating}
              style={{
                background: 'none', border: `1px solid ${dir && !creating ? 'var(--accent)' : 'var(--border)'}`,
                color: dir && !creating ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 5, padding: '7px 16px', fontSize: 13, cursor: dir && !creating ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <FolderPlus size={13} />
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `src/components/NewProjectModal.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/NewProjectModal.tsx
git commit -m "feat: add NewProjectModal component"
```

---

## Task 4: Wire modal into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import at the top of App.tsx** (alongside other modal imports)

```typescript
import NewProjectModal from './components/NewProjectModal';
```

- [ ] **Step 2: Add state** (alongside other modal state like `showWhatsNew`, etc.)

```typescript
const [showNewProject, setShowNewProject] = useState(false);
```

- [ ] **Step 3: Pass `onNewProject` prop to TitleBar**

Find the `<TitleBar` usage in `App.tsx` and add the prop:

```typescript
onNewProject={() => setShowNewProject(true)}
```

- [ ] **Step 4: Mount the modal** (alongside other modal renders at the bottom of the return statement)

```typescript
{showNewProject && (
  <NewProjectModal
    onClose={() => setShowNewProject(false)}
    onCreated={(path) => {
      setShowNewProject(false);
      handleProjectSwitch(path);
    }}
  />
)}
```

- [ ] **Step 5: Check TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: error about missing `onNewProject` prop on TitleBar — this is expected, fixed in Task 5.

- [ ] **Step 6: Commit (after Task 5 completes and TS is clean)**

Hold this commit until Task 5 is done — see Task 5 Step 4.

---

## Task 5: Update TitleBar with split link row

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Add imports**

In the existing lucide import line in `TitleBar.tsx`:

```typescript
import { LogOut, Settings, ChevronDown, FolderOpen, FolderPlus } from 'lucide-react';
```

- [ ] **Step 2: Add `onNewProject` to TitleBarProps**

```typescript
interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  completedWorkspaces?: Set<string>;
  busyWorkspaces?: Set<string>;
  approvalWorkspaces?: Set<string>;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
  onHistoryRetentionChange?: (days: number | null) => void;
  onNewProject?: () => void;
}
```

- [ ] **Step 3: Replace the single button with the split row**

Find this block (around line 247):

```typescript
<div className="dropdown-divider" />
<button className="dropdown-item open-new" onClick={handleOpenNew}>
  + Open New Project...
</button>
```

Replace with:

```typescript
<div className="dropdown-divider" />
<div style={{ display: 'flex', alignItems: 'center' }}>
  <button
    className="dropdown-item"
    onClick={handleOpenNew}
    style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '4px 0 0 4px',
    }}
    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
  >
    <FolderOpen size={13} />
    Open Project
  </button>
  <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
  <button
    className="dropdown-item"
    onClick={() => { setOpen(false); onNewProject?.(); }}
    style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '0 4px 4px 0',
    }}
    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
  >
    <FolderPlus size={13} />
    New Project
  </button>
</div>
```

- [ ] **Step 4: Check TypeScript and commit both App.tsx and TitleBar.tsx**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

```bash
git add src/components/TitleBar.tsx src/App.tsx
git commit -m "feat: split open/new project links in title bar dropdown"
```

---

## Task 6: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify the split row**
  - Open the project dropdown
  - Confirm two centered text links with a vertical separator: `FolderOpen Open Project` | `FolderPlus New Project`
  - Hover each — color should shift to `#f5b832`, background to `var(--bg-elevated)`
  - Click "Open Project" — native folder picker opens; selecting a folder switches workspace

- [ ] **Step 3: Verify New Project modal — unauthenticated**
  - Log out of GitHub (Settings → GitHub → Log out) if currently logged in
  - Click "New Project" — modal opens
  - GitHub row shows "Connect GitHub" link, checkbox is disabled
  - Click "Connect GitHub" — device flow starts (browser opens)
  - Cancel auth; confirm modal remains open

- [ ] **Step 4: Verify New Project modal — authenticated**
  - Complete GitHub auth so a token exists
  - Reopen New Project modal
  - GitHub row shows green `@username` badge, checkbox is enabled
  - Check GitHub box → sub-panel expands with repo name + private/public toggle
  - Repo name auto-populates from directory name

- [ ] **Step 5: Verify scaffold**
  - Enter a new directory path (e.g. `/tmp/test-scaffold`)
  - Add context text
  - Leave defaults on (CLAUDE.md, git, .gitignore, README)
  - Click "Create Project"
  - Confirm modal closes and workspace opens
  - In terminal: `ls /tmp/test-scaffold` → should show `CLAUDE.md`, `.gitignore`, `README.md`
  - `cat /tmp/test-scaffold/CLAUDE.md` → should contain `## Project Context` and your context text
  - `git -C /tmp/test-scaffold status` → should show a valid git repo

- [ ] **Step 6: Commit if any fixes were needed during smoke test**

```bash
git add -p
git commit -m "fix: <describe what you found>"
```
