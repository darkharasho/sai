/**
 * E2E test setup — runs against the Vite dev server in a regular browser.
 *
 * NOTE: Playwright's Electron launch support is broken with Electron 33
 * (require('electron').app is undefined in the -r preload context).
 * Instead, we test the renderer via a regular Chromium browser pointing
 * at the Vite dev server. This covers all UI interactions. Electron-specific
 * features (native menus, file dialogs) are tested via unit/integration tests.
 *
 * Since window.sai (the Electron preload bridge) doesn't exist in a browser,
 * we inject a mock before the page loads.
 */

import { test as base, expect, Page } from '@playwright/test';
import path from 'path';

const FIXTURE_PROJECT = path.resolve(__dirname, 'fixtures/test-project');

export const test = base.extend<{ window: Page }>({
  window: async ({ page }, use) => {
    // Inject window.sai mock before any page script runs
    await page.addInitScript((fixturePath: string) => {
      const noop = () => () => {};
      (window as any).sai = {
        // Platform property (not a function) — used by TitleBar for layout
        platform: 'linux',
        // Core navigation — return fixture project as CWD
        getCwd: () => Promise.resolve(fixturePath),
        getRecentProjects: () => Promise.resolve([fixturePath]),
        selectFolder: () => Promise.resolve(null),
        selectFile: () => Promise.resolve(null),
        openRecentProject: () => {},
        // Settings — return sensible defaults so the app initializes properly
        settingsGet: (_key: string, defaultVal?: any) => Promise.resolve(defaultVal ?? null),
        settingsSet: () => Promise.resolve(),
        // Claude
        claudeStart: () => Promise.resolve({ slashCommands: ['/help', '/clear', '/compact'] }),
        claudeSend: () => {},
        claudeStop: () => {},
        claudeSetSessionId: () => {},
        claudeApprove: () => Promise.resolve(),
        claudeAlwaysAllow: () => Promise.resolve(),
        claudeGenerateCommitMessage: () => Promise.resolve('fix: test'),
        claudeOnMessage: (_cb: any) => noop(),
        // Codex
        codexModels: () => Promise.resolve({ models: [], defaultModel: '' }),
        codexStart: () => Promise.resolve({ message: 'ready' }),
        codexSend: () => {},
        codexStop: () => {},
        codexOnMessage: (_cb: any) => noop(),
        // Gemini
        geminiModels: () => Promise.resolve({ models: [], defaultModel: 'auto-gemini-3' }),
        geminiStart: () => Promise.resolve({ message: 'ready' }),
        geminiSend: () => {},
        geminiStop: () => {},
        geminiSetSessionId: () => {},
        codexSetSessionId: () => {},
        geminiOnMessage: (_cb: any) => noop(),
        // Terminal
        terminalCreate: () => Promise.resolve(1),
        terminalWrite: () => {},
        terminalResize: () => {},
        terminalOnData: (_cb: any) => noop(),
        // Git
        gitStatus: () => Promise.resolve({ branch: 'main', staged: [], modified: [], created: [], deleted: [], not_added: [], ahead: 0, behind: 0 }),
        gitStage: () => Promise.resolve(),
        gitUnstage: () => Promise.resolve(),
        gitCommit: () => Promise.resolve(),
        gitPush: () => Promise.resolve(),
        gitPull: () => Promise.resolve(),
        gitFetch: () => Promise.resolve(),
        gitLog: () => Promise.resolve([]),
        gitBranches: () => Promise.resolve([]),
        gitCheckout: () => Promise.resolve(),
        gitCreateBranch: () => Promise.resolve(),
        gitDiff: () => Promise.resolve(''),
        gitDiscard: () => Promise.resolve(),
        // FS
        fsReadDir: () => Promise.resolve([
          { name: 'src', path: fixturePath + '/src', type: 'directory' },
          { name: 'package.json', path: fixturePath + '/package.json', type: 'file' },
          { name: 'README.md', path: fixturePath + '/README.md', type: 'file' },
        ]),
        fsReadFile: () => Promise.resolve('// test content'),
        fsMtime: () => Promise.resolve({ mtime: Date.now() }),
        fsWriteFile: () => Promise.resolve(),
        fsRename: () => Promise.resolve(),
        fsDelete: () => Promise.resolve(),
        fsCreateFile: () => Promise.resolve(),
        fsCreateDir: () => Promise.resolve(),
        fsCheckIgnored: () => Promise.resolve([]),
        fsWalkFiles: () => Promise.resolve([]),
        // Workspace
        workspaceSetActive: () => {},
        workspaceGetAll: () => Promise.resolve([{ projectPath: fixturePath, status: 'active', lastActivity: Date.now() }]),
        workspaceClose: () => Promise.resolve(),
        workspaceSuspend: () => Promise.resolve(),
        onWorkspaceSuspended: (_cb: any) => noop(),
        // Usage
        usageFetch: () => Promise.resolve(null),
        usageMode: () => Promise.resolve('api'),
        onUsageUpdate: (_cb: any) => noop(),
        // Updater
        updateCheck: () => Promise.resolve(),
        updateInstall: () => {},
        updateGetVersion: () => Promise.resolve('0.3.17'),
        onUpdateStatus: (_cb: any) => noop(),
        onUpdateAvailable: (_cb: any) => noop(),
        onUpdateProgress: (_cb: any) => noop(),
        onUpdateDownloaded: (_cb: any) => noop(),
        onUpdateError: (_cb: any) => noop(),
        setBadgeCount: () => {},
        // GitHub — provide a mock user so Settings is accessible via the user dropdown
        githubGetUser: () => Promise.resolve({ login: 'test-user', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Test User' }),
        githubStartAuth: () => {},
        githubCancelAuth: () => {},
        githubLogout: () => Promise.resolve(),
        githubOnAuthComplete: (_cb: any) => noop(),
        githubOnAuthError: (_cb: any) => noop(),
        githubSyncNow: () => Promise.resolve(),
        githubOnSyncStatus: (_cb: any) => noop(),
        githubOnSettingsApplied: (_cb: any) => noop(),
        // Project
        saveImage: () => Promise.resolve('/tmp/test.png'),
      };
    }, FIXTURE_PROJECT);

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the app to fully render — project selector appears once getCwd resolves
    // and the workspace is initialized
    await page.waitForSelector('.project-selector', { timeout: 15000 });
    // Small extra wait for any remaining async initialization
    await page.waitForTimeout(1000);
    await use(page);
  },
});

export { expect } from '@playwright/test';
