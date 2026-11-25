import { canvasName } from '../lib/canvasName';
import { canvasKey } from './canvasFiles';

export interface CanvasOpenDeps {
  activeWorkspace: string | null;
  canvasList: (workspace: string) => Promise<{ path: string; content: string }[]>;
  openCanvas: (path: string) => void;
}

/**
 * `sai_canvas` action "open": show a canvas in the chat's canvas sidebar. Only in the workspace the user
 * is viewing; a background workspace's canvas would otherwise switch tabs behind their back.
 */
export async function handleCanvasOpen(input: unknown, workspace: string, deps: CanvasOpenDeps) {
  const n = canvasName((input as { name?: unknown } | null)?.name);
  if (!n.ok) throw new Error(n.error);
  const canvases = await deps.canvasList(workspace);
  const hit = canvases.find((c) => canvasKey(c.path).endsWith(`/.sai/canvas/${n.name}.md`));
  if (!hit) {
    const existing = canvases.map((c) => canvasKey(c.path).replace(/^.*\//, '').replace(/\.md$/, '')).sort();
    throw new Error(`no canvas named "${n.name}"${existing.length ? ` (existing: ${existing.join(', ')})` : ''}`);
  }
  if (!deps.activeWorkspace || canvasKey(deps.activeWorkspace) !== canvasKey(workspace)) {
    return { ok: true, opened: false, path: hit.path, note: 'The user is viewing another workspace; it shows in that chat\'s canvas sidebar when they switch back.' };
  }
  deps.openCanvas(hit.path);
  return { ok: true, opened: true, path: hit.path };
}
