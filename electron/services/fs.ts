import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function registerFsHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      title: 'Confirm Delete',
      message: `Delete "${path.basename(targetPath)}"?`,
      detail: 'This action cannot be undone.',
    });
    if (result.response === 0) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    }
    return false;
  });

  ipcMain.handle('fs:createFile', async (_event, filePath: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf-8');
  });

  ipcMain.handle('fs:createDir', async (_event, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });
}
