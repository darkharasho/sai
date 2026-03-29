import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export function registerUpdater(mainWindow: BrowserWindow) {
  // Always register getVersion — it works regardless of update capability
  ipcMain.handle('update:getVersion', () => {
    return process.env.VITE_DEV_SERVER_URL ? 'DEV' : app.getVersion();
  });

  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  const canAutoUpdate = app.isPackaged && !isPortable && fs.existsSync(updateConfigPath);

  if (!canAutoUpdate) {
    // Register no-op handlers so the renderer doesn't hang
    ipcMain.on('update:check', () => {});
    ipcMain.on('update:install', () => {});
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // On Linux, only AppImage supports auto-update
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    autoUpdater.autoDownload = false;
  }

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:status', 'checking');
  });

  autoUpdater.on('update-available', (info: any) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update:status', 'up-to-date');
  });

  autoUpdater.on('download-progress', (progress: any) => {
    mainWindow.webContents.send('update:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    mainWindow.webContents.send('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err: any) => {
    mainWindow.webContents.send('update:error', {
      message: err?.message ?? 'Unknown update error',
    });
  });

  ipcMain.on('update:check', () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });

  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  // Check after 3 second delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}
