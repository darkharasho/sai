# Mobile Remote — Phase 6 manual smoke

Real iPhone + paired SAI session.

- [ ] Open a markdown file via Files. Edit button visible. Tap → editor mounts with content.
- [ ] Type a line. Save button enables. Tap Save. Editor closes, viewer shows new content.
- [ ] Re-open from Files (fresh read). Content persists.
- [ ] Open a 200-line config file. Scroll. Cursor smooth, no jitter.
- [ ] Concurrent edit: phone has file open; desktop edits and saves the same file. Tap phone Save → conflict sheet appears.
  - [ ] Overwrite: desktop reflects phone content on next read.
  - [ ] Reload: editor shows desktop content; if dirty, confirm prompt fires first.
  - [ ] Keep editing: sheet dismisses, no write.
- [ ] Open a binary file (e.g. PNG) via Files: NO Edit button.
- [ ] Open a >256KB text file: NO Edit button (file comes back as binary via the 64KB inline cap → already excluded). Confirm a 300KB JSON falls into this bucket.
- [ ] iOS keyboard show: textarea shrinks above the keyboard, Save remains reachable.
- [ ] Cancel with dirty buffer: confirm prompt → Discard returns to viewer; Keep stays in editor.
- [ ] WS drop during save: toast appears with error message; reconnect; retry succeeds.
- [ ] No regression in P3 (Files browse), P4 (git), P5/P5.1 (terminals).
