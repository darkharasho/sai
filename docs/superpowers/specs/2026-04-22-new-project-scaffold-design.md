# New Project Scaffold — Design Spec

**Date:** 2026-04-22

## Overview

Replace the single "Open New Project..." button at the bottom of the project dropdown with two text links separated by a vertical divider: **Open Project** (existing behavior) and **New Project** (new scaffold workflow). New Project opens a modal where the user defines a directory, provides optional AI context, and selects setup helpers to scaffold the project before it opens in SAI.

---

## 1. Split Bottom Row (TitleBar.tsx)

**Current:** Single `<button className="dropdown-item open-new">+ Open New Project...</button>` at the bottom of the project dropdown.

**Change:** Replace with a flex row containing two text links and a 1px vertical separator.

- **Left — Open Project**
  - Icon: `FolderOpen` (lucide-react, size 13)
  - Behavior: identical to current — calls `window.sai.selectFolder()`
- **Separator:** 1px vertical line, 16px tall, color `--text-muted` (`#2a3040`)
- **Right — New Project**
  - Icon: `FolderPlus` (lucide-react, size 13)
  - Behavior: opens the New Project modal
- Both links: color `--accent` (`#c7910c`), hover color `--accent-hover` (`#f5b832`) with `--bg-elevated` (`#1c2027`) background, centered text, `border-radius: 4px`

---

## 2. New Project Modal

A focused dialog rendered at the app level (not inside the dropdown). Two sections: project identity, then setup helpers.

### Fields

**Directory** (required)
- Text input showing selected path (monospace, `--bg-secondary` background)
- "Browse" button triggers native folder picker via `window.sai.selectFolder()` — reuses existing IPC handler
- Defaults to empty; Create button is disabled until a path is set

**Context** (optional)
- Textarea, placeholder: `"What is this project for? e.g. 'A CLI tool for processing CSV files.'"`
- Used verbatim in CLAUDE.md and as the description line in README.md
- No minimum length required

### Setup Helpers

Six checkboxes. Each is independently toggleable.

| Helper | Default | Notes |
|---|---|---|
| CLAUDE.md | **on** | Writes context to `## Project Context` section |
| Git init | **on** | Runs `git init` in the directory |
| .gitignore | **on** | Common ignores: `node_modules`, `.env`, `.DS_Store`, `dist`, `build`, `*.log` |
| README.md | **on** | `# <folder-name>\n\n<context>` — falls back to folder name only if no context |
| .claude/settings.json | off | Empty `{}` — creates the file so project-level config is ready |
| Create GitHub repo | off | See GitHub section below |

### GitHub Repo Helper

When the user is **authenticated** (token present in `github_auth.token`):
- Checkbox is enabled
- Inline badge shows green dot + `@<username>` next to the label
- Checking it expands a sub-panel:
  - **Name** — text input, pre-filled with the directory's folder name
  - **Visibility** — toggle: Private (default) / Public

When the user is **not authenticated**:
- Checkbox is disabled
- Badge reads "Connect GitHub" (link style, `--accent` gold)
- Clicking it triggers the existing device flow (`github:startAuth` IPC)
- On successful auth, the badge switches to the connected state and the checkbox enables

**API call:** `POST /api/v3/repos` (or `https://api.github.com/user/repos`) via the existing `post()` helper in `electron/services/github-auth.ts`, then runs `git remote add origin <clone_url>`.

---

## 3. Create Flow (on submit)

Executed sequentially in the main process. Each step is skipped if its helper is unchecked.

1. Create directory if it doesn't exist (`fs.mkdirSync`)
2. Write `CLAUDE.md`
3. Run `git init`
4. Write `.gitignore`
5. Write `README.md`
6. Write `.claude/settings.json`
7. Create GitHub repo + `git remote add origin <url>`
8. Open the folder as a new workspace (`workspace.getOrCreate(path)`) and switch to it

Step 1 (directory creation) is blocking — if it fails the entire flow aborts with an error message in the modal. Errors in steps 2–7 are non-blocking: they surface as inline warnings but remaining steps still run. The modal closes and the workspace opens after step 8 completes.

---

## 4. Files Affected

| File | Change |
|---|---|
| `src/components/TitleBar.tsx` | Replace single button with split link row |
| `src/components/NewProjectModal.tsx` | New component |
| `src/App.tsx` | Mount modal, wire open/close state |
| `electron/handlers/new-project.ts` | New IPC handler: `project:scaffold` |
| `electron/main.ts` | Register `project:scaffold` handler |
| `electron/preload.ts` | Expose `window.sai.scaffoldProject(options)` |

---

## 5. Data Shape

```ts
interface ScaffoldOptions {
  path: string;
  context: string;          // empty string if not provided
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
```

---

## 6. Out of Scope

- Template selection (language-specific boilerplate)
- Org repo creation (personal repos only via `/user/repos`)
- Auto-first commit after scaffold
