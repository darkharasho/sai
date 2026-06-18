import { spawn } from 'node:child_process';

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ code: -1, stdout: '' });
      return;
    }
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.on('error', () => resolve({ code: -1, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
  });
}

// Active window title via xdotool (works for the X11/XWayland active window).
// Returns null when it can't be determined (tool missing, or a pure-Wayland window).
export async function activeWindowTitle(): Promise<string | null> {
  const r = await run('xdotool', ['getactivewindow', 'getwindowname']);
  if (r.code !== 0) return null;
  const t = r.stdout.trim();
  return t.length ? t : null;
}

// Best-effort: raise the first window whose title contains `title` (XWayland via wmctrl).
// Returns true if a matching window was activated.
export async function raiseWindowByTitle(title: string): Promise<boolean> {
  if (!title) return false;
  const list = await run('wmctrl', ['-l']);
  if (list.code !== 0) return false;
  const needle = title.toLowerCase();
  for (const line of list.stdout.split('\n')) {
    const m = line.match(/^(0x[0-9a-fA-F]+)\s+\S+\s+\S+\s+(.*)$/);
    if (!m) continue;
    if (m[2].toLowerCase().includes(needle)) {
      const act = await run('wmctrl', ['-i', '-a', m[1]]);
      return act.code === 0;
    }
  }
  return false;
}
