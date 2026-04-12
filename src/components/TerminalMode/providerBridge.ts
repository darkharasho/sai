type TerminalProvider = 'claude' | 'codex' | 'gemini';
type TerminalPermissionMode = 'default' | 'bypass';

interface TerminalSaiBridge {
  claudeSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string, model?: string, scope?: string) => void;
  claudeStop: (projectPath: string, scope?: string) => void;
  codexSend: (projectPath: string, message: string, imagePaths?: string[], permMode?: string, model?: string) => void;
  codexStop: (projectPath: string) => void;
  geminiSend: (projectPath: string, message: string, imagePaths?: string[], approvalMode?: string, conversationMode?: string, model?: string, scope?: string) => void;
  geminiStop: (projectPath: string, scope?: string) => void;
}

export function getTerminalProviderBridge(sai: TerminalSaiBridge, aiProvider: TerminalProvider) {
  if (aiProvider === 'codex') {
    return {
      send: (projectPath: string, message: string, permissionMode: TerminalPermissionMode) =>
        sai.codexSend(projectPath, message, undefined, permissionMode === 'bypass' ? 'full-access' : 'auto', undefined),
      stop: (projectPath: string) => sai.codexStop(projectPath),
    };
  }

  if (aiProvider === 'gemini') {
    return {
      send: (projectPath: string, message: string, _permissionMode: TerminalPermissionMode, scope: string = 'terminal') =>
        sai.geminiSend(projectPath, message, undefined, 'auto_edit', 'planning', undefined, scope),
      stop: (projectPath: string, scope: string = 'terminal') => sai.geminiStop(projectPath, scope),
    };
  }

  return {
    send: (projectPath: string, message: string, permissionMode: TerminalPermissionMode) =>
      sai.claudeSend(projectPath, message, undefined, permissionMode, 'high', 'sonnet', 'terminal'),
    stop: (projectPath: string) => sai.claudeStop(projectPath, 'terminal'),
  };
}
