# Comprehensive Testing Infrastructure for SAI

**Date:** 2026-03-31
**Status:** Approved

## Overview

Add a layered testing pyramid to SAI: unit tests (Vitest), integration tests (Vitest), and E2E tests (Playwright). Target near-total code coverage with specific regression tests for all past bugfixes. CI runs tests before releases; Playwright is opt-in via `/github-release <bump> e2e`.

## Architecture

Three-tier testing pyramid with clear separation of concerns:

```
tests/
├── unit/                          # Vitest — pure logic, parsers, components
│   ├── services/                  # Electron main process service tests
│   │   ├── commit-message-parser.test.ts
│   │   ├── claude.test.ts
│   │   ├── codex.test.ts
│   │   ├── gemini.test.ts
│   │   ├── pty.test.ts
│   │   ├── git.test.ts
│   │   ├── fs.test.ts
│   │   ├── usage.test.ts
│   │   ├── workspace.test.ts
│   │   └── notify.test.ts
│   └── components/                # React component tests (RTL)
│       ├── Chat/
│       ├── Terminal/
│       ├── Git/
│       ├── FileExplorer/
│       ├── CodePanel/
│       ├── SettingsModal.test.tsx
│       ├── TitleBar.test.tsx
│       └── NavBar.test.tsx
├── integration/                   # Vitest — IPC round-trips, service combos
│   ├── ipc-streaming.test.ts
│   ├── ipc-approval.test.ts
│   ├── ipc-slash-commands.test.ts
│   ├── workspace-lifecycle.test.ts
│   └── session-persistence.test.ts
├── e2e/                           # Playwright — full Electron app flows
│   ├── file-explorer.spec.ts
│   ├── terminal.spec.ts
│   ├── chat.spec.ts
│   ├── git.spec.ts
│   ├── settings.spec.ts
│   ├── workspace.spec.ts
│   └── fixtures/                  # Test projects, mock data
├── helpers/
│   ├── ipc-mock.ts                # Shared IPC mock for unit/component tests
│   ├── electron-mock.ts           # Electron API stubs
│   └── test-utils.tsx             # RTL render wrapper with providers
└── setup/
    ├── vitest.setup.ts            # Global setup for Vitest
    └── playwright.setup.ts
```

**Root config files:**
- `vitest.config.ts` — two Vitest workspaces: `unit` and `integration`
- `playwright.config.ts` — Electron-specific config

**npm scripts:**
- `test` — runs unit + integration (pre-release gate)
- `test:unit` — fast unit tests only
- `test:integration` — IPC/service integration tests
- `test:e2e` — Playwright E2E (optional, triggered by flag)
- `test:coverage` — unit + integration with coverage report

## Dependencies

- `vitest` — test runner for unit + integration
- `@testing-library/react` — React component testing
- `@testing-library/jest-dom` — DOM assertion matchers
- `jsdom` — browser environment for component tests
- `@playwright/test` — E2E framework
- `playwright` — Electron browser support

## Unit Tests — Regression Coverage

Each past bugfix area gets targeted test cases that would have caught the original bug.

### Terminal/PTY (`tests/unit/services/pty.test.ts`)

| Test Case | Regression For |
|-----------|---------------|
| Paste operations don't cause cursor jumps or prompt corruption | `08cabed` |
| node-pty spawn handles missing shell gracefully | `62618bd` |
| stdin is properly closed on spawned process exit | `1a34a0d` |
| Terminal fitting calculations produce valid dimensions on resize | `7730e74` |

### Streaming State (`tests/unit/services/claude.test.ts`, `codex.test.ts`, `gemini.test.ts`)

| Test Case | Regression For |
|-----------|---------------|
| Streaming state resets correctly after completion | `e96d1c1` |
| No false positive completion notifications during active streams | `f476162` |
| Thinking animation state machine transitions correctly | `fbb9a5d` |
| Safety timeout removal doesn't leave orphaned state | `dd4d6a0` |

### Provider Parsing (`tests/unit/services/commit-message-parser.test.ts`)

Migrated from existing Node `test` module to Vitest.

| Test Case | Regression For |
|-----------|---------------|
| Codex JSONL commit message parsing handles all edge cases | `4efb745` |
| Legacy commit message format fallback works | `4efb745` |
| Token usage parsing extracts highest-utilization limit | `f2c6146` |
| Billing mode detection bypasses cache correctly | `f2c6146` |

### Approval Flow

| Test Case | Regression For |
|-----------|---------------|
| Token counting in approval UI is accurate | `4a11646` |
| Approval state doesn't leak between messages | `4a11646` |

### Notifications

| Test Case | Regression For |
|-----------|---------------|
| Notifications are workspace-aware | `dd4d6a0` |
| Notification timing respects streaming state | `3e0e7bf` |

### React Components (`tests/unit/components/`)

| Component | Key Test Cases |
|-----------|---------------|
| Chat | Message rendering, streaming indicator, code blocks with syntax highlighting |
| Terminal | XTerm mount/unmount lifecycle, buffer management |
| Git | Diff viewer renders hunks correctly, stage/unstage toggles |
| FileExplorer | File tree rendering, context menu actions, tab management |
| CodePanel | Monaco editor mount, file content display, diff view |
| SettingsModal | Provider switching updates UI, keybinding display |
| TitleBar | Workspace switcher shows correct active workspace |
| NavBar | Panel toggle state, active panel indication |

## Integration Tests — IPC Boundary

These validate round-trips between renderer and main process using real service instances where possible.

### IPC Streaming (`tests/integration/ipc-streaming.test.ts`)

- Start stream → receive chunks → completion event fires in correct order
- Abort mid-stream → state resets cleanly, no dangling listeners
- Multiple rapid stream requests don't interleave responses
- Stream error → renderer receives error event and resets UI state
- Workspace switch mid-stream → stream is properly cleaned up

