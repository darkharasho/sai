# Multi-Project Workspaces

Simultaneously run multiple project contexts with independent Claude sessions, terminals, git state, and open files. Switch between them via a dropdown without interrupting work in any project.

## Architecture: Workspace Map in Main Process

Refactor backend services to maintain a `Map<string, Workspace>` keyed by project path. Each workspace holds its own Claude subprocess, terminal PTYs, and session state. IPC calls route to the correct workspace via a `projectPath` parameter. The frontend swaps which workspace context is visible without tearing down state.

## Backend

### Workspace Manager (`electron/services/workspace.ts`)

New module that owns the workspace map and coordinates lifecycle.

```typescript
interface Workspace {
  projectPath: string
  claude: {
    process: ChildProcess | null
    probe: ChildProcess | null
    sessionId: string | undefined
    buffer: string
    cwd: string
  }
  terminals: Map<number, IPty>
  lastActivity: number
  status: 'active' | 'suspended'
}

const workspaces = new Map<string, Workspace>()
```

The workspace manager provides:
- `getOrCreate(projectPath)` - Returns existing workspace or creates a new one with `status: 'active'`
- `get(projectPath)` - Returns workspace or null
- `suspend(projectPath)` - Kills Claude process and terminals, sets `status: 'suspended'`, keeps entry in map
- `remove(projectPath)` - Fully removes workspace (kills everything, deletes from map)
- `getAll()` - Returns all workspaces for the frontend to display
- `touchActivity(projectPath)` - Updates `lastActivity` to `Date.now()`

### Suspend Timer

A `setInterval` running every 5 minutes checks each workspace's `lastActivity`. If more than 1 hour has elapsed since last activity, calls `suspend(projectPath)` and notifies the frontend via `workspace:suspended` IPC event.

### Claude Service Changes (`electron/services/claude.ts`)

Currently uses module-level globals: `activeProcess`, `activeProbe`, `sessionId`, `currentCwd`. These move into the `Workspace.claude` object.

IPC handler changes:
- `claude:start(cwd)` - Stays the same signature. Uses `cwd` to look up or create workspace. Kills any existing probe/process for that workspace only.
- `claude:send(projectPath, message, imagePaths?, permMode?)` - New `projectPath` parameter. Routes to the correct workspace's Claude process. Updates `lastActivity`.
- `claude:stop(projectPath)` - New `projectPath` parameter. Kills only that workspace's active process.
- `claude:message` events - Include `projectPath` in the payload so the frontend can route messages to the correct workspace.
- `claude:generateCommitMessage(cwd)` - Stays the same (already takes `cwd`, stateless one-off process).

### Terminal Service Changes (`electron/services/pty.ts`)

Currently uses a global `terminals` map and incrementing `nextId`. Terminal IDs remain globally unique, but each workspace tracks which IDs belong to it.

IPC handler changes:
- `terminal:create(cwd)` - Stays the same. The workspace manager registers the returned terminal ID with the workspace matching `cwd`.
- `terminal:write(id, data)` - Stays the same (globally unique IDs). Updates `lastActivity` for the owning workspace.
- `terminal:resize(id, cols, rows)` - Stays the same.
- `terminal:data` events - Stay the same (terminal ID is sufficient for routing).

On suspend: all terminal PTYs for the workspace are killed. On resume: frontend recreates terminals via `terminal:create`.

### New IPC Handlers (registered in `electron/main.ts`)

- `workspace:getAll()` - Returns `Array<{ projectPath, status, lastActivity }>` combining active/suspended workspaces with recent projects list.
- `workspace:suspended` (event, not handler) - Sent from backend to frontend when a workspace is auto-suspended.
- `workspace:close(projectPath)` - Fully removes a workspace (kills processes, removes from map).

## Frontend

### Workspace Context Type (`src/types.ts`)

