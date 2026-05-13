# Meta Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meta Workspaces — a named, persistent grouping of N project paths that opens one chat / terminal / editor / multi-repo git panel rooted at a SAI-managed synthetic directory of junctions+symlinks.

**Architecture:** Persist `MetaWorkspace` records in `settings.json` (synced via `sai-config`). On activation, materialize `~/.sai/meta/<id>/` containing one filesystem link per included project (`fs.symlink(target, link, 'junction')` — junction on Windows, symlink elsewhere). The existing `WorkspaceContext` is reused with `projectPath = syntheticRoot`; chat, terminal, file explorer, and search inherit the curated view. The git sidebar gains a multi-repo collapsible variant for meta workspaces.

**Tech Stack:** Electron 36 (main process: Node `fs`, `path`), React 19 + TypeScript 5.7 (renderer), Vitest (unit + integration), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-05-13-meta-workspaces-design.md`

---

## File Structure

**Create:**
- `electron/services/metaWorkspace.ts` — persistence + CRUD for `MetaWorkspace[]` in settings.json.
- `electron/services/metaSyntheticRoot.ts` — synthetic-root materialization, reconciliation, deletion.
- `src/components/MetaWorkspace/CreateMetaWorkspaceModal.tsx` — creation flow UI.
- `src/components/MetaWorkspace/ManageMetaWorkspaceModal.tsx` — rename / add / remove / edit-description / delete.
- `src/components/MetaWorkspace/IncludedProjectsStrip.tsx` — chip strip + `@`-mention insert.
- `src/components/Git/MetaGitSidebar.tsx` — multi-repo collapsible variant.
- `src/lib/metaSystemPrompt.ts` — builds the preamble appended to the AI system prompt.
- `tests/unit/metaWorkspace.test.ts` — store CRUD.
- `tests/unit/metaSyntheticRoot.test.ts` — link tree lifecycle (uses tmpdir).
- `tests/unit/metaSystemPrompt.test.ts` — preamble formatting.
- `tests/e2e/meta-workspace.spec.ts` — picker tabs + creation + activation.

**Modify:**
- `src/types.ts` — add `MetaWorkspace`, `MetaWorkspaceProject`, `MetaWorkspaceProjectStatus`.
- `electron/main.ts` — register meta-workspace IPC handlers; persist `metaWorkspaces` key.
- `electron/preload.ts` — expose `metaWorkspace*` bridge methods.
- `electron/services/github-sync.ts` — confirm `metaWorkspaces` key is included in sync (not in the excludes list).
- `src/components/TitleBar.tsx` — Projects/Meta tabs in dropdown; "Meta: <name>" active label.
- `src/App.tsx` — load meta workspace registry; route activation through synthetic-root flow; pass `metaWorkspace` to chat/git/file-explorer.
- `src/components/Chat/ChatPanel.tsx` — pass meta-workspace preamble into Claude/Codex/Gemini start.
- `src/components/Chat/ChatInput.tsx` — `@`-mention picker bound to included projects.
- `src/components/Git/GitSidebar.tsx` — render `MetaGitSidebar` when active workspace is meta.
- `src/components/FileExplorer/FileExplorerSidebar.tsx` — block cross-project drag-and-drop when rooted at a synthetic root.
- `src/components/SearchPanel/SearchPanel.tsx` — multi-project replace confirmation gate.

---

## Task 1: Types

**Files:**
- Modify: `src/types.ts` (append after line 144)

- [ ] **Step 1: Add types**

Append to `src/types.ts`:

```ts
export type MetaWorkspaceProjectStatus = 'ok' | 'unavailable';

export interface MetaWorkspaceProject {
  path: string;            // absolute path on the originating device
  linkName: string;        // basename used inside the synthetic root
  description?: string;    // one-line hint fed to the AI system prompt
}

export interface MetaWorkspace {
  id: string;                          // stable UUID, also used as ~/.sai/meta/<id>
  name: string;                        // display name
  projects: MetaWorkspaceProject[];
  createdAt: number;
  lastActivity: number;
}

export interface MetaWorkspaceRuntimeProject extends MetaWorkspaceProject {
  status: MetaWorkspaceProjectStatus;  // derived per-device on activation
}

export interface MetaWorkspaceRuntime {
  meta: MetaWorkspace;
  syntheticRoot: string;               // ~/.sai/meta/<id>/, derived per-device
  projects: MetaWorkspaceRuntimeProject[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(meta-workspace): add MetaWorkspace types"
```

---

## Task 2: Meta workspace store (main process)

**Files:**
- Create: `electron/services/metaWorkspace.ts`
- Test: `tests/unit/metaWorkspace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/metaWorkspace.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/sai-meta-test' },
}));

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  listMetaWorkspaces, createMetaWorkspace, updateMetaWorkspace,
  deleteMetaWorkspace, getMetaWorkspace,
} from '../../electron/services/metaWorkspace';

const dir = '/tmp/sai-meta-test';
const file = path.join(dir, 'settings.json');

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
});

