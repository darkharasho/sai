import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let claudeProcess: ChildProcess | null = null;

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
	try {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	} catch {
		// Window already destroyed
	}
}

export function registerClaudeHandlers(win: BrowserWindow) {
	ipcMain.handle('claude:start', (_event, cwd: string) => {
		if (claudeProcess) {
			claudeProcess.kill();
			claudeProcess = null;
		}

		// Spawn a persistent interactive Claude process
		claudeProcess = spawn('claude', [
			'--output-format', 'stream-json',
			'--input-format', 'stream-json',
			'--verbose',
			'--include-partial-messages',
		], {
			cwd: cwd || process.env.HOME || '/',
			env: { ...process.env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let buffer = '';

		claudeProcess.stdout?.on('data', (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					safeSend(win, 'claude:message', msg);
				} catch {
					// Non-JSON line
				}
			}
		});

		claudeProcess.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text) {
				safeSend(win, 'claude:message', { type: 'error', text });
			}
		});

		claudeProcess.on('exit', (code) => {
			safeSend(win, 'claude:message', { type: 'process_exit', code });
			claudeProcess = null;
		});

		safeSend(win, 'claude:message', { type: 'ready' });
	});

	ipcMain.on('claude:send', (_event, message: string) => {
		if (claudeProcess?.stdin?.writable) {
			// stream-json input format
			const msg = JSON.stringify({
				type: 'user_message',
				content: message,
			});
			claudeProcess.stdin.write(msg + '\n');
		}
	});
}

export function destroyClaude() {
	if (claudeProcess) {
		claudeProcess.kill();
		claudeProcess = null;
	}
}
