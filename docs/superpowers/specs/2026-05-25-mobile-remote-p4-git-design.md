# Mobile Remote — Phase 4: Git write ops Design

Status: design spec. Implementation plan follows.

Parent roadmap: `2026-05-25-mobile-remote-roadmap.md`.
P0–P3 shipped and merged to main. P3 added the Git rail with read-only Changes + diffs.

## Scope

Phase 4 makes the Git rail interactive: stage, unstage, commit, push, pull. Per-repo for meta workspaces via the existing RepoPicker.

## Goals

1. From the phone's Git rail, the user can stage/unstage individual files with a checkbox tap.
2. With ≥1 file staged and a non-empty commit message, the user can commit. The status list refreshes within 1s of success.
3. Pull and Push buttons live in a small toolbar above the Changes list. Push is disabled when `ahead === 0`; both show a system message on success/error.
4. Commit message drafts survive PWA reload (per-cwd localStorage).
5. Errors from `simple-git` surface inline as system messages in the sidebar with the underlying message.

## Non-goals

- AI-generated commit messages
- Branch picker / checkout
- Discard per-file changes
- Merge conflict resolution
- Tags / cherry-pick / interactive rebase
- Multi-repo "land all" fan-out (per-repo only; user switches via RepoPicker)

## Architecture

```
phone PWA (Git rail)
   ⇄ WS
electron/services/remote/bridge-server.ts
   ├─ new inbound: git.stage / git.unstage / git.commit / git.push / git.pull
   └─ delegates to extracted impls from electron/services/git.ts

electron/services/git.ts (modify)
   ├─ extract: gitStageImpl, gitUnstageImpl, gitCommitImpl, gitPushImpl, gitPullImpl
   ├─ enrich gitStatusImpl: also return { branch, ahead, behind }
   └─ existing IPC handler bodies become one-liners (P1/P3 pattern)

src/renderer-remote/files/ (modify)
   ├─ Git.tsx          + branch toolbar, commit panel, stage toggle plumbing
   ├─ ChangesView.tsx  + per-row stage checkbox, stage state from a new `staged` Set
   └─ (no new files; everything lives in the existing Git rail)
```

## Wire protocol (P4 additions)

All client→server frames carry `reqId`. Errors flow through the existing `error` frame.

### Client → Server

```jsonc
{ "type": "git.stage",   "cwd": "/repo", "path": "src/App.tsx", "reqId": "..." }
{ "type": "git.unstage", "cwd": "/repo", "path": "src/App.tsx", "reqId": "..." }
{ "type": "git.commit",  "cwd": "/repo", "message": "feat: ...", "reqId": "..." }
{ "type": "git.push",    "cwd": "/repo", "reqId": "..." }
{ "type": "git.pull",    "cwd": "/repo", "reqId": "..." }
```

### Server → Client

```jsonc
{ "v": 1, "type": "git.stage.result",   "reqId": "..." }
{ "v": 1, "type": "git.unstage.result", "reqId": "..." }
{ "v": 1, "type": "git.commit.result",  "reqId": "...", "hash": "abc1234" }
{ "v": 1, "type": "git.push.result",    "reqId": "..." }
{ "v": 1, "type": "git.pull.result",    "reqId": "..." }
```

The existing `files.status.result` response gets two new optional fields when the cwd is a git repo:

```jsonc
{ "v": 1, "type": "files.status.result", "reqId": "...",
  "entries": [ /* ... */ ],
  "branch": "main",
  "ahead": 2,
  "behind": 0
}
```

`branch` is null when in detached HEAD; the toolbar handles it.

## Main-process integration

### `electron/services/git.ts`

Extract 5 new exports above `registerGitHandlers`:

```ts
export async function gitStageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).add(filepath);
}
export async function gitUnstageImpl(cwd: string, filepath: string): Promise<void> {
  await git(cwd).reset(['HEAD', '--', filepath]);
}
export async function gitCommitImpl(cwd: string, message: string): Promise<{ hash?: string }> {
  const r = await git(cwd).commit(message);
  return { hash: r.commit };
}
export async function gitPushImpl(cwd: string): Promise<void> {
  await git(cwd).push();
}
export async function gitPullImpl(cwd: string): Promise<void> {
  await git(cwd).pull();
}
```

Enrich `gitStatusImpl` to return `{ branch, ahead, behind, entries }`:

