import * as pty from 'node-pty';
import * as fs from 'node:fs';
import { BrowserWindow, ipcMain } from 'electron';
import { get, touchActivity } from './workspace';
import { RingBuffer } from './remote/ring-buffer';

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

// Shared scrollback + fan-out for desktop-owned terminals so phone clients can
// attach via the remote bridge. Phone-owned terminals (created via
// createTerminalImpl from PhoneTerminalRegistry) keep their own ring inside
// the registry — these maps are only populated by the desktop IPC handler.
const DESKTOP_RING_CAP_BYTES = 64 * 1024;
type DesktopDataListener = (data: string) => void;
const ringByTerm = new Map<number, RingBuffer>();
const subscribersByTerm = new Map<number, Set<DesktopDataListener>>();

/**
 * Spawn a node-pty shell at `cwd` and return its IPty + the globally-unique id.
 * Caller is responsible for wiring data/exit listeners. This impl is shared by
 * the desktop IPC handler and the phone-remote terminal store; they maintain
 * independent registries.
 */
export function createTerminalImpl(opts: {
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}): { termId: number; pty: pty.IPty } {
  const id = nextId++;
  const env = { ...process.env } as Record<string, string>;

  let spawnCmd: string;
  let spawnArgs: string[];
  let ptyName: string;
  let fallbackCwd: string;

  if (process.platform === 'win32') {
    const pwsh7Candidates = [
      process.env.PWSH_PATH,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    const winPwsh = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : '';
    let resolved: string | null = null;
    for (const candidate of pwsh7Candidates) {
      try { if (fs.existsSync(candidate)) { resolved = candidate; break; } } catch { /* ignore */ }
    }
    if (!resolved && winPwsh) {
      try { if (fs.existsSync(winPwsh)) resolved = winPwsh; } catch { /* ignore */ }
    }
    spawnCmd = resolved || process.env.ComSpec || 'cmd.exe';
    const isCmd = spawnCmd.toLowerCase().endsWith('cmd.exe');
    spawnArgs = isCmd ? [] : ['-NoLogo'];
    ptyName = 'xterm-256color';
    fallbackCwd = process.env.USERPROFILE || process.env.HOMEDRIVE || 'C:\\';
  } else {
    const shell = process.env.SHELL || '/bin/bash';
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    delete env.CHROME_DESKTOP;
    delete env.INVOCATION_ID;
    const shellInit = `stty -echoctl 2>/dev/null; exec "${shell}" --login`;
    const useScope = canUseSystemdScope();
    spawnCmd = useScope ? 'systemd-run' : shell;
    spawnArgs = useScope
      ? ['--user', '--scope', '--quiet', '--', shell, '-c', shellInit]
      : ['-c', shellInit];
    ptyName = 'xterm-256color';
    fallbackCwd = process.env.HOME || '/';
  }

  const term = pty.spawn(spawnCmd, spawnArgs, {
    name: ptyName,
    cwd: opts.cwd || fallbackCwd,
    cols: opts.cols,
    rows: opts.rows,
    env,
  });

  allTerminals.set(id, term);
  term.onData((data) => opts.onData(data));
  term.onExit(({ exitCode }) => {
    allTerminals.delete(id);
    opts.onExit(exitCode);
  });
  return { termId: id, pty: term };
}

export function writeTerminalImpl(termId: number, data: string): void {
  allTerminals.get(termId)?.write(data);
}

export function resizeTerminalImpl(termId: number, cols: number, rows: number): void {
  allTerminals.get(termId)?.resize(cols, rows);
}

export function signalTerminalImpl(termId: number, signal: NodeJS.Signals): void {
  const term = allTerminals.get(termId);
  if (!term) return;
  try { process.kill(-term.pid, signal); } catch { /* already exited */ }
}

export function killTerminalImpl(termId: number): void {
  const term = allTerminals.get(termId);
  if (!term) return;
  try { term.kill(); } catch { /* already exited */ }
  allTerminals.delete(termId);
}

export function registerTerminalHandlers(win: BrowserWindow) {
  ipcMain.handle('terminal:create', (_event, cwd: string, scope?: string) => {
    const id = nextId++;
    const env = { ...process.env } as Record<string, string>;

    let spawnCmd: string;
    let spawnArgs: string[];
    let ptyName: string;
    let fallbackCwd: string;

    if (process.platform === 'win32') {
      // Windows: prefer PowerShell 7 (pwsh.exe) when present, fall back to
      // Windows PowerShell 5.1 which ships with every supported Windows
      // build, then cmd.exe as a last resort. node-pty under ConPTY doesn't
      // resolve bare executable names via PATH, so every candidate must be
      // an absolute path we've confirmed exists.
      const pwsh7Candidates = [
        process.env.PWSH_PATH,
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
      ].filter((p): p is string => typeof p === 'string' && p.length > 0);
      const winPwsh = process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : '';
      let resolved: string | null = null;
      for (const candidate of pwsh7Candidates) {
        try {
          if (fs.existsSync(candidate)) { resolved = candidate; break; }
        } catch { /* ignore */ }
      }
      if (!resolved && winPwsh) {
        try { if (fs.existsSync(winPwsh)) resolved = winPwsh; } catch { /* ignore */ }
      }
      spawnCmd = resolved || process.env.ComSpec || 'cmd.exe';
      const isCmd = spawnCmd.toLowerCase().endsWith('cmd.exe');
      spawnArgs = isCmd ? [] : ['-NoLogo'];
      ptyName = 'xterm-256color';
      fallbackCwd = process.env.USERPROFILE || process.env.HOMEDRIVE || 'C:\\';
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      // Prevent child processes from grouping under SAI in the taskbar
      delete env.GIO_LAUNCHED_DESKTOP_FILE;
      delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
      delete env.BAMF_DESKTOP_FILE_HINT;
      // KDE Plasma / Wayland: clear startup notification tokens so spawned
      // GUI apps (e.g. electron dev servers, browsers) get their own taskbar entry
      delete env.XDG_ACTIVATION_TOKEN;
      delete env.DESKTOP_STARTUP_ID;
      // Chromium/Electron sets CHROME_DESKTOP to the .desktop filename (e.g.
      // "sai.desktop").  Child Electron apps inherit this and use it for their
      // WM_CLASS / app_id, causing the DE to group them under SAI's taskbar icon.
      delete env.CHROME_DESKTOP;
      // INVOCATION_ID ties the process to SAI's systemd service unit; clear it so
      // child processes aren't associated with this unit's lifecycle.
      delete env.INVOCATION_ID;
      // On Linux with systemd, spawn via systemd-run --user --scope so the shell
      // lives in its own cgroup. This prevents desktop environments (GNOME, KDE)
      // from grouping GUI apps launched from the terminal under SAI's taskbar icon.
      // Disable ECHOCTL before starting the interactive shell so escape sequences
      // (arrow keys etc.) aren't echoed as ^[[A notation on the prompt line.
      const shellInit = `stty -echoctl 2>/dev/null; exec "${shell}" --login`;
      const useScope = canUseSystemdScope();
      spawnCmd = useScope ? 'systemd-run' : shell;
      spawnArgs = useScope
        ? ['--user', '--scope', '--quiet', '--', shell, '-c', shellInit]
        : ['-c', shellInit];
      ptyName = 'xterm-256color';
      fallbackCwd = process.env.HOME || '/';
    }

    const term = pty.spawn(spawnCmd, spawnArgs, {
      name: ptyName,
      cwd: cwd || fallbackCwd,
      env,
    });

    allTerminals.set(id, term);

    const ws = get(cwd);
    if (ws) {
      ws.terminals.set(id, term);
      terminalOwner.set(id, cwd);
    }

    term.onData((data) => {
      // Desktop renderer (unchanged behavior)
      safeSend(win, 'terminal:data', id, data);
      // Phone-bridge fan-out: write to ring, broadcast to subscribers.
      let ring = ringByTerm.get(id);
      if (!ring) { ring = new RingBuffer(DESKTOP_RING_CAP_BYTES); ringByTerm.set(id, ring); }
      ring.push(data);
      const subs = subscribersByTerm.get(id);
      if (subs && subs.size > 0) {
        for (const cb of subs) {
          try { cb(data); } catch { /* isolate one subscriber's failure */ }
        }
      }
    });
    term.onExit(() => {
      allTerminals.delete(id);
      const owner = terminalOwner.get(id);
      if (owner) {
        const ownerWs = get(owner);
        ownerWs?.terminals.delete(id);
        terminalOwner.delete(id);
      }
      ringByTerm.delete(id);
      subscribersByTerm.delete(id);
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

  ipcMain.handle('terminal:isAwaitingInput', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return false;
    if (process.platform !== 'linux') return false;
    try {
      const fs = require('fs') as typeof import('fs');
      const stat = fs.readFileSync(`/proc/${term.pid}/stat`, 'utf8');
      const closeParenIdx = stat.lastIndexOf(')');
      const fields = stat.slice(closeParenIdx + 2).split(' ');
      const tpgid = parseInt(fields[5], 10);
      if (tpgid <= 0) return false;
      // Check if the foreground process is blocked reading from the terminal
      const wchan = fs.readFileSync(`/proc/${tpgid}/wchan`, 'utf8').trim();
      return wchan === 'n_tty_read' || wchan === 'read_chan' || wchan === 'wait_woken';
    } catch {
      return false;
    }
  });

  ipcMain.handle('terminal:getCwd', (_event, id: number) => {
    const term = allTerminals.get(id);
    if (!term) return null;
    if (process.platform === 'linux') {
      try {
        const fs = require('fs') as typeof import('fs');
        return fs.readlinkSync(`/proc/${term.pid}/cwd`);
      } catch {
        return null;
      }
    }
    // macOS: node-pty doesn't expose cwd directly; could use lsof but skip for now
    return null;
  });

  ipcMain.handle('terminal:tabComplete', async (_event, text: string, cwd: string) => {
    // Tab completion uses bash's `compgen`; cmd.exe has no equivalent, so
    // on Windows we defer to the shell's own built-in completion (Tab key
    // inside cmd.exe / PowerShell handles it natively).
    if (process.platform === 'win32') return [];
    const lastWord = text.split(/\s+/).pop() || '';
    const { execFile } = require('child_process') as typeof import('child_process');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const isFirstWord = !text.includes(' ');
    // compgen -c for commands (first word), -f for files, -d for dirs
    const flags = isFirstWord ? '-c -f' : '-f -d';
    const escaped = lastWord ? lastWord.replace(/'/g, "'\\''") : '';
    const cmd = escaped
      ? `compgen ${flags} -- '${escaped}' 2>/dev/null | head -50`
      : `compgen ${flags} 2>/dev/null | head -50`;
    return new Promise<string[]>((resolve) => {
      execFile('bash', ['-c', cmd], { cwd, timeout: 2000 }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve([]); return; }
        const raw = [...new Set(stdout.trim().split('\n').filter(Boolean))];
        // Append / to directories
        const results = raw.map(entry => {
          const absPath = path.isAbsolute(entry) ? entry : path.resolve(cwd, entry);
          try {
            if (fs.statSync(absPath).isDirectory()) return entry + '/';
          } catch { /* not a path — command name etc */ }
          return entry;
        });
        resolve(results);
      });
    });
  });

  ipcMain.handle('terminal:getShellHistory', async (_event, count: number) => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const os = require('os') as typeof import('os');
    const home = os.homedir();
    const candidates = [
      path.join(home, '.zsh_history'),
      path.join(home, '.bash_history'),
    ];
    for (const histFile of candidates) {
      try {
        const content = fs.readFileSync(histFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        // zsh extended history format: lines starting with ": timestamp:0;" — extract the command part
        const parsed = lines.map(l => {
          const m = l.match(/^: \d+:\d+;(.*)$/);
          return m ? m[1] : l;
        });
        return parsed.slice(-count);
      } catch {
        continue;
      }
    }
    return [];
  });

  ipcMain.on('terminal:write', (_event, id: number, data: string) => {
    allTerminals.get(id)?.write(data);
    // Update activity for owning workspace
    const owner = terminalOwner.get(id);
    if (owner) touchActivity(owner);
  });

  ipcMain.on('terminal:signal', (_event, id: number, signal: string) => {
    const term = allTerminals.get(id);
    if (term) {
      try { process.kill(-term.pid, signal); } catch { /* process already exited */ }
    }
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
      ringByTerm.delete(id);
      subscribersByTerm.delete(id);
    }
  });
}

export function destroyAllTerminals() {
  for (const term of allTerminals.values()) { term.kill(); }
  allTerminals.clear();
  terminalOwner.clear();
  ringByTerm.clear();
  subscribersByTerm.clear();
}

/**
 * Return the current ring snapshot for a desktop-owned terminal, or '' if none.
 * Phone-owned terminals (PhoneTerminalRegistry) snapshot their own ring directly.
 */
export function snapshotTerminal(termId: number): string {
  return ringByTerm.get(termId)?.snapshot() ?? '';
}

/**
 * Subscribe to live output for a desktop-owned terminal. Returns an unsubscribe.
 * The callback runs synchronously inside the pty.onData handler — keep it cheap.
 */
export function subscribeTerminal(termId: number, cb: DesktopDataListener): () => void {
  let set = subscribersByTerm.get(termId);
  if (!set) { set = new Set(); subscribersByTerm.set(termId, set); }
  set.add(cb);
  return () => { set?.delete(cb); };
}

/**
 * List desktop-owned terminals with best-effort cwd / cols / rows.
 * cwd is taken from terminalOwner; cols/rows from the IPty instance.
 */
export function listDesktopTerminals(): Array<{
  termId: number; cwd: string; cols: number; rows: number; alive: boolean;
}> {
  const out: Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }> = [];
  for (const [termId, term] of allTerminals.entries()) {
    // Skip phone-owned: phone terms live in PhoneTerminalRegistry, but they also
    // pass through createTerminalImpl → allTerminals. We tag desktop ownership
    // by the presence of a terminalOwner entry (set only inside the IPC handler).
    const cwd = terminalOwner.get(termId);
    if (cwd === undefined) continue;
    const t = term as unknown as { cols?: number; rows?: number };
    out.push({
      termId, cwd,
      cols: typeof t.cols === 'number' ? t.cols : 80,
      rows: typeof t.rows === 'number' ? t.rows : 24,
      alive: true,
    });
  }
  return out;
}

/** Test hook: seed desktop state without spawning a real PTY. */
export function _seedDesktopTerminalForTest(termId: number, cwd: string, cols = 80, rows = 24): void {
  // Used by integration test to simulate a desktop term. We can't fake
  // allTerminals (it needs a real IPty), so we only populate the ancillary
  // maps; listDesktopTerminals reads allTerminals → use this in unit tests via
  // the vi.hoisted stub instead. (Kept here as an explicit no-op anchor so
  // test code can document its intent; integration tests use the real path.)
  void termId; void cwd; void cols; void rows;
}
