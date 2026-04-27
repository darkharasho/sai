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
 * we inject a mock before the page loads. Per-test overrides are supported
 * via the `saiMock` fixture option (see SaiMockOverrides below).
 */

import { test as base, expect, Page } from '@playwright/test';
import path from 'path';

const FIXTURE_PROJECT = path.resolve(__dirname, 'fixtures/test-project');

/**
 * Build the default window.sai mock. Returns a fresh object on every call so
 * tests cannot mutate each other's state.
 */
export function buildDefaultSaiMock(fixturePath: string): Record<string, any> {
  const noop = () => () => {};
  return {
    platform: 'linux',
    getCwd: () => Promise.resolve(fixturePath),
    getRecentProjects: () => Promise.resolve([fixturePath]),
    selectFolder: () => Promise.resolve(null),
    selectFile: () => Promise.resolve(null),
    openRecentProject: () => {},
    settingsGet: (key: string, defaultVal?: any) => {
      // Suppress the What's New modal in tests by pretending the user has already
      // seen the current version. Tests that need to assert What's New behavior
      // can override settingsGet via the saiMock fixture.
      if (key === 'lastSeenVersion') return Promise.resolve('0.8.34');
      return Promise.resolve(defaultVal ?? null);
    },
    settingsSet: () => Promise.resolve(),
    claudeStart: () => Promise.resolve({ slashCommands: ['/help', '/clear', '/compact'] }),
    claudeSend: () => {},
    claudeStop: () => {},
    claudeSetSessionId: () => {},
    claudeApprove: () => Promise.resolve(),
    claudeAlwaysAllow: () => Promise.resolve(),
    claudeGenerateCommitMessage: () => Promise.resolve('fix: test'),
    claudeOnMessage: (_cb: any) => noop(),
    codexModels: () => Promise.resolve({ models: [], defaultModel: '' }),
    codexStart: () => Promise.resolve({ message: 'ready' }),
    codexSend: () => {},
    codexStop: () => {},
    codexOnMessage: (_cb: any) => noop(),
    geminiModels: () => Promise.resolve({ models: [], defaultModel: 'auto-gemini-3' }),
    geminiStart: () => Promise.resolve({ message: 'ready' }),
    geminiSend: () => {},
    geminiStop: () => {},
    geminiSetSessionId: () => {},
    codexSetSessionId: () => {},
    geminiOnMessage: (_cb: any) => noop(),
    terminalCreate: () => Promise.resolve(1),
    terminalWrite: () => {},
    terminalResize: () => {},
    terminalOnData: (_cb: any) => noop(),
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
    workspaceSetActive: () => {},
    workspaceGetAll: () => Promise.resolve([{ projectPath: fixturePath, status: 'active', lastActivity: Date.now() }]),
    workspaceClose: () => Promise.resolve(),
    workspaceSuspend: () => Promise.resolve(),
    onWorkspaceSuspended: (_cb: any) => noop(),
    usageFetch: () => Promise.resolve(null),
    usageMode: () => Promise.resolve('api'),
    onUsageUpdate: (_cb: any) => noop(),
    updateCheck: () => Promise.resolve(),
    updateInstall: () => {},
    updateGetVersion: () => Promise.resolve('0.3.17'),
    onUpdateStatus: (_cb: any) => noop(),
    onUpdateAvailable: (_cb: any) => noop(),
    onUpdateProgress: (_cb: any) => noop(),
    onUpdateDownloaded: (_cb: any) => noop(),
    onUpdateError: (_cb: any) => noop(),
    setBadgeCount: () => {},
    githubGetUser: () => Promise.resolve({ login: 'test-user', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Test User' }),
    githubStartAuth: () => {},
    githubCancelAuth: () => {},
    githubLogout: () => Promise.resolve(),
    githubOnAuthComplete: (_cb: any) => noop(),
    githubOnAuthError: (_cb: any) => noop(),
    githubSyncNow: () => Promise.resolve(),
    githubOnSyncStatus: (_cb: any) => noop(),
    githubOnSettingsApplied: (_cb: any) => noop(),
    saveImage: () => Promise.resolve('/tmp/test.png'),
  };
}

/**
 * Per-test mock overrides. Pass via `test.use({ saiMock: { ... } })`.
 * Values are shallow-merged onto the default mock at page-init time.
 */
export type SaiMockOverrides = Record<string, any>;

export const test = base.extend<{ window: Page; saiMock: SaiMockOverrides }>({
  saiMock: [{}, { option: true }],
  window: async ({ page, saiMock }, use) => {
    await page.addInitScript(
      ({ fixturePath, overrides }: { fixturePath: string; overrides: Record<string, string> }) => {
        const noop = () => () => {};
        // NOTE: This object is a deliberate duplicate of buildDefaultSaiMock() above.
        // The structured-clone boundary prevents passing live functions across addInitScript,
        // so the default mock must be inlined here. If you add or remove a key in
        // buildDefaultSaiMock(), you MUST make the same change here.
        const base: Record<string, any> = {
          platform: 'linux',
          getCwd: () => Promise.resolve(fixturePath),
          getRecentProjects: () => Promise.resolve([fixturePath]),
          selectFolder: () => Promise.resolve(null),
          selectFile: () => Promise.resolve(null),
          openRecentProject: () => {},
          settingsGet: (key: string, defaultVal?: any) => {
            // Suppress the What's New modal in tests by pretending the user has already
            // seen the current version. Tests that need to assert What's New behavior
            // can override settingsGet via the saiMock fixture.
            if (key === 'lastSeenVersion') return Promise.resolve('0.8.34');
            return Promise.resolve(defaultVal ?? null);
          },
          settingsSet: () => Promise.resolve(),
          claudeStart: () => Promise.resolve({ slashCommands: ['/help', '/clear', '/compact'] }),
          claudeSend: () => {},
          claudeStop: () => {},
          claudeSetSessionId: () => {},
          claudeApprove: () => Promise.resolve(),
          claudeAlwaysAllow: () => Promise.resolve(),
          claudeGenerateCommitMessage: () => Promise.resolve('fix: test'),
          claudeOnMessage: (_cb: any) => noop(),
          codexModels: () => Promise.resolve({ models: [], defaultModel: '' }),
          codexStart: () => Promise.resolve({ message: 'ready' }),
          codexSend: () => {},
          codexStop: () => {},
          codexOnMessage: (_cb: any) => noop(),
          geminiModels: () => Promise.resolve({ models: [], defaultModel: 'auto-gemini-3' }),
          geminiStart: () => Promise.resolve({ message: 'ready' }),
          geminiSend: () => {},
          geminiStop: () => {},
          geminiSetSessionId: () => {},
          codexSetSessionId: () => {},
          geminiOnMessage: (_cb: any) => noop(),
          terminalCreate: () => Promise.resolve(1),
          terminalWrite: () => {},
          terminalResize: () => {},
          terminalOnData: (_cb: any) => noop(),
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
          workspaceSetActive: () => {},
          workspaceGetAll: () => Promise.resolve([{ projectPath: fixturePath, status: 'active', lastActivity: Date.now() }]),
          workspaceClose: () => Promise.resolve(),
          workspaceSuspend: () => Promise.resolve(),
          onWorkspaceSuspended: (_cb: any) => noop(),
          usageFetch: () => Promise.resolve(null),
          usageMode: () => Promise.resolve('api'),
          onUsageUpdate: (_cb: any) => noop(),
          updateCheck: () => Promise.resolve(),
          updateInstall: () => {},
          updateGetVersion: () => Promise.resolve('0.3.17'),
          onUpdateStatus: (_cb: any) => noop(),
          onUpdateAvailable: (_cb: any) => noop(),
          onUpdateProgress: (_cb: any) => noop(),
          onUpdateDownloaded: (_cb: any) => noop(),
          onUpdateError: (_cb: any) => noop(),
          setBadgeCount: () => {},
          githubGetUser: () => Promise.resolve({ login: 'test-user', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Test User' }),
          githubStartAuth: () => {},
          githubCancelAuth: () => {},
          githubLogout: () => Promise.resolve(),
          githubOnAuthComplete: (_cb: any) => noop(),
          githubOnAuthError: (_cb: any) => noop(),
          githubSyncNow: () => Promise.resolve(),
          githubOnSyncStatus: (_cb: any) => noop(),
          githubOnSettingsApplied: (_cb: any) => noop(),
          saveImage: () => Promise.resolve('/tmp/test.png'),
        };
        // Apply overrides — each value is a function source string we eval back into a function.
        for (const [key, fnSource] of Object.entries(overrides)) {
          // eslint-disable-next-line no-new-func
          base[key] = new Function('return (' + fnSource + ')')();
        }
        (window as any).sai = base;
        // Expose helper to fire saved event-listener callbacks from tests.
        (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      },
      {
        fixturePath: FIXTURE_PROJECT,
        // Serialize each override function to source so it survives the structured-clone boundary.
        overrides: Object.fromEntries(
          Object.entries(saiMock).map(([k, v]) => [k, typeof v === 'function' ? v.toString() : `() => (${JSON.stringify(v)})`])
        ),
      }
    );

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.project-selector', { timeout: 15000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';
