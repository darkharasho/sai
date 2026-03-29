import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sai', {
  terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),
  terminalWrite: (id: number, data: string) => ipcRenderer.send('terminal:write', id, data),
  terminalResize: (id: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalOnData: (callback: (id: number, data: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: number, data: string) => callback(id, data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  claudeStart: (cwd: string) => ipcRenderer.invoke('claude:start', cwd),
  claudeSend: (message: string, imagePaths?: string[], permMode?: string) => ipcRenderer.send('claude:send', message, imagePaths, permMode),
  claudeStop: () => ipcRenderer.send('claude:stop'),
  claudeApprove: (approved: boolean) => ipcRenderer.send('claude:approve', approved),
  claudeOnMessage: (callback: (msg: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: unknown) => callback(msg);
    ipcRenderer.on('claude:message', listener);
    return () => ipcRenderer.removeListener('claude:message', listener);
  },
  gitStatus: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
  gitStage: (cwd: string, filepath: string) => ipcRenderer.invoke('git:stage', cwd, filepath),
  gitUnstage: (cwd: string, filepath: string) => ipcRenderer.invoke('git:unstage', cwd, filepath),
  gitCommit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
  gitPush: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
  gitPull: (cwd: string) => ipcRenderer.invoke('git:pull', cwd),
  gitLog: (cwd: string, count: number) => ipcRenderer.invoke('git:log', cwd, count),
  gitDiff: (cwd: string, filepath: string, staged: boolean) =>
    ipcRenderer.invoke('git:diff', cwd, filepath, staged),
  fsReadDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  fsReadFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  fsWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  fsRename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  fsDelete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  fsCreateFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  fsCreateDir: (dirPath: string) => ipcRenderer.invoke('fs:createDir', dirPath),
  // Auto-updater
  updateCheck: () => ipcRenderer.send('update:check'),
  updateInstall: () => ipcRenderer.send('update:install'),
  updateGetVersion: () => ipcRenderer.invoke('update:getVersion'),
  onUpdateStatus: (callback: (status: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  onUpdateAvailable: (callback: (info: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  onUpdateProgress: (callback: (progress: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update:downloaded', listener);
    return () => ipcRenderer.removeListener('update:downloaded', listener);
  },
  onUpdateError: (callback: (err: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, err: any) => callback(err);
    ipcRenderer.on('update:error', listener);
    return () => ipcRenderer.removeListener('update:error', listener);
  },
  saveImage: (base64Data: string) => ipcRenderer.invoke('project:saveImage', base64Data),
  selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  openRecentProject: (path: string) => ipcRenderer.invoke('project:openRecent', path),
});
