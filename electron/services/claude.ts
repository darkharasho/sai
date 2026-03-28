import { spawn, ChildProcess } from 'node:child_process';
import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';

let currentCwd: string = '';
let claudePty: pty.IPty | null = null;
let activeProcess: ChildProcess | null = null;
let sessionId: string | undefined;
let currentPermMode: string = 'default';

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
	ipcMain.handle('claude:start', (_event, cwd: string, permMode?: string) => {
		currentCwd = cwd || process.env.HOME || '/';
		sessionId = undefined;
		currentPermMode = permMode || 'default';

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
		if (claudePty) {
			claudePty.kill();
			claudePty = null;
			safeSend(win, 'claude:message', { type: 'done' });
		}
	});

	// Handle approval responses from the UI
	ipcMain.on('claude:approve', (_event, approved: boolean) => {
		if (claudePty) {
			// Send 'y' or 'n' to the PTY for the approval prompt
			claudePty.write(approved ? 'y\n' : 'n\n');
		}
	});

	ipcMain.on('claude:send', (_event, message: string, imagePaths?: string[], permMode?: string) => {
		if (activeProcess) {
			activeProcess.kill();
			activeProcess = null;
		}
		if (claudePty) {
			claudePty.kill();
			claudePty = null;
		}

		currentPermMode = permMode || currentPermMode;

		// For default permission mode, use interactive PTY to capture approval prompts
		if (currentPermMode === 'default') {
			sendWithPty(win, message, imagePaths);
		} else {
			// For bypass mode, use -p for speed (no approvals needed)
			sendWithProcess(win, message, imagePaths, currentPermMode);
		}
	});
}

// Fast path: -p mode, no approval flow
function sendWithProcess(win: BrowserWindow, message: string, imagePaths?: string[], permMode?: string) {
	const args = [
		'-p', message,
		'--output-format', 'stream-json',
		'--verbose',
		'--include-partial-messages',
	];

	if (sessionId) {
		args.push('--resume', sessionId);
	}

	if (permMode === 'bypass') {
		args.push('--permission-mode', 'bypassPermissions');
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
}

// Interactive path: PTY mode, captures approval prompts
function sendWithPty(win: BrowserWindow, message: string, imagePaths?: string[]) {
	const args = [
		'--verbose',
	];

	if (sessionId) {
		args.push('--resume', sessionId);
	}

	if (imagePaths && imagePaths.length > 0) {
		for (const imgPath of imagePaths) {
			args.push('--image', imgPath);
		}
	}

	safeSend(win, 'claude:message', { type: 'streaming_start' });

	claudePty = pty.spawn('claude', args, {
		name: 'xterm-256color',
		cwd: currentCwd,
		env: { ...process.env },
		cols: 120,
		rows: 40,
	});

	let fullOutput = '';
	let pendingApproval = false;

	claudePty.onData((data) => {
		fullOutput += data;

		// Detect approval prompts - Claude shows something like:
		// "Allow Claude to write to file.txt? (y/n)"
		// or tool use permission dialogs
		const lowerData = data.toLowerCase();
		if ((lowerData.includes('allow') || lowerData.includes('approve') || lowerData.includes('(y/n)') || lowerData.includes('yes/no')) && !pendingApproval) {
			pendingApproval = true;

			// Extract the approval question from recent output
			const lines = fullOutput.split('\n');
			const recentLines = lines.slice(-5).join('\n').trim();

			safeSend(win, 'claude:message', {
				type: 'approval_request',
				question: recentLines,
			});
			return;
		}

		if (pendingApproval) {
			// After approval response, reset
			pendingApproval = false;
		}

		// Try to parse any JSON in the output (Claude sometimes outputs structured data)
		// But mostly PTY output is ANSI terminal text
		safeSend(win, 'claude:message', {
			type: 'pty_output',
			data: data,
		});
	});

	claudePty.onExit(() => {
		safeSend(win, 'claude:message', { type: 'done' });
		claudePty = null;
	});

	// Send the message after a brief delay for Claude to initialize
	setTimeout(() => {
		if (claudePty) {
			claudePty.write(message + '\n');
		}
	}, 500);
}

export function destroyClaude() {
	if (activeProcess) {
		activeProcess.kill();
		activeProcess = null;
	}
	if (claudePty) {
		claudePty.kill();
		claudePty = null;
	}
}
