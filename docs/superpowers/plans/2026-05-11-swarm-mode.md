# Swarm Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concurrent multi-task orchestration ("Swarm") to SAI: spawn N tasks against the same project, each in its own lazy git worktree, supervised by a chattable orchestrator agent.

**Architecture:** A new `SwarmTask` entity wraps existing SAI chat sessions. A `⚡ Swarm` left-nav button opens a sidebar listing tasks (plus a pinned "Swarm Overview" row). Selecting a task row swaps the main chat panel to that task's session. Selecting "Swarm Overview" swaps the main panel to an orchestrator view: a chat session (`kind: 'orchestrator'`) whose tools are swarm operations (`spawn_task`, `land`, `approve_tool_call`, …). Task worktrees materialize lazily on first write tool-call, landing is manual (FF-merge) but can be invoked through the orchestrator.

**Tech Stack:** TypeScript, React, Electron, IndexedDB (existing `chatDb`), `simple-git` (worktree commands run in main process via IPC), reuses existing approval / provider / session infrastructure.

**Spec:** `docs/superpowers/specs/2026-05-11-swarm-mode-design.md`

---

## Resume Status (as of 2026-05-11)

Branch: `feat/swarm-mode` (not pushed). Working tree clean.

**Completed:**
- [x] Task 1 — Types & migration field (`502cf1c`)
- [x] Task 2 — swarmDb (`b5fd219` + fix `2eaea3c`: atomic update + transaction error handlers)
- [x] Task 3 — Branch-slug helper (`6ea124b`)

**Next up:** Task 4 — Electron worktree IPC.

**Execution mode:** subagent-driven-development with two-stage review. To resume, see the bottom of this file for the continuation prompt.

---

## File Map

### New files

- `src/swarmDb.ts` — IndexedDB store for `swarm_tasks` + `swarm_approvals` (parallels `chatDb`)
- `src/lib/swarmScheduler.ts` — concurrency-cap scheduler; promotes queued → streaming
- `src/lib/swarmOrchestrator.ts` — orchestrator agent: tool definitions + dispatch
- `src/lib/swarmSlug.ts` — title→branch slug helper
- `src/components/Swarm/SwarmSidebar.tsx` — sidebar list, pinned Overview, "+ NEW" button
- `src/components/Swarm/SwarmTaskRow.tsx` — single task row
- `src/components/Swarm/SwarmTaskHeader.tsx` — thin context bar above task chat
- `src/components/Swarm/OrchestratorView.tsx` — main panel orchestrator dashboard
- `src/components/Swarm/OrchestratorChat.tsx` — orchestrator chat stream
- `src/components/Swarm/ApprovalTray.tsx`
- `src/components/Swarm/ReadyToLandTray.tsx`
- `src/components/Swarm/OrchestratorComposer.tsx` — composer with split-lines toggle
- `src/components/Swarm/NewTaskPopover.tsx`
- `src/components/Swarm/QuitSwarmConfirmModal.tsx`
- `src/components/Settings/SwarmSettings.tsx`
- `electron/services/swarm.ts` — IPC handlers for git worktree create/remove/list, branch FF-check, branch FF-merge
- `tests/swarm/*.test.ts` — unit + integration tests

### Modified files

- `src/types.ts` — add `SwarmTask`, `SwarmTaskStatus`, `SwarmApproval`, `ApprovalPolicy`, `SessionKind`; extend `ChatSession` with `kind?: SessionKind`
- `src/chatDb.ts` — schema bump: add `kind` field on sessions (default `'chat'`); add `swarmTaskId?` index
- `src/components/NavBar.tsx` — add ⚡ Swarm button with badge
- `src/components/SettingsModal.tsx` — register `'swarm'` page
- `src/App.tsx` — wire swarm sidebar state, panel switching, dispatch, IPC
- `electron/services/git.ts` — worktree helpers (create, remove, list, ff-merge, conflict-check)
- `electron/main.ts` — register `registerSwarmHandlers`
- `electron/preload.ts` — expose `window.sai.swarm.*` API

---

## Phase 1 — Foundations (Tasks 1–10)

Ships a usable per-task workflow: spawn task → it streams in its own session → focus it → land manually. No orchestrator AI yet (the "Swarm Overview" row shows a static placeholder until Phase 2).

### Task 1: Types & migration field

**Files:**
- Modify: `src/types.ts` (append at bottom)
- Modify: `src/chatDb.ts` (schema version bump)
- Test: `tests/swarm/types.test.ts`

- [ ] **Step 1: Add types in `src/types.ts`**

```ts
export type SessionKind = 'chat' | 'task' | 'orchestrator';

export type SwarmTaskStatus =
  | 'queued'
  | 'streaming'
  | 'awaiting_approval'
  | 'paused'
  | 'done'
  | 'failed'
  | 'landed'
  | 'discarded';

export type ApprovalPolicy = 'auto' | 'auto-read' | 'always-ask';

export interface SwarmTask {
  id: string;
  workspaceId: string;        // = projectPath
  sessionId: string;          // FK to ChatSession.id
  title: string;
  prompt: string;
  provider: AIProvider;
  model: string;
  approvalPolicy: ApprovalPolicy;
  status: SwarmTaskStatus;
  branch: string;
  baseBranch: string;         // branch HEAD when task was spawned
  worktreePath: string | null;
  createdAt: number;
  lastActivityAt: number;
  costEstimate: number;
  toolCallCount: number;
}

export interface SwarmApproval {
  id: string;
  taskId: string;
  workspaceId: string;
  toolName: string;
  toolUseId: string;
  command?: string;
  description?: string;
  input?: unknown;
  createdAt: number;
}
```

Extend `ChatSession` (locate the existing interface, add):

```ts
  kind?: SessionKind;        // default 'chat'
  swarmTaskId?: string;      // populated for task / orchestrator sessions
```

- [ ] **Step 2: Bump chatDb schema and migrate**

In `src/chatDb.ts`, increment the IDB version constant (e.g. `DB_VERSION = N+1`) and in the `onupgradeneeded` handler add:

```ts
// Add `kind` index to sessions store when upgrading to vN+1
if (event.oldVersion < N+1) {
  const sessions = transaction.objectStore('sessions');
  if (!sessions.indexNames.contains('kind')) {
    sessions.createIndex('kind', 'kind', { unique: false });
  }
  if (!sessions.indexNames.contains('swarmTaskId')) {
    sessions.createIndex('swarmTaskId', 'swarmTaskId', { unique: false });
  }
}
```

No backfill needed — existing rows with undefined `kind` are treated as `'chat'` by readers.

- [ ] **Step 3: Write the failing test**

```ts
// tests/swarm/types.test.ts
import { describe, it, expect } from 'vitest';
import type { SwarmTask, SwarmTaskStatus } from '@/types';

describe('SwarmTask type', () => {
  it('accepts the canonical status set', () => {
    const statuses: SwarmTaskStatus[] = [
      'queued','streaming','awaiting_approval','paused',
      'done','failed','landed','discarded',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('compiles a complete SwarmTask record', () => {
    const t: SwarmTask = {
      id: 't1', workspaceId: '/p', sessionId: 's1',
      title: 'foo', prompt: 'do foo',
      provider: 'claude', model: 'opus',
      approvalPolicy: 'auto-read', status: 'queued',
      branch: 'swarm/foo-abc', baseBranch: 'main',
      worktreePath: null,
      createdAt: 0, lastActivityAt: 0, costEstimate: 0, toolCallCount: 0,
    };
    expect(t.status).toBe('queued');
  });
});
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/swarm/types.test.ts`
Expected: PASS (types are compile-time; this verifies the module exports).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/chatDb.ts tests/swarm/types.test.ts
git commit -m "feat(swarm): add SwarmTask/SwarmApproval types and session kind"
```

---

### Task 2: swarmDb (IndexedDB persistence)

**Files:**
- Create: `src/swarmDb.ts`
- Test: `tests/swarm/swarmDb.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/swarm/swarmDb.test.ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  swarmInit, swarmCreateTask, swarmGetTasks, swarmUpdateTask,
  swarmDeleteTask, swarmCreateApproval, swarmGetApprovals,
  swarmResolveApproval,
} from '@/swarmDb';
import type { SwarmTask } from '@/types';

const baseTask = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's',
  title: 't', prompt: 'p',
  provider: 'claude', model: 'opus',
  approvalPolicy: 'auto-read', status: 'queued',
  branch: 'swarm/t-a', baseBranch: 'main',
  worktreePath: null, createdAt: 1, lastActivityAt: 1,
  costEstimate: 0, toolCallCount: 0, ...over,
});

beforeEach(async () => { await swarmInit(); });

describe('swarmDb tasks', () => {
  it('round-trips a task', async () => {
    await swarmCreateTask(baseTask({ id: 'x' }));
    const rows = await swarmGetTasks('/p');
    expect(rows.map(r => r.id)).toContain('x');
  });

  it('updates status', async () => {
    await swarmCreateTask(baseTask({ id: 'y' }));
    await swarmUpdateTask('y', { status: 'streaming' });
    const [row] = await swarmGetTasks('/p');
    expect(row.status).toBe('streaming');
  });

  it('scopes by workspaceId', async () => {
    await swarmCreateTask(baseTask({ id: 'z', workspaceId: '/p1' }));
    await swarmCreateTask(baseTask({ id: 'w', workspaceId: '/p2' }));
    expect((await swarmGetTasks('/p1')).map(r => r.id)).toEqual(['z']);
  });
});

