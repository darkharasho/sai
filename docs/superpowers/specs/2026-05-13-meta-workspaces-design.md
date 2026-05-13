# Meta Workspaces — Design Spec

**Date:** 2026-05-13
**Status:** Approved design, pending implementation plan

## Problem

SAI's current workspace model is single-project: one `WorkspaceContext` per `projectPath: string`, and chat / terminal / editor / git all hang off that one root. When a user needs to make the same change across many sibling projects (e.g., adding a marketing site to each of 8 axi apps), they currently open each project as its own workspace and repeat conversation setup per project. There is no way to give the AI shared context across multiple projects in a single chat.

## Goal

Introduce a **Meta Workspace**: a named, persistent grouping of N existing project paths that behaves like a regular workspace but exposes all included projects to one chat, one terminal, one editor session, and one git panel — so cross-cutting changes can happen in one conversation.

## Non-goals (v1)

- Cross-project drag-and-drop in the file explorer.
- Aggregate single-action commands across all repos (e.g., one-click "commit and push everywhere"). Per-repo actions are supported; true atomic multi-repo operations are a separate feature.
- Promoting a meta workspace conversation back into a single-project workspace or vice versa.
- Combining meta workspaces with swarm mode (treated as a separate composition).

## Concept

A Meta Workspace owns a SAI-managed synthetic directory at `~/.sai/meta/<id>/` that contains one filesystem link per included project. The synthetic root is the meta workspace's `projectPath` for runtime purposes — chat CWD, terminal CWD, file explorer root, and search root all resolve there. The AI sees each included project as a top-level subdirectory of a clean curated root, with no noise from sibling folders the user did not include.

Links are created via Node's `fs.symlink(target, link, 'junction')`:

- On Windows, this creates a **directory junction**, which works for any user with no admin privilege or Developer Mode required.
- On macOS / Linux, this creates a regular symlink.
- All major tooling (git, node, vite, file watchers, terminals) follows both transparently.

Same code path, same UX, every supported OS.

## Data model

New persisted type, stored alongside existing workspace records and synced via the `sai-config` repo:

```ts
interface MetaWorkspace {
  id: string;                        // stable UUID
  name: string;                      // user-chosen display name
  projects: MetaWorkspaceProject[];  // included projects
  createdAt: number;
  lastActivity: number;
}

interface MetaWorkspaceProject {
  path: string;            // absolute path to the project (may differ across devices)
  linkName: string;        // basename used inside the synthetic root (collision-resolved)
  description?: string;    // optional one-line description fed to the AI system prompt
}
```

The synthetic root path is derived: `path.join(os.homedir(), '.sai', 'meta', id)`. It is **machine-local** — not stored in the record, not synced — because absolute project paths may not exist on every device. The link tree is materialized lazily on first activation per machine.

A project may belong to multiple meta workspaces; each meta workspace has its own synthetic root, so this is trivial.

At runtime, the existing `WorkspaceContext` is reused with `projectPath = syntheticRoot`. Sessions, open files, terminals, and status fields work unchanged. Meta-workspace-specific state (the included-projects list, per-project descriptions, the `@`-mention scope hints) is held alongside the context, keyed by `MetaWorkspace.id`.

## Synthetic-root lifecycle

SAI owns `~/.sai/meta/<id>/` and never edits its contents from outside the meta workspace controller.

- **Activation:** ensure the directory exists and contains exactly one link per `projects[]` entry, with the configured `linkName`. Idempotent.
- **Add project:** create one new link. Do not disturb existing links.
- **Remove project:** `fs.unlink` the link. Never recurse into the target.
- **Rename meta workspace:** display-name change only. `id` and `syntheticRoot` are stable; nothing on disk moves.
- **Delete meta workspace:** remove the entire `~/.sai/meta/<id>/` tree (links only).
- **Startup reconcile:** for each known meta workspace, prune dangling links, recreate missing ones, mark entries whose `path` does not exist on this machine as **unavailable** (kept in the record, omitted from the link tree, surfaced in the UI).

**Safety invariants:**

- SAI refuses to delete or overwrite anything under `~/.sai/meta/` that is not a link, to prevent data loss if real files ever end up there.
- Delete operations only call `fs.unlink` on link entries.
- Basename collisions on add/create are resolved by appending a numeric suffix (`foo`, `foo-2`). The user can rename inline at creation time.

## Runtime behavior

### Chat / AI

- Chat CWD = synthetic root.
- System prompt gains a meta-workspace preamble that lists each included project as: display name, link name, absolute path, and optional description. It tells the AI it is operating across multiple projects and that each top-level entry in the working directory is a separate project root.
- `@`-mention picker: typing `@` in the composer opens a picker of included projects. Mentions render as chips in the composer and are passed to the AI as explicit scope hints alongside the user's message. With no mention, the AI picks the relevant project(s) from request context.
- Sessions are meta-workspace-scoped and fully independent from any included project's sessions. A meta workspace's chat history never bleeds into individual project workspaces and vice versa.