### IPC Approval Flow (`tests/integration/ipc-approval.test.ts`)

- Tool call triggers approval → approve → execution resumes
- Tool call triggers approval → reject → stream continues without tool
- Multiple pending approvals in sequence don't corrupt state

### Slash Commands (`tests/integration/ipc-slash-commands.test.ts`)

- Commands are cached on startup, available immediately (regression for `044bb07`)
- Provider switch → slash commands update to new provider's set
- Commands refresh correctly after cache invalidation

### Workspace Lifecycle (`tests/integration/workspace-lifecycle.test.ts`)

- Create workspace → sessions initialize → terminal spawns
- Switch workspace → previous workspace state preserved
- Suspend workspace after timeout → resources freed
- Resume suspended workspace → state restored correctly
- Close workspace → all resources cleaned up (PTY, listeners, buffers)

### Session Persistence (`tests/integration/session-persistence.test.ts`)

- Save session → reload → messages and metadata intact
- Large session with many messages → on-demand loading works
- Concurrent session saves don't corrupt storage

## Playwright E2E Tests

Full Electron app tests using Playwright's Electron support (`_electron.launch()`).

### File Explorer (`tests/e2e/file-explorer.spec.ts`)

- Open project → file tree renders with correct hierarchy
- Click file → opens in editor tab with syntax highlighting
- Edit file → unsaved indicator shows → save → indicator clears
- Create/rename/delete file via context menu
- Drag and drop file between folders
- Multiple tabs → switch between them → content preserved

### Terminal (`tests/e2e/terminal.spec.ts`)

- Terminal spawns on workspace open with correct shell
- Type command → output renders in terminal
- Paste text → no cursor jump, no prompt corruption
- Resize window → terminal refits correctly
- Terminal persists across panel toggles

### Chat (`tests/e2e/chat.spec.ts`)

- Send message → streaming response renders progressively
- Code blocks in response have syntax highlighting
- Approval panel appears for tool calls → approve/reject works
- Session switching preserves message history
- @terminal context inclusion

### Git (`tests/e2e/git.spec.ts`)

- Git sidebar shows changed files with correct status icons
- Click file → diff viewer opens with highlighted hunks
- Stage/unstage files → status updates
- Write commit message → commit → files clear from staging
- Branch display is accurate

### Settings (`tests/e2e/settings.spec.ts`)

- Open settings modal → all sections render
- Switch AI provider → UI updates (model dropdown, permission modes)
- Change editor font size → Monaco editor reflects change
- Toggle minimap → editor updates
- Keybinding display renders correctly

### Workspace (`tests/e2e/workspace.spec.ts`)

- Add workspace → appears in switcher
- Switch workspace → editor, terminal, chat all switch context
- Close workspace → confirmation dialog → workspace removed
- Unsaved changes → close workspace → warning dialog appears

### Test Fixtures (`tests/e2e/fixtures/`)

- Small test project directory with known file structure for file explorer tests
- Pre-initialized git repo with staged/unstaged changes for git tests
- Mock AI CLI responses for chat tests (to avoid real API calls in E2E)

## CI Integration

### New Workflow: `test.yml`

Triggers on every push to `main` and pull requests targeting `main`.

```yaml
name: Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx electron-rebuild
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
```

### Modified `release.yml`

Add a `test` job that runs before platform builds:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - checkout, setup node, npm ci, electron-rebuild
      - npm run test:unit
      - npm run test:integration

  build-linux:
    needs: [test]
    # ...existing steps...

  build-windows:
    needs: [test]
    # ...existing steps...

  build-macos:
    needs: [test]
    # ...existing steps...
```

### Modified `/github-release` Skill

Add local test gate before version bump:

1. Run `npm test` (unit + integration)
2. If tests fail → abort release, show failures
3. If tests pass → proceed with version bump, tag, push
4. If invoked as `/github-release <bump> e2e`:
   - Build the Electron app first (`npm run build`)
   - Run `npm run test:e2e` against built app
   - If E2E fails → abort release
5. Create draft release as before

### Test Execution Summary

| When | What Runs | Blocking? |
|------|-----------|-----------|
| `npm test` (local dev) | Unit + Integration | N/A |
| Push/PR to main | Unit + Integration + Coverage | Yes (PR checks) |
| `/github-release patch` | Unit + Integration (local) → CI repeats before build | Yes |
| `/github-release patch e2e` | Unit + Integration + E2E (local) → CI repeats unit+integration | Yes |
| Tag push (`v*`) | Unit + Integration (CI) → then platform builds | Yes |

## Mock Strategy

### Unit Tests
- **IPC**: Full mock via `tests/helpers/ipc-mock.ts` — simulates `window.ipcRenderer` and `ipcMain` handlers
- **Electron APIs**: Stubbed via `tests/helpers/electron-mock.ts` — BrowserWindow, dialog, notification
- **File system**: Use `memfs` or temp directories for fs.test.ts
- **node-pty**: Mock the PTY spawn interface, test the wrapping logic
- **External CLIs** (claude, codex, gemini): Mock child process spawn, feed canned stdout/stderr

### Integration Tests
- **Real service instances** where possible (git, fs operations on temp dirs)
- **Mock external CLIs** — still use canned responses for AI provider interactions
- **Real IPC simulation** — test the actual handler registration and invocation path

### E2E Tests
- **Real Electron app** — launched via Playwright's `_electron.launch()`
- **Mock AI CLIs** — intercept or stub CLI spawning to return canned responses
- **Real file system** — use fixture projects in `tests/e2e/fixtures/`
- **Real git** — fixture repos with pre-set state
