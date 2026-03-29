import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';

let currentCwd: string = '';
let activeProcess: ChildProcess | null = null;
let activeProbe: ChildProcess | null = null;
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
		// Kill any in-flight probe or active process from previous project
		if (activeProbe) {
			activeProbe.kill();
			activeProbe = null;
		}
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
		}

		currentCwd = cwd || process.env.HOME || '/';
		sessionId = undefined;

		// Probe Claude to get slash commands from init message
		return new Promise<void>((resolve) => {
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

			activeProbe = probe;

			let probeBuffer = '';
			probe.stdout?.on('data', (data: Buffer) => {
				// Ignore output from a stale probe
				if (activeProbe !== probe) return;

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
				if (activeProbe === probe) {
					activeProbe = null;
					safeSend(win, 'claude:message', { type: 'ready' });
				}
				resolve();
			});

			probe.on('error', () => {
				if (activeProbe === probe) {
					activeProbe = null;
					safeSend(win, 'claude:message', { type: 'ready' });
				}
				resolve();
			});
		});
	});

	ipcMain.on('claude:stop', () => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
			safeSend(win, 'claude:message', { type: 'done' });
		}
	});

	ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string) => {
		return new Promise<string>((resolve) => {
			const proc = spawn('claude', [
				'-p', 'Run `git diff HEAD` to see all changes, then generate a concise commit message. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.',
				'--output-format', 'text',
				'--max-turns', '10',
				'--permission-mode', 'acceptEdits',
				'--allowedTools', 'Bash(git diff:*) Bash(git status:*) Bash(git log:*)',
			], {
				cwd: cwd || currentCwd,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let output = '';
			proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
			proc.on('exit', () => resolve(output.trim()));
			proc.on('error', () => resolve(''));
		});
	});

	ipcMain.on('claude:send', (_event, message: string, imagePaths?: string[], permMode?: string) => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
		}

		// Prepend image file paths to the prompt so Claude reads them via its Read tool
		let prompt = message;
		if (imagePaths && imagePaths.length > 0) {
			const imageRefs = imagePaths.map(p => `[Attached image: ${p}]`).join('\n');
			prompt = `${imageRefs}\n\n${message}`;
		}

		const args = [
			'-p', prompt,
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
			if (text) {
				// Always forward stderr so we can debug
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
	if (activeProbe) {
		activeProbe.kill();
		activeProbe = null;
	}
	if (activeProcess) {
		activeProcess.kill();
		activeProcess = null;
	}
}
