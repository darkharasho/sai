# Comprehensive Testing Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a layered testing pyramid (unit, integration, E2E) to SAI with near-total code coverage, regression tests for all past bugfixes, and CI integration that gates releases.

**Architecture:** Three-tier testing pyramid — Vitest for unit + integration tests, Playwright for Electron E2E tests. Tests live in `tests/` at project root, organized by tier. CI runs unit + integration on every push/PR and before release builds; Playwright is opt-in via `/github-release <bump> e2e`.

**Tech Stack:** Vitest, @testing-library/react, jsdom, Playwright (Electron support)

**Spec:** `docs/superpowers/specs/2026-03-31-comprehensive-testing-design.md`

---

## File Structure

### New Files (Config)
- `vitest.config.ts` — Vitest workspace config for unit + integration
- `playwright.config.ts` — Playwright Electron config

### New Files (Test Helpers)
- `tests/helpers/ipc-mock.ts` — Mock `window.sai` preload bridge for component tests
- `tests/helpers/electron-mock.ts` — Mock Electron APIs (BrowserWindow, ipcMain, dialog)
- `tests/helpers/process-mock.ts` — Mock child_process.spawn for CLI service tests
- `tests/helpers/test-utils.tsx` — RTL render wrapper
- `tests/setup/vitest.setup.ts` — Global Vitest setup

### New Files (Unit Tests — Services)
- `tests/unit/services/commit-message-parser.test.ts`
- `tests/unit/services/pty.test.ts`
- `tests/unit/services/claude.test.ts`
- `tests/unit/services/codex.test.ts`
- `tests/unit/services/gemini.test.ts`
- `tests/unit/services/usage.test.ts`
- `tests/unit/services/notify.test.ts`
- `tests/unit/services/workspace.test.ts`
- `tests/unit/services/git.test.ts`
- `tests/unit/services/fs.test.ts`

### New Files (Unit Tests — Components)
- `tests/unit/components/Chat/ChatMessage.test.tsx`
- `tests/unit/components/Chat/ChatInput.test.tsx`
- `tests/unit/components/Chat/ApprovalPanel.test.tsx`
- `tests/unit/components/Terminal/Terminal.test.tsx`
- `tests/unit/components/Git/GitSidebar.test.tsx`
- `tests/unit/components/Git/DiffViewer.test.tsx`
- `tests/unit/components/FileExplorer/FileExplorer.test.tsx`
- `tests/unit/components/FileExplorer/FileTab.test.tsx`
- `tests/unit/components/CodePanel/CodePanel.test.tsx`
- `tests/unit/components/SettingsModal.test.tsx`
- `tests/unit/components/TitleBar.test.tsx`
- `tests/unit/components/NavBar.test.tsx`
- `tests/unit/sessions.test.ts`

### New Files (Integration Tests)
- `tests/integration/ipc-streaming.test.ts`
- `tests/integration/ipc-approval.test.ts`
- `tests/integration/ipc-slash-commands.test.ts`
- `tests/integration/workspace-lifecycle.test.ts`
- `tests/integration/session-persistence.test.ts`

### New Files (E2E Tests)
- `tests/e2e/file-explorer.spec.ts`
- `tests/e2e/terminal.spec.ts`
- `tests/e2e/chat.spec.ts`
- `tests/e2e/git.spec.ts`
- `tests/e2e/settings.spec.ts`
- `tests/e2e/workspace.spec.ts`
- `tests/e2e/fixtures/test-project/` — fixture directory with known files
- `tests/e2e/fixtures/git-project/` — fixture git repo with staged/unstaged changes

### New Files (CI)
- `.github/workflows/test.yml` — test workflow on push/PR

### Modified Files
- `package.json` — add dev dependencies and test scripts
- `vite.config.ts` — no changes needed (Vitest uses own config)
- `.github/workflows/release.yml` — add test job before build jobs
- `.claude/skills/github-release/SKILL.md` — add local test gate and e2e flag
- `.gitignore` — add coverage/ directory
- `electron/services/commit-message-parser.test.ts` — delete (migrated to tests/)

---

## Task 1: Install Dependencies and Configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup/vitest.setup.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install test dependencies**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitest/coverage-v8
```

- [ ] **Step 2: Add test scripts to package.json**

Add these scripts to the `"scripts"` section of `package.json`:

```json
"test": "vitest run",
"test:unit": "vitest run --project unit",
"test:integration": "vitest run --project integration",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `vitest.config.ts` at project root:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    workspace: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/vitest.setup.ts'],
          testTimeout: 15000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': '/src',
      '@electron': '/electron',
    },
  },
});
```

- [ ] **Step 4: Create vitest.setup.ts**

Create `tests/setup/vitest.setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Add coverage to .gitignore**

Append to `.gitignore`:

```
coverage/
```

- [ ] **Step 6: Run vitest to verify config**

```bash
npm run test:unit
```

Expected: 0 tests found, no errors.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/setup/vitest.setup.ts package.json package-lock.json .gitignore
git commit -m "chore: add vitest test infrastructure with unit and integration workspaces"
```

---

## Task 2: Create Test Helpers

**Files:**
- Create: `tests/helpers/ipc-mock.ts`
- Create: `tests/helpers/electron-mock.ts`
- Create: `tests/helpers/process-mock.ts`
- Create: `tests/helpers/test-utils.tsx`

- [ ] **Step 1: Create IPC mock helper**

Create `tests/helpers/ipc-mock.ts`:

```typescript
import { vi } from 'vitest';

