# Customizable Keyboard Shortcuts Design

**Status:** Approved (brainstorm 2026-04-27)
**Owner:** SAI 1.0 readiness
**Related:** Roadmap audit (third 1.0-readiness item, after `unskip-e2e-tests` and `find-replace`)

## Goal

Let users rebind SAI's global keyboard shortcuts from a Settings page, with conflict warning, per-row reset, reset-all, and cross-platform Cmd↔Ctrl handling. Migrate the existing scattered `addEventListener('keydown', ...)` sites in `App.tsx` to a single registry-backed `useKeybinding` hook so the Settings UI is the single source of truth.

## Non-goals (v1)

- Chord sequences (`Ctrl+K Ctrl+X`)
- Component-local shortcuts (Ctrl+F in GitSidebar, terminal shortcuts, Ctrl+Enter in ChatInput/CommitBox)
- Per-context `when` clauses (`when: editorFocused`)
- JSON file editor for power users
- Importing VS Code `keybindings.json`

## Scope

In-scope shortcuts (4 globals in `src/App.tsx`):

| ID                       | Default          | Label                          | Current site         |
| ------------------------ | ---------------- | ------------------------------ | -------------------- |
| `palette.open`           | `Ctrl+K`         | Open command palette           | App.tsx ~line 172    |
| `chatHistory.toggle`     | `Ctrl+H`         | Toggle chat history sidebar    | App.tsx ~line 644    |
| `search.toggle`          | `Ctrl+Shift+F`   | Toggle search sidebar          | App.tsx ~line 656    |
| `markdownPreview.toggle` | `Ctrl+Shift+M`   | Toggle markdown preview        | App.tsx ~line 1000   |

Out of scope, untouched: `Ctrl+Enter` in ChatInput/CommitBox; `Ctrl+F` inside GitSidebar; xterm/TerminalPanel shortcuts.

## Architecture

### Registry

A single static module at `src/utils/keybindings.ts`.

```typescript
export type KeybindingId = string;
export type KeyCombo = string;       // canonical form, e.g. 'Ctrl+K' or 'Ctrl+Shift+F' or '' (unbound)

export interface KeybindingDef {
  id: KeybindingId;
  label: string;                     // human-readable, shown in Settings UI
  defaultCombo: KeyCombo;
  description?: string;
}

export const KEYBINDINGS: KeybindingDef[] = [
  { id: 'palette.open',           label: 'Open command palette',        defaultCombo: 'Ctrl+K' },
  { id: 'chatHistory.toggle',     label: 'Toggle chat history sidebar', defaultCombo: 'Ctrl+H' },
  { id: 'search.toggle',          label: 'Toggle search sidebar',       defaultCombo: 'Ctrl+Shift+F' },
  { id: 'markdownPreview.toggle', label: 'Toggle markdown preview',     defaultCombo: 'Ctrl+Shift+M' },
];
```

The list is static — defined at module load — so the Settings UI is deterministic and tests don't depend on registration order. Adding a new global shortcut is a one-line code change.

### Hook

```typescript
// src/hooks/useKeybinding.ts

/**
 * Listen for the user-configured key combo for `id` and invoke `handler`.
 * Re-binds automatically when the user changes the combo in Settings.
 */
export function useKeybinding(id: KeybindingId, handler: (e: KeyboardEvent) => void): void;
```

Internally one shared global keydown listener owns the dispatch table; each `useKeybinding` call subscribes/unsubscribes its handler. This avoids N independent listeners on `window`.

### Storage

User overrides live in the existing settings store under one key:

```typescript
settings.keybindings: Record<KeybindingId, KeyCombo>
```

Empty string = explicitly unbound. Missing = use the default. Stored via the existing `settingsGet`/`settingsSet` IPC, so the GitHub settings sync picks it up automatically (single key, no allowlist additions needed).

### Combo normalization

```typescript
export function eventToCombo(e: KeyboardEvent): KeyCombo {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');   // collapse Cmd→Ctrl
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return '';   // pure-modifier event
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}
```

`normalizeKey` upper-cases single letters, leaves `Enter`/`Tab`/`Escape`/`F1`–`F12` as-is, normalizes `' '` → `'Space'`, `'ArrowLeft'` → `'Left'`, etc.

The dispatcher uses the same function on incoming events; storage and runtime are exact-string compared.

### Display formatting

The Settings UI calls `formatCombo(combo, platform)`:

- macOS: `Ctrl+K` → `⌘K`, `Ctrl+Shift+F` → `⇧⌘F`
- Linux/Windows: `Ctrl+K` → `Ctrl+K` (verbatim)

Storage stays canonical regardless of platform.

## Settings UI

A new "Keybindings" entry in `SettingsModal`'s sidebar nav, between General and Provider. Renders:

```
┌──────────────────────────────────────┐
│ Search keybindings... [_____________]│
├──────────────────────────────────────┤
│ Open command palette        Ctrl+K  ✏ ⟲│
│ Toggle search sidebar    Ctrl+Shift+F  ✏ ⟲│
│ Toggle chat history         Ctrl+H  ✏ ⟲│
│ Toggle markdown preview   Ctrl+Shift+M  ✏ ⟲│
├──────────────────────────────────────┤
│            [Reset all to defaults]   │
└──────────────────────────────────────┘
```

