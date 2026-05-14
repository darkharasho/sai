# Meta Workspaces — Progress Notes

**Plan:** `docs/superpowers/plans/2026-05-13-meta-workspaces.md`
**Spec:** `docs/superpowers/specs/2026-05-13-meta-workspaces-design.md`
**Branch:** `feat/meta-workspaces` (from `main` at `4de30f5`)
**Session paused:** 2026-05-13

## Done (Tasks 1–7) — foundation complete

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1 | Types | `11f60ff` | `MetaWorkspace`, `MetaWorkspaceProject`, `MetaWorkspaceRuntime[Project]` in `src/types.ts:146-170`. |
| 2 | Persistence store | `e548a34` | `electron/services/metaWorkspace.ts` + `tests/unit/metaWorkspace.test.ts` (4/4 pass). Persists `metaWorkspaces` key in `settings.json`. |
| 3 | Synthetic-root materialization | `0d1542d` | `electron/services/metaSyntheticRoot.ts` + `tests/unit/metaSyntheticRoot.test.ts` (6/6 pass). `fs.symlink(..., 'junction')` for cross-platform. |
| 4 | System-prompt preamble | `c165706` | `src/lib/metaSystemPrompt.ts` + `tests/unit/metaSystemPrompt.test.ts` (3/3 pass). Pure function. |
| 5 | IPC + preload bridge | `469cd39` | `electron/main.ts` (5 handlers), `electron/preload.ts` (5 methods), `src/types.ts` (`SaiBridge` signatures). `npm run build` passes. |
| 6 | Sync verification | (no commit) | Confirmed `metaWorkspaces` is not in `EXCLUDE_KEYS` at `electron/services/github-sync.ts:7`, so it syncs by default. No code change required. |
| 7 | Renderer registry + activation | `1ff75a5` | `src/App.tsx`: `metaWorkspaces` + `activeMetaRuntime` state, mount-time `metaWorkspaceList` load, `handleMetaWorkspaceActivate` callback, props passed to `<TitleBar>`. `<TitleBar>` accepts the 3 new optional props (`metaWorkspaces`, `activeMetaRuntime`, `onActivateMeta`) but does not render anything new yet. |

All test suites green. `npm run build` passes.

## Next (Tasks 8–17)

These are the remaining tasks, all renderer-side UI work:

- **Task 8:** Picker tabs in `TitleBar.tsx` (Projects / Meta).
- **Task 9:** `CreateMetaWorkspaceModal.tsx` — new component, multiselect folders, link-name preview, description fields.
- **Task 10:** Inject `buildMetaPreamble(...)` output into `ChatPanel.tsx` provider start.
- **Task 11:** `IncludedProjectsStrip.tsx` + `@`-mention picker in `ChatInput.tsx`.
- **Task 12:** `MetaGitSidebar.tsx` (multi-repo collapsible) + branching in the GitSidebar parent.
- **Task 13:** Cross-project drag-drop block in `FileExplorerSidebar.tsx`.
- **Task 14:** Multi-project replace confirmation in `SearchPanel.tsx`; extract `owningLink` helper into `src/lib/syntheticRoot.ts`.
- **Task 15:** `ManageMetaWorkspaceModal.tsx` — rename / add / remove / edit description / delete.
- **Task 16:** E2E smoke test in `tests/e2e/meta-workspace.spec.ts`.
- **Task 17:** Full verification (vitest + integration + playwright + manual end-to-end).

Each task body in the plan file is verbatim — fresh session can dispatch directly.

## Resumption instructions for the next session

1. `git checkout feat/meta-workspaces && git pull` (if syncing across machines).
2. Re-read this file and the plan section for Task 8.
3. Use `superpowers:subagent-driven-development` again.
4. The minimum useful subset to get a usable feature end-to-end is Tasks 8 + 9 + 10 — they enable "create a meta workspace and chat across all included projects." Tasks 11-15 are UI polish; Tasks 16-17 are verification.

## Notable design decisions made during execution

- The `linkName` field name was kept as-is (a code reviewer suggested `mountName`/`symlink`; rejected because junctions aren't symlinks and the field literally is the name of the link on disk).
- `handleMetaWorkspaceActivate` inlines the workspace-switch logic rather than calling `handleProjectSwitch`, because `handleProjectSwitch` would (a) clear `activeMetaRuntime` via the new clearing line at its top, and (b) call `openRecentProject` which shouldn't be invoked for synthetic roots. `handleProjectSwitch` was modified to clear `activeMetaRuntime` so switching back to a regular project from a meta workspace works correctly.
- Sync of `metaWorkspaces` was confirmed — uses denylist pattern, default-included.
