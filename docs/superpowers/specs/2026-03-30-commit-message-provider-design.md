# Commit Message AI Provider Setting

## Summary

Add a separate setting (`commitMessageProvider`) that controls which AI provider generates commit messages, independent of the main chat `aiProvider` setting.

## Motivation

Currently, commit message generation uses whichever AI provider is selected for chat. Users may want to use different providers for chat vs. commit messages — e.g., Claude Opus for chat but Gemini Flash for commit messages.

## Design

### New Setting

- **Key:** `commitMessageProvider`
- **Values:** `"claude"` | `"codex"` | `"gemini"`
- **Default:** `"claude"`
- **Storage:** `~/.config/sai/settings.json` (syncs via GitHub sync automatically)

### UI

A new dropdown in `SettingsModal`, placed near the existing AI Provider dropdown. Same three options: Claude, Codex, Gemini. Label: "Commit Message Provider".

### State Management

`App.tsx` loads `commitMessageProvider` from settings on startup using the same pattern as `aiProvider`. The value is passed down through `GitSidebar` to `CommitBox`.

### Data Flow

1. User selects commit message provider in Settings
2. `App.tsx` stores it in state and persists to settings
3. `CommitBox.tsx` receives `commitMessageProvider` as a prop
4. On "Generate" click, `CommitBox` calls `window.sai.claudeGenerateCommitMessage(projectPath, commitMessageProvider)`
5. Backend (`claude.ts`) already switches CLI tool and model based on the provider parameter — no backend changes needed

### Files Changed

1. **`electron/main.ts`** — Add `commitMessageProvider` to default settings
2. **`src/App.tsx`** — Load, manage, and pass down `commitMessageProvider` state
3. **`src/components/SettingsModal.tsx`** — Add "Commit Message Provider" dropdown
4. **`src/components/Git/GitSidebar.tsx`** — Pass `commitMessageProvider` prop through to `CommitBox`
5. **`src/components/Git/CommitBox.tsx`** — Use `commitMessageProvider` prop instead of `aiProvider` when generating commit messages

### No Changes Needed

- **`electron/preload.ts`** — Already passes provider parameter through
- **`electron/services/claude.ts`** — Already handles all three providers via the parameter
- **`electron/services/github-sync.ts`** — New setting syncs automatically
