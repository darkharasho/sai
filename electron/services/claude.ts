import { spawn, ChildProcess } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import { getOrCreate, get, touchActivity } from './workspace';

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
		if (!cwd) return;
		const ws = getOrCreate(cwd);

		// If workspace already has a session, just signal ready (don't re-probe)
		if (ws.claude.sessionId) {
			safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
			return;
		}

		// Kill any in-flight probe from a previous start attempt
		if (ws.claude.probe) {
			ws.claude.probe.kill();
			ws.claude.probe = null;
		}

		ws.claude.cwd = cwd;

		// Probe Claude to get slash commands from init message
		return new Promise<void>((resolve) => {
			const probe = spawn('claude', [
				'-p', 'hi',
				'--output-format', 'stream-json',
				'--verbose',
				'--max-turns', '1',
			], {
				cwd: ws.claude.cwd,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			ws.claude.probe = probe;

			let probeBuffer = '';
			probe.stdout?.on('data', (data: Buffer) => {
				// Ignore output from a stale probe
				if (ws.claude.probe !== probe) return;

				probeBuffer += data.toString();
				const lines = probeBuffer.split('\n');
				probeBuffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.type === 'system' && msg.subtype === 'init') {
							safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
						}
						if (msg.session_id && !ws.claude.sessionId) {
							ws.claude.sessionId = msg.session_id;
						}
					} catch { /* ignore */ }
				}
			});

			probe.on('exit', () => {
				if (ws.claude.probe === probe) {
					ws.claude.probe = null;
					safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
				}
				resolve();
			});

			probe.on('error', () => {
				if (ws.claude.probe === probe) {
					ws.claude.probe = null;
					safeSend(win, 'claude:message', { type: 'ready', projectPath: ws.projectPath });
				}
				resolve();
			});
		});
	});

	ipcMain.on('claude:stop', (_event, projectPath: string) => {
		const ws = get(projectPath);
		if (!ws) return;
		if (ws.claude.process) {
			const proc = ws.claude.process;
			ws.claude.process = null;
			proc.kill();
			safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
		}
	});

	ipcMain.handle('claude:generateCommitMessage', async (_event, cwd: string) => {
		const ws = get(cwd);
		const effectiveCwd = cwd || ws?.claude.cwd || process.env.HOME || '/';

		// Get the diff upfront so Claude doesn't need tool calls
		const diff = await new Promise<string>((resolve) => {
			const diffProc = spawn('git', ['diff', '--staged'], {
				cwd: effectiveCwd,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			let out = '';
			diffProc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
			diffProc.on('exit', () => resolve(out.trim()));
			diffProc.on('error', () => resolve(''));
		});

		if (!diff) return '';

		// Truncate very large diffs to keep the request fast
		const maxLen = 8000;
		const truncatedDiff = diff.length > maxLen
			? diff.slice(0, maxLen) + '\n... (diff truncated)'
			: diff;

		return new Promise<string>((resolve) => {
			const proc = spawn('claude', [
				'-p', `Generate a concise commit message for this diff. Output ONLY the commit message text, nothing else. Use conventional commit format (e.g. feat:, fix:, refactor:). Keep it under 72 characters for the subject line.\n\n${truncatedDiff}`,
				'--output-format', 'text',
				'--max-turns', '1',
			], {
				cwd: effectiveCwd,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let output = '';
			proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
			proc.on('exit', () => resolve(output.trim()));
			proc.on('error', () => resolve(''));
		});
	});

	ipcMain.on('claude:send', (_event, projectPath: string, message: string, imagePaths?: string[], permMode?: string, effort?: string) => {
		const ws = get(projectPath);
		if (!ws) return;

		touchActivity(projectPath);

		if (ws.claude.process) {
			ws.claude.process.kill();
			ws.claude.process = null;
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

		if (ws.claude.sessionId) {
			args.push('--resume', ws.claude.sessionId);
		}

		// Map permission modes to Claude CLI flags
		if (permMode === 'bypass') {
			args.push('--permission-mode', 'bypassPermissions');
		} else {
			args.push('--permission-mode', 'acceptEdits');
		}

		// Effort level
		if (effort && ['low', 'medium', 'high', 'max'].includes(effort)) {
			args.push('--effort', effort);
		}

		safeSend(win, 'claude:message', { type: 'streaming_start', projectPath: ws.projectPath });

		ws.claude.process = spawn('claude', args, {
			cwd: ws.claude.cwd,
			env: { ...process.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		ws.claude.buffer = '';

		ws.claude.process.stdout?.on('data', (data: Buffer) => {
			ws.claude.buffer += data.toString();
			const lines = ws.claude.buffer.split('\n');
			ws.claude.buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.session_id && !ws.claude.sessionId) {
						ws.claude.sessionId = msg.session_id;
					}
					safeSend(win, 'claude:message', { ...msg, projectPath: ws.projectPath });
				} catch { /* ignore */ }
			}
		});

		ws.claude.process.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text) {
				safeSend(win, 'claude:message', { type: 'error', text, projectPath: ws.projectPath });
			}
		});

		const proc = ws.claude.process;
		proc.on('exit', () => {
			if (ws.claude.process !== proc) return; // killed by stop or new send
			if (ws.claude.buffer.trim()) {
				try {
					safeSend(win, 'claude:message', { ...JSON.parse(ws.claude.buffer), projectPath: ws.projectPath });
				} catch { /* ignore */ }
			}
			ws.claude.buffer = '';
			safeSend(win, 'claude:message', { type: 'done', projectPath: ws.projectPath });
			ws.claude.process = null;
		});
	});
}

export function destroyClaude() {
	// Now handled by workspace.destroyAll — this is kept for backwards compat during migration
}
