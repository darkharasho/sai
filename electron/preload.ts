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
  claudeSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string) => ipcRenderer.send('claude:send', projectPath, message, imagePaths, permMode, effort, model),
  claudeGenerateCommitMessage: (cwd: string) => ipcRenderer.invoke('claude:generateCommitMessage', cwd),
  claudeStop: (projectPath: string) => ipcRenderer.send('claude:stop', projectPath),
  claudeApprove: (projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string) =>
    ipcRenderer.send('claude:approve', projectPath, toolUseId, approved, modifiedCommand),
  claudeAlwaysAllow: (projectPath: string, toolPattern: string) =>
    ipcRenderer.invoke('claude:alwaysAllow', projectPath, toolPattern),
  // Codex CLI
  codexModels: () => ipcRenderer.invoke('codex:models'),
  codexStart: (cwd: string) => ipcRenderer.invoke('codex:start', cwd),
  codexSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, model?: string) => ipcRenderer.send('codex:send', projectPath, message, imagePaths, permMode, model),
  codexStop: (projectPath: string) => ipcRenderer.send('codex:stop', projectPath),
  // Gemini CLI
  geminiModels: () => ipcRenderer.invoke('gemini:models'),
  geminiStart: (cwd: string) => ipcRenderer.invoke('gemini:start', cwd),
  geminiSend: (projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string) => ipcRenderer.send('gemini:send', projectPath, message, imagePaths, approvalMode, conversationMode, model),
  geminiStop: (projectPath: string) => ipcRenderer.send('gemini:stop', projectPath),
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
  gitFetch: (cwd: string) => ipcRenderer.invoke('git:fetch', cwd),
  gitLog: (cwd: string, count: number) => ipcRenderer.invoke('git:log', cwd, count),
  gitBranches: (cwd: string) => ipcRenderer.invoke('git:branches', cwd),
  gitCheckout: (cwd: string, branchName: string) => ipcRenderer.invoke('git:checkout', cwd, branchName),
  gitCreateBranch: (cwd: string, branchName: string) => ipcRenderer.invoke('git:createBranch', cwd, branchName),
  gitDiff: (cwd: string, filepath: string, staged: boolean) =>
    ipcRenderer.invoke('git:diff', cwd, filepath, staged),
  gitDiscard: (cwd: string, filepath: string) => ipcRenderer.invoke('git:discard', cwd, filepath),
  fsReadDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  fsReadFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  fsMtime: (filePath: string) => ipcRenderer.invoke('fs:mtime', filePath),
  fsWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  fsRename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  fsDelete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  fsCreateFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  fsCreateDir: (dirPath: string) => ipcRenderer.invoke('fs:createDir', dirPath),
  fsCheckIgnored: (rootPath: string, paths: string[]) => ipcRenderer.invoke('fs:checkIgnored', rootPath, paths),
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
  workspaceGetAll: () => ipcRenderer.invoke('workspace:getAll'),
  workspaceClose: (projectPath: string) => ipcRenderer.invoke('workspace:close', projectPath),
  workspaceSuspend: (projectPath: string) => ipcRenderer.invoke('workspace:suspend', projectPath),
  onWorkspaceSuspended: (callback: (projectPath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, projectPath: string) => callback(projectPath);
    ipcRenderer.on('workspace:suspended', listener);
    return () => ipcRenderer.removeListener('workspace:suspended', listener);
  },
  saveImage: (base64Data: string) => ipcRenderer.invoke('project:saveImage', base64Data),
  settingsGet: (key: string, defaultValue?: any) => ipcRenderer.invoke('settings:get', key, defaultValue),
  settingsSet: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  getCwd: () => ipcRenderer.invoke('project:getCwd'),
  selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  openRecentProject: (path: string) => ipcRenderer.invoke('project:openRecent', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  // Usage API polling
  usageFetch: () => ipcRenderer.invoke('usage:fetch'),
  onUsageUpdate: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('usage:update', listener);
    return () => ipcRenderer.removeListener('usage:update', listener);
  },
  // GitHub OAuth
  githubGetUser: () => ipcRenderer.invoke('github:getUser'),
  githubStartAuth: () => ipcRenderer.invoke('github:startAuth'),
  githubCancelAuth: () => ipcRenderer.invoke('github:cancelAuth'),
  githubLogout: () => ipcRenderer.invoke('github:logout'),
  githubOnAuthComplete: (callback: (user: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, user: any) => callback(user);
    ipcRenderer.on('github:authComplete', listener);
    return () => ipcRenderer.removeListener('github:authComplete', listener);
  },
  githubOnAuthError: (callback: (error: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('github:authError', listener);
    return () => ipcRenderer.removeListener('github:authError', listener);
  },
  githubSyncNow: () => ipcRenderer.invoke('github:syncNow'),
  githubOnSyncStatus: (callback: (status: { status: string; lastSynced?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('github:syncStatus', listener);
    return () => ipcRenderer.removeListener('github:syncStatus', listener);
  },
  githubOnSettingsApplied: (callback: (settings: Record<string, any>) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: any) => callback(settings);
    ipcRenderer.on('github:settingsApplied', listener);
    return () => ipcRenderer.removeListener('github:settingsApplied', listener);
  },
});
