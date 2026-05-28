# Mobile Remote Phase 2 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 2 done.

## Prerequisites

- [ ] Phase 0 + Phase 1 smoke pass (pair, chat, approvals, switch session).
- [ ] At least two workspaces open in SAI on the desktop (project + project, or project + meta).

## Workspace switcher

- [ ] Open the PWA drawer (≡). The "Workspaces" section above sessions lists every open workspace, with the currently active one highlighted in accent.
- [ ] Tap a different workspace from the phone. Desktop window's active workspace switches AND the phone re-attaches to that workspace's active chat session within ~1s.
- [ ] If a meta workspace is open, its row shows the `meta` tag and the member project names on a second line.
- [ ] Switch desktop's workspace directly (on the laptop). Phone in follow-mode updates automatically.

## Per-prompt overrides

- [ ] Tap the `default model` chip. Bottom-sheet appears with Opus/Sonnet/Haiku + "Use desktop default". Pick Haiku. Chip shows "Haiku 4.5" in accent color.
- [ ] Send a prompt. Verify on desktop that the response uses Haiku (the system init event or the model badge will say so).
- [ ] Tap `mode: default`, pick `Always ask`. Set desktop's `permMode` to `auto`. Send a write-tool prompt. Approval banner appears on both surfaces (P1 clamp).
- [ ] Tap "reset" — all three chips revert to default, the next prompt uses desktop config.
- [ ] Reload the PWA. Chip values for THIS session persist; switching to another session shows that session's own chip state (or defaults if never set).

## Edge cases

- [ ] Set an effort override. Switch to a different session via the drawer. The new session's chips reflect its own values, not the previous one's.
- [ ] Tap a workspace that's since been closed on desktop. The drawer's list updates within ~5s; trying to tap a stale entry just no-ops (or surfaces an error toast).