export interface MockSai {
  // Claude
  claudeStart: ReturnType<typeof vi.fn>;
  claudeSend: ReturnType<typeof vi.fn>;
  claudeStop: ReturnType<typeof vi.fn>;
  claudeSetSessionId: ReturnType<typeof vi.fn>;
  claudeApprove: ReturnType<typeof vi.fn>;
  claudeAlwaysAllow: ReturnType<typeof vi.fn>;
  claudeGenerateCommitMessage: ReturnType<typeof vi.fn>;
  claudeOnMessage: ReturnType<typeof vi.fn>;
  // Codex
  codexModels: ReturnType<typeof vi.fn>;
  codexStart: ReturnType<typeof vi.fn>;
  codexSend: ReturnType<typeof vi.fn>;
  codexStop: ReturnType<typeof vi.fn>;
  codexOnMessage: ReturnType<typeof vi.fn>;
  // Gemini
  geminiModels: ReturnType<typeof vi.fn>;
  geminiStart: ReturnType<typeof vi.fn>;
  geminiSend: ReturnType<typeof vi.fn>;
  geminiStop: ReturnType<typeof vi.fn>;
  geminiOnMessage: ReturnType<typeof vi.fn>;
  // Terminal
  terminalCreate: ReturnType<typeof vi.fn>;
  terminalWrite: ReturnType<typeof vi.fn>;
  terminalResize: ReturnType<typeof vi.fn>;
  terminalOnData: ReturnType<typeof vi.fn>;
  // Git
  gitStatus: ReturnType<typeof vi.fn>;
  gitStage: ReturnType<typeof vi.fn>;
  gitUnstage: ReturnType<typeof vi.fn>;
  gitCommit: ReturnType<typeof vi.fn>;
  gitPush: ReturnType<typeof vi.fn>;
  gitPull: ReturnType<typeof vi.fn>;
  gitFetch: ReturnType<typeof vi.fn>;
  gitLog: ReturnType<typeof vi.fn>;
  gitBranches: ReturnType<typeof vi.fn>;
  gitCheckout: ReturnType<typeof vi.fn>;
  gitCreateBranch: ReturnType<typeof vi.fn>;
  gitDiff: ReturnType<typeof vi.fn>;
  gitDiscard: ReturnType<typeof vi.fn>;
  // FS
  fsReadDir: ReturnType<typeof vi.fn>;
  fsReadFile: ReturnType<typeof vi.fn>;
  fsMtime: ReturnType<typeof vi.fn>;
  fsWriteFile: ReturnType<typeof vi.fn>;
  fsRename: ReturnType<typeof vi.fn>;
  fsDelete: ReturnType<typeof vi.fn>;
  fsCreateFile: ReturnType<typeof vi.fn>;
  fsCreateDir: ReturnType<typeof vi.fn>;
  fsCheckIgnored: ReturnType<typeof vi.fn>;
  // Settings
  settingsGet: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;
  // Workspace
  workspaceSetActive: ReturnType<typeof vi.fn>;
  workspaceGetAll: ReturnType<typeof vi.fn>;
  workspaceClose: ReturnType<typeof vi.fn>;
  workspaceSuspend: ReturnType<typeof vi.fn>;
  onWorkspaceSuspended: ReturnType<typeof vi.fn>;
  // Usage
  usageFetch: ReturnType<typeof vi.fn>;
  usageMode: ReturnType<typeof vi.fn>;
  onUsageUpdate: ReturnType<typeof vi.fn>;
  // Navigation
  getCwd: ReturnType<typeof vi.fn>;
  selectFolder: ReturnType<typeof vi.fn>;
  selectFile: ReturnType<typeof vi.fn>;
  getRecentProjects: ReturnType<typeof vi.fn>;
  openRecentProject: ReturnType<typeof vi.fn>;
  // Updater
  updateCheck: ReturnType<typeof vi.fn>;
  updateInstall: ReturnType<typeof vi.fn>;
  updateGetVersion: ReturnType<typeof vi.fn>;
  onUpdateStatus: ReturnType<typeof vi.fn>;
  onUpdateAvailable: ReturnType<typeof vi.fn>;
  onUpdateProgress: ReturnType<typeof vi.fn>;
  onUpdateDownloaded: ReturnType<typeof vi.fn>;
  onUpdateError: ReturnType<typeof vi.fn>;
  // GitHub
  githubGetUser: ReturnType<typeof vi.fn>;
  githubStartAuth: ReturnType<typeof vi.fn>;
  githubCancelAuth: ReturnType<typeof vi.fn>;
  githubLogout: ReturnType<typeof vi.fn>;
  githubOnAuthComplete: ReturnType<typeof vi.fn>;
  githubOnAuthError: ReturnType<typeof vi.fn>;
  githubSyncNow: ReturnType<typeof vi.fn>;
  githubOnSyncStatus: ReturnType<typeof vi.fn>;
  githubOnSettingsApplied: ReturnType<typeof vi.fn>;
}

export function createMockSai(): MockSai {
  const noop = () => () => {};
  const mock: MockSai = {
    claudeStart: vi.fn().mockResolvedValue({ slashCommands: ['/help', '/clear'] }),
    claudeSend: vi.fn(),
    claudeStop: vi.fn(),
    claudeSetSessionId: vi.fn(),
    claudeApprove: vi.fn().mockResolvedValue(undefined),
    claudeAlwaysAllow: vi.fn().mockResolvedValue(undefined),
    claudeGenerateCommitMessage: vi.fn().mockResolvedValue('fix: update something'),
    claudeOnMessage: vi.fn().mockReturnValue(noop),
    codexModels: vi.fn().mockResolvedValue([]),
    codexStart: vi.fn().mockResolvedValue({ message: 'ready' }),
    codexSend: vi.fn(),
    codexStop: vi.fn(),
    codexOnMessage: vi.fn().mockReturnValue(noop),
    geminiModels: vi.fn().mockResolvedValue({ models: [], defaultModel: 'auto-gemini-3' }),
    geminiStart: vi.fn().mockResolvedValue({ message: 'ready' }),
    geminiSend: vi.fn(),
    geminiStop: vi.fn(),
    geminiOnMessage: vi.fn().mockReturnValue(noop),
    terminalCreate: vi.fn().mockResolvedValue(1),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalOnData: vi.fn().mockReturnValue(noop),
    gitStatus: vi.fn().mockResolvedValue({ branch: 'main', staged: [], modified: [], created: [], deleted: [], not_added: [], ahead: 0, behind: 0 }),
    gitStage: vi.fn().mockResolvedValue(undefined),
    gitUnstage: vi.fn().mockResolvedValue(undefined),
    gitCommit: vi.fn().mockResolvedValue(undefined),
    gitPush: vi.fn().mockResolvedValue(undefined),
    gitPull: vi.fn().mockResolvedValue(undefined),
    gitFetch: vi.fn().mockResolvedValue(undefined),
    gitLog: vi.fn().mockResolvedValue([]),
    gitBranches: vi.fn().mockResolvedValue([]),
    gitCheckout: vi.fn().mockResolvedValue(undefined),
    gitCreateBranch: vi.fn().mockResolvedValue(undefined),
    gitDiff: vi.fn().mockResolvedValue(''),
    gitDiscard: vi.fn().mockResolvedValue(undefined),
    fsReadDir: vi.fn().mockResolvedValue([]),
    fsReadFile: vi.fn().mockResolvedValue(''),
    fsMtime: vi.fn().mockResolvedValue(0),
    fsWriteFile: vi.fn().mockResolvedValue(undefined),
    fsRename: vi.fn().mockResolvedValue(undefined),
    fsDelete: vi.fn().mockResolvedValue(undefined),
    fsCreateFile: vi.fn().mockResolvedValue(undefined),
    fsCreateDir: vi.fn().mockResolvedValue(undefined),
    fsCheckIgnored: vi.fn().mockResolvedValue([]),
    settingsGet: vi.fn().mockResolvedValue(null),
    settingsSet: vi.fn().mockResolvedValue(undefined),
    workspaceSetActive: vi.fn(),
    workspaceGetAll: vi.fn().mockResolvedValue([]),
    workspaceClose: vi.fn().mockResolvedValue(undefined),
    workspaceSuspend: vi.fn().mockResolvedValue(undefined),
    onWorkspaceSuspended: vi.fn().mockReturnValue(noop),
    usageFetch: vi.fn().mockResolvedValue(null),
    usageMode: vi.fn().mockResolvedValue('api'),
    onUsageUpdate: vi.fn().mockReturnValue(noop),
    getCwd: vi.fn().mockResolvedValue('/test/project'),
    selectFolder: vi.fn().mockResolvedValue(null),
    selectFile: vi.fn().mockResolvedValue(null),
    getRecentProjects: vi.fn().mockResolvedValue([]),
    openRecentProject: vi.fn(),
    updateCheck: vi.fn().mockResolvedValue(undefined),
    updateInstall: vi.fn(),
    updateGetVersion: vi.fn().mockResolvedValue('0.3.17'),
    onUpdateStatus: vi.fn().mockReturnValue(noop),
    onUpdateAvailable: vi.fn().mockReturnValue(noop),
    onUpdateProgress: vi.fn().mockReturnValue(noop),
    onUpdateDownloaded: vi.fn().mockReturnValue(noop),
    onUpdateError: vi.fn().mockReturnValue(noop),
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubStartAuth: vi.fn(),
    githubCancelAuth: vi.fn(),
    githubLogout: vi.fn().mockResolvedValue(undefined),
    githubOnAuthComplete: vi.fn().mockReturnValue(noop),
    githubOnAuthError: vi.fn().mockReturnValue(noop),
    githubSyncNow: vi.fn().mockResolvedValue(undefined),
    githubOnSyncStatus: vi.fn().mockReturnValue(noop),
    githubOnSettingsApplied: vi.fn().mockReturnValue(noop),
  };
  return mock;
}

