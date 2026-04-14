# Window State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and restore the window's `x`, `y`, `width`, and `height` between launches using the existing `settings.json` infrastructure.

**Architecture:** On `close`, write `mainWindow.getBounds()` to `settings.json` via the existing `writeSetting()` helper. On `createWindow()`, read back `windowBounds`, validate it intersects at least one display, and pass it to the `BrowserWindow` constructor. Fall back to defaults if the value is missing or off-screen.

**Tech Stack:** Electron `screen` API, existing `fs`-based `readSettings`/`writeSetting` helpers in `electron/main.ts`.

> **Note on tests:** There are no unit tests for `electron/main.ts` (no test files exist in `electron/`). Adding a test harness for Electron window creation is a multi-day effort outside the scope of this feature. Skip the TDD loop for this task.

---

### Task 1: Add `screen` to imports and read/validate saved bounds in `createWindow`

**Files:**
- Modify: `electron/main.ts:1` (import line)
- Modify: `electron/main.ts:35-60` (`createWindow` function — window construction block)

- [ ] **Step 1: Add `screen` to the electron import**

In `electron/main.ts` line 1, change:

```ts
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } from 'electron';
```

to:

```ts
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, screen } from 'electron';
```

- [ ] **Step 2: Read and validate saved bounds, then apply to BrowserWindow constructor**

Replace the `createWindow` function opening block (lines 35–60) with:

```ts
function createWindow() {
  let tb = THEME_TITLEBAR.default;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    if (s.theme && THEME_TITLEBAR[s.theme]) tb = THEME_TITLEBAR[s.theme];
  } catch { /* use default */ }

  // Restore last window position/size if valid
  let savedBounds: { x: number; y: number; width: number; height: number } | undefined;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    const b = s.windowBounds;
    if (b && typeof b.x === 'number' && typeof b.y === 'number' &&
        typeof b.width === 'number' && typeof b.height === 'number') {
      const isOnScreen = screen.getAllDisplays().some(({ bounds }) =>
        b.x < bounds.x + bounds.width &&
        b.x + b.width > bounds.x &&
        b.y < bounds.y + bounds.height &&
        b.y + b.height > bounds.y
      );
      if (isOnScreen) savedBounds = b;
    }
  } catch { /* use defaults */ }

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: tb.color,
      symbolColor: tb.symbolColor,
      height: 38,
    },
    backgroundColor: tb.bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit -p tsconfig.node.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: restore window size and position from settings on launch"
```

---

### Task 2: Save window bounds on close

**Files:**
- Modify: `electron/main.ts:98-102` (`mainWindow.on('close', ...)` handler)

- [ ] **Step 1: Save bounds before teardown in the close handler**

Replace lines 98–102:

```ts
  mainWindow.on('close', () => {
    stopSuspendTimer();
    destroyAllTerminals();
    destroyAll(mainWindow!);
  });
```

with:

```ts
  mainWindow.on('close', () => {
    if (mainWindow) writeSetting('windowBounds', mainWindow.getBounds());
    stopSuspendTimer();
    destroyAllTerminals();
    destroyAll(mainWindow!);
  });
```

> **Note:** `writeSetting` is defined later in `createWindow` (line 166). This ordering is fine because `close` fires at runtime, well after the function has fully executed and `writeSetting` is in scope via closure.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx tsc --noEmit -p tsconfig.node.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: save window bounds to settings on close"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Build and launch the app**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm run dev
```

- [ ] **Step 2: Resize and reposition the window, then close it**

Move the window to a non-default position and resize it. Close the app.

- [ ] **Step 3: Check settings.json contains windowBounds**

```bash
cat "$(electron -e 'process.stdout.write(require("electron").app.getPath("userData"))' 2>/dev/null || echo ~/.config/sai)/settings.json" | python3 -m json.tool | grep -A 5 windowBounds
```

Expected output like:
```json
"windowBounds": {
    "x": 200,
    "y": 150,
    "width": 1200,
    "height": 800
}
```

- [ ] **Step 4: Relaunch and confirm window opens at the saved position/size**

```bash
npm run dev
```

The window should open at the same position and size it was closed at.