```ts
export async function gitStatusImpl(cwd: string): Promise<{
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
}> {
  const s = await git(cwd).status();
  const entries: GitStatusEntry[] = [/* same as P3 */];
  return { branch: s.current ?? null, ahead: s.ahead, behind: s.behind, entries };
}
```

The existing IPC handlers (`git:stage` etc.) become one-liners calling the impls. The shape the desktop already expects on `git:status` stays unchanged (it returns a different shape with named fields per status group; only the bridge's `statusFiles` callback uses the new shape).

### `electron/services/remote/bridge-server.ts`

Widen `statusFiles` return type to include the branch+ahead/behind, and propagate to the WS frame:

```ts
statusFiles?: (cwd: string) => Promise<{
  entries: FileStatusEntry[];
  branch?: string | null;
  ahead?: number;
  behind?: number;
}>;
```

In the `files.status` handler, spread these fields into the result frame.

Add 5 new opts:

```ts
stageFile?:   (cwd: string, path: string) => Promise<void>;
unstageFile?: (cwd: string, path: string) => Promise<void>;
commit?:      (cwd: string, message: string) => Promise<{ hash?: string }>;
push?:        (cwd: string) => Promise<void>;
pull?:        (cwd: string) => Promise<void>;
```

5 new WS branches in `handleWs`, each ~10 lines. Pattern matches P3's `files.*` branches: validation → callback → result frame; on throw, send `error` with reqId + message.

### `electron/main.ts`

Wire each opt to its impl:

```ts
stageFile:   (cwd, path) => gitStageImpl(cwd, path),
unstageFile: (cwd, path) => gitUnstageImpl(cwd, path),
commit:      (cwd, msg) => gitCommitImpl(cwd, msg),
push:        (cwd) => gitPushImpl(cwd),
pull:        (cwd) => gitPullImpl(cwd),
```

Update the existing `statusFiles` wiring to pass the whole `gitStatusImpl` result (which now includes branch/ahead/behind), not just entries.

## PWA changes

### `wire.ts`

Add 5 typed helpers + 5 reply branches:

```ts
stageFile(cwd, path): Promise<void>;
unstageFile(cwd, path): Promise<void>;
commit(cwd, message): Promise<{ hash?: string }>;
push(cwd): Promise<void>;
pull(cwd): Promise<void>;
```

Reply dispatcher: for `git.{stage,unstage,push,pull}.result` resolve with `undefined`; for `git.commit.result` resolve with `{ hash: msg.hash }`.

### `src/renderer-remote/files/Git.tsx`

Restructured layout:

```
┌──────────────────────────────────────┐
│ Changes header (existing)            │
│ RepoPicker (if meta, existing)       │
├──────────────────────────────────────┤
│ BranchToolbar    main · 2↑ 0↓        │  NEW
│                       [⤓ Pull][⤒ Push] │
├──────────────────────────────────────┤
│ ChangesView with stage checkboxes    │  modified
├──────────────────────────────────────┤
│ DiffViewer (existing, for selected)  │
├──────────────────────────────────────┤
│ CommitPanel                          │  NEW
│ ▼ Commit (1 staged)                  │
│ ┌────────────────────────────────┐   │
│ │ Message...                     │   │
│ └────────────────────────────────┘   │
│           [Commit]                   │
└──────────────────────────────────────┘
```

State Git.tsx owns:
- `branch: string | null`, `ahead: number`, `behind: number` (from the status response)
- `stagedSet: Set<string>` — staged paths, derived from `entries.filter(e => e.staged)`
- `message: string` (driven by localStorage draft per cwd)
- `busy: { stage?: string; commit?: boolean; push?: boolean; pull?: boolean }` — disables buttons during async ops
- `notes: string[]` — system messages shown inline (success/error toasts)

`ChangesView` gains a `staged: Set<string>` prop and an `onToggleStage(path: string)` callback. Each row renders a checkbox in front of the M/A/D letter. Checkbox tap calls `onToggleStage(path)`; row body click still opens the diff (existing behavior).

`Git.tsx` handles `onToggleStage`:

```ts
const onToggleStage = async (path: string) => {
  const entry = entries.find((e) => e.path === path);
  if (!entry) return;
  setBusy((b) => ({ ...b, stage: path }));
  try {
    if (entry.staged) await client.unstageFile(cwd, path);
    else await client.stageFile(cwd, path);
    await refreshStatus();
  } catch (err) {
    addNote(`stage failed: ${(err as Error).message}`);
  } finally {
    setBusy((b) => ({ ...b, stage: undefined }));
  }
};
```

`BranchToolbar`:
- Mono branch name (`var(--accent)`) + ahead/behind chips
- `Pull` button: enabled when `branch != null`; disables during pull
- `Push` button: enabled when `ahead > 0`; disables during push; shows the `ahead` count
- Both call the respective wire helpers, refresh status on success, surface errors via `addNote`

`CommitPanel`:
- `staged.size` count in the header
- Collapsed by default when `staged.size === 0`, expanded otherwise
- Textarea with 16px font (iOS zoom prevention)
- Commit button: disabled when `message.trim() === '' || staged.size === 0 || busy.commit`
- On commit: optimistically clears the textarea, refreshes status, surfaces the short hash via system note (`committed abc1234`)

### Persistence

```ts
// localStorage shape
type CommitDrafts = Record<string /* cwd */, string /* message */>;
```

Read on mount of Git.tsx (or when cwd changes); write on every textarea change (debounced 250ms is fine but optional); delete after a successful commit.

## Failure modes

| Condition | Behavior |
|---|---|
| Push fails (no upstream, network) | Inline system note with the simple-git error |
| Pull fails (merge conflict, dirty tree) | Inline system note; phone doesn't attempt to resolve |
| Commit fails (no staged changes, hook rejection) | Inline system note; textarea preserves its content |
| Stage fails (file deleted between status fetch and stage) | Inline note; status auto-refreshes |
| Network drop mid-op | Existing wire timeout (5s) triggers an error reply; phone displays it |
| User taps Commit twice quickly | `busy.commit` flag prevents the second send |

## Testing

### Unit (`tests/unit/remote/`)

- New `bridge-server-git.test.ts`: each of the 5 message types — stage, unstage, commit (with reqId returning hash), push, pull — exercised with stubbed callbacks; verifies reqId correlation + error reply on callback throw
- Extend `bridge-server-files.test.ts`: `files.status.result` includes `branch/ahead/behind` when the callback returns them

### Integration (`tests/integration/remote/git-end-to-end.test.ts`)

Real temp dir with `git init` + a bare remote:

1. Create tmp dir, write `a.txt`, init, commit
2. Add a bare remote (`git init --bare tmp/remote.git`); `git remote add origin file://...`
3. Modify `a.txt`
4. Pair → auth
5. `git.stage` → `files.status` confirms `staged: true`
6. `git.commit` with message → returns `hash`; `files.status` shows clean
7. `git.push` → succeeds; `ahead` returns to 0
8. Modify + `git.unstage` (after re-staging) → confirms removal from stage

### Manual smoke

`docs/superpowers/notes/2026-05-25-mobile-remote-p4-smoke.md`:

- Open Git rail in a workspace with uncommitted changes
- Stage a file via checkbox; toolbar shows the staged count
- Type a commit message; tap Commit; status list refreshes and shows the file gone
- Tap Push; pushes to the desktop's tracked remote; ahead counter resets
- Tap Pull; pulls fresh commits; behind counter resets
- Switch repos in a meta workspace via RepoPicker; staged set + draft are per-repo
- Reload PWA; commit draft for current repo persists; switch repos and back to verify

## Exit criteria

1. All vitest unit + integration tests pass (P0–P3 stay green; P4 new tests pass).
2. `tsc --noEmit` is clean.
3. PWA bundle builds.
4. Manual smoke walked on iPhone over Tailscale against a real SAI workspace.
5. Stage/commit/push/pull round-trip works in both plain and meta workspaces.

## Open questions resolved during implementation

- `git.commit` return shape — does `simple-git`'s `commit()` return the hash directly? Verify and adjust the impl (the `r.commit` field is the convention).
- Whether `git.push` should default to upstream or require the caller to pass a branch — for v1 we default to the simple-git no-arg `.push()` which uses upstream; if there's no upstream the error message surfaces in the note.
- Toast/notes positioning — bottom of the sidebar, auto-dismiss after 5s? Stick to the system-message-row style used in P1 chat.

These resolve during implementation, not before.

## Phase 5+ preview

Phase 5 (terminal) is independent. Phase 6 (Monaco editing) builds on P3's BrowseView and the file read pathway. Branch picker, AI commit messages, and discard could be a "Phase 4.5" polish round if the appetite is there after P4.
