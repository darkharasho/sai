import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerTerminalHandlers, destroyAllTerminals } from './services/pty';
import { registerClaudeHandlers } from './services/claude';
import { registerGitHandlers } from './services/git';
import { registerFsHandlers } from './services/fs';
import { registerUpdater } from './services/updater';
import { registerUsageHandlers, destroyUsagePolling } from './services/usage';
import { destroyAll, startSuspendTimer, stopSuspendTimer, getAll, remove, suspend, DEFAULT_SUSPEND_TIMEOUT } from './services/workspace';
import { initFocusTracking, setActiveWorkspace } from './services/notify';
import { registerGithubAuthHandlers } from './services/github-auth';
import { initialSync, schedulePush } from './services/github-sync';
import { registerCodexHandlers } from './services/codex';
import { registerGeminiHandlers } from './services/gemini';

// Allow E2E tests to isolate userData
if (process.env.SAI_USER_DATA_DIR) {
  app.setPath('userData', process.env.SAI_USER_DATA_DIR);
}

let mainWindow: BrowserWindow | null = null;

const THEME_TITLEBAR: Record<string, { color: string; symbolColor: string; bg: string }> = {
  default:  { color: '#0c0f11', symbolColor: '#bec6d0', bg: '#111418' },
  midnight: { color: '#131316', symbolColor: '#c8c8d0', bg: '#1a1a1e' },
  steel:    { color: '#2c2d33', symbolColor: '#d5d5dc', bg: '#36373e' },
};

function createWindow() {
  let tb = THEME_TITLEBAR.default;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf-8'));
    if (s.theme && THEME_TITLEBAR[s.theme]) tb = THEME_TITLEBAR[s.theme];
  } catch { /* use default */ }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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

  initFocusTracking(mainWindow);
  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false);
  });

  // Right-click context menu with spelling suggestions
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => mainWindow!.webContents.replaceMisspelling(suggestion),
        }));
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({
        label: 'Add to dictionary',
        click: () => mainWindow!.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }));
    }
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  mainWindow.on('close', () => {
    stopSuspendTimer();
    destroyAllTerminals();
    destroyAll(mainWindow!);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  registerTerminalHandlers(mainWindow);
  registerClaudeHandlers(mainWindow);
  registerCodexHandlers(mainWindow);
  registerGeminiHandlers(mainWindow);
  registerGitHandlers();
  registerFsHandlers(mainWindow!);
  registerUpdater(mainWindow!);
  registerUsageHandlers(mainWindow!);
  startSuspendTimer(mainWindow, () => {
    const s = readSettings();
    return typeof s.suspendTimeout === 'number' ? s.suspendTimeout : DEFAULT_SUSPEND_TIMEOUT;
  });

  ipcMain.on('app:setBadgeCount', (_event, count: number) => {
    app.setBadgeCount(count);
  });

  ipcMain.on('workspace:setActive', (_event, projectPath: string) => {
    setActiveWorkspace(projectPath || '');
  });

  ipcMain.handle('workspace:getAll', () => {
    const active = getAll().filter(w => w.projectPath);
    const recent = getRecentProjects();
    const activeSet = new Set(active.map(w => w.projectPath));
    const recentOnly = recent
      .filter(p => p && !activeSet.has(p))
      .map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 }));
    return [...active, ...recentOnly];
  });

  ipcMain.handle('workspace:close', (_event, projectPath: string) => {
    remove(projectPath, mainWindow!);
  });

  ipcMain.handle('workspace:suspend', (_event, projectPath: string) => {
    suspend(projectPath, mainWindow!);
  });

  // Settings persistence (works across dev/prod)
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');

  function readSettings(): Record<string, any> {
    try {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  function getAuthInfo(): { token: string; login: string } | null {
    const auth = readSettings().github_auth;
    if (!auth?.token || !auth?.user?.login) return null;
    return { token: auth.token, login: auth.user.login };
  }

  function writeSetting(key: string, value: any) {
    const settings = readSettings();
    settings[key] = value;
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    // Schedule a push to GitHub if authed (skip for auth key itself)
    if (key !== 'github_auth') {
      const auth = getAuthInfo();
      if (auth) schedulePush(auth.token, auth.login, readSettings, mainWindow!);
    }
  }

  ipcMain.handle('settings:get', (_event, key: string, defaultValue?: any) => {
    const settings = readSettings();
    return key in settings ? settings[key] : defaultValue;
  });

  ipcMain.handle('settings:set', (_event, key: string, value: any) => {
    writeSetting(key, value);
  });

  ipcMain.handle('titlebar:setOverlay', (_event, color: string, symbolColor: string) => {
    if (mainWindow) {
      mainWindow.setTitleBarOverlay({ color, symbolColor, height: 38 });
    }
  });

  ipcMain.handle('github:syncNow', async () => {
    const auth = getAuthInfo();
    if (!auth) return;
    await initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
  });

  registerGithubAuthHandlers(mainWindow, readSettings, writeSetting, () => {
    // Called after successful auth — run initial sync
    const auth = getAuthInfo();
    if (auth) initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
  });

  // Run sync on startup if already authenticated.
  // Delay briefly so the renderer has time to mount and subscribe to IPC events.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const auth = getAuthInfo();
      if (auth) initialSync(auth.token, auth.login, readSettings, writeSetting, mainWindow!);
    }, 1500);
  });

  // Recent projects persistence
  const recentProjectsFile = path.join(app.getPath('userData'), 'recent-projects.json');

  function getRecentProjects(): string[] {
    try {
      return JSON.parse(fs.readFileSync(recentProjectsFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  function addRecentProject(projectPath: string) {
    const recent = getRecentProjects().filter(p => p !== projectPath);
    recent.unshift(projectPath);
    fs.writeFileSync(recentProjectsFile, JSON.stringify(recent.slice(0, 10)));
  }

  ipcMain.handle('project:saveImage', async (_event, base64Data: string) => {
    const tmpDir = path.join(app.getPath('temp'), 'sai-images');
    fs.mkdirSync(tmpDir, { recursive: true });
    // Strip data URL prefix
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = matches?.[1] || 'png';
    const data = matches?.[2] || base64Data;
    const filename = `image-${Date.now()}.${ext}`;
    const filepath = path.join(tmpDir, filename);
    fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
    return filepath;
  });

  ipcMain.handle('project:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    const folder = result.filePaths[0] || null;
    if (folder) addRecentProject(folder);
    return folder;
  });

  ipcMain.handle('project:selectFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      title: 'Select File',
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('project:getRecent', () => getRecentProjects());
  ipcMain.handle('project:getCwd', () => {
    const recent = getRecentProjects();
    if (recent.length > 0 && fs.existsSync(recent[0])) {
      return recent[0];
    }
    return null;
  });

  ipcMain.handle('project:openRecent', (_event, projectPath: string) => {
    addRecentProject(projectPath);
    return projectPath;
  });

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      return shell.openExternal(url);
    }
  });
}

// Suppress EPIPE errors from writing to closed streams (e.g. killed child processes)
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('Uncaught exception:', err);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  stopSuspendTimer();
  destroyUsagePolling();
  destroyAllTerminals();
  if (mainWindow) destroyAll(mainWindow);
  app.quit();
});
