import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
	try {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	} catch {
		// Window already destroyed
	}
}

const terminals = new Map<number, pty.IPty>();
let nextId = 1;

export function registerTerminalHandlers(win: BrowserWindow) {
  ipcMain.handle('terminal:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env: process.env as Record<string, string>,
    });
    terminals.set(id, term);
    term.onData((data) => { safeSend(win, 'terminal:data', id, data); });
    term.onExit(() => { terminals.delete(id); });
    return id;
  });

  ipcMain.on('terminal:write', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });
}

export function destroyAllTerminals() {
  for (const term of terminals.values()) { term.kill(); }
  terminals.clear();
}
