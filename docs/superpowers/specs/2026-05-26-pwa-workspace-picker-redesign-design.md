# PWA Workspace Picker — visual parity with SAI desktop

## Goal

Bring the PWA (`src/renderer-remote`) workspace picker visually in line with
the desktop `TitleBar` workspace picker: squircle status dots, the same
animations, the approval / completed badges, and a Projects / Meta tab split
inside the dropdown.

Only `src/renderer-remote/chat/WorkspaceHeader.tsx` is touched. The legacy
`WorkspacePicker.tsx` (not used in the live UI) is left alone.

## Visual mapping

Status priority is collapsed to match desktop. The PWA-only `streaming` and
`awaitingQuestion` states fold into `busy`.

| Priority           | Shape        | Color           | Animation                | Size |
| ------------------ | ------------ | --------------- | ------------------------ | ---- |
| `approval`         | round circle | `#f59e0b`       | `approval-blink` (1s)    | 7 px |
| `busy` (merged)    | squircle     | `var(--accent)` | `dot-spinner-pulse` (2.2s) | 9 px |
| `completed`        | squircle     | `#4ade80`       | `done-pulse` (2s)        | 9 px |
| active idle (current ws row) | squircle | `#4ade80` | none                     | 9 px |
| `suspended` (row context) | squircle | `#d4a72c`  | none                     | 9 px |
| `recent` / `idle`  | none         | —               | —                        | —    |

`busy` = `status.busy || status.streaming || status.awaitingQuestion` in the
priority resolver used by the picker.

Row-level badges (right of the name):

- approval → orange round `!` icon + `Approval needed` label
- completed → green round `!` icon

## Trigger button

The header button (always visible above the chat) gains the same indicator
treatment as desktop:

- squircle/round dot reflecting current workspace state (same mapping as above)
- if approval → orange `!` badge replaces the dot
- if completed → green `!` badge appears alongside the dot
- ChevronDown stays, rotates on open (unchanged)

## Dropdown structure

```
┌───────────────────────────────────────────┐
│ [Projects •]   [Meta]      ← picker-tabs  │
├───────────────────────────────────────────┤
│ ACTIVE                                    │
│  ● workspace-name        path/here        │
│ OPEN                                      │
│  ● workspace-name        path/here        │
│ SUSPENDED                                 │
│  ● workspace-name (dim)  path/here        │
│ RECENT                                    │
│    workspace-name (dim)  path/here        │
└───────────────────────────────────────────┘
```

Tabs:

- `Projects` shows workspaces with `kind === 'project'`
- `Meta` shows workspaces with `kind === 'meta'` (members preview line shown
  instead of project path)
- Each tab label carries a small indicator (round dot or squircle spinner)
  summarizing approval/completed/busy in workspaces of that kind, so the user
  notices activity in the non-selected tab. Indicator priority:
  approval > completed > busy. No indicator when nothing applies.
- Empty Meta tab: text "No meta workspaces open on desktop." (the PWA cannot
  create meta workspaces, so no creation affordance is added.)

Sections inside each tab keep the existing logic
(Active / Open / Suspended / Recent), filtered by `kind`.

## Out of scope

- Row hover overflow menu (suspend / close) — desktop-only lifecycle actions.
- `+ New Meta Workspace` button — PWA is read-only for meta workspaces.
- Changes to `WorkspacePicker.tsx` (legacy sidebar variant) or to the
  `workspaceStatusStore` priority resolver.

## Implementation notes

- Import `DOT_MASK_URL` from `../../lib/assets` (already an inline data URI,
  works under file:// — same import works for renderer-remote).
- Inline `<style>` block scoped to the component. Animation keyframes and the
  `.workspace-status-dot`, `.workspace-spinner`, `.workspace-approval-icon`,
  `.workspace-completed-icon`, `.picker-tabs`, `.picker-tab-dot`,
  `.picker-tab-spinner`, `.picker-tab-meta-icon` class rules are lifted
  verbatim from `src/components/TitleBar.tsx`. Renderer-remote bundle stays
  self-contained.
- `StatusDot` becomes a small renderer that, given a priority + an optional
  "active row" hint, picks shape/color/animation.
- `pickerTab: 'projects' | 'meta'` is local state. Default `projects`. Reset
  on dropdown open is not required; persisting across opens within the
  session is fine.
- The trigger-button's existing `StatusDot` call is replaced with the new
  one; approval / completed badges render next to it in addition to (or
  instead of) the dot per the table above.

## Testing

Manual verification only — this is a visual refactor.

- Trigger button: dot animates while a turn streams; goes to green `!` on
  completion; goes to orange `!` while a tool approval is pending.
- Dropdown rows: same per-row treatment for non-active workspaces.
- Tabs: indicator on `Meta` tab fires when a meta workspace becomes busy
  while `Projects` tab is selected (and vice versa). Empty Meta tab message
  appears when desktop has no meta workspaces open.

No new unit tests; existing `tests/unit/remote/bridge-server-workspace-status.test.ts`
and `tests/unit/remote/workspace-status-store.test.ts` are unaffected
(priority resolver and status store are unchanged).