describe('swarmDb approvals', () => {
  it('round-trips and resolves approvals', async () => {
    await swarmCreateApproval({
      id: 'a1', taskId: 't1', workspaceId: '/p',
      toolName: 'bash', toolUseId: 'u1', createdAt: 1,
    });
    expect((await swarmGetApprovals('/p'))).toHaveLength(1);
    await swarmResolveApproval('a1');
    expect((await swarmGetApprovals('/p'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/swarm/swarmDb.test.ts`
Expected: FAIL — module `@/swarmDb` not found.

- [ ] **Step 3: Implement swarmDb**

Create `src/swarmDb.ts` modeled after `chatDb.ts`:

```ts
import type { SwarmTask, SwarmApproval } from './types';

const DB = 'sai-swarm';
const VERSION = 1;
const TASKS = 'swarm_tasks';
const APPR = 'swarm_approvals';

let db: IDBDatabase | null = null;

export function swarmInit(): Promise<void> {
  if (db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(TASKS)) {
        const s = d.createObjectStore(TASKS, { keyPath: 'id' });
        s.createIndex('workspaceId', 'workspaceId');
        s.createIndex('status', 'status');
      }
      if (!d.objectStoreNames.contains(APPR)) {
        const s = d.createObjectStore(APPR, { keyPath: 'id' });
        s.createIndex('workspaceId', 'workspaceId');
        s.createIndex('taskId', 'taskId');
      }
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store: string, mode: IDBTransactionMode) {
  if (!db) throw new Error('swarmDb not initialised');
  return db.transaction(store, mode).objectStore(store);
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function swarmCreateTask(t: SwarmTask) { await req(tx(TASKS,'readwrite').put(t)); }
export async function swarmUpdateTask(id: string, patch: Partial<SwarmTask>) {
  const cur = await req(tx(TASKS,'readonly').get(id)) as SwarmTask | undefined;
  if (!cur) return;
  await req(tx(TASKS,'readwrite').put({ ...cur, ...patch, lastActivityAt: Date.now() }));
}
export async function swarmGetTask(id: string) {
  return req(tx(TASKS,'readonly').get(id)) as Promise<SwarmTask | undefined>;
}
export async function swarmGetTasks(workspaceId: string): Promise<SwarmTask[]> {
  const idx = tx(TASKS,'readonly').index('workspaceId');
  return req(idx.getAll(IDBKeyRange.only(workspaceId)));
}
export async function swarmDeleteTask(id: string) { await req(tx(TASKS,'readwrite').delete(id)); }

export async function swarmCreateApproval(a: SwarmApproval) { await req(tx(APPR,'readwrite').put(a)); }
export async function swarmGetApprovals(workspaceId: string): Promise<SwarmApproval[]> {
  const idx = tx(APPR,'readonly').index('workspaceId');
  return req(idx.getAll(IDBKeyRange.only(workspaceId)));
}
export async function swarmResolveApproval(id: string) { await req(tx(APPR,'readwrite').delete(id)); }
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run tests/swarm/swarmDb.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/swarmDb.ts tests/swarm/swarmDb.test.ts
git commit -m "feat(swarm): swarmDb IndexedDB store for tasks and approvals"
```

---

### Task 3: Branch-slug helper

**Files:**
- Create: `src/lib/swarmSlug.ts`
- Test: `tests/swarm/swarmSlug.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/swarm/swarmSlug.test.ts
import { describe, it, expect } from 'vitest';
import { swarmBranchName } from '@/lib/swarmSlug';

describe('swarmBranchName', () => {
  it('kebabs the title and appends a short id', () => {
    const b = swarmBranchName('Refactor Auth Middleware!', 'abc1234567');
    expect(b).toBe('swarm/refactor-auth-middleware-abc12345');
  });
  it('handles empty title', () => {
    expect(swarmBranchName('', 'abc12345')).toBe('swarm/task-abc12345');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/swarm/swarmSlug.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/swarmSlug.ts
export function swarmBranchName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    || 'task';
  const short = id.replace(/-/g, '').slice(0, 8);
  return `swarm/${slug}-${short}`;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmSlug.ts tests/swarm/swarmSlug.test.ts
git commit -m "feat(swarm): branch slug helper"
```

---

### Task 4: Electron worktree IPC

**Files:**
- Create: `electron/services/swarm.ts`
- Modify: `electron/main.ts` (register handlers)
- Modify: `electron/preload.ts` (expose `window.sai.swarm`)
- Modify: `electron/services/git.ts` (add worktree helpers)
- Test: `tests/swarm/swarm.electron.test.ts` (uses `tmp` + `simple-git`)

- [ ] **Step 1: Add worktree helpers to `electron/services/git.ts`**

Append:

```ts
import { promises as fsp } from 'fs';
import path from 'path';

export async function gitWorktreeAdd(repoCwd: string, worktreePath: string, branch: string, baseBranch: string) {
  await fsp.mkdir(path.dirname(worktreePath), { recursive: true });
  // create branch off baseBranch and check it out in the new worktree
  const git = simpleGit({ baseDir: repoCwd });
  await git.raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
}

export async function gitWorktreeRemove(repoCwd: string, worktreePath: string) {
  const git = simpleGit({ baseDir: repoCwd });
  await git.raw(['worktree', 'remove', '--force', worktreePath]);
}

export async function gitDeleteBranch(repoCwd: string, branch: string) {
  const git = simpleGit({ baseDir: repoCwd });
  await git.raw(['branch', '-D', branch]).catch(() => {});
}

export async function gitCanFastForward(repoCwd: string, sourceBranch: string, targetBranch: string): Promise<boolean> {
  const git = simpleGit({ baseDir: repoCwd });
  // target is ancestor of source ⇒ FF possible
  const merge = await git.raw(['merge-base', '--is-ancestor', targetBranch, sourceBranch]).then(() => true).catch(() => false);
  return merge;
}

export async function gitFastForwardMerge(repoCwd: string, sourceBranch: string) {
  const git = simpleGit({ baseDir: repoCwd });
  await git.raw(['merge', '--ff-only', sourceBranch]);
}
```

- [ ] **Step 2: Create `electron/services/swarm.ts`**

```ts
import { ipcMain } from 'electron';
import path from 'path';
import {
  gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch,
  gitCanFastForward, gitFastForwardMerge,
} from './git';

const SWARM_ROOT = '.sai-swarm'; // sibling-of-project dir

export function swarmWorktreePath(projectPath: string, workspaceId: string, taskId: string) {
  const parent = path.dirname(projectPath);
  const wsName = path.basename(projectPath);
  return path.join(parent, SWARM_ROOT, wsName, taskId);
}

export function registerSwarmHandlers() {
  ipcMain.handle('swarm:worktree-add', async (_e, projectPath: string, taskId: string, branch: string, baseBranch: string) => {
    const wt = swarmWorktreePath(projectPath, projectPath, taskId);
    await gitWorktreeAdd(projectPath, wt, branch, baseBranch);
    return wt;
  });
  ipcMain.handle('swarm:worktree-remove', async (_e, projectPath: string, worktreePath: string, branch: string) => {
    await gitWorktreeRemove(projectPath, worktreePath).catch(() => {});
    await gitDeleteBranch(projectPath, branch);
  });
  ipcMain.handle('swarm:can-ff', (_e, projectPath: string, source: string, target: string) =>
    gitCanFastForward(projectPath, source, target));
  ipcMain.handle('swarm:ff-merge', (_e, projectPath: string, source: string) =>
    gitFastForwardMerge(projectPath, source));
}
```

- [ ] **Step 3: Wire `electron/main.ts`**

Add `import { registerSwarmHandlers } from './services/swarm';` and call `registerSwarmHandlers();` alongside the other `register*Handlers()` calls.

- [ ] **Step 4: Expose IPC in `electron/preload.ts`**

Inside the `window.sai` object literal:

```ts
swarm: {
  worktreeAdd: (projectPath: string, taskId: string, branch: string, baseBranch: string) =>
    ipcRenderer.invoke('swarm:worktree-add', projectPath, taskId, branch, baseBranch),
  worktreeRemove: (projectPath: string, worktreePath: string, branch: string) =>
    ipcRenderer.invoke('swarm:worktree-remove', projectPath, worktreePath, branch),
  canFastForward: (projectPath: string, source: string, target: string) =>
    ipcRenderer.invoke('swarm:can-ff', projectPath, source, target),
  ffMerge: (projectPath: string, source: string) =>
    ipcRenderer.invoke('swarm:ff-merge', projectPath, source),
},
```

Add the matching type declaration in the SAI window typings (search for the existing `Window['sai']` interface and add a `swarm: { ... }` member).

- [ ] **Step 5: Write integration test**

```ts
// tests/swarm/swarm.electron.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { gitWorktreeAdd, gitWorktreeRemove, gitCanFastForward } from '../../electron/services/git';

async function tmpRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sai-swarm-'));
  const g = simpleGit({ baseDir: dir });
  await g.init();
  await fs.writeFile(path.join(dir, 'a.txt'), 'a');
  await g.add('.').commit('init', undefined, ['--no-gpg-sign']);
  await g.branch(['main']).catch(() => {});
  return dir;
}

describe('worktree integration', () => {
  it('adds and removes a worktree', async () => {
    const repo = await tmpRepo();
    const wt = path.join(repo, '..', 'wt-x');
    await gitWorktreeAdd(repo, wt, 'swarm/x', 'main');
    expect(await fs.stat(path.join(wt, 'a.txt')).then(() => true)).toBe(true);
    expect(await gitCanFastForward(repo, 'swarm/x', 'main')).toBe(true);
    await gitWorktreeRemove(repo, wt);
  });
});
```

- [ ] **Step 6: Run, expect PASS**

Run: `npx vitest run tests/swarm/swarm.electron.test.ts`

- [ ] **Step 7: Commit**

```bash
git add electron/services/swarm.ts electron/services/git.ts electron/main.ts electron/preload.ts tests/swarm/swarm.electron.test.ts
git commit -m "feat(swarm): electron worktree IPC and git helpers"
```

---

### Task 5: NavBar ⚡ Swarm button

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `src/App.tsx` (route `'swarm'` sidebar id)
- Test: `tests/swarm/NavBar.swarm.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// tests/swarm/NavBar.swarm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NavBar from '@/components/NavBar';

describe('NavBar swarm button', () => {
  it('shows ⚡ Swarm button and toggles', () => {
    const onToggle = vi.fn();
    render(<NavBar activeSidebar={null} onToggle={onToggle} swarmApprovalCount={0} />);
    fireEvent.click(screen.getByLabelText(/swarm/i));
    expect(onToggle).toHaveBeenCalledWith('swarm');
  });
  it('renders the approval badge when count > 0', () => {
    render(<NavBar activeSidebar={null} onToggle={() => {}} swarmApprovalCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — in `NavBar.tsx`, add `swarmApprovalCount?: number` to props, and add a button using the existing button pattern with the Zap icon from lucide-react:

```tsx
<button
  aria-label="Swarm"
  className={cls('nav-btn', activeSidebar === 'swarm' && 'active')}
  onClick={() => onToggle('swarm')}
>
  <Zap size={18} />
  {swarmApprovalCount > 0 && <span className="nav-badge">{swarmApprovalCount}</span>}
</button>
```

(Reuse whatever styling the existing nav buttons use — preserve the file's prevailing pattern.)

- [ ] **Step 4: Wire in `App.tsx`** — add `swarmApprovalCount` derived from active workspace's swarm approvals (placeholder `0` until Task 6 hooks it up), pass to `<NavBar>`.

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/components/NavBar.tsx src/App.tsx tests/swarm/NavBar.swarm.test.tsx
git commit -m "feat(swarm): NavBar Swarm button with approval badge"
```

---

### Task 6: SwarmSidebar shell with task list

**Files:**
- Create: `src/components/Swarm/SwarmSidebar.tsx`
- Create: `src/components/Swarm/SwarmTaskRow.tsx`
- Test: `tests/swarm/SwarmSidebar.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// tests/swarm/SwarmSidebar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SwarmSidebar from '@/components/Swarm/SwarmSidebar';

const tasks = [{
  id: 't1', title: 'refactor auth', status: 'streaming',
  lastActivityAt: 1, toolCallCount: 14, hasApproval: false,
}, {
  id: 't2', title: 'migrate users', status: 'awaiting_approval',
  lastActivityAt: 2, toolCallCount: 3, hasApproval: true,
}];

describe('SwarmSidebar', () => {
  it('renders Overview row + tasks, fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={onSelect}
        onNewTask={() => {}}
      />
    );
    expect(screen.getByText(/swarm overview/i)).toBeInTheDocument();
    expect(screen.getByText('refactor auth')).toBeInTheDocument();
    fireEvent.click(screen.getByText('migrate users'));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `SwarmTaskRow.tsx`**

```tsx
import type { SwarmTaskStatus } from '@/types';

interface Props {
  id: string;
  title: string;
  status: SwarmTaskStatus;
  toolCallCount: number;
  hasApproval: boolean;
  selected: boolean;
  onClick: () => void;
}

const STATUS_COLOR: Record<SwarmTaskStatus, string> = {
  queued: '#888', streaming: '#c8943e', awaiting_approval: '#b44',
  paused: '#888', done: '#3a8', failed: '#b44',
  landed: '#3a8', discarded: '#666',
};

const STATUS_ICON: Record<SwarmTaskStatus, string> = {
  queued: '●', streaming: '●', awaiting_approval: '⚠',
  paused: '⏸', done: '✓', failed: '✗', landed: '✓', discarded: '–',
};

export default function SwarmTaskRow(p: Props) {
  return (
    <div
      className={`swarm-row ${p.selected ? 'selected' : ''}`}
      onClick={p.onClick}
      style={{ borderLeft: `3px solid ${STATUS_COLOR[p.status]}` }}
    >
      <div className="row-main">
        <div className="row-title">{p.title}</div>
        <div className="row-sub">{p.status} · {p.toolCallCount} tools</div>
      </div>
      <span className="row-icon" style={{ color: STATUS_COLOR[p.status] }}>{STATUS_ICON[p.status]}</span>
    </div>
  );
}
```

- [ ] **Step 4: Implement `SwarmSidebar.tsx`**

```tsx
import SwarmTaskRow from './SwarmTaskRow';
import { Zap, Plus } from 'lucide-react';
import type { SwarmTask } from '@/types';

interface Props {
  tasks: SwarmTask[];
  selectedId: 'overview' | string;
  onSelect: (id: 'overview' | string) => void;
  onNewTask: () => void;
}

export default function SwarmSidebar({ tasks, selectedId, onSelect, onNewTask }: Props) {
  const activeCount = tasks.filter(t => t.status === 'streaming').length;
  const apprCount = tasks.filter(t => t.status === 'awaiting_approval').length;
  const readyCount = tasks.filter(t => t.status === 'done').length;
  return (
    <aside className="swarm-sidebar">
      <header>
        <span className="label">SWARM</span>
        <button className="new-task" onClick={onNewTask}><Plus size={12}/> NEW</button>
      </header>
      <div
        className={`swarm-overview-row ${selectedId === 'overview' ? 'selected' : ''}`}
        onClick={() => onSelect('overview')}
      >
        <Zap size={16}/>
        <div>
          <div className="overview-title">Swarm Overview</div>
          <div className="overview-sub">{activeCount} active · {apprCount} approval · {readyCount} ready</div>
        </div>
      </div>
      <div className="section-label">TASKS</div>
      <div className="task-list">
        {tasks.map(t => (
          <SwarmTaskRow
            key={t.id} id={t.id} title={t.title} status={t.status}
            toolCallCount={t.toolCallCount} hasApproval={t.status === 'awaiting_approval'}
            selected={selectedId === t.id}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>
    </aside>
  );
}
```

Add minimal CSS in a new `src/components/Swarm/SwarmSidebar.css` or extend existing global styles. Keep tokens consistent with SAI's theme — match the colour palette already in `src/themes.ts`.

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/SwarmSidebar.tsx src/components/Swarm/SwarmTaskRow.tsx src/components/Swarm/*.css tests/swarm/SwarmSidebar.test.tsx
git commit -m "feat(swarm): SwarmSidebar with task rows and overview pin"
```

---

### Task 7: Wire sidebar into App and load tasks per workspace

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/swarmDb.ts` (no changes expected; usage)
- Test: `tests/swarm/AppSwarmWiring.test.tsx` (smoke test)

- [ ] **Step 1: Add swarm state to `App.tsx`**

Near other workspace state, add:

```ts
const [swarmTasksByWs, setSwarmTasksByWs] = useState<Map<string, SwarmTask[]>>(new Map());
const [swarmSelected, setSwarmSelected] = useState<'overview' | string>('overview');
```

Add an effect that, when `activeProjectPath` changes, loads tasks via `swarmGetTasks(activeProjectPath)` and writes them into `swarmTasksByWs`. Reset `swarmSelected` to `'overview'`.

- [ ] **Step 2: Render the sidebar**

In the sidebar-rendering region (find where `sidebarOpen === 'files'` etc. branches), add:

```tsx
{sidebarOpen === 'swarm' && (
  <SwarmSidebar
    tasks={swarmTasksByWs.get(activeProjectPath) ?? []}
    selectedId={swarmSelected}
    onSelect={setSwarmSelected}
    onNewTask={() => setShowNewTaskPopover(true)}
  />
)}
```

- [ ] **Step 3: Compute `swarmApprovalCount` for NavBar**

```ts
const swarmApprovalCount = (swarmTasksByWs.get(activeProjectPath) ?? [])
  .filter(t => t.status === 'awaiting_approval').length;
```

Pass to `<NavBar swarmApprovalCount={swarmApprovalCount}/>`.

- [ ] **Step 4: Smoke test**

```tsx
// tests/swarm/AppSwarmWiring.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '@/App';

describe('App swarm wiring', () => {
  it('opens swarm sidebar on nav click', async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText(/swarm/i));
    expect(await screen.findByText(/swarm overview/i)).toBeInTheDocument();
  });
});
```

Mock `window.sai` minimally in `tests/setup.ts` if not already mocked.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx tests/swarm/AppSwarmWiring.test.tsx
git commit -m "feat(swarm): wire swarm sidebar and task loading into App"
```

---

### Task 8: NewTaskPopover (single-task quick dispatch)

**Files:**
- Create: `src/components/Swarm/NewTaskPopover.tsx`
- Modify: `src/App.tsx` (handle dispatch)
- Test: `tests/swarm/NewTaskPopover.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewTaskPopover from '@/components/Swarm/NewTaskPopover';

describe('NewTaskPopover', () => {
  it('submits prompt + provider', () => {
    const onSubmit = vi.fn();
    render(<NewTaskPopover open onClose={() => {}} onSubmit={onSubmit} defaultProvider="claude" defaultModel="opus"/>);
    fireEvent.change(screen.getByPlaceholderText(/what should this task do/i), { target: { value: 'fix lint' }});
    fireEvent.click(screen.getByText(/dispatch/i));
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: 'fix lint', provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — a small popover with prompt textarea, provider/model selects (reuse existing model select widget from `ChatInput.tsx` if extractable), approval policy select. Returns `{ prompt, provider, model, approvalPolicy }`.

- [ ] **Step 4: Implement dispatch in `App.tsx`**

```ts
async function spawnSwarmTask(input: { prompt: string; provider: AIProvider; model: string; approvalPolicy: ApprovalPolicy }) {
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const title = input.prompt.split('\n')[0].slice(0, 60) || 'task';
  const branch = swarmBranchName(title, id);
  const baseBranch = await window.sai.git.currentBranch(activeProjectPath); // existing helper

  // Create the chat session for this task
  await dbSaveSession(activeProjectPath, {
    id: sessionId, title, messages: [],
    aiProvider: input.provider, projectPath: activeProjectPath,
    pinned: false, messageCount: 0,
    kind: 'task', swarmTaskId: id,
  });

  const task: SwarmTask = {
    id, workspaceId: activeProjectPath, sessionId, title,
    prompt: input.prompt, provider: input.provider, model: input.model,
    approvalPolicy: input.approvalPolicy, status: 'queued',
    branch, baseBranch, worktreePath: null,
    createdAt: Date.now(), lastActivityAt: Date.now(),
    costEstimate: 0, toolCallCount: 0,
  };
  await swarmCreateTask(task);
  setSwarmTasksByWs(prev => {
    const m = new Map(prev);
    m.set(activeProjectPath, [task, ...(m.get(activeProjectPath) ?? [])]);
    return m;
  });
  // scheduler will pick it up in Task 9
}
```

- [ ] **Step 5: Run tests, expect PASS; manual smoke: click ⚡ → click NEW → submit → see row appear**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/NewTaskPopover.tsx src/App.tsx tests/swarm/NewTaskPopover.test.tsx
git commit -m "feat(swarm): NewTaskPopover and spawn flow (queued state)"
```

---

### Task 9: Scheduler (concurrency cap promotes queued → streaming)

**Files:**
- Create: `src/lib/swarmScheduler.ts`
- Modify: `src/App.tsx` (instantiate scheduler per workspace)
- Test: `tests/swarm/swarmScheduler.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { SwarmScheduler } from '@/lib/swarmScheduler';

describe('SwarmScheduler', () => {
  it('promotes up to cap from queued to streaming and calls onStart', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([
      { id: 'a', status: 'queued' }, { id: 'b', status: 'queued' },
      { id: 'c', status: 'queued' }, { id: 'd', status: 'streaming' },
    ] as any);
    s.tick();
    // 1 already streaming, cap 2 → promote 1 more
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
  it('does not promote when at cap', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([{ id: 'a', status: 'streaming' }, { id: 'b', status: 'streaming' }, { id: 'c', status: 'queued' }] as any);
    s.tick();
    expect(onStart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/lib/swarmScheduler.ts
import type { SwarmTask } from '@/types';

export interface SchedulerOptions {
  cap: number;
  onStart: (task: SwarmTask) => void;
}

export class SwarmScheduler {
  private tasks: SwarmTask[] = [];
  constructor(private opts: SchedulerOptions) {}
  setTasks(tasks: SwarmTask[]) { this.tasks = tasks; this.tick(); }
  setCap(cap: number) { this.opts.cap = cap; this.tick(); }
  tick() {
    const streaming = this.tasks.filter(t => t.status === 'streaming').length;
    let free = this.opts.cap - streaming;
    if (free <= 0) return;
    for (const t of this.tasks) {
      if (free === 0) break;
      if (t.status === 'queued') { this.opts.onStart(t); free--; }
    }
  }
}
```

- [ ] **Step 4: Wire in `App.tsx`**

Create one scheduler per workspace, persisted across renders via a ref. `onStart` updates the task status to `streaming` in `swarmDb`, in-memory state, and kicks off the existing provider runner pointed at the task's session (reuse whatever function App.tsx uses today to send the first user message in a chat — e.g., `claudeStart(sessionId, prompt, cwd)`). For tasks without a worktree yet, `cwd = activeProjectPath`.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmScheduler.ts src/App.tsx tests/swarm/swarmScheduler.test.ts
git commit -m "feat(swarm): concurrency-cap scheduler"
```

---

### Task 10: Lazy worktree materialization on first write

**Files:**
- Modify: `src/App.tsx` (intercept tool-call events for swarm tasks)
- Modify: `src/lib/swarmScheduler.ts` (add `onMaterializeWorktree` callback)
- Test: `tests/swarm/lazyWorktree.test.ts`

A "write tool call" is any tool whose name matches `WRITE_TOOLS = ['edit_file','write_file','apply_patch','str_replace','create_file','bash']`. (We treat `bash` as write because it can write.)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { isWriteTool, materializeIfNeeded, WRITE_TOOLS } from '@/lib/swarmScheduler';

describe('lazy worktree', () => {
  it('classifies write tools', () => {
    expect(isWriteTool('edit_file')).toBe(true);
    expect(isWriteTool('read_file')).toBe(false);
  });
  it('materializes once on first write call', async () => {
    const calls: string[] = [];
    const task = { id: 't', branch: 'b', baseBranch: 'main', worktreePath: null, workspaceId: '/p' } as any;
    const newPath = await materializeIfNeeded(task, 'edit_file', {
      worktreeAdd: async (...args) => { calls.push('add'); return '/wt'; },
      updateTask: async () => {},
    });
    expect(calls).toEqual(['add']);
    expect(newPath).toBe('/wt');
  });
  it('no-ops on read tools', async () => {
    const task = { worktreePath: null } as any;
    const calls: string[] = [];
    const newPath = await materializeIfNeeded(task, 'read_file', {
      worktreeAdd: async () => { calls.push('add'); return '/wt'; },
      updateTask: async () => {},
    });
    expect(newPath).toBeNull();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement in `src/lib/swarmScheduler.ts`** (export top-level helpers)

```ts
export const WRITE_TOOLS = new Set(['edit_file','write_file','apply_patch','str_replace','create_file','bash']);
export function isWriteTool(name: string) { return WRITE_TOOLS.has(name); }

export interface MaterializeDeps {
  worktreeAdd: (workspaceId: string, taskId: string, branch: string, baseBranch: string) => Promise<string>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function materializeIfNeeded(task: SwarmTask, toolName: string, deps: MaterializeDeps): Promise<string | null> {
  if (task.worktreePath) return task.worktreePath;
  if (!isWriteTool(toolName)) return null;
  const wt = await deps.worktreeAdd(task.workspaceId, task.id, task.branch, task.baseBranch);
  await deps.updateTask(task.id, { worktreePath: wt });
  return wt;
}
```

- [ ] **Step 4: Wire in `App.tsx`**

The chat-runner code dispatches a `tool_use` callback per tool call (locate the existing handler). For sessions where `session.kind === 'task'`, before executing the tool, call:

```ts
const task = await swarmGetTask(session.swarmTaskId!);
if (task) {
  const newWt = await materializeIfNeeded(task, toolName, {
    worktreeAdd: window.sai.swarm.worktreeAdd,
    updateTask: swarmUpdateTask,
  });
  if (newWt) {
    // re-point provider runner CWD to newWt (provider-specific API; for claude: restart turn with new cwd)
    await provider.setCwd(session.id, newWt);
  }
}
```

Implementation note: "re-point CWD mid-turn" is provider-specific. For v1, if a turn starts with no worktree and hits a write, we can document the constraint that lazy materialization happens at *turn boundary* — i.e., the first user message's first tool-call. If mid-turn cwd reset isn't feasible for a given provider, materialize the worktree eagerly when the task transitions to `streaming` for the first time. Pick one of the two and apply consistently.

For simplicity, **default to "eager on first stream"**: in scheduler's `onStart`, if the prompt doesn't trivially match a read-only pattern (regex `/^(explain|what|why|how|describe|read|show)\b/i`), call `worktreeAdd` before starting the provider runner with `cwd = worktreePath`.

Update tests to cover the eager path as well.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmScheduler.ts src/App.tsx tests/swarm/lazyWorktree.test.ts
git commit -m "feat(swarm): lazy worktree materialization for write tasks"
```

---

### Task 11: SwarmTaskHeader + focused task view

**Files:**
- Create: `src/components/Swarm/SwarmTaskHeader.tsx`
- Modify: `src/App.tsx` (route main panel when task row selected)
- Test: `tests/swarm/SwarmTaskHeader.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SwarmTaskHeader from '@/components/Swarm/SwarmTaskHeader';

const t = {
  id: 't', title: 'refactor auth', branch: 'swarm/refactor-auth-abc',
  worktreePath: '/p/../sai-swarm/p/t', status: 'streaming',
  provider: 'claude', model: 'opus',
} as any;

describe('SwarmTaskHeader', () => {
  it('renders branch and reacts to pause/discard/land buttons', () => {
    const onPause = vi.fn(); const onDiscard = vi.fn(); const onLand = vi.fn();
    render(<SwarmTaskHeader task={t} onPause={onPause} onDiscard={onDiscard} onLand={onLand} onOpenDiff={() => {}} />);
    expect(screen.getByText(/swarm\/refactor-auth-abc/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/pause/i));
    expect(onPause).toHaveBeenCalled();
  });
  it('disables Land unless status is done', () => {
    render(<SwarmTaskHeader task={t} onPause={() => {}} onDiscard={() => {}} onLand={() => {}} onOpenDiff={() => {}} />);
    expect(screen.getByRole('button', { name: /land/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — a 24px-tall horizontal strip with: task title (small), branch + provider/model muted, action buttons (pause/discard/land/open-diff). Reuse existing icon-button styling.

- [ ] **Step 4: Route main panel in `App.tsx`**

```tsx
{sidebarOpen === 'swarm' && swarmSelected !== 'overview' ? (() => {
  const task = (swarmTasksByWs.get(activeProjectPath) ?? []).find(t => t.id === swarmSelected);
  if (!task) return <EmptyState message="Task not found"/>;
  return (
    <div className="task-pane">
      <SwarmTaskHeader task={task} onPause={...} onDiscard={...} onLand={...} onOpenDiff={...}/>
      <ChatPanel sessionId={task.sessionId} projectPath={task.workspaceId} /* ... existing props */ />
    </div>
  );
})() : /* existing main panel content */}
```

- [ ] **Step 5: Run tests, manual smoke (click row → see task chat + header)**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/SwarmTaskHeader.tsx src/App.tsx tests/swarm/SwarmTaskHeader.test.tsx
git commit -m "feat(swarm): focused task view with task-context header"
```

---

### Task 12: Manual land + discard actions

**Files:**
- Modify: `src/App.tsx` (handlers)
- Create: `src/lib/swarmLanding.ts`
- Test: `tests/swarm/swarmLanding.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { landTask, discardTask } from '@/lib/swarmLanding';

describe('swarmLanding', () => {
  it('lands a task by ff-merging then removing worktree', async () => {
    const canFf = vi.fn().mockResolvedValue(true);
    const ffMerge = vi.fn().mockResolvedValue(undefined);
    const wtRemove = vi.fn().mockResolvedValue(undefined);
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', baseBranch: 'main', worktreePath: '/wt' } as any;
    const r = await landTask(task, { canFastForward: canFf, ffMerge, worktreeRemove: wtRemove, updateTask });
    expect(r).toEqual({ ok: true });
    expect(ffMerge).toHaveBeenCalledWith('/p', 'swarm/x');
    expect(updateTask).toHaveBeenCalledWith('t', { status: 'landed', worktreePath: null });
  });

  it('reports rebase-needed when FF is not possible', async () => {
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', baseBranch: 'main', worktreePath: '/wt' } as any;
    const r = await landTask(task, {
      canFastForward: () => Promise.resolve(false),
      ffMerge: vi.fn(), worktreeRemove: vi.fn(), updateTask: vi.fn(),
    });
    expect(r).toEqual({ ok: false, reason: 'rebase-needed' });
  });

  it('discards by removing worktree, branch, and marking discarded', async () => {
    const wtRemove = vi.fn(); const updateTask = vi.fn();
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', worktreePath: '/wt' } as any;
    await discardTask(task, { worktreeRemove: wtRemove, updateTask });
    expect(wtRemove).toHaveBeenCalledWith('/p', '/wt', 'swarm/x');
    expect(updateTask).toHaveBeenCalledWith('t', { status: 'discarded', worktreePath: null });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `src/lib/swarmLanding.ts`**

```ts
import type { SwarmTask } from '@/types';

export interface LandDeps {
  canFastForward: (cwd: string, source: string, target: string) => Promise<boolean>;
  ffMerge: (cwd: string, source: string) => Promise<void>;
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function landTask(task: SwarmTask, deps: LandDeps): Promise<{ ok: true } | { ok: false; reason: 'rebase-needed' }> {
  if (!task.worktreePath) {
    // Read-only task — nothing to land
    await deps.updateTask(task.id, { status: 'landed' });
    return { ok: true };
  }
  const canFf = await deps.canFastForward(task.workspaceId, task.branch, task.baseBranch);
  if (!canFf) return { ok: false, reason: 'rebase-needed' };
  await deps.ffMerge(task.workspaceId, task.branch);
  await deps.worktreeRemove(task.workspaceId, task.worktreePath, task.branch);
  await deps.updateTask(task.id, { status: 'landed', worktreePath: null });
  return { ok: true };
}

export interface DiscardDeps {
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function discardTask(task: SwarmTask, deps: DiscardDeps) {
  if (task.worktreePath) await deps.worktreeRemove(task.workspaceId, task.worktreePath, task.branch);
  await deps.updateTask(task.id, { status: 'discarded', worktreePath: null });
}
```

- [ ] **Step 4: Wire `onLand` / `onDiscard` in `App.tsx`** to call these with `window.sai.swarm.*` deps. Show a toast on rebase-needed.

- [ ] **Step 5: Run tests, manual smoke**

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmLanding.ts src/App.tsx tests/swarm/swarmLanding.test.ts
git commit -m "feat(swarm): manual land + discard with rebase-needed surface"
```

---

### Task 13: Live status updates from provider streams

**Files:** Modify: `src/App.tsx` (event handling) — no new file.

Provider runners already emit events (`onMessage`, `onToolUse`, `onTurnComplete`, `onError`). For sessions with `kind === 'task'`, mirror those into the swarm task record:

- `onToolUse` → `toolCallCount++`, `lastActivityAt = now`.
- `onTurnComplete` with no further user input pending → `status: 'done'`, schedule a notification if enabled.
- `onError` → `status: 'failed'`.
- A new approval surfacing → push into `swarm_approvals`, set task `status: 'awaiting_approval'`.
- An approval resolved (existing approval flow) → resolve in `swarm_approvals`, restore task to `streaming` if any work remains, otherwise `done`.

- [ ] **Step 1: Locate the existing provider event dispatcher in `App.tsx`** (search for `onToolUse` / `pendingToolUse`).

- [ ] **Step 2: Wrap with a swarm-aware adapter that:**

```ts
function swarmHookForSession(session: ChatSession) {
  if (session.kind !== 'task' || !session.swarmTaskId) return null;
  const taskId = session.swarmTaskId;
  return {
    onToolUse: async (tool: { name: string }) => {
      const t = await swarmGetTask(taskId);
      if (!t) return;
      await swarmUpdateTask(taskId, { toolCallCount: t.toolCallCount + 1 });
      // worktree materialization handled in Task 10
    },
    onTurnComplete: async () => {
      await swarmUpdateTask(taskId, { status: 'done' });
    },
    onError: async () => {
      await swarmUpdateTask(taskId, { status: 'failed' });
    },
    onApprovalNeeded: async (a: { toolName: string; toolUseId: string; command?: string; description?: string; input?: unknown }) => {
      await swarmCreateApproval({ id: crypto.randomUUID(), taskId, workspaceId: session.projectPath, ...a, createdAt: Date.now() });
      await swarmUpdateTask(taskId, { status: 'awaiting_approval' });
    },
    onApprovalResolved: async (toolUseId: string) => {
      // find approval by toolUseId and resolve
      const all = await swarmGetApprovals(session.projectPath);
      const match = all.find(a => a.taskId === taskId && a.toolUseId === toolUseId);
      if (match) await swarmResolveApproval(match.id);
      const remaining = (await swarmGetApprovals(session.projectPath)).filter(a => a.taskId === taskId);
      if (remaining.length === 0) await swarmUpdateTask(taskId, { status: 'streaming' });
    },
  };
}
```

Splice this into the existing event handlers — call the hook in addition to current behaviour, not instead of.

- [ ] **Step 3: Add a `useEffect` that polls or subscribes to swarm DB changes** to refresh `swarmTasksByWs` (a 1s interval polling per active workspace is fine for v1; replace with a pub/sub if it shows up in profiling).

- [ ] **Step 4: Manual integration smoke test:** spawn a task, observe sidebar status moves queued → streaming → done. Verify approvals show ⚠ badge.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(swarm): mirror provider events into swarm task status"
```

---

**Phase 1 complete.** At this point a user can: open ⚡ Swarm → click + NEW → submit a prompt → see a task row → click it → see its chat stream → land or discard it. Concurrency cap applies. No orchestrator agent yet.

---

## Phase 2 — Orchestrator (Tasks 14–22)

### Task 14: Orchestrator session creation per workspace

**Files:**
- Modify: `src/App.tsx`
- Create: `src/lib/swarmOrchestratorSession.ts`
- Test: `tests/swarm/orchestratorSession.test.ts`

The orchestrator is a `ChatSession` with `kind: 'orchestrator'`. There is exactly one per workspace; if one doesn't exist for the active workspace, create it on first sidebar open.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ensureOrchestratorSession } from '@/lib/swarmOrchestratorSession';
import { dbGetSessions } from '@/chatDb';

describe('ensureOrchestratorSession', () => {
  it('creates exactly one orchestrator session per workspace', async () => {
    const s1 = await ensureOrchestratorSession('/p', 'claude');
    const s2 = await ensureOrchestratorSession('/p', 'claude');
    expect(s1.id).toBe(s2.id);
    const all = await dbGetSessions('/p');
    expect(all.filter(s => s.kind === 'orchestrator')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/lib/swarmOrchestratorSession.ts
import { dbGetSessions, dbSaveSession } from '@/chatDb';
import type { AIProvider, ChatSession } from '@/types';

export async function ensureOrchestratorSession(projectPath: string, provider: AIProvider): Promise<ChatSession> {
  const all = await dbGetSessions(projectPath);
  const existing = all.find(s => s.kind === 'orchestrator');
  if (existing) return existing;
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: 'Swarm Orchestrator',
    messages: [],
    aiProvider: provider,
    projectPath,
    pinned: true,
    messageCount: 0,
    kind: 'orchestrator',
  };
  await dbSaveSession(projectPath, session);
  return session;
}
```

- [ ] **Step 4: Wire in `App.tsx`** — when the swarm sidebar first opens, call `ensureOrchestratorSession(activeProjectPath, aiProvider)` and store the resulting session id.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmOrchestratorSession.ts src/App.tsx tests/swarm/orchestratorSession.test.ts
git commit -m "feat(swarm): singleton orchestrator session per workspace"
```

---

### Task 15: Orchestrator tool schema

**Files:**
- Create: `src/lib/swarmOrchestratorTools.ts`
- Test: `tests/swarm/swarmOrchestratorTools.test.ts`

The orchestrator's tools are dispatched in-renderer (no model code change beyond providing the tool schema). Each provider integration already supports custom tool injection in its system prompt / tool list.

- [ ] **Step 1: Implement tool schema**

```ts
// src/lib/swarmOrchestratorTools.ts
export const SWARM_TOOL_SCHEMA = [
  {
    name: 'spawn_task',
    description: 'Spawn a new SwarmTask in the active workspace.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        title: { type: 'string' },
        provider: { type: 'string', enum: ['claude','codex','gemini'] },
        model: { type: 'string' },
        approvalPolicy: { type: 'string', enum: ['auto','auto-read','always-ask'] },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'spawn_tasks',
    description: 'Spawn multiple SwarmTasks at once.',
    input_schema: {
      type: 'object',
      properties: { prompts: { type: 'array', items: { type: 'string' } } },
      required: ['prompts'],
    },
  },
  { name: 'query_status', description: 'Return the current swarm state.', input_schema: { type: 'object', properties: { filter: { type: 'string' } } } },
  { name: 'pause_task', description: 'Pause a task.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'resume_task', description: 'Resume a paused task.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'approve_tool_call', description: 'Approve a pending tool-call approval.', input_schema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] } },
  { name: 'deny_tool_call', description: 'Deny a pending tool-call approval.', input_schema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] } },
  { name: 'land', description: 'Fast-forward merge a done task into its base branch and remove the worktree.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'discard', description: 'Discard a task — delete branch and worktree.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
] as const;
```

- [ ] **Step 2: Test schema shape**

```ts
import { describe, it, expect } from 'vitest';
import { SWARM_TOOL_SCHEMA } from '@/lib/swarmOrchestratorTools';

describe('swarm tool schema', () => {
  it('declares the expected tools', () => {
    expect(SWARM_TOOL_SCHEMA.map(t => t.name)).toEqual([
      'spawn_task','spawn_tasks','query_status','pause_task','resume_task',
      'approve_tool_call','deny_tool_call','land','discard',
    ]);
  });
});
```

- [ ] **Step 3: Run, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/lib/swarmOrchestratorTools.ts tests/swarm/swarmOrchestratorTools.test.ts
git commit -m "feat(swarm): orchestrator tool schema"
```

---

### Task 16: Tool dispatcher (runs tools client-side)

**Files:**
- Create: `src/lib/swarmOrchestratorDispatcher.ts`
- Test: `tests/swarm/swarmOrchestratorDispatcher.test.ts`

When a provider emits a tool call with `name` matching one of the orchestrator's tools, the dispatcher resolves it against the swarm registry and returns the structured result.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { dispatchSwarmTool } from '@/lib/swarmOrchestratorDispatcher';

describe('dispatchSwarmTool', () => {
  it('spawn_task creates a task via the host', async () => {
    const host = { spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'foo' }) } as any;
    const r = await dispatchSwarmTool('spawn_task', { prompt: 'foo' }, host);
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'foo' });
    expect(r).toEqual({ ok: true, task: { id: 't1', title: 'foo' } });
  });

  it('query_status returns the snapshot', async () => {
    const host = { snapshot: vi.fn().mockResolvedValue({ active: 2, approvals: 0, ready: 1, tasks: [] }) } as any;
    const r = await dispatchSwarmTool('query_status', {}, host);
    expect(r.snapshot.active).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/lib/swarmOrchestratorDispatcher.ts
export interface SwarmHost {
  spawnTask(input: { prompt: string; title?: string; provider?: string; model?: string; approvalPolicy?: string }): Promise<{ id: string; title: string }>;
  spawnTasks(prompts: string[]): Promise<Array<{ id: string; title: string }>>;
  snapshot(filter?: string): Promise<unknown>;
  pause(taskRef: string): Promise<void>;
  resume(taskRef: string): Promise<void>;
  approve(approvalId: string): Promise<void>;
  deny(approvalId: string): Promise<void>;
  land(taskRef: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  discard(taskRef: string): Promise<void>;
}

export async function dispatchSwarmTool(name: string, input: any, host: SwarmHost) {
  switch (name) {
    case 'spawn_task': return { ok: true, task: await host.spawnTask(input) };
    case 'spawn_tasks': return { ok: true, tasks: await host.spawnTasks(input.prompts) };
    case 'query_status': return { ok: true, snapshot: await host.snapshot(input.filter) };
    case 'pause_task': await host.pause(input.taskRef); return { ok: true };
    case 'resume_task': await host.resume(input.taskRef); return { ok: true };
    case 'approve_tool_call': await host.approve(input.approvalId); return { ok: true };
    case 'deny_tool_call': await host.deny(input.approvalId); return { ok: true };
    case 'land': return await host.land(input.taskRef);
    case 'discard': await host.discard(input.taskRef); return { ok: true };
    default: return { ok: false, error: `unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmOrchestratorDispatcher.ts tests/swarm/swarmOrchestratorDispatcher.test.ts
git commit -m "feat(swarm): orchestrator tool dispatcher"
```

---

### Task 17: Provider integration for orchestrator sessions

**Files:**
- Modify: each provider runner integration in `src/App.tsx` (and/or `electron/services/claude.ts`, `codex.ts`, `gemini.ts` if tool definitions live there)
- Test: `tests/swarm/orchestratorProviderIntegration.test.ts` (mock provider, assert tool schema + dispatcher wiring)

- [ ] **Step 1: Locate the existing tool registration path per provider** (search `tools:` / `tool_schema` in `electron/services`).

- [ ] **Step 2: For each provider, when the session has `kind === 'orchestrator'`:** merge `SWARM_TOOL_SCHEMA` into the provider's tool list, and on a tool-use event matching one of these names, route to `dispatchSwarmTool` instead of the provider's normal tool runner.

- [ ] **Step 3: Test using a mock provider** — feed a synthetic tool-use event, assert that `swarmTasks` table gains a row.

- [ ] **Step 4: Manual smoke**: select Swarm Overview, type "spawn a task that writes a hello.txt", observe a new row appears, orchestrator chat shows the tool call.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx electron/services/*.ts tests/swarm/orchestratorProviderIntegration.test.ts
git commit -m "feat(swarm): inject swarm tools into orchestrator sessions"
```

---

### Task 18: OrchestratorView shell (chat + composer)

**Files:**
- Create: `src/components/Swarm/OrchestratorView.tsx`
- Create: `src/components/Swarm/OrchestratorComposer.tsx`
- Modify: `src/App.tsx` (route to OrchestratorView when `swarmSelected === 'overview'`)
- Test: `tests/swarm/OrchestratorView.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrchestratorView from '@/components/Swarm/OrchestratorView';

const stats = { active: 5, approvals: 1, ready: 1, cost: 0.42, runtimeSec: 134 };

describe('OrchestratorView', () => {
  it('renders header and composer', () => {
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} approvals={[]} readyTasks={[]} onCommand={vi.fn()}/>);
    expect(screen.getByText(/orchestrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('split-lines toggle sends one command per line', () => {
    const onCommand = vi.fn();
    render(<OrchestratorView orchestratorSessionId="o1" projectPath="/p" stats={stats} approvals={[]} readyTasks={[]} onCommand={onCommand}/>);
    fireEvent.click(screen.getByLabelText(/split lines/i));
    fireEvent.change(screen.getByPlaceholderText(/ask the orchestrator/i), { target: { value: 'a\nb\nc' }});
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onCommand).toHaveBeenCalledWith({ text: 'a\nb\nc', splitLines: true });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — top-to-bottom: header (stats + provider/model), embedded chat stream (reuse `ChatPanel` with the orchestrator's sessionId), approval tray (Task 19), ready-to-land tray (Task 20), composer (Task 21). Composer emits `onCommand({ text, splitLines })`.

- [ ] **Step 4: Wire in `App.tsx`** — when `sidebarOpen === 'swarm' && swarmSelected === 'overview'`, render `<OrchestratorView>`. On `onCommand`:

```ts
async function handleOrchestratorCommand({ text, splitLines }: { text: string; splitLines: boolean }) {
  // Just send into the orchestrator session — the model decides whether the
  // text is a prompt to spawn vs a command. If splitLines is on, prepend an
  // instruction:
  const body = splitLines
    ? `Spawn one task per line below:\n${text}`
    : text;
  await provider.sendMessage(orchestratorSession.id, body);
}
```

- [ ] **Step 5: Run tests, manual smoke**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/OrchestratorView.tsx src/components/Swarm/OrchestratorComposer.tsx src/App.tsx tests/swarm/OrchestratorView.test.tsx
git commit -m "feat(swarm): OrchestratorView shell with chat + composer"
```

---

### Task 19: ApprovalTray

**Files:**
- Create: `src/components/Swarm/ApprovalTray.tsx`
- Test: `tests/swarm/ApprovalTray.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalTray from '@/components/Swarm/ApprovalTray';

const approvals = [{
  id: 'a1', taskId: 't1', taskTitle: 'migrate users',
  toolName: 'bash', command: 'psql -f migrate.sql', createdAt: 1,
}];

describe('ApprovalTray', () => {
  it('renders pending approvals and fires actions', () => {
    const onApprove = vi.fn(); const onDeny = vi.fn();
    render(<ApprovalTray approvals={approvals} onApprove={onApprove} onDeny={onDeny} onApproveAllReads={() => {}} onDenyAll={() => {}}/>);
    expect(screen.getByText(/migrate users/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(onApprove).toHaveBeenCalledWith('a1');
  });

  it('renders nothing when empty', () => {
    const { container } = render(<ApprovalTray approvals={[]} onApprove={() => {}} onDeny={() => {}} onApproveAllReads={() => {}} onDenyAll={() => {}}/>);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — collapsed strip when no approvals (return `null`), expanded list when present. Each row has View / Deny / Approve buttons. Header has "approve all reads" / "deny all" actions.

- [ ] **Step 4: Wire into OrchestratorView**, pass live approvals from `swarmGetApprovals(activeProjectPath)`. `onApprove` calls the existing per-session approval-resolution API for the matching toolUseId AND `swarmResolveApproval`.

- [ ] **Step 5: Run, manual smoke**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/ApprovalTray.tsx tests/swarm/ApprovalTray.test.tsx src/components/Swarm/OrchestratorView.tsx
git commit -m "feat(swarm): approval tray in orchestrator"
```

---

### Task 20: ReadyToLandTray

**Files:**
- Create: `src/components/Swarm/ReadyToLandTray.tsx`
- Test: `tests/swarm/ReadyToLandTray.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReadyToLandTray from '@/components/Swarm/ReadyToLandTray';

const tasks = [{ id: 't', title: 'fix flaky test', branch: 'swarm/fix-x', additions: 18, deletions: 7 }];

describe('ReadyToLandTray', () => {
  it('lists ready tasks with land/discard/diff', () => {
    const onLand = vi.fn(); const onDiscard = vi.fn(); const onDiff = vi.fn();
    render(<ReadyToLandTray tasks={tasks as any} onLand={onLand} onDiscard={onDiscard} onDiff={onDiff} onLandAll={() => {}}/>);
    expect(screen.getByText(/fix flaky test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /land/i }));
    expect(onLand).toHaveBeenCalledWith('t');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — collapsed peek by default ("1 ready · fix flaky test · expand"), expandable to the full list with Diff / Discard / Land buttons + a "land all green" header action.

`additions` / `deletions` come from a new `window.sai.git.diffStats(cwd, branch)` helper — add it in `electron/services/git.ts` if missing (uses `git diff --shortstat baseBranch..branch`).

- [ ] **Step 4: Wire into OrchestratorView.**

- [ ] **Step 5: Run, manual smoke**

- [ ] **Step 6: Commit**

```bash
git add src/components/Swarm/ReadyToLandTray.tsx tests/swarm/ReadyToLandTray.test.tsx electron/services/git.ts src/components/Swarm/OrchestratorView.tsx
git commit -m "feat(swarm): ready-to-land tray with diff stats"
```

---

### Task 21: Host integration — wire dispatcher to App state

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/swarm/SwarmHost.test.ts`

Implement `SwarmHost` (from Task 16) inside `App.tsx`, capturing closures over the current state and `swarmDb`. Provide it to the orchestrator provider integration (Task 17).

- [ ] **Step 1: Implement host**

```ts
const landDeps = {
  canFastForward: window.sai.swarm.canFastForward,
  ffMerge: window.sai.swarm.ffMerge,
  worktreeRemove: window.sai.swarm.worktreeRemove,
  updateTask: swarmUpdateTask,
};
const discardDeps = {
  worktreeRemove: window.sai.swarm.worktreeRemove,
  updateTask: swarmUpdateTask,
};

async function byRef(ref: string) {
  const tasks = swarmTasksByWs.get(activeProjectPath) ?? [];
  const resolved = resolveTaskRef(tasks, ref);
  if (!resolved) throw new Error(`task not found: ${ref}`);
  return resolved;
}

const swarmHost: SwarmHost = {
  spawnTask: async (i) => {
    const created = await spawnSwarmTask({
      prompt: i.prompt,
      provider: (i.provider as AIProvider) ?? aiProvider,
      model: i.model ?? modelChoice,
      approvalPolicy: (i.approvalPolicy as ApprovalPolicy) ?? 'auto-read',
    });
    return { id: created.id, title: created.title };
  },
  spawnTasks: async (prompts) =>
    Promise.all(prompts.map(p => swarmHost.spawnTask({ prompt: p }))),
  snapshot: async () => {
    const tasks = swarmTasksByWs.get(activeProjectPath) ?? [];
    return {
      active: tasks.filter(t => t.status === 'streaming').length,
      approvals: tasks.filter(t => t.status === 'awaiting_approval').length,
      ready: tasks.filter(t => t.status === 'done').length,
      tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
    };
  },
  pause: async (ref) => {
    const t = await byRef(ref);
    await provider.stop(t.sessionId); // existing per-provider stop helper
    await swarmUpdateTask(t.id, { status: 'paused' });
  },
  resume: async (ref) => {
    const t = await byRef(ref);
    await swarmUpdateTask(t.id, { status: 'queued' });
    scheduler.tick();
  },
  approve: async (approvalId) => {
    const all = await swarmGetApprovals(activeProjectPath);
    const a = all.find(x => x.id === approvalId);
    if (!a) return;
    // Resolve in the provider's existing per-session approval API
    await provider.approveToolCall(a.taskId /* sessionId resolution */, a.toolUseId);
    await swarmResolveApproval(a.id);
  },
  deny: async (approvalId) => {
    const all = await swarmGetApprovals(activeProjectPath);
    const a = all.find(x => x.id === approvalId);
    if (!a) return;
    await provider.denyToolCall(a.taskId, a.toolUseId);
    await swarmResolveApproval(a.id);
  },
  land: async (ref) => landTask(await byRef(ref), landDeps),
  discard: async (ref) => { await discardTask(await byRef(ref), discardDeps); },
};
```

Note: `spawnSwarmTask` (Task 8) must return the created `SwarmTask` (refactor its return type from `void` to `Promise<SwarmTask>`). `provider.stop` / `approveToolCall` / `denyToolCall` are the existing per-session APIs already used in `ChatPanel.tsx` — locate and reuse them, do not invent new ones.

`byRef(ref)` resolves either by task id or by exact-prefix title match across the current workspace's tasks.

- [ ] **Step 2: Test `byRef`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveTaskRef } from '@/App'; // or extract to src/lib/swarmRef.ts

const tasks = [
  { id: 'abc123', title: 'refactor auth' },
  { id: 'def456', title: 'fix flaky test' },
] as any[];

describe('resolveTaskRef', () => {
  it('matches by id', () => { expect(resolveTaskRef(tasks, 'abc123')?.id).toBe('abc123'); });
  it('matches by title prefix', () => { expect(resolveTaskRef(tasks, 'fix flaky')?.id).toBe('def456'); });
  it('returns null on ambiguity', () => { expect(resolveTaskRef([{id:'a',title:'foo bar'},{id:'b',title:'foo baz'}] as any, 'foo')).toBeNull(); });
});
```

Extract `resolveTaskRef` into `src/lib/swarmRef.ts` for testability.

- [ ] **Step 3: Run, expect PASS**

- [ ] **Step 4: Manual end-to-end smoke** — type into orchestrator composer "spawn a task to add a hello world to README" and watch a new row appear via the dispatcher, then "land it" and watch the worktree FF-merge.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/lib/swarmRef.ts tests/swarm/SwarmHost.test.ts
git commit -m "feat(swarm): host implementation wiring tools to app state"
```

---

### Task 22: Recent activity scrollback

**Files:**
- Modify: `src/components/Swarm/OrchestratorView.tsx`
- Modify: `src/swarmDb.ts` (no schema change; just queries for landed/discarded)
- Test: `tests/swarm/RecentActivity.test.tsx`

- [ ] **Step 1: Render a "RECENT" section** below the ready tray listing the last 10 tasks with status `landed`, `discarded`, `failed`, sorted by `lastActivityAt`.

- [ ] **Step 2: Test rendering** — one row per status, with timestamp.

- [ ] **Step 3: Commit**

```bash
git add src/components/Swarm/OrchestratorView.tsx tests/swarm/RecentActivity.test.tsx
git commit -m "feat(swarm): recent activity scrollback in orchestrator"
```

---

**Phase 2 complete.** Orchestrator is chattable, spawns tasks via natural language, exposes approval and land trays whose buttons are equivalent to tool calls.

---

## Phase 3 — Polish (Tasks 23–28)

### Task 23: Settings → Swarm panel

**Files:**
- Create: `src/components/Settings/SwarmSettings.tsx`
- Modify: `src/components/SettingsModal.tsx` (register `'swarm'` page)
- Test: `tests/swarm/SwarmSettings.test.tsx`

Settings to expose:
- `concurrencyCap` (number, default 5)
- `defaultApprovalPolicy` (select, default `auto-read`)
- `orchestratorProvider` / `orchestratorModel`
- `defaultTaskProvider` / `defaultTaskModel`
- `worktreeRoot` (path, default `<project>/../.sai-swarm/`)
- `notifyOnComplete` (bool)
- `notifyOnApproval` (bool)

- [ ] **Step 1: Failing test** — renders all fields, edits persist via `window.sai.settingsSet`.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** — follow the existing per-page pattern (claude/codex/gemini settings pages are good references). Persist each value with `settingsSet('swarm.<key>', value)`.

- [ ] **Step 4: Add `'swarm'` to the `SettingsPage` type** in `SettingsModal.tsx` and to the page-tab list with a Zap icon.

- [ ] **Step 5: Make scheduler/host respect settings** — `swarmHost.spawnTask` defaults pull from settings, scheduler cap updates on settings change.

- [ ] **Step 6: Run, manual smoke**

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/SwarmSettings.tsx src/components/SettingsModal.tsx tests/swarm/SwarmSettings.test.tsx src/App.tsx
git commit -m "feat(swarm): Settings → Swarm panel and wiring"
```

---

### Task 24: Approval policy enforcement

**Files:**
- Modify: `src/App.tsx` (swarm-aware approval interception)
- Create: `src/lib/swarmApprovalPolicy.ts`
- Test: `tests/swarm/swarmApprovalPolicy.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { shouldRequireApproval, READ_TOOLS } from '@/lib/swarmApprovalPolicy';

describe('shouldRequireApproval', () => {
  it('auto-read pauses on writes', () => {
    expect(shouldRequireApproval('auto-read', 'bash')).toBe(true);
    expect(shouldRequireApproval('auto-read', 'read_file')).toBe(false);
  });
  it('always-ask pauses on everything', () => {
    expect(shouldRequireApproval('always-ask', 'read_file')).toBe(true);
  });
  it('auto never pauses', () => {
    expect(shouldRequireApproval('auto', 'bash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/lib/swarmApprovalPolicy.ts
import type { ApprovalPolicy } from '@/types';

export const READ_TOOLS = new Set(['read_file','list_files','grep','glob','search']);
export function shouldRequireApproval(policy: ApprovalPolicy, toolName: string): boolean {
  if (policy === 'auto') return false;
  if (policy === 'always-ask') return true;
  return !READ_TOOLS.has(toolName);
}
```

- [ ] **Step 4: In `App.tsx` swarmHookForSession**, before the existing approval flow fires for a tool call, consult `shouldRequireApproval(task.approvalPolicy, tool.name)`. If `false`, auto-resolve the approval immediately. If `true`, fall through to the normal approval flow.

- [ ] **Step 5: Run, manual smoke** — spawn a task with policy `auto-read`, observe `read_file` calls do not surface; `bash` calls do.

- [ ] **Step 6: Commit**

```bash
git add src/lib/swarmApprovalPolicy.ts src/App.tsx tests/swarm/swarmApprovalPolicy.test.ts
git commit -m "feat(swarm): per-task approval policy enforcement"
```

---

### Task 25: Notifications

**Files:**
- Modify: `src/App.tsx` (hook into existing notification helpers)
- Test: covered by manual smoke

- [ ] **Step 1:** When `swarmHookForSession.onTurnComplete` fires and `settings.swarm.notifyOnComplete` is true, call the existing SAI notification helper used today for chat-completion notifications, prefixed with the task title.

- [ ] **Step 2:** When `onApprovalNeeded` fires and `settings.swarm.notifyOnApproval` is true, send a notification with the task title and tool name.

- [ ] **Step 3:** Manual smoke — toggle settings, observe notifications fire/skip.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(swarm): task completion and approval notifications"
```

---

### Task 26: Quit-confirm modal

**Files:**
- Create: `src/components/Swarm/QuitSwarmConfirmModal.tsx`
- Modify: `src/App.tsx` (intercept window close when swarm has streaming tasks)
- Modify: `electron/main.ts` (renderer-driven `close` flow; existing close-handler pattern)
- Test: `tests/swarm/QuitSwarmConfirmModal.test.tsx`

- [ ] **Step 1: Failing test** — modal lists affected tasks, has Cancel / Quit anyway buttons.

- [ ] **Step 2: Implement** — themed modal matching `UnsavedChangesModal.tsx`.

- [ ] **Step 3:** In `App.tsx`, before quitting, count streaming tasks across all workspaces; if > 0, show the modal. On confirm, mark all `streaming` tasks as `paused` in `swarmDb` and let close proceed.

- [ ] **Step 4: Manual smoke** — quit with active tasks, see modal.

- [ ] **Step 5: Commit**

```bash
git add src/components/Swarm/QuitSwarmConfirmModal.tsx src/App.tsx electron/main.ts tests/swarm/QuitSwarmConfirmModal.test.tsx
git commit -m "feat(swarm): quit confirmation when streaming tasks exist"
```

---

### Task 27: Resume-on-relaunch hygiene

**Files:**
- Modify: `src/App.tsx`
- Test: integration-style (manual + targeted unit)

- [ ] **Step 1:** On app start, after `swarmInit()`, for each workspace, load tasks. Any task with status `streaming` is forced to `paused` (the model wasn't actually running). Any `awaiting_approval` stays as-is (the approval row is also persisted).

- [ ] **Step 2:** When the user opens a task row, expose a visible "▶ Resume" button (in `SwarmTaskHeader`) when status is `paused`. Clicking it transitions to `queued`; scheduler picks it up.

- [ ] **Step 3: Unit test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { swarmInit, swarmCreateTask, swarmGetTasks, swarmUpdateTask } from '@/swarmDb';
import { reconcileTasksOnStartup } from '@/App'; // export the helper

beforeEach(async () => { await swarmInit(); });

describe('reconcileTasksOnStartup', () => {
  it('demotes streaming tasks to paused', async () => {
    await swarmCreateTask({ id: 'x', workspaceId: '/p', sessionId: 's', title: 't', prompt: 'p', provider: 'claude', model: 'opus', approvalPolicy: 'auto-read', status: 'streaming', branch: 'b', baseBranch: 'main', worktreePath: '/wt', createdAt: 1, lastActivityAt: 1, costEstimate: 0, toolCallCount: 0 });
    await reconcileTasksOnStartup('/p');
    const [t] = await swarmGetTasks('/p');
    expect(t.status).toBe('paused');
  });
});
```

Extract `reconcileTasksOnStartup` to `src/lib/swarmReconcile.ts` for testability.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmReconcile.ts src/components/Swarm/SwarmTaskHeader.tsx src/App.tsx tests/swarm/swarmReconcile.test.ts
git commit -m "feat(swarm): reconcile streaming tasks to paused on relaunch"
```

---

### Task 28: End-to-end smoke (Playwright)

**Files:**
- Create: `tests/e2e/swarm.spec.ts`

- [ ] **Step 1: Write the scenario**

```ts
import { test, expect } from '@playwright/test';

test('swarm: spawn → focus → land', async ({ electronApp, page }) => {
  // open SAI, open a temp project workspace, etc. — follow existing e2e patterns in playwright.config.ts and tests/e2e/
  await page.click('[aria-label="Swarm"]');
  await expect(page.getByText('Swarm Overview')).toBeVisible();

  await page.click('text=+ NEW');
  await page.fill('textarea[placeholder*="what should this task do"]', 'echo hello > greet.txt');
  await page.click('button:has-text("Dispatch")');

  await expect(page.getByText('echo hello > greet.txt')).toBeVisible();
  // wait for task to reach "done"
  await expect(page.locator('.row-icon', { hasText: '✓' })).toBeVisible({ timeout: 60_000 });

  await page.click('text=echo hello > greet.txt');
  await page.click('button:has-text("Land")');
  await expect(page.getByText(/landed/i)).toBeVisible();
});
```

- [ ] **Step 2: Run** — `npx playwright test tests/e2e/swarm.spec.ts`. Expect first-pass flakiness; tighten waits as needed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/swarm.spec.ts
git commit -m "test(swarm): e2e smoke for spawn → land"
```

---

**Plan complete.** When all 28 tasks pass tests + smoke, swarm mode is shippable.

## Sanity Checks (post-implementation)

- [ ] No new TypeScript errors: `npx tsc --noEmit`
- [ ] All vitest tests pass: `npx vitest run`
- [ ] Playwright e2e for swarm passes
- [ ] Manual: spawn 6 tasks against a real repo, observe scheduler caps at 5, verify worktree directories are sibling-of-project, land one cleanly, discard one cleanly
- [ ] Manual: trigger an approval, resolve through orchestrator chat ("approve a1"), watch task resume
- [ ] Manual: quit with active tasks, relaunch, observe they appear as paused with ▶ Resume buttons

---

## Continuation Prompt (paste into new session)

> Resume executing the swarm-mode plan at `docs/superpowers/plans/2026-05-11-swarm-mode.md`. Tasks 1–3 are done and committed on branch `feat/swarm-mode` (commits `502cf1c`, `b5fd219`, `2eaea3c`, `6ea124b`). Use the superpowers:subagent-driven-development skill, starting from Task 4 (Electron worktree IPC). Match the prior cadence: implementer subagent → spec compliance review → code quality review → fix loop if needed → commit → next task. For trivial spec-verbatim tasks you may skip the two-stage review and just verify the commit + tests. Continue through Phase 1 (Tasks 1–13) at minimum. Final goal: a usable "spawn task → focus → land" feature shippable from this branch.
