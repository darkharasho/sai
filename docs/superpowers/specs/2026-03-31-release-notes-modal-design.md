# What's New Modal — Design Spec

**Date:** 2026-03-31
**Version:** 1.0

## Overview

A "What's New" modal that appears automatically on the first launch after a version update, fetches release notes from GitHub Releases, and renders them with markdown. Users can also re-open it manually from the Settings modal.

---

## Version Tracking & Trigger Logic

- On app launch, a `useWhatsNew` hook reads `lastSeenVersion` from `settings.json` via `window.sai.settingsGet('lastSeenVersion')`.
- It compares `lastSeenVersion` to the current app version, imported directly from `package.json`. This is the single source of truth — no separate version constant.
- If `lastSeenVersion` is absent or differs from the current version, the modal opens automatically.
- Once the modal opens, `lastSeenVersion` is written to settings via `window.sai.settingsSet('lastSeenVersion', currentVersion)` — preventing the modal from appearing again for this version.
- The hook exposes an `openWhatsNew()` function for the manual re-open trigger.

---

## Data Fetching

- Fetch occurs when the modal opens (lazy, not on app startup).
- Endpoint: `https://api.github.com/repos/darkharasho/sai/releases/tags/v{version}`
- The `body` field of the API response contains the markdown release notes.
- On success: markdown string is passed to the modal for rendering.
- On failure (network error, 404, rate limit, or any non-200 response): modal shows a graceful fallback — a message with a link to the GitHub releases page. No error is thrown, no blank modal.

---

## Modal UI

### Structure

Follows the existing modal pattern in the codebase (CSS-in-JS, fixed positioning, dark overlay, `backdrop-filter: blur`) — consistent with `SettingsModal.tsx`, `UnsavedChangesModal.tsx`, etc.

### Content

- **Header:** "What's New in v{version}"
- **Body:** Scrollable area rendering markdown via `ReactMarkdown` with `remark-gfm` (same configuration as `ChatMessage.tsx`)
  - **Loading state:** Simple inline spinner or skeleton while fetch is in-flight
  - **Fallback state:** "See release notes on GitHub →" link (opens externally)
- **Footer:** Single "Got it" close button

### Dismissal

All three of the following close the modal:
1. Clicking the "Got it" button
2. Pressing ESC
3. Clicking the backdrop overlay

### Re-open Trigger

A "What's New" link/button in the Settings modal (exact placement decided during implementation). Calls `openWhatsNew()` from the hook.

---

## Component Structure

```
src/
  hooks/
    useWhatsNew.ts        — version check, fetch logic, open/close state
  components/
    WhatsNewModal.tsx     — pure UI component, receives state/handlers as props
```

`App.tsx` uses `useWhatsNew` and passes the returned state and handlers to `WhatsNewModal`.

---

## Data Flow

```
App.tsx
  → useWhatsNew()
      → reads settings (lastSeenVersion)
      → compares to package.json version
      → if mismatch: sets isOpen=true, writes new lastSeenVersion to settings
      → on open: fetches GitHub API → sets releaseNotes or fallback flag
  → <WhatsNewModal isOpen releaseNotes version onClose />
      → renders markdown or fallback
      → ESC / backdrop / button → onClose()

SettingsModal.tsx
  → "What's New" link → calls openWhatsNew() from hook
```

---

## Error Handling

- All fetch errors (network, HTTP non-200, malformed response) are caught silently.
- Fallback UI is shown instead — never a crash or blank modal.
- No retry logic needed; user can dismiss and re-open manually if desired.

---

## Out of Scope

- Syntax highlighting in release notes (release notes are prose + lists, not code-heavy)
- Caching the fetched release notes between sessions
- Showing a "what's new" badge/indicator before opening the modal
