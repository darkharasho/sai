import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let currentCwd: string = '';
let activeProcess: ChildProcess | null = null;
let sessionId: string | undefined;

export function registerClaudeHandlers(win: BrowserWindow) {
	ipcMain.handle('claude:start', (_event, cwd: string) => {
		currentCwd = cwd || process.env.HOME || '/';
		sessionId = undefined;
		win.webContents.send('claude:message', { type: 'ready' });
	});

	ipcMain.on('claude:send', (_event, message: string) => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
		}

		const args = [
			'-p', message,
			'--output-format', 'stream-json',
			'--verbose',
		];

		// Resume session for conversation continuity
		if (sessionId) {
			args.push('--resume', sessionId);
		}

		activeProcess = spawn('claude', args, {
			cwd: currentCwd,
			env: { ...process.env },
			stdio: ['ignore', 'pipe', 'pipe'],  // stdin=ignore to avoid the 3s warning
		});

		let buffer = '';

		activeProcess.stdout?.on('data', (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';  // Keep incomplete last line in buffer

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);

					// Capture session ID for conversation continuity
					if (msg.session_id && !sessionId) {
						sessionId = msg.session_id;
					}

					// Forward to renderer
					win.webContents.send('claude:message', msg);
				} catch {
					// Non-JSON line, ignore
				}
			}
		});

		activeProcess.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text && !text.includes('Warning: no stdin data')) {
				win.webContents.send('claude:message', { type: 'error', text });
			}
		});

		activeProcess.on('exit', () => {
			// Flush remaining buffer
			if (buffer.trim()) {
				try {
					const msg = JSON.parse(buffer);
					win.webContents.send('claude:message', msg);
				} catch {
					// ignore
				}
			}
			buffer = '';
			win.webContents.send('claude:message', { type: 'done' });
			activeProcess = null;
		});
	});
}

export function destroyClaude() {
	if (activeProcess) {
		activeProcess.kill();
		activeProcess = null;
	}
}
