import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { registerTerminalHandlers, destroyAllTerminals } from './services/pty';
import { registerClaudeHandlers, destroyClaude } from './services/claude';
import { registerGitHandlers } from './services/git';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0c0f11',
      symbolColor: '#bec6d0',
      height: 38,
    },
    backgroundColor: '#111418',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  registerTerminalHandlers(mainWindow);
  registerClaudeHandlers(mainWindow);
  registerGitHandlers();

  ipcMain.handle('project:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    return result.filePaths[0] || null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  destroyAllTerminals();
  destroyClaude();
  app.quit();
});
