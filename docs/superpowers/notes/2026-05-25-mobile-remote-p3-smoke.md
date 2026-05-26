# Mobile Remote Phase 3 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 3 done.

## Prerequisites

- [ ] P0–P2 smoke pass (pair, chat, workspaces).
- [ ] At least one workspace open in SAI with uncommitted git changes.

## Files tab

- [ ] Tap Files at top. Sub-tabs show Changes (default) and Browse.
- [ ] Changes list shows every uncommitted file with the correct letter (M / A / D).
- [ ] Tap a modified file. Diff shows below with +/- coloring and the right code.
- [ ] Tap a staged file. Banner shows "staged"; diff is the staged diff.
- [ ] Browse tab: tap a folder — expands, lists children. Tap a `.ts` file — content renders with Shiki highlighting.
- [ ] Tap an image (e.g. `public/img/sai.png`) — image previews inline.
- [ ] Tap a binary (e.g. `node_modules/.bin/...`) — "Binary file" placeholder with "open raw" link.

## Meta workspace

- [ ] Switch to a meta workspace via the workspace header.
- [ ] RepoPicker chips appear above Changes/Browse.
- [ ] Tap a different chip. List + diff retarget to that member repo.

## Persistence

- [ ] Set Files sub-tab to Browse, reload PWA. Files opens at Browse.
- [ ] Switch top-level tab to Chat, reload PWA. Opens at Chat.

## Performance

- [ ] List a deep directory (e.g. `node_modules`). Lazy expand doesn't lock the UI.
- [ ] Open a large source file (~10K lines). Shiki render < 2s; content scrolls smoothly.
- [ ] Open a 1MB+ file. Content arrives via signedUrl; second tap after consume prompts a re-request.