### Interactions

- **Search filter** — narrows the row list by case-insensitive substring match against `label`.
- **✏ (Edit)** — clicking enters capture mode for that row. Row text becomes `Press keys… (Esc to cancel)`. The next non-modifier keydown is captured via `eventToCombo` and `e.preventDefault()` is called so the underlying combo doesn't fire. Esc cancels and restores the previous binding.
- **⟲ (Reset)** — sets this row back to its `defaultCombo`. Disabled if already at default.
- **Reset all to defaults** — confirmation dialog, then clears all overrides.
- **Conflict modal** — if the captured combo equals another binding's current combo, a modal appears: *"`Ctrl+K` is currently bound to **Open command palette**. Reassign it to **Toggle chat history**?"* — Cancel reverts the capture; Confirm clears the old binding (becomes empty string) and assigns the new.
- **Reserved-combo warning** — captured combo matching a known browser/OS shortcut (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Ctrl+A`, `Tab`, F1–F12) shows a non-blocking inline warning: *"This combo may not fire reliably (browser shortcut)."*
- **Empty bindings allowed** — a row with empty combo just doesn't fire anything. Lets users disable a shortcut.

## Migration

Each existing `useEffect`/`addEventListener('keydown', ...)` site in `App.tsx` collapses to a single line:

```typescript
// Before
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setPaletteOpen(p => !p);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);

// After
useKeybinding('palette.open', (e) => {
  e.preventDefault();
  setPaletteOpen(p => !p);
});
```

Same pattern for `chatHistory.toggle`, `search.toggle`, `markdownPreview.toggle`. The `markdownPreview.toggle` handler keeps its existing context check (only fires for `.md` files).

## Error handling & edge cases

- **Empty combo on save** — allowed; treated as "disabled."
- **Unknown registered ID in stored settings** — silently ignored at load (lets us rename IDs without breaking saved settings).
- **Two IDs end up sharing a combo via stale settings or a conflict-modal Cancel race** — at dispatch time the registry iterates `KEYBINDINGS` in declaration order and fires only the first matching subscribed handler; later duplicates are silently skipped. The Settings UI shows a ⚠ icon next to each affected row so the user can resolve it.
- **Capture mode cancelled by Esc** — restores previous binding, exits capture.
- **User attempts to bind Esc as a primary key** — disallowed; capture stays armed (Esc is the universal cancel).
- **User attempts to bind a pure modifier (Ctrl/Shift/Alt alone)** — capture ignores pure-modifier keydowns; user must press a non-modifier to complete the combo.
- **Window loses focus during capture** — capture cancels on `blur`.

## Testing

### Unit — `tests/unit/utils/keybindings.test.ts`

- `eventToCombo` matrix: each modifier alone and combined; case-normalization for letters; `Enter`, `Tab`, `Space`, `ArrowLeft`, `F5`; pure-modifier events return `''`.
- `formatCombo` for both platforms.
- Registry: defaults; merge of stored overrides; missing key falls back to default; empty string respected as "unbound."
- Conflict detection helper: returns the conflicting `KeybindingDef` or `null`.

### Unit — `tests/unit/hooks/useKeybinding.test.ts`

- Calls handler when the configured combo fires.
- Re-binds when the user changes the combo in settings (via a settingsGet mock).
- Does NOT call handler after unmount.
- Multiple `useKeybinding` calls each get their own handler invocation.

### Component — `tests/unit/components/KeybindingsPage.test.tsx`

- Renders all 4 registered bindings with current combos.
- Search filter narrows rows by label.
- Edit button enters capture mode; pressing keys updates the row.
- Reset row sets back to default.
- Reset-all clears all overrides.
- Conflict modal appears when captured combo matches another row.

### E2E — `tests/e2e/keybindings.spec.ts`

- Open Settings → Keybindings, rebind Command Palette from `Ctrl+K` to `Ctrl+J`. Close Settings.
- Press `Ctrl+J` → command palette opens.
- Press old `Ctrl+K` → nothing happens (with `palette.open` rebound and the capture confirmed via `saiMock.settingsGet`/`settingsSet`).

## File-by-file impact

| File | Change |
| --- | --- |
| `src/utils/keybindings.ts` | NEW: registry, types, `eventToCombo`, `formatCombo`, conflict detection |
| `src/hooks/useKeybinding.ts` | NEW: hook + shared-listener dispatcher |
| `src/components/Settings/KeybindingsPage.tsx` | NEW: Settings page UI |
| `src/components/Settings/KeybindingsPage.css` | NEW: row, capture-mode, conflict-modal styles |
| `src/components/SettingsModal.tsx` | +1 sidebar nav entry, +1 page route |
| `src/App.tsx` | Replace 4 `useEffect`/`addEventListener` blocks with 4 `useKeybinding` calls |
| `tests/unit/utils/keybindings.test.ts` | NEW |
| `tests/unit/hooks/useKeybinding.test.ts` | NEW |
| `tests/unit/components/KeybindingsPage.test.tsx` | NEW |
| `tests/e2e/keybindings.spec.ts` | NEW |
| `tests/e2e/electron.setup.ts` | (no changes — uses existing `settingsGet`/`settingsSet` mock) |

Estimated 4-6 days of focused work.