```typescript
interface WorkspaceContext {
  projectPath: string
  sessions: ChatSession[]
  activeSession: ChatSession
  openFiles: OpenFile[]
  activeFilePath: string | null
  terminalIds: number[]
  status: 'active' | 'suspended' | 'recent'
  lastActivity: number
}
```

### State Management (`src/App.tsx`)

Replace flat per-project state with a workspace map:

**Current state (to be replaced):**
- `projectPath` - single string
- `sessions` / `activeSession` - single project's chat history
- `openFiles` / `activeFilePath` - single project's editor state

**New state:**
- `workspaces: Map<string, WorkspaceContext>` - all open workspace contexts
- `activeProjectPath: string` - which workspace is currently visible

When switching projects:
1. The current workspace context stays in the map untouched
2. `activeProjectPath` updates to the target project
3. React re-renders with the target workspace's state feeding all panels
4. Chat and CodePanel components receive new props without re-mounting. Terminal panels re-mount to rebind their xterm instances to the new workspace's PTY IDs.

### Per-Project Session Storage (`src/sessions.ts`)

Change localStorage key from `sai-chat-sessions` (global) to `sai-chat-sessions-{projectPath}` (per-project). The `projectPath` is used directly (no hashing needed since localStorage keys can be any string).

Functions change signatures:
- `loadSessions(projectPath)` - Reads from project-scoped key
- `saveSessions(projectPath, sessions)` - Writes to project-scoped key

Migration: On first load, if sessions exist under the old `sai-chat-sessions` key, move them to the current project's scoped key and delete the old key.

### Workspace List Persistence

The list of open workspaces (paths + status) is persisted to `localStorage('sai-workspaces')`. On app restart, all workspaces start as `status: 'recent'` since all backend processes are gone. The first project loaded (most recent) auto-starts as `'active'`.

## UI: Project Switcher Dropdown

Extends the existing recent projects dropdown in the title bar. The current folder-name display and dropdown become the workspace switcher.

### Layout

Projects grouped into three sections:

**Active** - Green dot (6px circle, `#4ade80`). Claude process running. Clicking switches instantly.

**Suspended** - Yellow dot (6px circle, `#d4a72c`). Auto-suspended after 1 hour. Clicking switches to the project; frontend calls `claude:start` to resume and recreates terminals.

**Recent** - No dot. Not opened this session. Clicking opens the project as a new workspace: creates workspace context, calls `claude:start`, creates initial terminal.

The current project is highlighted with the same blue left-border + subtle background as the chat history active item.

Each row shows: `[status dot] directory-name    ~/full/path` (directory name in normal weight, full path dimmed to the right).

"Open folder..." remains at the bottom, separated by a divider. Opens file picker, creates new workspace on selection.

### Preload API Additions (`electron/preload.ts`)

```typescript
workspaceGetAll(): Promise<Array<{ projectPath: string, status: string, lastActivity: number }>>
workspaceClose(projectPath: string): Promise<void>
onWorkspaceSuspended(callback: (projectPath: string) => void): void
```

## IPC Contract Summary

| Channel | Direction | Params | Change |
|---------|-----------|--------|--------|
| `claude:start` | renderer→main | `cwd` | No change |
| `claude:send` | renderer→main | `projectPath, msg, images?, mode?` | Added `projectPath` |
| `claude:stop` | renderer→main | `projectPath` | Added `projectPath` |
| `claude:message` | main→renderer | `{ ...msg, projectPath }` | Added `projectPath` to payload |
| `terminal:create` | renderer→main | `cwd` | No change |
| `terminal:write` | renderer→main | `id, data` | No change (updates activity internally) |
| `workspace:getAll` | renderer→main | none | New |
| `workspace:close` | renderer→main | `projectPath` | New |
| `workspace:suspended` | main→renderer | `projectPath` | New event |

## Migration

- Existing `sai-chat-sessions` localStorage data moves to `sai-chat-sessions-{currentProjectPath}` on first load
- `sai-permission-mode` stays global (not per-project)
- `recent-projects.json` (main process) continues to be the source for the "Recent" section
