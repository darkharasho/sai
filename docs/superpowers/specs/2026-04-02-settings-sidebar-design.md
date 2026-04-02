# Settings Modal Sidebar Navigation

## Summary

Refactor the settings modal from a flat scrollable layout to a sidebar-navigated layout with categorized pages. The modal widens to ~720px to accommodate a left sidebar (185px) alongside the content area.

## Current State

`src/components/SettingsModal.tsx` (698 lines) renders all settings in a single scrollable column with 6 sections: AI Provider, Editor, Layout, Workspaces, Notifications, and Gemini.

## Design

### Navigation Structure

```
General          (lucide: Settings icon)
Provider         (lucide: Monitor icon)
  ├── Claude     (orange badge)
  ├── Codex      (white badge)
  └── Gemini     (blue badge)
```

- **General** — contains Editor, Layout, Workspaces, and Notifications sub-sections (rendered as grouped settings within the page, separated by dividers, same as today)
- **Provider** (top-level) — contains Chat provider and Commit message provider dropdowns
- **Claude** — contains Auto-compact context (moved from Workspaces)
- **Codex** — placeholder page ("No Codex-specific settings yet")
- **Gemini** — contains Loading phrases

### Sidebar Behavior

- Clicking a top-level item (General, Provider) navigates to that page
- Provider sub-items (Claude, Codex, Gemini) are always visible and indented under Provider — no expand/collapse
- Active item gets a left border indicator and highlighted text
- Top-level items use the default accent color (`--accent` / purple) for the active indicator
- Provider sub-items use their brand color for the active indicator:
  - Claude: `#e27b4a`
  - Codex: `#fff`
  - Gemini: `#4285f4`

### Layout Dimensions

- Modal width: ~720px (up from 480px)
- Sidebar width: 185px fixed
- Content area: remaining space (flex: 1)
- Modal height: unchanged (content scrolls within the content area)

### Sidebar Styling

- Background: slightly darker than modal content (`--bg-primary` or similar)
- Right border: 1px solid `--border`
- Top-level items: 12px font, lucide icon (14px) + label, 9px vertical padding, 16px horizontal padding
- Sub-items: 11px font, 14px colored circle badge + label, 7px vertical padding, 36px left padding (indented under parent)
- Active item: `rgba(255,255,255,0.05)` background, 2px left border in accent/brand color, brighter text color
- Inactive items: muted text color

### Content Area

Each page renders its settings groups identically to the current layout — section label (uppercase), setting rows with controls, dividers between groups. No structural change to individual settings rendering.

### State Management

- Add `activePage` state: `'general' | 'provider' | 'claude' | 'codex' | 'gemini'`
- Default to `'general'`
- Sidebar click sets `activePage`, content area renders the corresponding page
- All existing setting state and handlers remain unchanged

### Settings Redistribution

| Setting | Current Section | New Page |
|---|---|---|
| Chat provider | AI Provider | Provider |
| Commit message provider | AI Provider | Provider |
| Font size | Editor | General |
| Minimap | Editor | General |
| Focused chat | Layout | General |
| Sidebar width | Layout | General |
| Auto-suspend after | Workspaces | General |
| System notifications | Notifications | General |
| Auto-compact context | Workspaces | Claude |
| Loading phrases | Gemini | Gemini |

### Sync & What's New

- GitHub sync status dot remains in the header (unchanged)
- Sync note ("Settings are synced...") moves to the bottom of the General page
- What's New button remains at the bottom of General page

## Component Structure

The refactor stays within `SettingsModal.tsx`. Extract render helpers for each page to keep the component readable:

```
SettingsModal
├── Header (title, sync dot, close button)
├── Sidebar
│   ├── NavItem (General)
│   ├── NavItem (Provider)
│   ├── SubNavItem (Claude)
│   ├── SubNavItem (Codex)
│   └── SubNavItem (Gemini)
└── Content
    ├── GeneralPage (Editor + Layout + Workspaces + Notifications)
    ├── ProviderPage (Chat provider + Commit message provider)
    ├── ClaudePage (Auto-compact context)
    ├── CodexPage (Placeholder)
    └── GeminiPage (Loading phrases)
```

No new files needed — page render functions are local to SettingsModal.tsx or extracted as small components in the same file.

## Testing

- Update existing unit tests to account for sidebar navigation (click sidebar items, verify correct page renders)
- Update E2E tests to navigate between pages
- Verify all settings still persist and trigger `onSettingChange` callbacks correctly
