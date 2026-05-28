# Mobile Remote Phase 1 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring Phase 1 done.

## Prerequisites

- [ ] Phase 0 smoke passes (pair, status, revoke).
- [ ] Tailscale on both sides; phone PWA installed via Add-to-Home-Screen.
- [ ] At least one workspace open in SAI with a Claude chat session.

## Streaming + prompts

- [ ] On phone, open the PWA. Verify chat surface renders with a "≡" hamburger and the active session's projectPath at the top.
- [ ] Type a prompt on desktop; phone shows the user bubble and assistant streaming response.
- [ ] Type a prompt on phone; desktop transcript shows the user bubble (origin=remote dedup works — no duplicate); both surfaces stream the response.
- [ ] Mid-stream, tap "Stop" on phone; both surfaces show the turn ends cleanly.

## Tool cards

- [ ] Trigger a tool call (e.g., a Bash command). Phone shows a collapsed tool card; tap to expand input/result.

## Approvals

- [ ] Trigger a tool that requires approval. Both surfaces show approval banner.
- [ ] Approve from phone. Desktop banner dismisses; tool runs.
- [ ] Trigger another approval; deny from desktop. Phone banner dismisses; tool blocked.

## Session switching

- [ ] On phone, open the drawer (≡). Verify follow-mode is on by default and the desktop's active session is highlighted.
- [ ] Toggle follow-mode off. On phone drawer, tap a different session — phone re-attaches; transcript loads its history.
- [ ] Switch desktop's active session. Phone (with follow off) stays on the previously chosen session.
- [ ] Toggle follow-mode back on. Phone immediately re-attaches to desktop's active session.

## Autonomy clamp

- [ ] Set desktop approval mode to "auto" and remoteCeiling to "always-ask".
- [ ] Send a write-tool prompt from phone. Verify approval banner appears (despite desktop being "auto").
- [ ] Set remoteCeiling to "No clamp". Same prompt from phone now auto-approves.

## Reconnect

- [ ] Toggle Tailscale off on phone mid-stream. WS closes; on reconnect, phone re-attaches and resumes streaming via bus replay.
- [ ] Quit and restart SAI. Phone PWA (still open) auto-reconnects, re-attaches to last session.