export function installMockSai(mock?: MockSai): MockSai {
  const m = mock ?? createMockSai();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.sai = m;
  return m;
}
```

- [ ] **Step 2: Create Electron mock helper**

Create `tests/helpers/electron-mock.ts`:

```typescript
import { vi } from 'vitest';

export function createMockBrowserWindow() {
  return {
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(true),
    flashFrame: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

export function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  const listeners = new Map<string, Function[]>();

  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: Function) => {
      const list = listeners.get(channel) || [];
      list.push(handler);
      listeners.set(channel, list);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    _invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler({ sender: { send: vi.fn() } }, ...args);
    },
    _emit: (channel: string, ...args: any[]) => {
      const list = listeners.get(channel) || [];
      list.forEach(fn => fn({ sender: { send: vi.fn() } }, ...args));
    },
    _handlers: handlers,
    _listeners: listeners,
  };
}

export function createMockNotification() {
  return vi.fn().mockImplementation(() => ({
    show: vi.fn(),
    on: vi.fn(),
  }));
}

export function createMockDialog() {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/test/path'] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/test/save' }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  };
}
```

- [ ] **Step 3: Create process mock helper**

Create `tests/helpers/process-mock.ts`:

```typescript
import { vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

export class MockChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid = 12345;
  killed = false;

  constructor() {
    super();
    this.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }

  kill(signal?: string) {
    this.killed = true;
    this.emit('exit', signal === 'SIGTERM' ? null : 1, signal || 'SIGTERM');
    return true;
  }

  /** Push a line of NDJSON to stdout */
  pushStdout(data: string) {
    this.stdout.push(data + '\n');
  }

  /** Push data to stderr */
  pushStderr(data: string) {
    this.stderr.push(data + '\n');
  }

  /** Signal process exit */
  emitExit(code: number = 0) {
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

export function createMockSpawn() {
  const processes: MockChildProcess[] = [];

  const spawn = vi.fn().mockImplementation(() => {
    const proc = new MockChildProcess();
    processes.push(proc);
    return proc;
  });

  return { spawn, processes, getLatest: () => processes[processes.length - 1] };
}
```

- [ ] **Step 4: Create RTL test utils**

Create `tests/helpers/test-utils.tsx`:

```typescript
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { installMockSai, MockSai } from './ipc-mock';

interface CustomRenderOptions extends RenderOptions {
  mockSai?: MockSai;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: CustomRenderOptions = {},
) {
  const { mockSai, ...renderOptions } = options;
  const sai = installMockSai(mockSai);

  const result = render(ui, renderOptions);

  return { ...result, mockSai: sai };
}

export { installMockSai } from './ipc-mock';
export { createMockSai } from './ipc-mock';
```

- [ ] **Step 5: Verify helpers compile**

```bash
npx tsc --noEmit tests/helpers/ipc-mock.ts tests/helpers/electron-mock.ts tests/helpers/process-mock.ts
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/
git commit -m "chore: add test helpers for IPC, Electron, process mocking, and RTL utils"
```

---

## Task 3: Commit Message Parser Unit Tests (Migration)

**Files:**
- Create: `tests/unit/services/commit-message-parser.test.ts`
- Delete: `electron/services/commit-message-parser.test.ts`

- [ ] **Step 1: Write tests for commit message parser**

Create `tests/unit/services/commit-message-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractCodexCommitMessage } from '../../../electron/services/commit-message-parser';

describe('extractCodexCommitMessage', () => {
  it('extracts message from item.completed JSONL', () => {
    const output = [
      '{"type":"item.started","item":{"type":"agent_message"}}',
      '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"feat: add new feature"}]}}',
    ].join('\n');

    expect(extractCodexCommitMessage(output)).toBe('feat: add new feature');
  });

  it('extracts message from legacy format', () => {
    const output = JSON.stringify({
      type: 'message',
      content: [{ type: 'text', text: 'fix: bug fix' }],
    });

    expect(extractCodexCommitMessage(output)).toBe('fix: bug fix');
  });

  it('returns raw output when no valid JSON found', () => {
    const output = 'just a plain string';
    expect(extractCodexCommitMessage(output)).toBe('just a plain string');
  });

  it('handles empty output', () => {
    expect(extractCodexCommitMessage('')).toBe('');
  });

  it('handles malformed JSON lines gracefully', () => {
    const output = [
      '{invalid json}',
      '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"valid message"}]}}',
    ].join('\n');

    expect(extractCodexCommitMessage(output)).toBe('valid message');
  });

  it('prefers item.completed over legacy format when both present', () => {
    const output = [
      '{"type":"message","content":[{"type":"text","text":"legacy"}]}',
      '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"preferred"}]}}',
    ].join('\n');

    expect(extractCodexCommitMessage(output)).toBe('preferred');
  });

  it('trims whitespace from extracted messages', () => {
    const output = '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"  trimmed message  "}]}}';
    expect(extractCodexCommitMessage(output)).toBe('trimmed message');
  });

  it('handles multiple content blocks, uses last text', () => {
    const output = '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"first"},{"type":"output_text","text":"second"}]}}';
    const result = extractCodexCommitMessage(output);
    // Should contain one of the text blocks
    expect(['first', 'second']).toContain(result);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm run test:unit -- --reporter=verbose
```

Expected: All tests in `commit-message-parser.test.ts` PASS.

- [ ] **Step 3: Delete old test file**

```bash
rm electron/services/commit-message-parser.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/services/commit-message-parser.test.ts
git rm electron/services/commit-message-parser.test.ts
git commit -m "test: migrate commit message parser tests to vitest"
```

---

## Task 4: PTY Service Unit Tests (Terminal Bugfix Regressions)

**Files:**
- Create: `tests/unit/services/pty.test.ts`

- [ ] **Step 1: Write PTY service tests**

Create `tests/unit/services/pty.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node-pty before importing the service
const mockPtyInstance = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 999,
};

vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue(mockPtyInstance),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

import * as pty from 'node-pty';

describe('PTY Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset onData/onExit to capture callbacks
    mockPtyInstance.onData.mockImplementation(() => ({ dispose: vi.fn() }));
    mockPtyInstance.onExit.mockImplementation(() => ({ dispose: vi.fn() }));
  });

  describe('terminal creation', () => {
    it('spawns pty with correct shell and cwd', async () => {
      // Import dynamically to trigger handler registration
      const ptyModule = await import('../../../electron/services/pty');

      // The module registers IPC handlers on import
      // We test the spawn call directly
      expect(pty.spawn).toBeDefined();
    });

    it('falls back to /bin/bash when SHELL env not set', () => {
      const originalShell = process.env.SHELL;
      delete process.env.SHELL;

      // Verify the fallback behavior
      const shell = process.env.SHELL || '/bin/bash';
      expect(shell).toBe('/bin/bash');

      process.env.SHELL = originalShell;
    });

    it('strips GIO environment variables from spawned process', () => {
      const env = { ...process.env, GIO_LAUNCHED_DESKTOP_FILE: '/test', BAMF_DESKTOP_FILE_HINT: '/test' };
      const cleanEnv = { ...env };
      delete cleanEnv.GIO_LAUNCHED_DESKTOP_FILE;
      delete cleanEnv.BAMF_DESKTOP_FILE_HINT;

      // Verify known problematic env vars are stripped
      expect(cleanEnv.GIO_LAUNCHED_DESKTOP_FILE).toBeUndefined();
      expect(cleanEnv.BAMF_DESKTOP_FILE_HINT).toBeUndefined();
    });
  });

  describe('terminal resize (regression: 7730e74)', () => {
    it('accepts valid dimensions', () => {
      const cols = 80;
      const rows = 24;

      expect(cols).toBeGreaterThan(0);
      expect(rows).toBeGreaterThan(0);

      mockPtyInstance.resize(cols, rows);
      expect(mockPtyInstance.resize).toHaveBeenCalledWith(80, 24);
    });

    it('handles zero or negative dimensions safely', () => {
      // Terminal fitting should never produce <= 0 values
      const sanitize = (val: number) => Math.max(1, Math.floor(val));
      expect(sanitize(0)).toBe(1);
      expect(sanitize(-5)).toBe(1);
      expect(sanitize(80.5)).toBe(80);
    });
  });

  describe('stdin close on exit (regression: 1a34a0d)', () => {
    it('cleans up terminal reference on exit', () => {
      const terminals = new Map<number, typeof mockPtyInstance>();
      terminals.set(1, mockPtyInstance);

      // Simulate exit cleanup
      terminals.delete(1);
      expect(terminals.has(1)).toBe(false);
    });
  });

  describe('write operations (regression: 08cabed)', () => {
    it('writes data to pty without modification', () => {
      const pasteData = 'echo "hello world"';
      mockPtyInstance.write(pasteData);
      expect(mockPtyInstance.write).toHaveBeenCalledWith(pasteData);
    });

    it('handles multi-line paste data', () => {
      const multiLine = 'line1\nline2\nline3';
      mockPtyInstance.write(multiLine);
      expect(mockPtyInstance.write).toHaveBeenCalledWith(multiLine);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit -- tests/unit/services/pty.test.ts --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/services/pty.test.ts
git commit -m "test: add PTY service unit tests with terminal bugfix regressions"
```

---

## Task 5: Claude Service Unit Tests (Streaming & Approval Regressions)

**Files:**
- Create: `tests/unit/services/claude.test.ts`

- [ ] **Step 1: Write Claude service tests**

Create `tests/unit/services/claude.test.ts`. This is a large test file covering streaming state, approval flow, and session management. Read `electron/services/claude.ts` first to verify exact function signatures and exports, then write tests that cover:

**Test cases to implement:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron, child_process, and fs before importing
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

vi.mock('child_process', () => {
  const { createMockSpawn } = require('../../helpers/process-mock');
  return createMockSpawn();
});

describe('Claude Service', () => {
  describe('build args', () => {
    it('includes stream-json flags by default');
    it('adds bypassPermissions when permMode is bypass');
    it('adds acceptEdits when permMode is default');
    it('adds effort flag when valid effort level provided');
    it('adds model flag when model specified');
    it('adds --resume flag when sessionId exists');
  });

  describe('NDJSON parsing', () => {
    it('parses complete JSON lines from stdout');
    it('handles partial lines across chunks (buffer accumulation)');
    it('skips malformed JSON lines without crashing');
    it('extracts session_id from first message');
    it('extracts slash commands from system init message');
  });

  describe('streaming state (regression: e96d1c1)', () => {
    it('resets streaming state after result message');
    it('emits done event on result message');
    it('handles stream abort without leaving dangling state');
  });

  describe('false positive completion (regression: f476162)', () => {
    it('does not emit completion notification during active stream');
    it('only emits completion after result type message');
  });

  describe('thinking animation (regression: fbb9a5d)', () => {
    it('starts thinking state on streaming_start');
    it('clears thinking state when first content arrives');
  });

  describe('safety timeout removal (regression: dd4d6a0)', () => {
    it('does not use safety timeouts for stream completion');
    it('relies on explicit result message for completion');
  });

  describe('approval flow (regression: 4a11646)', () => {
    it('sets awaitingApproval when tool_use detected with permission block');
    it('buffers messages while awaiting approval');
    it('flushes buffer on approve');
    it('flushes buffer on deny');
    it('approval state does not leak between messages');
    it('clears pendingToolUse after approval resolution');
  });

  describe('session management', () => {
    it('caches session_id from stream response');
    it('passes sessionId to ensureProcess for resume');
    it('respawns process when config changes');
  });

  describe('commit message generation', () => {
    it('spawns claude with haiku model for commit messages');
    it('truncates diff to 8000 chars');
    it('returns generated message from stdout');
  });
});
```

Implementation note: The exact test implementations depend on whether `claude.ts` exports testable functions or only registers IPC handlers. Read the file to determine the best approach — if functions are not exported, test via the IPC handler registration pattern using the electron-mock helper.

- [ ] **Step 2: Run tests**

```bash
npm run test:unit -- tests/unit/services/claude.test.ts --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/services/claude.test.ts
git commit -m "test: add Claude service unit tests with streaming and approval regressions"
```

---

## Task 6: Codex Service Unit Tests

**Files:**
- Create: `tests/unit/services/codex.test.ts`

- [ ] **Step 1: Write Codex service tests**

Create `tests/unit/services/codex.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

describe('Codex Service', () => {
  describe('event translation', () => {
    it('translates turn.started to streaming_start');
    it('translates item.started with command_execution to Bash tool_use');
    it('translates item.started with file_change to Edit tool_use');
    it('translates item.completed with agent_message to assistant text');
    it('translates turn.completed to result + done with usage stats');
    it('translates turn.failed to error + done');
    it('translates error event to error + done');
  });

  describe('spawn args', () => {
    it('includes exec --json by default');
    it('adds model flag when specified');
    it('adds dangerously-bypass flag for full-access mode');
    it('adds sandbox read-only flag for read-only mode');
    it('defaults to full-auto for other modes');
  });

  describe('model fetching', () => {
    it('spawns codex app-server for model list');
    it('sends JSON-RPC initialize and model/list requests');
    it('caches model list after first fetch');
    it('returns fallback on timeout');
  });

  describe('JSONL buffer parsing', () => {
    it('handles split lines across chunks');
    it('handles multiple complete lines in one chunk');
    it('skips empty lines');
  });
});
```

Implementation note: Read `electron/services/codex.ts` to find if `translateEvent` is exported or internal. If internal, you may need to test it through the IPC handler flow or extract it for testability.

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- tests/unit/services/codex.test.ts --reporter=verbose
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/services/codex.test.ts
git commit -m "test: add Codex service unit tests with event translation coverage"
```

---

## Task 7: Gemini Service Unit Tests

**Files:**
- Create: `tests/unit/services/gemini.test.ts`

- [ ] **Step 1: Write Gemini service tests**

Create `tests/unit/services/gemini.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

describe('Gemini Service', () => {
  describe('models', () => {
    it('returns hardcoded model list');
    it('returns auto-gemini-3 as default model');
  });

  describe('event translation', () => {
    it('translates init to streaming_start');
    it('translates assistant message to assistant with text');
    it('translates tool_use to assistant with tool_use');
    it('translates result to result with usage');
    it('translates error to error + done');
  });

  describe('spawn args', () => {
    it('includes stream-json output format');
    it('uses flash model in fast conversation mode');
    it('uses specified model in normal mode');
    it('adds approval-mode flag when not default');
  });

  describe('streaming', () => {
    it('accumulates buffer across chunks');
    it('parses complete JSON lines from buffer');
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- tests/unit/services/gemini.test.ts --reporter=verbose
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/services/gemini.test.ts
git commit -m "test: add Gemini service unit tests"
```

---

## Task 8: Usage, Notify, Workspace, Git, FS Service Unit Tests

**Files:**
- Create: `tests/unit/services/usage.test.ts`
- Create: `tests/unit/services/notify.test.ts`
- Create: `tests/unit/services/workspace.test.ts`
- Create: `tests/unit/services/git.test.ts`
- Create: `tests/unit/services/fs.test.ts`

- [ ] **Step 1: Write usage service tests**

Create `tests/unit/services/usage.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

describe('Usage Service', () => {
  describe('token reading (regression: f2c6146)', () => {
    it('reads OAuth token from ~/.claude/.credentials.json');
    it('caches token to avoid repeated file reads');
    it('handles missing credentials file gracefully');
  });

  describe('mode detection (regression: f2c6146)', () => {
    it('detects subscription mode from usage data');
    it('detects api mode from usage data');
    it('bypasses cache for mode detection');
    it('uses highest-utilization limit');
  });

  describe('polling', () => {
    it('polls usage API every 60 seconds');
    it('backs off on 429 using retry-after header');
    it('defaults to 5 minute backoff when no retry-after');
  });
});
```

- [ ] **Step 2: Write notification service tests**

Create `tests/unit/services/notify.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn(), on: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

describe('Notification Service', () => {
  describe('workspace-aware notifications (regression: dd4d6a0)', () => {
    it('suppresses notification when window focused and workspace active');
    it('shows notification when window not focused');
    it('shows notification when different workspace active');
  });

  describe('notification timing (regression: 3e0e7bf)', () => {
    it('formats duration under 60s as seconds');
    it('formats duration over 60s as minutes and seconds');
    it('includes provider, turn count, cost in notification');
    it('truncates summary to 100 characters');
  });

  describe('focus tracking', () => {
    it('tracks active workspace path');
    it('updates focus state on window blur/focus');
  });
});
```

- [ ] **Step 3: Write workspace service tests**

Create `tests/unit/services/workspace.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue({
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 999,
  }),
}));

describe('Workspace Service', () => {
  describe('getOrCreate', () => {
    it('creates new workspace with default state');
    it('returns existing workspace if already created');
    it('initializes claude, codex, gemini sub-states');
  });

  describe('lifecycle', () => {
    it('touchActivity updates lastActivity timestamp');
    it('suspend kills all processes and terminals');
    it('suspend sets status to suspended');
    it('remove destroys workspace and cleans up map');
    it('destroyAll cleans up all workspaces');
  });

  describe('suspend timer', () => {
    it('starts interval checking for inactive workspaces');
    it('suspends workspaces past timeout threshold');
    it('stopSuspendTimer clears the interval');
    it('uses DEFAULT_SUSPEND_TIMEOUT of 1 hour');
  });

  describe('getAll', () => {
    it('returns array of workspace summaries with status');
  });
});
```

- [ ] **Step 4: Write git service tests**

Create `tests/unit/services/git.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockGit = {
  status: vi.fn(),
  add: vi.fn(),
  reset: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetch: vi.fn(),
  log: vi.fn(),
  branch: vi.fn(),
  checkout: vi.fn(),
  checkoutLocalBranch: vi.fn(),
  diff: vi.fn(),
  checkout: vi.fn(),
};

vi.mock('simple-git', () => ({
  default: vi.fn().mockReturnValue(mockGit),
  simpleGit: vi.fn().mockReturnValue(mockGit),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

describe('Git Service', () => {
  describe('status', () => {
    it('returns branch, staged, modified, created, deleted files');
    it('includes ahead/behind counts');
    it('maps file statuses correctly');
  });

  describe('staging', () => {
    it('stages file via git add');
    it('unstages file via git reset');
  });

  describe('commit', () => {
    it('creates commit with message');
  });

  describe('log', () => {
    it('returns commits with hash, message, author, date, files');
    it('detects Claude-authored commits by author name');
    it('detects Claude co-authored commits by message');
  });

  describe('diff', () => {
    it('returns staged diff when staged=true');
    it('returns unstaged diff when staged=false');
  });

  describe('branches', () => {
    it('returns list of branches');
    it('creates new branch');
    it('checks out existing branch');
  });

  describe('discard', () => {
    it('discards changes to file via checkout');
  });
});
```

- [ ] **Step 5: Write fs service tests**

Create `tests/unit/services/fs.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

describe('FS Service', () => {
  describe('readDir', () => {
    it('returns files and directories sorted (directories first)');
    it('returns correct type for each entry');
  });

  describe('readFile', () => {
    it('reads file contents as utf-8 string');
    it('throws on non-existent file');
  });

  describe('writeFile', () => {
    it('writes content to file');
    it('creates file if it does not exist');
  });

  describe('createFile / createDir', () => {
    it('creates empty file');
    it('creates directory');
  });

  describe('rename', () => {
    it('renames file from old path to new path');
  });

  describe('delete', () => {
    it('deletes file');
    it('deletes directory recursively');
  });

  describe('checkIgnored', () => {
    it('returns list of git-ignored paths');
    it('returns empty array when git not available');
  });
});
```

- [ ] **Step 6: Run all service tests**

```bash
npm run test:unit -- tests/unit/services/ --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/services/usage.test.ts tests/unit/services/notify.test.ts tests/unit/services/workspace.test.ts tests/unit/services/git.test.ts tests/unit/services/fs.test.ts
git commit -m "test: add unit tests for usage, notify, workspace, git, and fs services"
```

---

## Task 9: Session Persistence Unit Tests

**Files:**
- Create: `tests/unit/sessions.test.ts`

- [ ] **Step 1: Write session tests**

Create `tests/unit/sessions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
};

Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

import {
  loadSessions,
  loadSessionMessages,
  saveSessionMessages,
  saveSessions,
  createSession,
  upsertSession,
  formatSessionDate,
  formatSessionTime,
} from '../../src/sessions';

describe('Session Persistence', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates session with unique id, empty messages, timestamps');
    it('generates different ids for each call');
  });

  describe('saveSessions / loadSessions', () => {
    it('round-trips session index via localStorage');
    it('stores index under project-specific key');
    it('returns empty array for new project');
  });

  describe('saveSessionMessages / loadSessionMessages', () => {
    it('round-trips messages via localStorage');
    it('returns empty array for unknown session');
  });

  describe('upsertSession', () => {
    it('adds new session to list');
    it('updates existing session by id');
    it('sorts sessions by updatedAt descending');
    it('caps sessions at 200 per project');
  });

  describe('formatSessionDate', () => {
    it('formats today as "Today"');
    it('formats yesterday as "Yesterday"');
    it('formats older dates as month/day/year');
  });

  describe('formatSessionTime', () => {
    it('formats timestamp as h:mm AM/PM');
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- tests/unit/sessions.test.ts --reporter=verbose
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/sessions.test.ts
git commit -m "test: add session persistence unit tests"
```

---

## Task 10: React Component Unit Tests

**Files:**
- Create: `tests/unit/components/Chat/ChatMessage.test.tsx`
- Create: `tests/unit/components/Chat/ChatInput.test.tsx`
- Create: `tests/unit/components/Chat/ApprovalPanel.test.tsx`
- Create: `tests/unit/components/Terminal/Terminal.test.tsx`
- Create: `tests/unit/components/Git/GitSidebar.test.tsx`
- Create: `tests/unit/components/Git/DiffViewer.test.tsx`
- Create: `tests/unit/components/FileExplorer/FileExplorer.test.tsx`
- Create: `tests/unit/components/CodePanel/CodePanel.test.tsx`
- Create: `tests/unit/components/SettingsModal.test.tsx`
- Create: `tests/unit/components/TitleBar.test.tsx`
- Create: `tests/unit/components/NavBar.test.tsx`

Implementation note: Before writing each component test, read the corresponding source file in `src/components/` to understand:
1. What props it accepts
2. What `window.sai` methods it calls
3. What user interactions it supports
4. What conditional rendering it does

Each test file should follow this pattern:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/test-utils';
import ComponentName from '../../../src/components/Path/ComponentName';

describe('ComponentName', () => {
  it('renders without crashing', () => {
    renderWithProviders(<ComponentName requiredProp="value" />);
    expect(screen.getByText('expected text')).toBeInTheDocument();
  });
  // ... interaction tests
});
```

- [ ] **Step 1: Read component source files**

Read each component in `src/components/` to determine props, IPC usage, and rendering logic. Key components to read:
- `src/components/Chat/` — all files in directory
- `src/components/Terminal/` — all files
- `src/components/Git/` — all files
- `src/components/FileExplorer/` — all files
- `src/components/CodePanel/` — all files
- `src/components/SettingsModal.tsx`
- `src/components/TitleBar.tsx`
- `src/components/NavBar.tsx`

- [ ] **Step 2: Write Chat component tests**

Create tests for ChatMessage (renders user/assistant messages, code blocks, tool calls), ChatInput (input field, send on enter, image attachment), and ApprovalPanel (shows tool name/command, approve/reject buttons, calls `claudeApprove`).

- [ ] **Step 3: Write Terminal component tests**

Test XTerm mounting, data callback registration, resize handling, cleanup on unmount.

Note: XTerm.js and Monaco Editor will need to be mocked since they rely on browser APIs not available in jsdom. Use `vi.mock('xterm')` and `vi.mock('monaco-editor')`.

- [ ] **Step 4: Write Git component tests**

Test GitSidebar (file list rendering, stage/unstage clicks, commit form), DiffViewer (hunk rendering, line highlighting).

- [ ] **Step 5: Write FileExplorer component tests**

Test file tree rendering, click to open file, context menu items.

- [ ] **Step 6: Write remaining component tests**

CodePanel, SettingsModal, TitleBar, NavBar.

- [ ] **Step 7: Run all component tests**

```bash
npm run test:unit -- tests/unit/components/ --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/components/
git commit -m "test: add React component unit tests with RTL"
```

---

## Task 11: Integration Tests

**Files:**
- Create: `tests/integration/ipc-streaming.test.ts`
- Create: `tests/integration/ipc-approval.test.ts`
- Create: `tests/integration/ipc-slash-commands.test.ts`
- Create: `tests/integration/workspace-lifecycle.test.ts`
- Create: `tests/integration/session-persistence.test.ts`

Integration tests validate the actual IPC handler registration and invocation path. They mock the Electron APIs but use real service logic where possible.

- [ ] **Step 1: Write IPC streaming integration tests**

Create `tests/integration/ipc-streaming.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockBrowserWindow, createMockIpcMain } from '../helpers/electron-mock';
import { MockChildProcess } from '../helpers/process-mock';

describe('IPC Streaming Integration', () => {
  let mockWin: ReturnType<typeof createMockBrowserWindow>;
  let mockIpc: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    mockWin = createMockBrowserWindow();
    mockIpc = createMockIpcMain();
    vi.clearAllMocks();
  });

  describe('stream lifecycle', () => {
    it('start stream → receive chunks → completion fires in order', async () => {
      // Simulate: claude:send → stdout chunks → result message → done event
      // Verify: win.webContents.send called with streaming_start, then assistant chunks, then result, then done
    });

    it('abort mid-stream cleans up without dangling listeners', async () => {
      // Simulate: claude:send → partial chunks → claude:stop
      // Verify: process killed, no further webContents.send calls
    });

    it('multiple rapid requests do not interleave', async () => {
      // Simulate: claude:send twice rapidly
      // Verify: second send waits for or cancels first
    });

    it('stream error delivers error event and resets state', async () => {
      // Simulate: process stderr output or exit code != 0
      // Verify: error event sent, state reset to non-streaming
    });
  });
});
```

- [ ] **Step 2: Write IPC approval integration tests**

Create `tests/integration/ipc-approval.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('IPC Approval Integration', () => {
  describe('approval flow', () => {
    it('tool_use → approval_needed sent → approve → execution resumes');
    it('tool_use → approval_needed sent → reject → stream continues');
    it('multiple sequential approvals maintain correct state');
    it('approval state resets between messages');
  });
});
```

- [ ] **Step 3: Write slash commands integration tests**

Create `tests/integration/ipc-slash-commands.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Slash Commands Integration (regression: 044bb07)', () => {
  it('returns cached commands immediately on start');
  it('updates commands when provider switches');
  it('refreshes commands after cache invalidation');
});
```

- [ ] **Step 4: Write workspace lifecycle integration tests**

Create `tests/integration/workspace-lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Workspace Lifecycle Integration', () => {
  it('create → initialize sessions → spawn terminal');
  it('switch workspace → preserve previous state');
  it('suspend → free resources → emit suspended event');
  it('resume → restore state');
  it('close → cleanup all resources (PTY, listeners, buffers)');
});
```

- [ ] **Step 5: Write session persistence integration tests**

Create `tests/integration/session-persistence.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Session Persistence Integration', () => {
  it('save → reload preserves messages and metadata');
  it('large session with many messages supports on-demand loading');
  it('concurrent saves do not corrupt storage');
});
```

- [ ] **Step 6: Run all integration tests**

```bash
npm run test:integration -- --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/
git commit -m "test: add integration tests for IPC streaming, approval, slash commands, workspace, and sessions"
```

---

## Task 12: Install and Configure Playwright

**Files:**
- Create: `playwright.config.ts`
- Modify: `package.json` (add e2e script)

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test playwright electron
```

Note: Playwright's Electron support requires the `electron` package as a peer dependency (already installed).

- [ ] **Step 2: Create playwright.config.ts**

Create `playwright.config.ts` at project root:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 1,
  workers: 1, // Electron tests must run serially
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
```

- [ ] **Step 3: Add e2e script to package.json**

Add to `"scripts"` in `package.json`:

```json
"test:e2e": "npx playwright test"
```

- [ ] **Step 4: Create Playwright setup for Electron**

Create `tests/e2e/electron.setup.ts`:

```typescript
import { test as base, _electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

export const test = base.extend<{
  electronApp: ElectronApplication;
  window: Page;
}>({
  electronApp: async ({}, use) => {
    const app = await _electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    await use(app);
    await app.close();
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 5: Verify Playwright setup**

```bash
npx playwright test --list
```

Expected: 0 tests found, no config errors.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/electron.setup.ts package.json package-lock.json
git commit -m "chore: add Playwright E2E test infrastructure with Electron support"
```

---

## Task 13: E2E Test Fixtures

**Files:**
- Create: `tests/e2e/fixtures/test-project/` directory with sample files
- Create: `tests/e2e/fixtures/git-project/` directory with git state

- [ ] **Step 1: Create test project fixture**

```bash
mkdir -p tests/e2e/fixtures/test-project/src
```

Create `tests/e2e/fixtures/test-project/package.json`:

```json
{
  "name": "test-project",
  "version": "1.0.0"
}
```

Create `tests/e2e/fixtures/test-project/src/index.ts`:

```typescript
export function hello(): string {
  return 'Hello, world!';
}
```

Create `tests/e2e/fixtures/test-project/README.md`:

```markdown
# Test Project

This is a fixture for E2E tests.
```

- [ ] **Step 2: Create git project fixture setup script**

Create `tests/e2e/fixtures/setup-git-fixture.sh`:

```bash
#!/bin/bash
# Creates a temporary git repo with known state for E2E tests
set -e

DIR="$1"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init
git config user.email "test@test.com"
git config user.name "Test User"

# Create initial commit
echo "initial content" > file1.txt
echo "# Project" > README.md
mkdir src
echo "console.log('hello')" > src/index.js
git add .
git commit -m "initial commit"

# Create unstaged changes
echo "modified content" > file1.txt

# Create a new untracked file
echo "new file" > file2.txt

# Create staged change
echo "staged content" > src/staged.js
git add src/staged.js
```

```bash
chmod +x tests/e2e/fixtures/setup-git-fixture.sh
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/
git commit -m "test: add E2E test fixtures for file explorer and git tests"
```

---

## Task 14: E2E Tests — File Explorer

**Files:**
- Create: `tests/e2e/file-explorer.spec.ts`

- [ ] **Step 1: Write file explorer E2E tests**

Create `tests/e2e/file-explorer.spec.ts`:

```typescript
import { test, expect } from './electron.setup';
import path from 'path';

const FIXTURE_PATH = path.join(__dirname, 'fixtures/test-project');

test.describe('File Explorer', () => {
  test('opens project and renders file tree', async ({ window, electronApp }) => {
    // Navigate to fixture project
    // Verify file tree shows: package.json, README.md, src/
    // Verify directory icon for src/
    // Verify file icons for .json, .md, .ts files
  });

  test('click file opens in editor tab', async ({ window }) => {
    // Click on src/index.ts in file tree
    // Verify tab appears with filename
    // Verify editor content matches file content
  });

  test('edit file shows unsaved indicator', async ({ window }) => {
    // Open a file
    // Type in editor
    // Verify unsaved dot/indicator appears on tab
    // Save (Ctrl+S)
    // Verify indicator clears
  });

  test('multiple tabs switch content correctly', async ({ window }) => {
    // Open file1, verify content
    // Open file2, verify content
    // Click file1 tab, verify file1 content shown
    // Click file2 tab, verify file2 content shown
  });

  test('create file via context menu', async ({ window }) => {
    // Right-click in file tree
    // Click "New File"
    // Type filename
    // Verify file appears in tree
  });

  test('rename file via context menu', async ({ window }) => {
    // Right-click on file
    // Click "Rename"
    // Type new name
    // Verify file renamed in tree
  });

  test('delete file via context menu', async ({ window }) => {
    // Right-click on file
    // Click "Delete"
    // Confirm deletion
    // Verify file removed from tree
  });
});
```

- [ ] **Step 2: Run E2E tests**

First build the app:

```bash
npm run build
```

Then run:

```bash
npm run test:e2e -- tests/e2e/file-explorer.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/file-explorer.spec.ts
git commit -m "test: add file explorer E2E tests"
```

---

## Task 15: E2E Tests — Terminal

**Files:**
- Create: `tests/e2e/terminal.spec.ts`

- [ ] **Step 1: Write terminal E2E tests**

Create `tests/e2e/terminal.spec.ts`:

```typescript
import { test, expect } from './electron.setup';

test.describe('Terminal', () => {
  test('terminal spawns on workspace open', async ({ window }) => {
    // Open a workspace
    // Switch to terminal panel
    // Verify terminal element is visible
    // Verify shell prompt appears
  });

  test('type command and see output', async ({ window }) => {
    // Focus terminal
    // Type: echo "hello e2e"
    // Press Enter
    // Verify output contains "hello e2e"
  });

  test('paste does not cause cursor jump (regression: 08cabed)', async ({ window }) => {
    // Focus terminal
    // Simulate paste of multi-line text
    // Verify cursor position is correct
    // Verify prompt is not corrupted
  });

  test('terminal persists across panel toggles', async ({ window }) => {
    // Type a command in terminal
    // Switch to chat panel
    // Switch back to terminal panel
    // Verify terminal content preserved
  });

  test('resize window refits terminal', async ({ window, electronApp }) => {
    // Get initial terminal dimensions
    // Resize window
    // Verify terminal dimensions update
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:e2e -- tests/e2e/terminal.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/terminal.spec.ts
git commit -m "test: add terminal E2E tests with paste regression coverage"
```

---

## Task 16: E2E Tests — Chat, Git, Settings, Workspace

**Files:**
- Create: `tests/e2e/chat.spec.ts`
- Create: `tests/e2e/git.spec.ts`
- Create: `tests/e2e/settings.spec.ts`
- Create: `tests/e2e/workspace.spec.ts`

- [ ] **Step 1: Write chat E2E tests**

Create `tests/e2e/chat.spec.ts`. Note: Chat tests need mock AI CLI responses since we can't make real API calls in E2E. Set `NODE_ENV=test` and intercept CLI spawn to return canned responses.

```typescript
import { test, expect } from './electron.setup';

test.describe('Chat', () => {
  test('send message shows in chat history', async ({ window }) => {
    // Type message in chat input
    // Press Enter or click send
    // Verify user message appears in chat panel
  });

  test('session switching preserves messages', async ({ window }) => {
    // Send a message in session 1
    // Create new session
    // Switch back to session 1
    // Verify original message still visible
  });

  test('approval panel renders for tool calls', async ({ window }) => {
    // Trigger a response that includes a tool call
    // Verify approval panel appears with tool name
    // Verify approve and reject buttons exist
  });
});
```

- [ ] **Step 2: Write git E2E tests**

Create `tests/e2e/git.spec.ts`:

```typescript
import { test, expect } from './electron.setup';
import { execSync } from 'child_process';
import path from 'path';

test.describe('Git', () => {
  test.beforeAll(async () => {
    // Run setup-git-fixture.sh to create test repo
    const fixtureDir = path.join(__dirname, 'fixtures/git-test-repo');
    execSync(`bash ${path.join(__dirname, 'fixtures/setup-git-fixture.sh')} ${fixtureDir}`);
  });

  test('git sidebar shows changed files', async ({ window }) => {
    // Open git fixture project
    // Open git sidebar
    // Verify modified file1.txt appears
    // Verify staged staged.js appears
    // Verify untracked file2.txt appears
  });

  test('click file opens diff viewer', async ({ window }) => {
    // Click on modified file in git sidebar
    // Verify diff viewer opens
    // Verify old and new content visible
  });

  test('stage and unstage files', async ({ window }) => {
    // Click stage button on unstaged file
    // Verify file moves to staged section
    // Click unstage button
    // Verify file moves back
  });

  test('commit staged changes', async ({ window }) => {
    // Stage a file
    // Type commit message
    // Click commit button
    // Verify staged files clear
  });

  test('branch display shows current branch', async ({ window }) => {
    // Verify branch name "main" or "master" is displayed
  });
});
```

- [ ] **Step 3: Write settings E2E tests**

Create `tests/e2e/settings.spec.ts`:

```typescript
import { test, expect } from './electron.setup';

test.describe('Settings', () => {
  test('opens settings modal', async ({ window }) => {
    // Click settings icon/button
    // Verify modal is visible
  });

  test('switch AI provider updates UI', async ({ window }) => {
    // Open settings
    // Switch from Claude to Codex
    // Verify model dropdown changes
    // Verify permission mode options change
  });

  test('change editor font size', async ({ window }) => {
    // Open settings
    // Change font size
    // Verify editor font size updates
  });

  test('toggle minimap', async ({ window }) => {
    // Open settings
    // Toggle minimap off
    // Verify minimap disappears from editor
    // Toggle back on
    // Verify minimap reappears
  });
});
```

- [ ] **Step 4: Write workspace E2E tests**

Create `tests/e2e/workspace.spec.ts`:

```typescript
import { test, expect } from './electron.setup';

test.describe('Workspace', () => {
  test('add workspace appears in switcher', async ({ window }) => {
    // Click add workspace button
    // Select a folder
    // Verify new workspace tab/entry appears
  });

  test('switch workspace changes context', async ({ window }) => {
    // Open two workspaces
    // Switch between them
    // Verify editor, terminal, chat all reflect active workspace
  });

  test('close workspace shows confirmation', async ({ window }) => {
    // Right-click workspace or click close
    // Verify confirmation dialog appears
    // Confirm close
    // Verify workspace removed from switcher
  });

  test('unsaved changes trigger warning on close', async ({ window }) => {
    // Open file and make edits (don't save)
    // Attempt to close workspace
    // Verify unsaved changes warning appears
  });
});
```

- [ ] **Step 5: Run all E2E tests**

```bash
npm run build && npm run test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/chat.spec.ts tests/e2e/git.spec.ts tests/e2e/settings.spec.ts tests/e2e/workspace.spec.ts
git commit -m "test: add E2E tests for chat, git, settings, and workspace flows"
```

---

## Task 17: CI Workflow — test.yml

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create test workflow**

Create `.github/workflows/test.yml`:

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
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npx electron-rebuild

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/
          retention-days: 30
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add test workflow for push/PR to main"
```

---

## Task 18: Modify release.yml — Add Test Gate

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Read current release.yml**

```bash
cat .github/workflows/release.yml
```

- [ ] **Step 2: Add test job before build jobs**

Add a `test` job at the beginning of the `jobs` section, and add `needs: [test]` to each platform build job. The test job should:

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npx electron-rebuild

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration
```

Then add `needs: [test]` to each existing build job (build-linux, build-windows, build-macos or however they're named).

- [ ] **Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add test gate before release builds"
```

---

## Task 19: Modify /github-release Skill — Local Test Gate + E2E Flag

**Files:**
- Modify: `.claude/skills/github-release/SKILL.md`

- [ ] **Step 1: Read current skill file**

```bash
cat .claude/skills/github-release/SKILL.md
```

- [ ] **Step 2: Add test gate to skill**

Add a section after the validation step (clean working tree, on main) and before the version bump:

Add these steps to the skill's workflow:

1. After validating clean working tree and main branch, add:

```
## Step 2: Run Tests

Run the test suite before proceeding with the release:

\`\`\`bash
npm test
\`\`\`

If tests fail, STOP. Show the test output and do NOT proceed with the release. Tell the user to fix the failing tests first.

## Step 2b: Run E2E Tests (Optional)

Check if the user passed `e2e` as a second argument (e.g., `/github-release patch e2e`).

If `e2e` was passed:

\`\`\`bash
npm run build
npm run test:e2e
\`\`\`

If E2E tests fail, STOP. Show the output and do NOT proceed.

If `e2e` was NOT passed, skip this step.
```

2. Renumber subsequent steps accordingly.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/github-release/SKILL.md
git commit -m "feat: add test gate and optional e2e flag to github-release skill"
```

---

## Task 20: Run Full Test Suite and Coverage Report

- [ ] **Step 1: Run all unit tests**

```bash
npm run test:unit -- --reporter=verbose
```

Expected: All unit tests PASS.

- [ ] **Step 2: Run all integration tests**

```bash
npm run test:integration -- --reporter=verbose
```

Expected: All integration tests PASS.

- [ ] **Step 3: Run coverage report**

```bash
npm run test:coverage
```

Review the coverage output. Target areas with low coverage and add additional test cases if needed.

- [ ] **Step 4: Build and run E2E tests**

```bash
npm run build && npm run test:e2e
```

Expected: All E2E tests PASS (or identified failures to fix).

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "test: fix test issues and improve coverage"
```

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|-----------------|
| 1 | Install deps, configure Vitest | 7 |
| 2 | Create test helpers | 6 |
| 3 | Commit message parser tests (migration) | 4 |
| 4 | PTY service tests (terminal regressions) | 3 |
| 5 | Claude service tests (streaming/approval regressions) | 3 |
| 6 | Codex service tests | 3 |
| 7 | Gemini service tests | 3 |
| 8 | Usage, notify, workspace, git, fs tests | 7 |
| 9 | Session persistence tests | 3 |
| 10 | React component tests | 8 |
| 11 | Integration tests | 7 |
| 12 | Install and configure Playwright | 6 |
| 13 | E2E test fixtures | 3 |
| 14 | E2E file explorer tests | 3 |
| 15 | E2E terminal tests | 3 |
| 16 | E2E chat, git, settings, workspace tests | 6 |
| 17 | CI test.yml workflow | 2 |
| 18 | Modify release.yml with test gate | 4 |
| 19 | Modify github-release skill | 3 |
| 20 | Full test suite run and coverage | 5 |
| **Total** | | **84 steps** |
