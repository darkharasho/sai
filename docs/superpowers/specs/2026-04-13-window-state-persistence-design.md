# Window State Persistence Design

**Date:** 2026-04-13  
**Status:** Approved

## Goal

Remember the window's last size and position between launches. No maximized state — only `x`, `y`, `width`, `height`.

## Approach

Use the existing `settings.json` infrastructure (`readSettings` / `writeSetting`) in `electron/main.ts`. No new dependencies.

## Save (close handler)

In the existing `mainWindow.on('close', ...)` block, before `stopSuspendTimer()`, call:

```ts
writeSetting('windowBounds', mainWindow.getBounds());
```

This stores `{ x, y, width, height }` in `settings.json`.

## Restore (createWindow)

At the top of `createWindow()`, read `windowBounds` from `readSettings()`. Before applying it, validate that the bounds intersect at least one display returned by `screen.getAllDisplays()`. If valid, pass `x`, `y`, `width`, `height` to the `BrowserWindow` constructor. If missing or off-screen, fall back to the current defaults (`width: 1400, height: 900`, no position — Electron centers by default).

## Validation check

```ts
const displays = screen.getAllDisplays();
const isOnScreen = displays.some(({ bounds }) =>
  saved.x < bounds.x + bounds.width &&
  saved.x + saved.width > bounds.x &&
  saved.y < bounds.y + bounds.height &&
  saved.y + saved.height > bounds.y
);
```

## Scope

- **File:** `electron/main.ts` only
- **Lines changed:** ~15
- **New files:** none
- **New dependencies:** none
