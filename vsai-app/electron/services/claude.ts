import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let claudeProcess: ChildProcess | null = null;

export function registerClaudeHandlers(win: BrowserWindow) {
  ipcMain.handle('claude:start', (_event, cwd: string) => {
    if (claudeProcess) { claudeProcess.kill(); }

    claudeProcess = spawn('claude', [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
    ], {
      cwd: cwd || process.env.HOME || '/',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    claudeProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          win.webContents.send('claude:message', msg);
        } catch {
          win.webContents.send('claude:message', { type: 'raw', text: line });
        }
      }
    });

    claudeProcess.stderr?.on('data', (data: Buffer) => {
      win.webContents.send('claude:message', { type: 'error', text: data.toString() });
    });

    claudeProcess.on('exit', (code) => {
      win.webContents.send('claude:message', { type: 'exit', code });
      claudeProcess = null;
    });
  });

  ipcMain.on('claude:send', (_event, message: string) => {
    if (claudeProcess?.stdin?.writable) {
      claudeProcess.stdin.write(JSON.stringify({ type: 'user', content: message }) + '\n');
    }
  });
}

export function destroyClaude() {
  if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
}
