import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sai', {
  platform: process.platform,
  terminalCreate: (cwd: string, cols?: number, rows?: number) => ipcRenderer.invoke('terminal:create', cwd, cols, rows),
  terminalWrite: (id: number, data: string) => ipcRenderer.send('terminal:write', id, data),
  terminalResize: (id: number, cols: number, rows: number) => ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalGetProcess: (id: number) => ipcRenderer.invoke('terminal:getProcess', id),
  terminalGetCwd: (id: number) => ipcRenderer.invoke('terminal:getCwd', id),
  terminalIsAwaitingInput: (id: number) => ipcRenderer.invoke('terminal:isAwaitingInput', id),
  terminalTabComplete: (text: string, cwd: string) => ipcRenderer.invoke('terminal:tabComplete', text, cwd),
  terminalSignal: (id: number, signal: string) => ipcRenderer.send('terminal:signal', id, signal),
  terminalKill: (id: number) => ipcRenderer.send('terminal:kill', id),
  terminalGetShellHistory: (count: number) => ipcRenderer.invoke('terminal:getShellHistory', count),
  terminalOnData: (callback: (id: number, data: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: number, data: string) => callback(id, data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  claudeStart: (cwd: string, scope?: string, kind?: string, orchestratorContext?: any, scopeCwd?: string, metaPreamble?: string) =>
    ipcRenderer.invoke('claude:start', cwd, scope, kind, orchestratorContext, scopeCwd, metaPreamble),
  claudeSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) => ipcRenderer.send('claude:send', projectPath, message, imagePaths, permMode, effort, model, scope),
  claudeGenerateCommitMessage: (cwd: string, aiProvider?: string) => ipcRenderer.invoke('claude:generateCommitMessage', cwd, aiProvider),
  claudeGenerateTitle: (cwd: string, userMessage: string, aiProvider?: string) => ipcRenderer.invoke('claude:generateTitle', cwd, userMessage, aiProvider),
  claudeCompact: (projectPath: string, permMode?: string, effort?: string, model?: string, scope?: string) => ipcRenderer.send('claude:compact', projectPath, permMode, effort, model, scope),
  claudeStop: (projectPath: string, scope?: string) => ipcRenderer.send('claude:stop', projectPath, scope),
  claudeSetSessionId: (projectPath: string, sessionId: string | undefined, scope?: string) => ipcRenderer.send('claude:setSessionId', projectPath, sessionId, scope),
  claudeApprove: (projectPath: string, toolUseId: string, approved: boolean, modifiedCommand?: string, scope?: string) =>
    ipcRenderer.invoke('claude:approve', projectPath, toolUseId, approved, modifiedCommand, scope),
  claudeAnswerQuestion: (projectPath: string, toolUseId: string, answers: Record<string, string | string[]>, scope?: string) =>
    ipcRenderer.invoke('claude:answer-question', projectPath, toolUseId, answers, scope),
  remoteEmitWorkspaceStatus: (projectPath: string, status: { busy: boolean; streaming: boolean; completed: boolean; approval: boolean; streamingSessionId?: string | null }) =>
    ipcRenderer.invoke('remote:emit-workspace-status', projectPath, status),
  claudeAlwaysAllow: (projectPath: string, toolPattern: string) =>
    ipcRenderer.invoke('claude:alwaysAllow', projectPath, toolPattern),
  // Codex CLI
  codexModels: () => ipcRenderer.invoke('codex:models'),
  codexStart: (cwd: string, metaPreamble?: string) => ipcRenderer.invoke('codex:start', cwd, metaPreamble),
  codexSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, model?: string) => ipcRenderer.send('codex:send', projectPath, message, imagePaths, permMode, model),
  codexStop: (projectPath: string) => ipcRenderer.send('codex:stop', projectPath),
  codexSetSessionId: (projectPath: string, sessionId: string | undefined) => ipcRenderer.send('codex:setSessionId', projectPath, sessionId),
  // Gemini CLI
  geminiModels: () => ipcRenderer.invoke('gemini:models'),
  geminiStart: (cwd: string, metaPreamble?: string) => ipcRenderer.invoke('gemini:start', cwd, metaPreamble),
  geminiSend: (projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string, scope?: string) =>
    ipcRenderer.send('gemini:send', projectPath, message, imagePaths, approvalMode, conversationMode, model, scope),
  geminiStop: (projectPath: string, scope?: string) => ipcRenderer.send('gemini:stop', projectPath, scope),
  geminiSetSessionId: (projectPath: string, sessionId: string | undefined, scope?: string) =>
    ipcRenderer.send('gemini:setSessionId', projectPath, sessionId, scope),
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
  gitCommitDetails: (cwd: string, hash: string) => ipcRenderer.invoke('git:commitDetails', cwd, hash),
  gitBranches: (cwd: string) => ipcRenderer.invoke('git:branches', cwd),
  gitCheckout: (cwd: string, branchName: string) => ipcRenderer.invoke('git:checkout', cwd, branchName),
  gitCreateBranch: (cwd: string, branchName: string) => ipcRenderer.invoke('git:createBranch', cwd, branchName),
  gitDiff: (cwd: string, filepath: string, staged: boolean) =>
    ipcRenderer.invoke('git:diff', cwd, filepath, staged),
  gitShow: (cwd: string, filepath: string, ref: string) =>
    ipcRenderer.invoke('git:show', cwd, filepath, ref),
  gitDiffLines: (cwd: string, filepath: string) =>
    ipcRenderer.invoke('git:diffLines', cwd, filepath),
  gitDiscard: (cwd: string, filepath: string) => ipcRenderer.invoke('git:discard', cwd, filepath),
  gitStashList: (cwd: string) => ipcRenderer.invoke('git:stashList', cwd),
  gitStash: (cwd: string, message?: string) => ipcRenderer.invoke('git:stash', cwd, message),
  gitStashPop: (cwd: string, index: number) => ipcRenderer.invoke('git:stashPop', cwd, index),
  gitStashApply: (cwd: string, index: number) => ipcRenderer.invoke('git:stashApply', cwd, index),
  gitStashDrop: (cwd: string, index: number) => ipcRenderer.invoke('git:stashDrop', cwd, index),
  gitRebaseStatus: (cwd: string) => ipcRenderer.invoke('git:rebaseStatus', cwd),
  gitRebase: (cwd: string, branch: string) => ipcRenderer.invoke('git:rebase', cwd, branch),
  gitRebaseAbort: (cwd: string) => ipcRenderer.invoke('git:rebaseAbort', cwd),
  gitRebaseContinue: (cwd: string) => ipcRenderer.invoke('git:rebaseContinue', cwd),
  gitRebaseSkip: (cwd: string) => ipcRenderer.invoke('git:rebaseSkip', cwd),
  gitConflictFiles: (cwd: string) => ipcRenderer.invoke('git:conflictFiles', cwd),
  gitConflictHunks: (cwd: string, filepath: string) => ipcRenderer.invoke('git:conflictHunks', cwd, filepath),
  gitResolveConflict: (cwd: string, filepath: string, resolution: 'ours' | 'theirs' | 'both') =>
    ipcRenderer.invoke('git:resolveConflict', cwd, filepath, resolution),
  gitResolveAllConflicts: (cwd: string, resolution: 'ours' | 'theirs') =>
    ipcRenderer.invoke('git:resolveAllConflicts', cwd, resolution),
  fsReadDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  fsReadFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  fsReadFileBase64: (filePath: string) => ipcRenderer.invoke('fs:readFileBase64', filePath),
  fsMtime: (filePath: string) => ipcRenderer.invoke('fs:mtime', filePath),
  fsWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  fsRename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  fsDelete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
  fsCreateFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  fsCreateDir: (dirPath: string) => ipcRenderer.invoke('fs:createDir', dirPath),
  fsCheckIgnored: (rootPath: string, paths: string[]) => ipcRenderer.invoke('fs:checkIgnored', rootPath, paths),
  fsWalkFiles: (rootPath: string) => ipcRenderer.invoke('fs:walkFiles', rootPath),
  fsGrep: (rootPath: string, query: string, maxResults?: number) => ipcRenderer.invoke('fs:grep', rootPath, query, maxResults),
  searchRun: (args: {
    rootPath: string;
    query: import('../src/types').SearchQuery;
    openBuffers: { path: string; content: string }[];
  }) => ipcRenderer.invoke('search:run', args),
  searchReplaceFile: (args: { filePath: string; edits: { line: number; column: number; length: number; replacement: string }[] }) =>
    ipcRenderer.invoke('search:replaceFile', args),
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
  workspaceSetActive: (projectPath: string) => ipcRenderer.send('workspace:setActive', projectPath),
  workspaceGetAll: () => ipcRenderer.invoke('workspace:getAll'),
  workspaceClose: (projectPath: string) => ipcRenderer.invoke('workspace:close', projectPath),
  workspaceSuspend: (projectPath: string) => ipcRenderer.invoke('workspace:suspend', projectPath),
  onWorkspaceSuspended: (callback: (projectPath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, projectPath: string) => callback(projectPath);
    ipcRenderer.on('workspace:suspended', listener);
    return () => ipcRenderer.removeListener('workspace:suspended', listener);
  },
  metaWorkspaceList: () => ipcRenderer.invoke('metaWorkspace:list'),
  metaWorkspaceCreate: (input: any) => ipcRenderer.invoke('metaWorkspace:create', input),
  metaWorkspaceUpdate: (id: string, patch: any) => ipcRenderer.invoke('metaWorkspace:update', id, patch),
  metaWorkspaceActivate: (id: string) => ipcRenderer.invoke('metaWorkspace:activate', id),
  metaWorkspaceDelete: (id: string) => ipcRenderer.invoke('metaWorkspace:delete', id),
  saveImage: (base64Data: string) => ipcRenderer.invoke('project:saveImage', base64Data),
  settingsGet: (key: string, defaultValue?: any) => ipcRenderer.invoke('settings:get', key, defaultValue),
  settingsSet: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
  setTitleBarOverlay: (color: string, symbolColor: string) => ipcRenderer.invoke('titlebar:setOverlay', color, symbolColor),
  windowIsFramelessRounded: () => ipcRenderer.invoke('window:isFramelessRounded'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.send('window:maximizeToggle'),
  windowClose: () => ipcRenderer.send('window:close'),
  confirmQuit: () => ipcRenderer.send('app:confirmQuit'),
  onRequestQuit: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('swarm:request-quit', listener);
    return () => ipcRenderer.removeListener('swarm:request-quit', listener);
  },
  windowOnMaximizedChange: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window:maximizedChange', listener);
    return () => ipcRenderer.removeListener('window:maximizedChange', listener);
  },
  getCwd: () => ipcRenderer.invoke('project:getCwd'),
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('project:selectFolder', defaultPath),
  selectFile: () => ipcRenderer.invoke('project:selectFile'),
  getRecentProjects: () => ipcRenderer.invoke('project:getRecent'),
  openRecentProject: (path: string) => ipcRenderer.invoke('project:openRecent', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  setBadgeCount: (count: number) => ipcRenderer.send('app:setBadgeCount', count),
  scaffoldProject: (options: any) => ipcRenderer.invoke('project:scaffold', options),
  brainstormStart: () => ipcRenderer.invoke('brainstorm:start'),
  brainstormSend: (sessionId: string, message: string) =>
    ipcRenderer.invoke('brainstorm:send', sessionId, message),
  brainstormSynthesize: (sessionId: string, opts?: { force?: boolean }) =>
    ipcRenderer.invoke('brainstorm:synthesize', sessionId, opts),
  brainstormEnd: (sessionId: string) => ipcRenderer.invoke('brainstorm:end', sessionId),
  brainstormConsumeSeed: (projectPath: string) => ipcRenderer.invoke('brainstorm:consumeSeed', projectPath),
  brainstormOnChunk: (sessionId: string, callback: (text: string) => void) => {
    const channel = `brainstorm:chunk:${sessionId}`;
    const listener = (_e: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  brainstormOnDone: (sessionId: string, callback: (text: string) => void) => {
    const channel = `brainstorm:done:${sessionId}`;
    const listener = (_e: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  brainstormOnError: (sessionId: string, callback: (err: string) => void) => {
    const channel = `brainstorm:error:${sessionId}`;
    const listener = (_e: Electron.IpcRendererEvent, err: string) => callback(err);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  // Usage API polling
  usageFetch: () => ipcRenderer.invoke('usage:fetch'),
  usageMode: () => ipcRenderer.invoke('usage:mode'),
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
  githubListRepos: (page?: number, search?: string) => ipcRenderer.invoke('github:listRepos', page, search),
  githubClone: (cloneUrl: string, targetDir: string) => ipcRenderer.invoke('github:clone', cloneUrl, targetDir),
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
  // Plugins
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsInstall: (name: string) => ipcRenderer.invoke('plugins:install', name),
  pluginsUninstall: (name: string) => ipcRenderer.invoke('plugins:uninstall', name),
  pluginsRegistryList: () => ipcRenderer.invoke('plugins:registryList'),
  // MCP
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (config: any) => ipcRenderer.invoke('mcp:add', config),
  mcpRemove: (name: string) => ipcRenderer.invoke('mcp:remove', name),
  mcpUpdate: (name: string, updates: any) => ipcRenderer.invoke('mcp:update', name, updates),
  mcpRegistryList: () => ipcRenderer.invoke('mcp:registryList'),
  onSwarmToolRequest: (cb: (req: { id: string; tool: string; input: any; workspace: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, req: { id: string; tool: string; input: any; workspace: string }) => cb(req);
    ipcRenderer.on('swarm:tool-request', listener);
    return () => ipcRenderer.removeListener('swarm:tool-request', listener);
  },
  respondSwarmTool: (id: string, result: unknown) => ipcRenderer.send('swarm:tool-response', id, result),
  respondSwarmToolError: (id: string, error: string) => ipcRenderer.send('swarm:tool-response-error', id, error),
  swarmSetOrchestratorSession: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke('swarm:set-orchestrator-session', workspace, sessionId),
  swarmEmitCard: (workspace: string, kind: string, input: any) =>
    ipcRenderer.invoke('swarm:emit-card', { workspace, kind, input }),
  swarmEmitCardResult: (workspace: string, id: string, result: any, isError?: boolean) =>
    ipcRenderer.send('swarm:emit-card-result', { workspace, id, result, isError }),
  swarm: {
    worktreeAdd: (projectPath: string, taskId: string, branch: string, baseBranch: string) =>
      ipcRenderer.invoke('swarm:worktree-add', projectPath, taskId, branch, baseBranch),
    worktreeRemove: (projectPath: string, worktreePath: string, branch: string) =>
      ipcRenderer.invoke('swarm:worktree-remove', projectPath, worktreePath, branch),
    canFastForward: (projectPath: string, source: string, target: string) =>
      ipcRenderer.invoke('swarm:can-ff', projectPath, source, target),
    ffMerge: (projectPath: string, source: string) =>
      ipcRenderer.invoke('swarm:ff-merge', projectPath, source),
    diffStats: (cwd: string, baseBranch: string, branch: string) =>
      ipcRenderer.invoke('swarm:diff-stats', cwd, baseBranch, branch),
    branchDiff: (cwd: string, baseBranch: string, branch: string) =>
      ipcRenderer.invoke('swarm:branch-diff', cwd, baseBranch, branch),
  },
  remote: {
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:setEnabled', enabled),
    status:     () => ipcRenderer.invoke('remote:status'),
    mintPairCode: () => ipcRenderer.invoke('remote:mintPairCode'),
    listDevices:  () => ipcRenderer.invoke('remote:listDevices'),
    revoke:       (deviceId: string) => ipcRenderer.invoke('remote:revoke', deviceId),
    setCeiling: (ceiling: 'auto' | 'auto-read' | 'always-ask' | null) =>
      ipcRenderer.invoke('remote:setCeiling', ceiling),
    getCeiling: () => ipcRenderer.invoke('remote:getCeiling'),
    setActiveSession: (payload: { projectPath: string; scope: string; sessionId: string }) =>
      ipcRenderer.invoke('remote:setActiveSession', payload),
    onProxyRequest: (cb: (payload: { reqId: number; kind: string; args: any }) => void) => {
      const listener = (_e: any, payload: any) => cb(payload);
      ipcRenderer.on('remote:proxy:request', listener);
      return () => ipcRenderer.removeListener('remote:proxy:request', listener);
    },
    sendProxyReply: (payload: { reqId: number; result?: unknown; error?: string }) =>
      ipcRenderer.invoke('remote:proxy:reply', payload),
  },
});
