# Mobile Remote Phase 5 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring P5 done.

## Prerequisites
- [ ] P0–P4 smoke pass.
- [ ] Tailscale up. PWA reachable from phone over the tailnet.

## Drawer integration
- [ ] Open the drawer. Four rail items visible: Files, Changes, Chats, Terminal.
- [ ] Tap Terminal. Picker sheet slides up from the bottom.
- [ ] Picker shows "New terminal" at top + (initially) "No terminals yet.".

## New terminal
- [ ] Tap "New terminal". Picker dismisses, drawer rail and sliver hide, xterm fills the viewport.
- [ ] Prompt appears within ~1s. Type `ls` + Enter. Output renders with ANSI colors.
- [ ] Run `git status` in a repo cwd. Branch line shown.
- [ ] Run `git log --oneline --color=always | head` — colors render.

## Soft-key toolbar
- [ ] Esc cancels an active `less` invocation.
- [ ] Tab completes `cd <prefix><Tab>`.
- [ ] Run `sleep 30`. Tap Ctrl (highlights). Tap "c" on the on-screen keyboard. The sleep is killed (SIGINT delivered as `\x03`).
- [ ] Arrows recall history (`↑`/`↓`) and move within a line (`←`/`→`).
- [ ] Back arrow returns to the drawer with terminal preserved.

## Lock/unlock + reconnect
- [ ] Start a long-running command (`tail -f /tmp/sai.log` or `for i in $(seq 1 100); do echo $i; sleep 1; done`).
- [ ] Lock the phone for >1 min. Unlock.
- [ ] Terminal reattaches; scrollback intact; live output resumes within ~2s.

## Multiple terminals
- [ ] Back-arrow to drawer. Open Terminal again. Picker now lists the existing term + "New terminal".
- [ ] Tap "New terminal". A second xterm opens.
- [ ] Back-arrow → picker → tap the first term. Switches back, state preserved.

## Viewport resize
- [ ] Tap inside xterm — iOS keyboard pops up. Visible columns recompute; prompt stays in view.
- [ ] Dismiss keyboard — restore cols.

## Kill from picker / exit
- [ ] In the picker, no kill button is exposed yet (v1) — exit a term via `exit` instead.
- [ ] `exit 0` in a term → `[process exited (0)]` line in yellow → Close button → back to drawer.
- [ ] Re-open picker; the exited term is gone from the list.

## Workspace switch
- [ ] Use RepoPicker (Files/Git rail) to switch workspace. Open Terminal — picker only lists terms whose cwd matches the new workspace.

## Heavy stdout
- [ ] Run `yes | head -10000`. PWA stays responsive. After it finishes, scrollback is capped (oldest output evicted) but the last few hundred lines are visible.

## Regression
- [ ] Desktop SAI terminal still spawns normally (open a desktop window terminal — no change).
