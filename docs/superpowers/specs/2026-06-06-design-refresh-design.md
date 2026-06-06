# Holistic Design Refresh

**Date:** 2026-06-06
**Branch:** exploratory, own branch off main
**Approach:** Foundation-First — fix design tokens first, then cascade through components

## Goals

- Cleaner and more premium: refined minimalism with polish
- Dark-first (light theme remains available but not default)
- Contextual density: compact in sidebars/panels, comfortable in chat/main content
- Keep gold accent as brand identity
- Fix root causes: surfaces, typography, spacing, and component consistency all need work

## Approach

Foundation-First: overhaul the token layer in `src/styles/globals.css` first. Everything derives from coherent tokens. Semantic aliases (`--bg-primary`, etc.) are kept pointing to new values so nothing breaks immediately — they migrate gradually across components.

## Design Tokens

### Surface Elevation (replaces 6 ad-hoc `--bg-*` vars)

A 5-step ladder from darkest (window chrome) to lightest (hover/selected):

| Token | Value | Usage |
|---|---|---|
| `--surface-0` | `#090c0e` | Window background, nav bar |
| `--surface-1` | `#0f1318` | Sidebars, panels, main content area |
| `--surface-2` | `#161b22` | Cards, inputs, code blocks |
| `--surface-3` | `#1d2430` | Modals, dropdowns, tool card headers |
| `--surface-4` | `#252d3a` | Hover states, selected items |

Semantic aliases (backwards compat, migrate gradually):
- `--bg-primary` → `--surface-1`
- `--bg-secondary` → `--surface-0`
- `--bg-mid` → `--surface-0`
- `--bg-input` → `--surface-2`
- `--bg-hover` → `--surface-4`
- `--bg-elevated` → `--surface-3`

### Border Strategy (replaces single `--border`)

| Token | Value | Usage |
|---|---|---|
| `--border-hairline` | `#161f28` | Internal structure, separators within panels |
| `--border-subtle` | `#1e2a38` | Panel/card edges (default) |
| `--border-strong` | `#2e3d4e` | Focus rings, active/selected states |
| `--border-accent` | `rgba(212,160,23,0.35)` | Highlighted/selected with brand color |

Old `--border` becomes an alias for `--border-subtle`.

### Accent

Gold stays as brand — slightly refined:
- `--accent`: `#d4a017` (was `#c7910c` — slightly brighter/more saturated)
- `--accent-hover`: `#f0b820` (was `#f5b832`)
- `--accent-dim`: `rgba(212,160,23,0.12)` — new, for active icon backgrounds, selection tints
- `--accent-rgb`: `212, 160, 23` — new, for `rgba()` usage in components

### Type Scale (replaces single 13px default)

| Token | Value | Usage |
|---|---|---|
| `--text-xs` | `11px` | Timestamps, labels, metadata, tool card headers |
| `--text-sm` | `12px` | Secondary UI, sidebar items, compact panels |
| `--text-base` | `13px` | Body text (unchanged default) |
| `--text-md` | `14px` | Chat message body |
| `--text-lg` | `15px` | Section headings, panel titles |
| `--text-xl` | `17px` | Page-level headings |

### Spacing Scale (new — 4px base)

| Token | Value |
|---|---|
| `--sp-1` | `4px` |
| `--sp-2` | `8px` |
| `--sp-3` | `12px` |
| `--sp-4` | `16px` |
| `--sp-5` | `20px` |
| `--sp-6` | `24px` |
| `--sp-8` | `32px` |
| `--sp-10` | `40px` |
| `--sp-12` | `48px` |

Components use these tokens rather than ad-hoc pixel values. Sidebar items: `--sp-2` vertical, `--sp-3` horizontal. Chat messages: `--sp-4` gap. Modal padding: `--sp-6`.

### Radius Scale (new)

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` | `2px` | Tags, badges |
| `--radius-sm` | `4px` | Buttons, small inputs, inline elements |
| `--radius-md` | `6px` | Cards, inputs, tool cards |
| `--radius-lg` | `10px` | Panels, sidebars |
| `--radius-xl` | `14px` | Modals, overlays |

## Component Direction

### Nav Bar
- Background: `--surface-0` (darkest — visually recedes)
- Icon size: 32×32px touch target, 16px icon
- Active state: `--accent-dim` background, `--accent` icon color
- No explicit border between nav and sidebar — `--surface-0` vs `--surface-1` provides the separation through depth alone

### Sidebar Panels
- Background: `--surface-1`
- Right border: `1px solid --border-subtle`
- Header: `font-size: --text-sm`, `font-weight: 600`, uppercase, `letter-spacing: 0.06em`, `color: --text-secondary`
- Item height: compact — `4px` vertical padding, `--text-sm`
- Active item: `--accent-dim` background, `--accent` text

### Chat Panel
- Background: `--surface-1` (same as sidebar — unified feel)
- Message body: `--text-md` (14px), `line-height: 1.55`
- Comfortable spacing: `--sp-3` between messages, `--sp-4` padding
- User message: plain text, no bubble — cleaner
- AI message: same treatment, differentiated by avatar/label only

### Tool Cards
- Background: `--surface-2`
- Border: `1px solid --border-subtle`, `border-radius: --radius-md`
- Header: `--surface-3` background, `--border-hairline` bottom border
- Header content: tool icon + tool name (`--text-xs`, monospace, `font-weight: 600`) + path (muted) + status (right-aligned)
- Body: `--text-xs`, monospace, `--text-secondary` color, `--sp-2` padding

### Chat Input
- Background: `--surface-2`
- Border: `1px solid --border-subtle`, `border-radius: --radius-md` (8px)
- Focus: border upgrades to `--border-strong`
- Send button: `--accent` background, `--radius-sm`, `#000` icon

### Buttons
- Primary: `background: --accent`, `color: #000`, `font-weight: 600`, `border-radius: --radius-sm`
- Secondary: `background: --surface-3`, `color: --text-secondary`, `border: 1px solid --border-subtle`
- Ghost: transparent background, `color: --text-secondary`, hover → `--surface-4`
- All: `font-size: --text-sm`, `padding: 5px --sp-2`

### Scrollbar
- Thumb: `--border-subtle` (was `--border`) — more subtle
- Hover: `--accent` (unchanged)
- Width: 6px (was 8px) — less intrusive

## Implementation Phasing

This is exploratory work on its own branch. Suggested order:

1. **Token layer** — update `src/styles/globals.css` with full token system, add aliases for compat
2. **NavBar** — simplest component, good smoke test for surface-0
3. **Sidebar panels** — apply compact density, new header/item styles
4. **Tool cards** — new header treatment, surface-3 headers
5. **Chat messages** — comfortable density, text-md body
6. **Chat input** — border-radius, focus state
7. **Buttons/inputs globally** — sweep remaining components
8. **Modals/overlays** — surface-3/4, radius-xl

Each step is its own commit. No component removals — purely additive token updates and style adjustments.

## Out of Scope

- New features
- Light theme changes
- Syntax highlighting palette (separate concern)
- PWA/remote renderer (separate token system in `renderer-remote/theme.css`)
- New animations or motion design
