import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let currentCwd: string = '';
let activeProcess: ChildProcess | null = null;
let sessionId: string | undefined;

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
		currentCwd = cwd || process.env.HOME || '/';
		sessionId = undefined;

		// Probe Claude to get slash commands from init message
		const probe = spawn('claude', [
			'-p', 'hi',
			'--output-format', 'stream-json',
			'--verbose',
			'--max-turns', '1',
		], {
			cwd: currentCwd,
			env: { ...process.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let probeBuffer = '';
		probe.stdout?.on('data', (data: Buffer) => {
			probeBuffer += data.toString();
			const lines = probeBuffer.split('\n');
			probeBuffer = lines.pop() || '';
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.type === 'system' && msg.subtype === 'init') {
						safeSend(win, 'claude:message', msg);
					}
					if (msg.session_id && !sessionId) {
						sessionId = msg.session_id;
					}
				} catch { /* ignore */ }
			}
		});

		probe.on('exit', () => {
			safeSend(win, 'claude:message', { type: 'ready' });
		});
	});

	ipcMain.on('claude:stop', () => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
			safeSend(win, 'claude:message', { type: 'done' });
		}
	});

	ipcMain.on('claude:send', (_event, message: string, imagePaths?: string[], permMode?: string) => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
		}

		const args = [
			'-p', message,
			'--output-format', 'stream-json',
			'--verbose',
			'--include-partial-messages',
		];

		if (sessionId) {
			args.push('--resume', sessionId);
		}

		// Map permission modes to Claude CLI flags
		if (permMode === 'bypass') {
			args.push('--permission-mode', 'bypassPermissions');
		} else {
			args.push('--permission-mode', 'acceptEdits');
		}

		if (imagePaths && imagePaths.length > 0) {
			for (const imgPath of imagePaths) {
				args.push('--image', imgPath);
			}
		}

		safeSend(win, 'claude:message', { type: 'streaming_start' });

		activeProcess = spawn('claude', args, {
			cwd: currentCwd,
			env: { ...process.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let buffer = '';

		activeProcess.stdout?.on('data', (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.session_id && !sessionId) {
						sessionId = msg.session_id;
					}
					safeSend(win, 'claude:message', msg);
				} catch { /* ignore */ }
			}
		});

		activeProcess.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text && !text.includes('Warning: no stdin')) {
				safeSend(win, 'claude:message', { type: 'error', text });
			}
		});

		activeProcess.on('exit', () => {
			if (buffer.trim()) {
				try { safeSend(win, 'claude:message', JSON.parse(buffer)); } catch { /* ignore */ }
			}
			buffer = '';
			safeSend(win, 'claude:message', { type: 'done' });
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
