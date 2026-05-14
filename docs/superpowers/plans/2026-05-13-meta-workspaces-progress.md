# Meta Workspaces — Progress Notes

**Plan:** `docs/superpowers/plans/2026-05-13-meta-workspaces.md`
**Spec:** `docs/superpowers/specs/2026-05-13-meta-workspaces-design.md`
**Branch:** `feat/meta-workspaces` (from `main` at `4de30f5`)
**Status:** All tasks complete (1-17). Vitest 1185/1185 pass. `npm run build` clean. E2E smoke (1 passed, 1 skipped).

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

## Done (Tasks 8–17)

| # | Task | Commit |
|---|------|--------|
| 8 | Picker Projects/Meta tabs in TitleBar | `2f74b52` |
| 9 | CreateMetaWorkspaceModal + wiring | `6887b7c` |
| 10 | Preamble injection into Claude `--append-system-prompt`; stashed for codex/gemini | `890de8f` |
| 11 | IncludedProjectsStrip + `@`-mention picker (prepended to existing `@terminal` suggestions) | `d8f1500` |
| 12 | MetaGitSidebar + embedded mode for GitSidebar + synthetic-root guard | `cb97751` + `d09ec1d` (Windows path fix) |
| 13 | Cross-project DnD block; shared `src/lib/syntheticRoot.ts` (`owningLink`, `isCrossProjectMove`) | `ec31743` |
| 14 | Multi-project replace confirmation in SearchPanel | `9380be5` |
| 15 | ManageMetaWorkspaceModal (rename / add / remove / edit / delete) | `530659d` |
| 16 | E2E picker-tabs smoke test (creation flow `test.skip`d — needs preload harness changes) | `4ef0199` |
| 17 | Final verification — vitest 1185/1185, build clean, playwright meta-workspace 1 pass 1 skip | — |

## Known concerns / follow-ups

- **Codex & Gemini preamble:** stashed on workspace state but not yet injected into the providers (no clean injection point in current ACP/JSON-RPC bootstraps). Claude works via `--append-system-prompt`. Future: extend codex.ts / gemini.ts to prepend the preamble at message-send time or via a system-instructions field if the protocols expose one.
- **E2E creation flow:** `test.skip`d in `tests/e2e/meta-workspace.spec.ts` — requires stubbing `window.sai.selectFolder` + `metaWorkspaceCreate` via the preload harness.
- **`alert()` for cross-project DnD block:** acceptable v1; should be replaced with a proper toast when a notification system lands.
- **`aria-disabled` missing on IncludedProjectsStrip chips:** native `disabled` works; explicit `aria-disabled` would improve a11y.

## Next steps (post-merge)

1. Manual smoke as described in Task 17 of the plan (3 sibling folders, 2 with git, etc.).
2. Wire codex/gemini preamble injection when those protocols expose a system-instructions field.
3. Replace `alert()` in FileExplorerSidebar DnD block with a proper toast.
4. Flesh out the e2e creation-flow test once the preload harness supports selectFolder stubs.

## Notable design decisions made during execution

- The `linkName` field name was kept as-is (a code reviewer suggested `mountName`/`symlink`; rejected because junctions aren't symlinks and the field literally is the name of the link on disk).
- `handleMetaWorkspaceActivate` inlines the workspace-switch logic rather than calling `handleProjectSwitch`, because `handleProjectSwitch` would (a) clear `activeMetaRuntime` via the new clearing line at its top, and (b) call `openRecentProject` which shouldn't be invoked for synthetic roots. `handleProjectSwitch` was modified to clear `activeMetaRuntime` so switching back to a regular project from a meta workspace works correctly.
- Sync of `metaWorkspaces` was confirmed — uses denylist pattern, default-included.
