import fs from 'node:fs';
import path from 'node:path';
import { canvasName, canvasTitle } from '../../src/lib/canvasName';

export { canvasTitle };

/**
 * File side of the `sai_canvas` chat tool: list/read/write canvases at
 * `<workspace>/.sai/canvas/<name>.md`. Runs in the main process. A write is an
 * ordinary file change, so the canvas watcher picks it up like any agent edit
 * (live tab, auto-open, restore of user edits it clobbered). `open` needs the
 * renderer and is not handled here.
 */

export type CanvasFileResult =
  | { ok: true; name: string; path: string; created: boolean }
  | { ok: true; name: string; path: string; content: string }
  | { ok: true; canvases: { name: string; title: string; path: string }[] }
  | { ok: false; error: string };

export const CANVAS_ACTIONS = ['list', 'read', 'write', 'open'] as const;

function realWorkspace(workspace: string): { ok: true; real: string } | { ok: false; error: string } {
  if (typeof workspace !== 'string' || !workspace || !path.isAbsolute(workspace)) {
    return { ok: false, error: 'no workspace for this chat' };
  }
  try { return { ok: true, real: fs.realpathSync(workspace) }; } catch { return { ok: false, error: `workspace not found: ${workspace}` }; }
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** The canvas folder, realpath'd and confirmed inside the workspace. `create` makes it. */
function canvasDir(real: string, create: boolean): { ok: true; dir: string | null } | { ok: false; error: string } {
  const dir = path.join(real, '.sai', 'canvas');
  if (create) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { return { ok: false, error: `cannot create ${dir}: ${(err as Error).message}` }; }
  }
  let resolved: string;
  try { resolved = fs.realpathSync(dir); } catch { return { ok: true, dir: null }; }
  if (!inside(real, resolved)) return { ok: false, error: '.sai/canvas resolves outside the workspace' };
  return { ok: true, dir: resolved };
}

function names(dir: string | null): string[] {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.md'))
      .map(d => d.name.slice(0, -3))
      .sort();
  } catch { return []; }
}

export function runCanvasFileTool(input: unknown, workspace: string): CanvasFileResult {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const action = i.action;
  if (typeof action !== 'string' || !(CANVAS_ACTIONS as readonly string[]).includes(action) || action === 'open') {
    if (action === 'open') return { ok: false, error: 'open is handled by the app window' };
    return { ok: false, error: `action must be one of ${CANVAS_ACTIONS.join(', ')}` };
  }
  const ws = realWorkspace(workspace);
  if (!ws.ok) return ws;

  if (action === 'list') {
    const d = canvasDir(ws.real, false);
    if (!d.ok) return d;
    const canvases = names(d.dir).flatMap((name) => {
      const p = path.join(d.dir!, `${name}.md`);
      try { return [{ name, title: canvasTitle(fs.readFileSync(p, 'utf8'), name), path: p }]; } catch { return []; }
    });
    return { ok: true, canvases };
  }

  const n = canvasName(i.name);
  if (!n.ok) return n;

  if (action === 'read') {
    const d = canvasDir(ws.real, false);
    if (!d.ok) return d;
    const p = d.dir ? path.join(d.dir, `${n.name}.md`) : null;
    let content: string | null = null;
    if (p) {
      try { if (fs.lstatSync(p).isFile()) content = fs.readFileSync(p, 'utf8'); } catch { /* missing */ }
    }
    if (content === null || !p) {
      const existing = names(d.dir);
      return { ok: false, error: `no canvas named "${n.name}"${existing.length ? ` (existing: ${existing.join(', ')})` : ''}` };
    }
    return { ok: true, name: n.name, path: p, content };
  }

  // write
  if (typeof i.content !== 'string') return { ok: false, error: 'content (string) is required for write' };
  const d = canvasDir(ws.real, true);
  if (!d.ok) return d;
  if (!d.dir) return { ok: false, error: 'cannot create .sai/canvas' };
  const p = path.join(d.dir, `${n.name}.md`);
  let created = true;
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) return { ok: false, error: `${p} is not a regular file; refusing to write` };
    created = false;
  } catch { /* new canvas */ }
  // Temp + rename: the watcher never sees a half-written file. The temp name
  // doesn't end in .md, so it is never listed as a canvas.
  const tmp = path.join(d.dir, `.${n.name}.md.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, i.content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, p);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: `cannot write ${p}: ${(err as Error).message}` };
  }
  return { ok: true, name: n.name, path: p, created };
}
