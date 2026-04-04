import * as pty from 'node-pty';
import { BrowserWindow, ipcMain } from 'electron';
import { get, touchActivity } from './workspace';

/** Check whether systemd-run --user --scope is available (Linux only). Cached after first call. */
let hasSystemdRun: boolean | undefined;
function detectSystemdScope(): boolean {
  if (process.platform !== 'linux') return false;
  if (hasSystemdRun !== undefined) return hasSystemdRun;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('child_process') as typeof import('child_process');
    execFileSync('systemd-run', ['--user', '--scope', '--', '/bin/true'], {
      stdio: 'ignore', timeout: 3000,
    });
    hasSystemdRun = true;
  } catch {
    hasSystemdRun = false;
  }
  return hasSystemdRun;
}

// Indirection so tests can override detection without mocking child_process
export let canUseSystemdScope = detectSystemdScope;

/** Override the scope detection function (for testing). */
export function _setSystemdScopeDetector(fn: () => boolean) { canUseSystemdScope = fn; }

/** Reset to real detection (for testing). */
export function _resetSystemdDetection() {
  hasSystemdRun = undefined;
  canUseSystemdScope = detectSystemdScope;
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
	try {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	} catch {
		// Window already destroyed
	}
}

// Global map for ID→terminal lookup (IDs are globally unique)
const allTerminals = new Map<number, pty.IPty>();
// Reverse lookup: terminal ID → project path
const terminalOwner = new Map<number, string>();
let nextId = 1;

export function registerTerminalHandlers(win: BrowserWindow) {
  ipcMain.handle('terminal:create', (_event, cwd: string) => {
    const shell = process.env.SHELL || '/bin/bash';
    const id = nextId++;
    const env = { ...process.env } as Record<string, string>;
    // Prevent child processes from grouping under SAI in the taskbar
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    // KDE Plasma / Wayland: clear startup notification tokens so spawned
    // GUI apps (e.g. electron dev servers, browsers) get their own taskbar entry
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    // On Linux with systemd, spawn via systemd-run --user --scope so the shell
    // lives in its own cgroup. This prevents desktop environments (GNOME, KDE)
    // from grouping GUI apps launched from the terminal under SAI's taskbar icon.
    const useScope = canUseSystemdScope();
    const spawnCmd = useScope ? 'systemd-run' : shell;
    const spawnArgs = useScope
      ? ['--user', '--scope', '--quiet', '--', shell, '--login']
      : ['--login'];
    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cwd: cwd || process.env.HOME || '/',
      env,
    });

    allTerminals.set(id, term);

    // Register with workspace if one exists for this cwd
    const ws = get(cwd);
    if (ws) {
      ws.terminals.set(id, term);
      terminalOwner.set(id, cwd);
    }

    term.onData((data) => { safeSend(win, 'terminal:data', id, data); });
    term.onExit(() => {
      allTerminals.delete(id);
      const owner = terminalOwner.get(id);
      if (owner) {
        const ownerWs = get(owner);
        ownerWs?.terminals.delete(id);
        terminalOwner.delete(id);
      }
    });
    return id;
  });

  ipcMain.handle('terminal:getProcess', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    // On Linux, pty.process returns the original shell, not the foreground process.
    // Read /proc/<pid>/stat to get the foreground process group, then its name.
    if (process.platform === 'linux') {
      try {
        const fs = require('fs') as typeof import('fs');
        const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
        // Field 8 (0-indexed 7) is tpgid — the foreground process group ID
        // Fields are space-separated, but field 2 (comm) is in parens and may contain spaces
        const closeParenIdx = stat.lastIndexOf(')');
        const fields = stat.slice(closeParenIdx + 2).split(' ');
        const tpgid = parseInt(fields[5], 10); // tpgid is field 8, but after extracting past ")", it's index 5
        if (tpgid > 0) {
          const comm = fs.readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim();
          return comm || term.process;
        }
      } catch {
        // Fall through to default
      }
    }
    return term.process;
  });

  ipcMain.on('terminal:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
    // Update activity for owning workspace
    const owner = terminalOwner.get(id);
    if (owner) touchActivity(owner);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    allTerminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('terminal:kill', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (term) {
      term.kill();
      allTerminals.delete(id);
      const owner = terminalOwner.get(id);
      if (owner) {
        const ownerWs = get(owner);
        ownerWs?.terminals.delete(id);
        terminalOwner.delete(id);
      }
    }
  });
}

export function destroyAllTerminals() {
  for (const term of allTerminals.values()) { term.kill(); }
  allTerminals.clear();
  terminalOwner.clear();
}
