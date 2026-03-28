import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vsai', {
  terminalCreate: (cwd: string) => ipcRenderer.invoke('terminal:create', cwd),
  terminalWrite: (id: number, data: string) => ipcRenderer.send('terminal:write', id, data),
  terminalResize: (id: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalOnData: (callback: (id: number, data: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: number, data: string) => callback(id, data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  claudeStart: (cwd: string) => ipcRenderer.invoke('claude:start', cwd),
  claudeSend: (message: string) => ipcRenderer.send('claude:send', message),
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
  selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  openRecentProject: (path: string) => ipcRenderer.invoke('project:openRecent', path),
});