describe('metaWorkspace store', () => {
  it('returns empty list when no settings file', () => {
    expect(listMetaWorkspaces()).toEqual([]);
  });

  it('creates a meta workspace with stable id and persists it', () => {
    const m = createMetaWorkspace({
      name: 'axi-marketing',
      projects: [{ path: '/p/a', linkName: 'a' }],
    });
    expect(m.id).toMatch(/[0-9a-f-]{36}/);
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).metaWorkspaces;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('axi-marketing');
  });

  it('updates only the targeted record', () => {
    const a = createMetaWorkspace({ name: 'a', projects: [] });
    const b = createMetaWorkspace({ name: 'b', projects: [] });
    updateMetaWorkspace(a.id, { name: 'a-renamed' });
    expect(getMetaWorkspace(a.id)?.name).toBe('a-renamed');
    expect(getMetaWorkspace(b.id)?.name).toBe('b');
  });

  it('deletes by id', () => {
    const m = createMetaWorkspace({ name: 'x', projects: [] });
    deleteMetaWorkspace(m.id);
    expect(listMetaWorkspaces()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run tests/unit/metaWorkspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `electron/services/metaWorkspace.ts`:

```ts
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MetaWorkspace } from '../../src/types';

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readAll(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); }
  catch { return {}; }
}

function writeAll(settings: Record<string, any>) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings));
}

function readList(): MetaWorkspace[] {
  const v = readAll().metaWorkspaces;
  return Array.isArray(v) ? v : [];
}

function writeList(list: MetaWorkspace[]) {
  const all = readAll();
  all.metaWorkspaces = list;
  writeAll(all);
}

export function listMetaWorkspaces(): MetaWorkspace[] {
  return readList();
}

export function getMetaWorkspace(id: string): MetaWorkspace | undefined {
  return readList().find(m => m.id === id);
}

export function createMetaWorkspace(input: {
  name: string;
  projects: { path: string; linkName: string; description?: string }[];
}): MetaWorkspace {
  const now = Date.now();
  const meta: MetaWorkspace = {
    id: randomUUID(),
    name: input.name,
    projects: input.projects,
    createdAt: now,
    lastActivity: now,
  };
  writeList([...readList(), meta]);
  return meta;
}

export function updateMetaWorkspace(
  id: string,
  patch: Partial<Pick<MetaWorkspace, 'name' | 'projects' | 'lastActivity'>>,
): MetaWorkspace | undefined {
  const list = readList();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return undefined;
  list[idx] = { ...list[idx], ...patch };
  writeList(list);
  return list[idx];
}

export function deleteMetaWorkspace(id: string): void {
  writeList(readList().filter(m => m.id !== id));
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/unit/metaWorkspace.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add electron/services/metaWorkspace.ts tests/unit/metaWorkspace.test.ts
git commit -m "feat(meta-workspace): add persistence store"
```

---

## Task 3: Synthetic-root materialization

**Files:**
- Create: `electron/services/metaSyntheticRoot.ts`
- Test: `tests/unit/metaSyntheticRoot.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/metaSyntheticRoot.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  syntheticRootFor, materialize, reconcile, deleteSyntheticRoot,
  resolveLinkName,
} from '../../electron/services/metaSyntheticRoot';
import type { MetaWorkspace } from '../../src/types';

let tmp: string;
let targetA: string;
let targetB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-syn-'));
  targetA = path.join(tmp, 'project-a');
  targetB = path.join(tmp, 'project-b');
  fs.mkdirSync(targetA, { recursive: true });
  fs.mkdirSync(targetB, { recursive: true });
  fs.writeFileSync(path.join(targetA, 'marker-a.txt'), 'a');
  fs.writeFileSync(path.join(targetB, 'marker-b.txt'), 'b');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function meta(id: string, projects: { path: string; linkName: string }[]): MetaWorkspace {
  return { id, name: 't', projects, createdAt: 0, lastActivity: 0 };
}

describe('metaSyntheticRoot', () => {
  it('materializes one link per project', () => {
    const m = meta('m1', [
      { path: targetA, linkName: 'project-a' },
      { path: targetB, linkName: 'project-b' },
    ]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    expect(fs.existsSync(path.join(root, 'project-a', 'marker-a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'project-b', 'marker-b.txt'))).toBe(true);
  });

  it('marks unavailable when target is missing', () => {
    const m = meta('m2', [
      { path: targetA, linkName: 'project-a' },
      { path: path.join(tmp, 'does-not-exist'), linkName: 'gone' },
    ]);
    const root = syntheticRootFor(m.id, tmp);
    const runtime = materialize(m, root);
    expect(runtime.find(p => p.linkName === 'project-a')!.status).toBe('ok');
    expect(runtime.find(p => p.linkName === 'gone')!.status).toBe('unavailable');
    expect(fs.existsSync(path.join(root, 'gone'))).toBe(false);
  });

  it('reconcile removes dangling links and creates missing ones', () => {
    const m = meta('m3', [{ path: targetA, linkName: 'project-a' }]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    // Simulate a dangling link by adding one outside the manifest:
    fs.symlinkSync(targetB, path.join(root, 'stale'), 'junction');
    const updated: MetaWorkspace = { ...m, projects: [
      { path: targetA, linkName: 'project-a' },
      { path: targetB, linkName: 'project-b' },
    ]};
    reconcile(updated, root);
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'project-b', 'marker-b.txt'))).toBe(true);
  });

  it('deleteSyntheticRoot removes links only, never targets', () => {
    const m = meta('m4', [{ path: targetA, linkName: 'project-a' }]);
    const root = syntheticRootFor(m.id, tmp);
    materialize(m, root);
    deleteSyntheticRoot(root);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(path.join(targetA, 'marker-a.txt'))).toBe(true);
  });

  it('resolveLinkName appends suffix on collision', () => {
    const taken = new Set(['foo', 'foo-2']);
    expect(resolveLinkName('foo', taken)).toBe('foo-3');
    expect(resolveLinkName('bar', taken)).toBe('bar');
  });

  it('refuses to delete a non-link file under the synthetic root', () => {
    const m = meta('m5', []);
    const root = syntheticRootFor(m.id, tmp);
    fs.mkdirSync(root, { recursive: true });
    const realFile = path.join(root, 'oops.txt');
    fs.writeFileSync(realFile, 'do not delete');
    expect(() => deleteSyntheticRoot(root)).toThrow(/non-link/);
    expect(fs.existsSync(realFile)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/unit/metaSyntheticRoot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `electron/services/metaSyntheticRoot.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { MetaWorkspace, MetaWorkspaceRuntimeProject } from '../../src/types';

/** Compute the synthetic root path for a meta workspace id. */
export function syntheticRootFor(id: string, baseDir: string = path.join(os.homedir(), '.sai', 'meta')): string {
  return path.join(baseDir, id);
}

/** Resolve a candidate basename against a set of already-taken names by appending -2, -3, ... */
export function resolveLinkName(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  let n = 2;
  while (taken.has(`${candidate}-${n}`)) n++;
  return `${candidate}-${n}`;
}

/** Read existing entries (links only) in the synthetic root; returns basenames. */
function readExistingLinks(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => {
    const full = path.join(root, name);
    try { return fs.lstatSync(full).isSymbolicLink(); }
    catch { return false; }
  });
}

/** Materialize a fresh link tree at `root` matching `meta.projects`.
 *  Returns the per-project runtime status (ok|unavailable). */
export function materialize(meta: MetaWorkspace, root: string): MetaWorkspaceRuntimeProject[] {
  fs.mkdirSync(root, { recursive: true });
  const result: MetaWorkspaceRuntimeProject[] = [];
  for (const p of meta.projects) {
    const link = path.join(root, p.linkName);
    if (!fs.existsSync(p.path)) {
      // Don't create a dangling link; mark unavailable.
      if (fs.existsSync(link)) safeUnlinkLink(link);
      result.push({ ...p, status: 'unavailable' });
      continue;
    }
    if (fs.existsSync(link)) {
      // Refuse to overwrite a non-link.
      const stat = fs.lstatSync(link);
      if (!stat.isSymbolicLink()) {
        throw new Error(`Refusing to overwrite non-link at ${link}`);
      }
      // Already linked — leave it.
    } else {
      fs.symlinkSync(p.path, link, 'junction');
    }
    result.push({ ...p, status: 'ok' });
  }
  return result;
}

/** Reconcile the link tree to match the current manifest: prune extras, add missing. */
export function reconcile(meta: MetaWorkspace, root: string): MetaWorkspaceRuntimeProject[] {
  fs.mkdirSync(root, { recursive: true });
  const wantNames = new Set(meta.projects.map(p => p.linkName));
  for (const name of readExistingLinks(root)) {
    if (!wantNames.has(name)) safeUnlinkLink(path.join(root, name));
  }
  return materialize(meta, root);
}

/** Delete the synthetic root. Refuses if any non-link file is present. */
export function deleteSyntheticRoot(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to delete non-link entry at ${full}`);
    }
    fs.unlinkSync(full);
  }
  fs.rmdirSync(root);
}

function safeUnlinkLink(link: string) {
  const stat = fs.lstatSync(link);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-link at ${link}`);
  }
  fs.unlinkSync(link);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/metaSyntheticRoot.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add electron/services/metaSyntheticRoot.ts tests/unit/metaSyntheticRoot.test.ts
git commit -m "feat(meta-workspace): materialize synthetic root with junctions/symlinks"
```

---

## Task 4: System-prompt preamble builder

**Files:**
- Create: `src/lib/metaSystemPrompt.ts`
- Test: `tests/unit/metaSystemPrompt.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/metaSystemPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMetaPreamble } from '../../src/lib/metaSystemPrompt';

describe('buildMetaPreamble', () => {
  it('returns empty string when no meta workspace given', () => {
    expect(buildMetaPreamble(null)).toBe('');
  });

  it('lists each project with link name, real path, and description', () => {
    const out = buildMetaPreamble({
      name: 'axi-marketing',
      syntheticRoot: '/home/u/.sai/meta/abc',
      projects: [
        { linkName: 'axi-foo', path: '/work/axi-foo', description: 'storefront', status: 'ok' },
        { linkName: 'axi-bar', path: '/work/axi-bar', status: 'ok' },
      ],
    });
    expect(out).toContain('Meta Workspace "axi-marketing"');
    expect(out).toContain('/home/u/.sai/meta/abc');
    expect(out).toContain('axi-foo -> /work/axi-foo (storefront)');
    expect(out).toContain('axi-bar -> /work/axi-bar');
  });

  it('omits unavailable projects', () => {
    const out = buildMetaPreamble({
      name: 'x',
      syntheticRoot: '/r',
      projects: [
        { linkName: 'a', path: '/a', status: 'ok' },
        { linkName: 'b', path: '/b', status: 'unavailable' },
      ],
    });
    expect(out).toContain('a -> /a');
    expect(out).not.toContain('b -> /b');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run tests/unit/metaSystemPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/metaSystemPrompt.ts`:

```ts
import type { MetaWorkspaceRuntimeProject } from '../types';

export interface MetaPreambleInput {
  name: string;
  syntheticRoot: string;
  projects: MetaWorkspaceRuntimeProject[];
}

export function buildMetaPreamble(meta: MetaPreambleInput | null): string {
  if (!meta) return '';
  const available = meta.projects.filter(p => p.status === 'ok');
  if (available.length === 0) return '';
  const lines: string[] = [];
  lines.push(`You are operating inside a SAI Meta Workspace "${meta.name}".`);
  lines.push(`Your working directory is ${meta.syntheticRoot}, which contains symlinks/junctions to multiple project roots.`);
  lines.push(`Each top-level entry below the working directory is a separate project. Treat each project's root as authoritative for its own files, git history, and configuration.`);
  lines.push(`Included projects:`);
  for (const p of available) {
    const suffix = p.description ? ` (${p.description})` : '';
    lines.push(`- ${p.linkName} -> ${p.path}${suffix}`);
  }
  lines.push(`When the user request is ambiguous about which project to change, ask before making cross-project edits.`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/metaSystemPrompt.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/metaSystemPrompt.ts tests/unit/metaSystemPrompt.test.ts
git commit -m "feat(meta-workspace): build AI system-prompt preamble"
```

---

## Task 5: IPC handlers + preload bridge

**Files:**
- Modify: `electron/main.ts` (add handlers near existing `workspace:*` block ~line 320)
- Modify: `electron/preload.ts` (add bridge methods alongside `workspaceGetAll` at line 134)

- [ ] **Step 1: Add IPC handlers**

In `electron/main.ts`, near the existing workspace handlers (around line 340), add:

```ts
import {
  listMetaWorkspaces, createMetaWorkspace, updateMetaWorkspace,
  deleteMetaWorkspace, getMetaWorkspace,
} from './services/metaWorkspace';
import {
  syntheticRootFor, materialize, reconcile, deleteSyntheticRoot, resolveLinkName,
} from './services/metaSyntheticRoot';

ipcMain.handle('metaWorkspace:list', () => listMetaWorkspaces());

ipcMain.handle('metaWorkspace:create', (_e, input: {
  name: string;
  projects: { path: string; linkName?: string; description?: string }[];
}) => {
  const taken = new Set<string>();
  const projects = input.projects.map(p => {
    const base = p.linkName || require('path').basename(p.path);
    const name = resolveLinkName(base, taken);
    taken.add(name);
    return { path: p.path, linkName: name, description: p.description };
  });
  const meta = createMetaWorkspace({ name: input.name, projects });
  const root = syntheticRootFor(meta.id);
  const runtime = materialize(meta, root);
  return { meta, syntheticRoot: root, projects: runtime };
});

ipcMain.handle('metaWorkspace:update', (_e, id: string, patch: any) => {
  const updated = updateMetaWorkspace(id, patch);
  if (!updated) return null;
  const root = syntheticRootFor(updated.id);
  const runtime = reconcile(updated, root);
  return { meta: updated, syntheticRoot: root, projects: runtime };
});

ipcMain.handle('metaWorkspace:activate', (_e, id: string) => {
  const meta = getMetaWorkspace(id);
  if (!meta) return null;
  const root = syntheticRootFor(meta.id);
  const runtime = reconcile(meta, root);
  updateMetaWorkspace(meta.id, { lastActivity: Date.now() });
  return { meta, syntheticRoot: root, projects: runtime };
});

ipcMain.handle('metaWorkspace:delete', (_e, id: string) => {
  const meta = getMetaWorkspace(id);
  if (meta) {
    const root = syntheticRootFor(meta.id);
    try { deleteSyntheticRoot(root); } catch (err) { console.warn('[sai] meta delete failed:', err); }
  }
  deleteMetaWorkspace(id);
  return true;
});
```

- [ ] **Step 2: Add preload bridge**

In `electron/preload.ts`, after the existing `workspace*` block (around line 137), add:

```ts
metaWorkspaceList: () => ipcRenderer.invoke('metaWorkspace:list'),
metaWorkspaceCreate: (input: any) => ipcRenderer.invoke('metaWorkspace:create', input),
metaWorkspaceUpdate: (id: string, patch: any) => ipcRenderer.invoke('metaWorkspace:update', id, patch),
metaWorkspaceActivate: (id: string) => ipcRenderer.invoke('metaWorkspace:activate', id),
metaWorkspaceDelete: (id: string) => ipcRenderer.invoke('metaWorkspace:delete', id),
```

Also add corresponding signatures to the `SaiAPI` type declaration in the same file (search for `workspaceGetAll: () => Promise` and follow the same pattern).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(meta-workspace): expose CRUD + activate via IPC and preload"
```

---

## Task 6: Confirm settings sync includes meta workspaces

**Files:**
- Read: `electron/services/github-sync.ts`

- [ ] **Step 1: Inspect the sync exclude list**

Open `electron/services/github-sync.ts` and locate the constant listing excluded settings keys (e.g., `github_auth`, `lastSeenVersion`, `defaultProjectDir`). Confirm `metaWorkspaces` is **not** in that list.

- [ ] **Step 2: If excluded by category, add a unit-style assertion (no test framework — just inline check)**

If the exclusion is regex-based or pattern-based (e.g., excludes everything except a whitelist), explicitly add `metaWorkspaces` to the whitelist. If exclusion is a denylist (default behavior includes everything), no change needed.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add electron/services/github-sync.ts
git commit -m "feat(meta-workspace): ensure registry syncs via sai-config"
```

If no change required, skip the commit.

---

## Task 7: Renderer registry + activation plumbing

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add registry state**

In `src/App.tsx` near the `workspaceContexts` state (around line 163), add:

```ts
const [metaWorkspaces, setMetaWorkspaces] = useState<MetaWorkspace[]>([]);
const [activeMetaRuntime, setActiveMetaRuntime] = useState<MetaWorkspaceRuntime | null>(null);

useEffect(() => {
  window.sai.metaWorkspaceList().then(setMetaWorkspaces).catch(() => setMetaWorkspaces([]));
}, []);
```

Import the types at the top of `App.tsx`.

- [ ] **Step 2: Add activation handler**

Add an `activateMetaWorkspace(id: string)` function in `App.tsx`:

```ts
async function activateMetaWorkspace(id: string) {
  const runtime = await window.sai.metaWorkspaceActivate(id);
  if (!runtime) return;
  setActiveMetaRuntime(runtime);
  // Treat syntheticRoot as the active projectPath for the existing WorkspaceContext machinery.
  setActiveProjectPath(runtime.syntheticRoot);
  window.sai.workspaceSetActive(runtime.syntheticRoot);
}
```

When `activeProjectPath` is set via the regular project flow (single-project workspace), clear `activeMetaRuntime`:

```ts
function activateRegularProject(projectPath: string) {
  setActiveMetaRuntime(null);
  setActiveProjectPath(projectPath);
  window.sai.workspaceSetActive(projectPath);
}
```

Pass `activeMetaRuntime` down to `ChatPanel`, `GitSidebar`, `FileExplorerSidebar`, `SearchPanel`, and `TitleBar` as a prop.

- [ ] **Step 3: Verify TS compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(meta-workspace): renderer registry + activation"
```

---

## Task 8: Workspace picker Projects/Meta tabs

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Add tab state**

Inside the dropdown render in `TitleBar.tsx` (around line 36-80), introduce a tab state:

```tsx
const [pickerTab, setPickerTab] = useState<'projects' | 'meta'>('projects');
```

Render a two-button tab strip at the top of the dropdown:

```tsx
<div className="picker-tabs">
  <button className={pickerTab === 'projects' ? 'active' : ''} onClick={() => setPickerTab('projects')}>Projects</button>
  <button className={pickerTab === 'meta' ? 'active' : ''} onClick={() => setPickerTab('meta')}>Meta</button>
</div>
```

- [ ] **Step 2: Render the Meta tab content**

When `pickerTab === 'meta'`, render the list of `metaWorkspaces` (passed in as a prop) with an Active/Recent split similar to Projects. Each row shows: name, icon-stack glyph, "N projects" subtitle. Clicking a row calls `props.onActivateMeta(meta.id)`.

Add a "+ New Meta Workspace" button at the bottom that opens `CreateMetaWorkspaceModal` (Task 9).

- [ ] **Step 3: Active label**

When `activeMetaRuntime` is non-null, render `Meta: ${activeMetaRuntime.meta.name}` in the TitleBar (replace the regular project-name label).

- [ ] **Step 4: Manual smoke check**

Run: `npm run electron:dev`
Open the picker; confirm both tabs render. Meta tab will be empty for now.

- [ ] **Step 5: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat(meta-workspace): Projects/Meta tabs in workspace picker"
```

---

## Task 9: Create Meta Workspace modal

**Files:**
- Create: `src/components/MetaWorkspace/CreateMetaWorkspaceModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `src/components/MetaWorkspace/CreateMetaWorkspaceModal.tsx`:

```tsx
import { useState } from 'react';
import type { MetaWorkspaceRuntime } from '../../types';

interface DraftProject {
  path: string;
  linkName: string;
  description?: string;
}

interface Props {
  recentProjects: string[];
  onClose: () => void;
  onCreated: (runtime: MetaWorkspaceRuntime) => void;
}

export function CreateMetaWorkspaceModal({ recentProjects, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [projects, setProjects] = useState<DraftProject[]>([]);

  function basename(p: string) {
    return p.split(/[\\/]/).pop() || p;
  }

  function uniqueLinkName(base: string): string {
    const taken = new Set(projects.map(p => p.linkName));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async function pickFolder() {
    const folder = await window.sai.selectFolder();
    if (!folder) return;
    if (projects.some(p => p.path === folder)) return;
    setProjects([...projects, { path: folder, linkName: uniqueLinkName(basename(folder)) }]);
  }

  function addRecent(p: string) {
    if (projects.some(x => x.path === p)) return;
    setProjects([...projects, { path: p, linkName: uniqueLinkName(basename(p)) }]);
  }

  function updateProject(idx: number, patch: Partial<DraftProject>) {
    setProjects(projects.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function removeProject(idx: number) {
    setProjects(projects.filter((_, i) => i !== idx));
  }

  async function create() {
    if (!name.trim() || projects.length === 0) return;
    const runtime = await window.sai.metaWorkspaceCreate({ name: name.trim(), projects });
    if (runtime) onCreated(runtime);
  }

  return (
    <div className="modal">
      <h2>New Meta Workspace</h2>
      <label>
        Name
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. axi-marketing" />
      </label>

      <div className="picker-row">
        <button onClick={pickFolder}>Pick folder</button>
        <details>
          <summary>Add from recent</summary>
          {recentProjects.map(p => (
            <button key={p} onClick={() => addRecent(p)}>{p}</button>
          ))}
        </details>
      </div>

      <ul className="draft-list">
        {projects.map((p, i) => (
          <li key={p.path}>
            <input value={p.linkName} onChange={e => updateProject(i, { linkName: e.target.value })} />
            <span className="path">{p.path}</span>
            <input placeholder="description (optional)" value={p.description ?? ''}
                   onChange={e => updateProject(i, { description: e.target.value })} />
            <button onClick={() => removeProject(i)}>Remove</button>
          </li>
        ))}
      </ul>

      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button disabled={!name.trim() || projects.length === 0} onClick={create}>Create</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it from TitleBar**

In `TitleBar.tsx`, render `<CreateMetaWorkspaceModal>` when the "+ New Meta Workspace" button is clicked. On `onCreated(runtime)`, call the parent's `activateMetaWorkspace` callback and close the modal.

- [ ] **Step 3: Manual smoke check**

Run: `npm run electron:dev`
Create a meta workspace with 2 sibling folders. Verify `~/.sai/meta/<id>/` is created and contains links.

- [ ] **Step 4: Commit**

```bash
git add src/components/MetaWorkspace/CreateMetaWorkspaceModal.tsx src/components/TitleBar.tsx
git commit -m "feat(meta-workspace): creation modal"
```

---

## Task 10: Chat system-prompt augmentation

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`

- [ ] **Step 1: Pass preamble into provider start**

Locate the call site where `window.sai.claudeStart` (or `codex`/`gemini` equivalents) is invoked with the project CWD. Build the preamble:

```tsx
import { buildMetaPreamble } from '../../lib/metaSystemPrompt';
// ...
const metaPreamble = buildMetaPreamble(activeMetaRuntime ? {
  name: activeMetaRuntime.meta.name,
  syntheticRoot: activeMetaRuntime.syntheticRoot,
  projects: activeMetaRuntime.projects,
} : null);
```

Append `metaPreamble` to the system prompt / `additionalSystem` field passed to the provider. (Refer to the existing provider start signature — extend it if needed.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat(meta-workspace): inject preamble into AI system prompt"
```

---

## Task 11: Included-projects chip strip + `@`-mentions

**Files:**
- Create: `src/components/MetaWorkspace/IncludedProjectsStrip.tsx`
- Modify: `src/components/Chat/ChatInput.tsx`

- [ ] **Step 1: Strip component**

Create `src/components/MetaWorkspace/IncludedProjectsStrip.tsx`:

```tsx
import type { MetaWorkspaceRuntime } from '../../types';

interface Props {
  runtime: MetaWorkspaceRuntime;
  onMentionInsert: (linkName: string) => void;
}

export function IncludedProjectsStrip({ runtime, onMentionInsert }: Props) {
  return (
    <div className="included-projects-strip">
      {runtime.projects.map(p => (
        <button
          key={p.linkName}
          className={`chip ${p.status === 'unavailable' ? 'unavailable' : ''}`}
          title={p.status === 'unavailable' ? `Missing on this device: ${p.path}` : p.path}
          disabled={p.status === 'unavailable'}
          onClick={() => onMentionInsert(p.linkName)}
        >
          {p.linkName}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Render the strip in ChatPanel**

In `ChatPanel.tsx`, render `<IncludedProjectsStrip>` above the input when `activeMetaRuntime` is present. The `onMentionInsert` callback inserts `@<linkName> ` into the chat input.

- [ ] **Step 3: `@`-mention picker in ChatInput**

In `ChatInput.tsx`, detect when the user types `@` and the active workspace is a meta workspace; open a small dropdown listing `runtime.projects` (excluding unavailable). Selecting one inserts `@<linkName> ` into the textarea.

- [ ] **Step 4: Manual smoke check**

Run: `npm run electron:dev`
Open a meta workspace, verify the chip strip appears, click a chip → mention inserted, type `@` → dropdown opens.

- [ ] **Step 5: Commit**

```bash
git add src/components/MetaWorkspace/IncludedProjectsStrip.tsx src/components/Chat/ChatPanel.tsx src/components/Chat/ChatInput.tsx
git commit -m "feat(meta-workspace): included-projects strip and @-mention picker"
```

---

## Task 12: Multi-repo git sidebar

**Files:**
- Create: `src/components/Git/MetaGitSidebar.tsx`
- Modify: `src/components/Git/GitSidebar.tsx`

- [ ] **Step 1: MetaGitSidebar component**

Create `src/components/Git/MetaGitSidebar.tsx`:

```tsx
import { useState } from 'react';
import type { MetaWorkspaceRuntime } from '../../types';
import { GitSidebar } from './GitSidebar';

interface Props {
  runtime: MetaWorkspaceRuntime;
}

export function MetaGitSidebar({ runtime }: Props) {
  const repos = runtime.projects.filter(p => p.status === 'ok');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggle(name: string) {
    setCollapsed(c => ({ ...c, [name]: !c[name] }));
  }

  return (
    <div className="meta-git-sidebar">
      <div className="meta-git-header">
        <span>{repos.length} repos</span>
        <button onClick={() => setCollapsed(Object.fromEntries(repos.map(r => [r.linkName, true])))}>Collapse all</button>
        <button onClick={() => setCollapsed({})}>Expand all</button>
      </div>
      {repos.map(p => (
        <section key={p.linkName} className="meta-git-section">
          <header onClick={() => toggle(p.linkName)}>
            <span className={`caret ${collapsed[p.linkName] ? 'collapsed' : ''}`}>▾</span>
            <strong>{p.linkName}</strong>
            <span className="path">{p.path}</span>
          </header>
          {!collapsed[p.linkName] && <GitSidebar projectPath={p.path} embedded />}
        </section>
      ))}
    </div>
  );
}
```

The existing `GitSidebar` takes a `projectPath` prop already; add an optional `embedded?: boolean` prop that strips its own outer chrome (header bar / branch picker if duplicative).

- [ ] **Step 2: Route in GitSidebar parent**

Wherever `GitSidebar` is rendered (likely from `App.tsx` or a sidebar host), branch on `activeMetaRuntime`:

```tsx
{activeMetaRuntime
  ? <MetaGitSidebar runtime={activeMetaRuntime} />
  : <GitSidebar projectPath={activeProjectPath} />}
```

- [ ] **Step 3: Defensive guard**

In `GitSidebar.tsx`, if `projectPath` is a synthetic-root path (matches `/.sai/meta/`), render an empty state with "Open in single-project workspace for git" — covers any code path that might pass the synthetic root accidentally.

- [ ] **Step 4: Manual smoke check**

Run: `npm run electron:dev`
Open a meta workspace with 2 git repos. Confirm both sections render, expand/collapse work, per-repo staging works.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/MetaGitSidebar.tsx src/components/Git/GitSidebar.tsx
git commit -m "feat(meta-workspace): multi-repo collapsible git sidebar"
```

---

## Task 13: File explorer cross-project DnD block

**Files:**
- Modify: `src/components/FileExplorer/FileExplorerSidebar.tsx`

- [ ] **Step 1: Detect cross-project moves**

In the drag-drop handler in `FileExplorerSidebar.tsx`, when the workspace is a meta workspace (prop `metaRuntime` passed in), compute the "owning link" for source and target by walking from `syntheticRoot` and taking the first path segment. If they differ, block the drop:

```ts
function owningLink(absPath: string, syntheticRoot: string): string | null {
  if (!absPath.startsWith(syntheticRoot)) return null;
  const rel = absPath.slice(syntheticRoot.length).replace(/^[\\/]+/, '');
  return rel.split(/[\\/]/)[0] || null;
}

function isCrossProjectMove(src: string, dst: string, root: string): boolean {
  const a = owningLink(src, root);
  const b = owningLink(dst, root);
  return !!(a && b && a !== b);
}
```

If `isCrossProjectMove(...)` is true, abort with a toast: *"Cross-project moves are blocked in meta workspaces."*

- [ ] **Step 2: Manual smoke check**

Run: `npm run electron:dev`
Try to drag a file from one linked project to another in a meta workspace — confirm blocked. Confirm intra-project DnD still works.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileExplorer/FileExplorerSidebar.tsx
git commit -m "feat(meta-workspace): block cross-project drag-and-drop"
```

---

## Task 14: Search/replace multi-project confirmation

**Files:**
- Modify: `src/components/SearchPanel/SearchPanel.tsx`

- [ ] **Step 1: Group results by owning link before replace**

Before applying a replace, when the active workspace is a meta workspace, group the affected files by `owningLink(file, syntheticRoot)`. If more than one group is affected, show a modal listing the per-project file counts and require explicit confirmation.

```ts
function groupByProject(files: string[], root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    const k = owningLink(f, root) ?? '<unknown>';
    (out[k] ??= []).push(f);
  }
  return out;
}
```

Reuse `owningLink` from Task 13 (extract into `src/lib/syntheticRoot.ts` shared util — do this as part of this task, and update Task 13's import accordingly).

- [ ] **Step 2: Manual smoke check**

Run: `npm run electron:dev`
Open a meta workspace, search for a string present in multiple projects, hit Replace All — confirm the per-project breakdown modal appears with file counts.

- [ ] **Step 3: Commit**

```bash
git add src/lib/syntheticRoot.ts src/components/SearchPanel/SearchPanel.tsx src/components/FileExplorer/FileExplorerSidebar.tsx
git commit -m "feat(meta-workspace): multi-project replace confirmation"
```

---

## Task 15: Management modal (rename / add / remove / edit / delete)

**Files:**
- Create: `src/components/MetaWorkspace/ManageMetaWorkspaceModal.tsx`

- [ ] **Step 1: Implement**

Create `src/components/MetaWorkspace/ManageMetaWorkspaceModal.tsx`:

```tsx
import { useState } from 'react';
import type { MetaWorkspace, MetaWorkspaceRuntime } from '../../types';

interface Props {
  meta: MetaWorkspace;
  onClose: () => void;
  onUpdated: (runtime: MetaWorkspaceRuntime) => void;
  onDeleted: (id: string) => void;
}

export function ManageMetaWorkspaceModal({ meta, onClose, onUpdated, onDeleted }: Props) {
  const [name, setName] = useState(meta.name);
  const [projects, setProjects] = useState(meta.projects);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    const runtime = await window.sai.metaWorkspaceUpdate(meta.id, { name, projects });
    if (runtime) onUpdated(runtime);
  }

  async function pickAndAdd() {
    const folder = await window.sai.selectFolder();
    if (!folder || projects.some(p => p.path === folder)) return;
    const base = folder.split(/[\\/]/).pop()!;
    const taken = new Set(projects.map(p => p.linkName));
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}-${n++}`;
    setProjects([...projects, { path: folder, linkName: name }]);
  }

  async function confirmDelete() {
    await window.sai.metaWorkspaceDelete(meta.id);
    onDeleted(meta.id);
  }

  return (
    <div className="modal">
      <h2>Manage {meta.name}</h2>
      <label>Name <input value={name} onChange={e => setName(e.target.value)} /></label>
      <ul>
        {projects.map((p, i) => (
          <li key={p.path}>
            <input value={p.linkName} onChange={e => setProjects(projects.map((x, j) => j === i ? { ...x, linkName: e.target.value } : x))} />
            <span>{p.path}</span>
            <input placeholder="description" value={p.description ?? ''} onChange={e => setProjects(projects.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
            <button onClick={() => setProjects(projects.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ul>
      <button onClick={pickAndAdd}>Add project</button>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={save}>Save</button>
        {!confirmingDelete && <button className="danger" onClick={() => setConfirmingDelete(true)}>Delete meta workspace</button>}
        {confirmingDelete && (
          <>
            <span>Real project folders are not touched.</span>
            <button className="danger" onClick={confirmDelete}>Confirm delete</button>
            <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire from TitleBar Meta tab**

In the Meta tab of the workspace picker, add a "Manage" affordance on each meta workspace row that opens this modal. On `onUpdated`, update `metaWorkspaces` state and (if it's the active one) `activeMetaRuntime`. On `onDeleted`, remove from list; if it was active, fall back to no active workspace.

- [ ] **Step 3: Manual smoke check**

Run: `npm run electron:dev`
Rename, add a project, remove a project, delete a meta workspace. Verify the synthetic root reflects changes and the real project folders are untouched.

- [ ] **Step 4: Commit**

```bash
git add src/components/MetaWorkspace/ManageMetaWorkspaceModal.tsx src/components/TitleBar.tsx
git commit -m "feat(meta-workspace): management modal"
```

---

## Task 16: E2E smoke test

**Files:**
- Create: `tests/e2e/meta-workspace.spec.ts`

- [ ] **Step 1: Write e2e**

Create `tests/e2e/meta-workspace.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

test.describe('meta workspaces', () => {
  let tmp: string;

  test.beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-e2e-meta-'));
    fs.mkdirSync(path.join(tmp, 'alpha'));
    fs.mkdirSync(path.join(tmp, 'beta'));
    fs.writeFileSync(path.join(tmp, 'alpha', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'beta', 'package.json'), '{}');
  });

  test.afterEach(async () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('Projects and Meta tabs render in picker', async ({ page }) => {
    await page.goto('/');
    await page.locator('.project-selector').click();
    await expect(page.locator('.picker-tabs button', { hasText: 'Projects' })).toBeVisible();
    await expect(page.locator('.picker-tabs button', { hasText: 'Meta' })).toBeVisible();
  });

  test('creates a meta workspace and shows it as active', async ({ page }) => {
    // Setup: stub selectFolder via evaluate to return our tmp dirs in sequence.
    await page.exposeFunction('__test_select_folder', () => path.join(tmp, 'alpha'));
    // Real Playwright e2e would drive the dialog via window.sai mock or by feature-flagging dialog stub paths.
    // (Implementation detail left to the engineer; structurally: open picker → Meta tab → +New → fill name → add 2 folders → Create → verify TitleBar shows "Meta: <name>")
  });
});
```

Note: the second test is structural — the engineer fills in the dialog stubbing pattern that matches SAI's existing e2e harness (see `tests/e2e/workspace.spec.ts` for the pattern used to drive folder selection).

- [ ] **Step 2: Run e2e**

Run: `npx playwright test tests/e2e/meta-workspace.spec.ts`
Expected: first test passes; second test passes once dialog stub is wired.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/meta-workspace.spec.ts
git commit -m "test(meta-workspace): e2e picker + create smoke"
```

---

## Task 17: Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run && npx vitest run --project integration && npx playwright test`
Expected: all green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Manual end-to-end check**

Run: `npm run electron:dev`
- Create a meta workspace from 3 sibling folders (2 are git repos).
- Confirm `~/.sai/meta/<id>/` has 3 links.
- Chat: type `@`, pick a project, send a message — confirm the AI sees only the curated tree (`ls` output should list only the 3 link names).
- Git sidebar: confirm 2 collapsible sections, both functional.
- Search: replace a string present in 2 projects, confirm the multi-project confirmation modal appears.
- File explorer: try cross-project drag, confirm blocked.
- Suspend the meta workspace, resume it, confirm state restored.
- Delete the meta workspace, confirm `~/.sai/meta/<id>/` is gone and real folders are untouched.

- [ ] **Step 4: Final commit / summary**

If any cleanup commits are needed, make them now. Otherwise the feature is complete.

---

## Self-review notes

- Spec sections mapped: data model (T1), synthetic root lifecycle (T3), runtime behavior — chat (T10), terminal (inherits via T7's `projectPath = syntheticRoot`), editor (inherits), file explorer (T13), search (T14), git (T12), UI picker / creation / management (T8/T9/T15), cross-device sync (T6), error handling (T3 reconcile, T13/T14 guards), testing (T2/T3/T4/T16).
- All shared utilities (`owningLink`) are extracted into `src/lib/syntheticRoot.ts` in Task 14 and reused by Task 13's modification.
- IPC method names are consistent: `metaWorkspaceList/Create/Update/Activate/Delete` across preload and main.
- `MetaWorkspaceRuntime` shape is defined once in Task 1 and consumed identically in renderer and IPC return values.
