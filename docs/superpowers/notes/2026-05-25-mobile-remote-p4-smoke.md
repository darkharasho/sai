# Mobile Remote Phase 4 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring P4 done.

## Prerequisites

- [ ] P0–P3 smoke pass.
- [ ] A workspace open in SAI with uncommitted changes and a tracked remote.

## Stage / Unstage

- [ ] Open the Git rail. Each modified file has an empty checkbox in front of its M/A/D letter.
- [ ] Tap a checkbox. It fills with accent color + ✓. The "Commit (N staged)" counter increments.
- [ ] Tap the body of the same row. Diff renders below (P3 behavior, unchanged).
- [ ] Tap the checkbox again. Unstages; counter decrements.

## Commit

- [ ] Stage one file. Type a commit message. Commit button enables (accent fill).
- [ ] Tap Commit. "Committing…" briefly. Then `committed abc1234` system note appears.
- [ ] Changes list refreshes; the file is gone.
- [ ] Textarea clears. Reload PWA → message stays empty for this repo.
- [ ] Type a partial message, do not commit. Reload PWA. Draft persists.

## Push / Pull

- [ ] Make and commit a change locally on desktop while phone is showing same workspace. Toolbar updates to show `↓1` after a refresh (switch rails to force one).
- [ ] Tap Pull. Spinner. `pulled` note. Behind counter resets to 0.
- [ ] Commit a change from phone (or desktop). Toolbar shows `↑1`. Push button highlights in accent.
- [ ] Tap Push. Spinner. `pushed` note. Ahead counter resets.

## Errors

- [ ] Try to commit with empty message → button stays disabled.
- [ ] Try to commit with no staged files → button stays disabled.
- [ ] Stage a file, commit with a pre-commit hook that fails → error system note shows the hook output. Textarea preserves the message.

## Meta workspaces

- [ ] In a meta workspace, switch repos via RepoPicker. Commit draft and staged set are per-repo (each repo has independent state).
