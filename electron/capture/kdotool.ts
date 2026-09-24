// Window enumeration and activation for KDE Wayland via kdotool.
//
// wmctrl/xdotool only see XWayland windows, so on a Wayland session they miss
// most of the desktop. kdotool talks to KWin over D-Bus and reports every
// window, with titles AND class names — the class is what lets us exclude SAI's
// own windows regardless of what the titlebar currently says.
import { spawn } from 'node:child_process';

export interface KdotoolWindow {
  id: string;
  title: string;
  klass: string;
}

function run(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let child;
    try {
      child = spawn('kdotool', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ code: -1, stdout: '' });
      return;
    }
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.on('error', () => resolve({ code: -1, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
  });
}

// kdotool prints one brace-wrapped uuid per line; anything else is noise.
export function parseWindowIds(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\{[0-9a-f-]{36}\}$/i.test(l));
}

export async function kdotoolAvailable(): Promise<boolean> {
  const r = await run(['--version']);
  return r.code === 0;
}

// Every window KWin knows about. Windows whose title AND class are both empty
// are dropped — they are compositor internals, never a capture target.
export async function listKdotoolWindows(): Promise<KdotoolWindow[]> {
  const found = await run(['search', '--name', '.*']);
  if (found.code !== 0) return [];
  const out: KdotoolWindow[] = [];
  for (const id of parseWindowIds(found.stdout)) {
    const [name, klass] = await Promise.all([
      run(['getwindowname', id]),
      run(['getwindowclassname', id]),
    ]);
    const title = name.stdout.trim();
    const k = klass.stdout.trim();
    if (!title && !k) continue;
    out.push({ id, title, klass: k });
  }
  return out;
}

export async function activateKdotoolWindow(id: string): Promise<boolean> {
  const r = await run(['windowactivate', id]);
  return r.code === 0;
}

export async function kdotoolActiveWindowTitle(): Promise<string | null> {
  const active = await run(['getactivewindow']);
  if (active.code !== 0) return null;
  const id = parseWindowIds(active.stdout)[0];
  if (!id) return null;
  const name = await run(['getwindowname', id]);
  const t = name.stdout.trim();
  return t.length ? t : null;
}