### Terminal

- New terminal tabs spawn with CWD = synthetic root.
- `cd <linkName>` enters the real project (the shell resolves through the link). Git, npm, vite, and similar tools behave normally inside each linked project.

### Editor

- Files opened through the synthetic root display synthetic-root-relative paths in tabs (e.g., `axi-foo/src/App.tsx`). Read/write hits the real file via link resolution.

### File explorer

- Rooted at the synthetic root. Each linked project appears as a top-level folder with a "linked project" glyph distinguishing it from a regular subdirectory.
- Drag-and-drop within a single linked project works as today.
- Drag-and-drop **across** linked projects is blocked, to prevent silently moving files between unrelated repos.

### Project-wide search and replace

- Runs against the synthetic root, naturally spanning every included project. This directly serves the cross-cutting-change use case.
- Replace operations that touch more than one project show a per-project breakdown of affected files before applying, requiring explicit confirmation.

### Git

- The existing single-repo git sidebar is replaced (within meta workspaces) by a **stacked multi-repo panel**: one collapsible section per included project that is a git repository. Non-repo entries are omitted from the panel.
- Each section shows that project's status, staged/unstaged files, branch, and per-repo actions (stage, commit, push, pull, switch/create branch, discard, AI-generated commit message).
- Sections are individually collapsible; the panel header offers "collapse all / expand all."
- Git commands always execute inside the real linked project; SAI never runs git at the synthetic root itself.

## UI

### Workspace picker

Two tabs at the top: **Projects** and **Meta**. Each tab independently displays the existing Active / Suspended / Recent sections.

- A meta workspace card shows: name, icon-stack glyph hinting at multiple projects, project count (e.g., "8 projects"), and the same status / last-activity indicators regular workspaces show.
- A "+ New Meta Workspace" affordance lives in the Meta tab.

### Creation flow

1. **Name** — required free text.
2. **Add projects** — multi-add picker supporting two paths:
   - "Pick folder" — native folder picker, repeatable.
   - "Add from recent" — pulls from SAI's recent workspaces list.
3. **Preview** — shows the resulting link tree as `linkName → absolute path`. Inline rename to resolve basename collisions. Optional one-line description per project.
4. **Create** — materializes the synthetic root and opens the new meta workspace.

### Management

Accessed from a meta workspace's context menu (or a dedicated settings panel):

- Rename
- Add / remove projects (re-materializes only affected links)
- Edit per-project descriptions
- Delete (confirms; removes the synthetic root only; never touches real project folders)

### Runtime visual cues

- TitleBar shows `Meta: <name>` with the icon-stack glyph.
- A compact "included projects" strip near the chat header lists the included projects as chips. Clicking a chip inserts it as an `@`-mention in the composer. Unavailable projects (target missing on this machine) appear as dimmed chips with a tooltip.

## Cross-device sync

- `MetaWorkspace` records sync through the existing `sai-config` repo.
- `syntheticRoot` is derived from `id`, so it is consistent across machines without being part of the synced record.
- Opening a synced meta workspace on a fresh device materializes the link tree lazily. Entries whose `path` is missing are marked unavailable and shown as dimmed chips; the meta workspace still opens and works with the remaining valid projects.

## Error handling and edge cases

- **Target moved or deleted off-SAI:** the reconciler marks the entry unavailable and removes its link on next activation. A non-blocking toast offers "Remove from meta workspace or relink?".
- **Basename collision:** numeric suffix proposed; inline rename available at creation/add time.
- **Project in multiple meta workspaces:** supported; each meta workspace has its own synthetic root.
- **Suspension lifecycle:** meta workspaces use the same active / suspended / recent lifecycle as regular workspaces. Suspension tears down chat and terminal processes but leaves the link tree in place (cheap to keep).
- **Git at the synthetic root:** never attempted. The synthetic root is not a repo; git operations target individual linked projects only.

## Testing surface (new)

- Synthetic-root materialization, add/remove, reconciliation, deletion (unit tests against a tmpdir).
- Junction creation on Windows (via `fs.symlink(..., 'junction')`; runtime tests on Windows CI, with mocks for cross-OS unit coverage).
- Basename collision resolution.
- Missing-target reconciliation and "unavailable" rendering.
- `@`-mention parsing and system-prompt assembly with multiple included projects.
- Multi-repo git panel rendering with a mixed set of repo and non-repo entries.
- File explorer cross-project drag-and-drop block.
- Search-and-replace multi-project confirmation gate.
