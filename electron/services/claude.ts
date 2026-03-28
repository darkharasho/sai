import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let currentCwd: string = '';
let activeProcess: ChildProcess | null = null;
let sessionId: string | undefined;

export function registerClaudeHandlers(win: BrowserWindow) {
	ipcMain.handle('claude:start', (_event, cwd: string) => {
		currentCwd = cwd || process.env.HOME || '/';
		sessionId = undefined;
		// Don't spawn yet — we spawn per message
		win.webContents.send('claude:message', { type: 'ready' });
	});

	ipcMain.on('claude:send', (_event, message: string) => {
		if (activeProcess) {
			// Kill any still-running process
			activeProcess.kill();
			activeProcess = null;
		}

		const args = [
			'-p', message,
			'--output-format', 'stream-json',
		];

		// Resume session if we have one
		if (sessionId) {
			args.push('--resume', sessionId);
		}

		activeProcess = spawn('claude', args, {
			cwd: currentCwd,
			env: { ...process.env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		activeProcess.stdout?.on('data', (data: Buffer) => {
			const lines = data.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				try {
					const msg = JSON.parse(line);
					win.webContents.send('claude:message', msg);
					// Capture session ID from the response
					if (msg.session_id) {
						sessionId = msg.session_id;
					}
				} catch {
					win.webContents.send('claude:message', { type: 'raw', text: line });
				}
			}
		});

		activeProcess.stderr?.on('data', (data: Buffer) => {
			const text = data.toString();
			// Filter out noise (progress indicators, etc.)
			if (text.trim()) {
				win.webContents.send('claude:message', { type: 'error', text });
			}
		});

		activeProcess.on('exit', (code) => {
			win.webContents.send('claude:message', { type: 'done', code });
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
