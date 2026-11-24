import type { OpenFile } from '../types';

/**
 * One spelling for a path. This home is a symlink (/home/x -> /var/home/x) and the
 * watcher reports realpaths while tabs keep whatever path opened them, so canvas paths
 * are only ever compared in this form (same rule as sameWorkspace / shortDir).
 */
export function canvasKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/var(?=\/home\/)/, '').replace(/\/+$/, '');
}

/** `<anything>/.sai/canvas/<name>.md`, no deeper nesting. */
export function isCanvasFile(absPath: string): boolean {
  return /\/\.sai\/canvas\/[^/]+\.md$/.test(canvasKey(absPath));
}

/** Project-relative path (`.sai/canvas/x.md`), or `absPath` when it is outside the project. */
export function canvasRelPath(projectPath: string, absPath: string): string {
  const root = canvasKey(projectPath) + '/';
  const p = canvasKey(absPath);
  return p.startsWith(root) ? p.slice(root.length) : absPath;
}

/** True when `absPath` is a canvas of the project at `projectPath`. */
export function isProjectCanvas(projectPath: string, absPath: string): boolean {
  return isCanvasFile(absPath) && canvasRelPath(projectPath, absPath).startsWith('.sai/canvas/');
}

/** `openFiles` without any tab showing the deleted canvas (same array when none match). */
export function closeDeletedCanvas(openFiles: OpenFile[], path: string): OpenFile[] {
  const key = canvasKey(path);
  const next = openFiles.filter((f) => canvasKey(f.path) !== key);
  return next.length === openFiles.length ? openFiles : next;
}

/** The path an existing tab uses for this canvas (any spelling), or null. */
export function findOpenCanvasPath(openFiles: OpenFile[], path: string): string | null {
  const key = canvasKey(path);
  return openFiles.find((f) => canvasKey(f.path) === key)?.path ?? null;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * Focus is in a text entry (Monaco, textarea, contenteditable, text-like input), anywhere,
 * including the canvas block editor. Checkboxes, buttons and other inputs do not count.
 */
export function isTextEntry(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has(((el as HTMLInputElement).getAttribute('type') ?? '').toLowerCase());
  return (el as HTMLElement).isContentEditable || !!el.closest('.monaco-editor');
}

/**
 * Workspaces whose canvases to watch: every workspace with a canvas store (opened this run)
 * that is still open, plus the active one. Sorted for a stable effect key.
 */
export function canvasWatchSet(storeWorkspaces: Iterable<string>, openWorkspaces: Iterable<string>, active: string | null): string[] {
  const open = new Set(openWorkspaces);
  if (active) open.add(active);
  return [...new Set(storeWorkspaces)].filter((ws) => ws && open.has(ws)).sort();
}

/** `ws` has a live chat turn or a live background task in any of its scopes (`${ws}:${scope}`). */
export function workspaceAgentLive<T>(
  ws: string,
  streamingWorkspaces: ReadonlySet<string>,
  tasksByScope: ReadonlyMap<string, readonly T[]>,
  isLive: (t: T) => boolean,
): boolean {
  if (streamingWorkspaces.has(ws)) return true;
  const prefix = `${ws}:`;
  for (const [k, tasks] of tasksByScope) if (k.startsWith(prefix) && tasks.some(isLive)) return true;
  return false;
}

/** A workspace's tabs without the deleted canvas, keeping the active tab valid. */
export function closeDeletedCanvasTabs(
  w: { openFiles: OpenFile[]; activeFilePath: string | null },
  path: string,
): { openFiles: OpenFile[]; activeFilePath: string | null } {
  const openFiles = closeDeletedCanvas(w.openFiles, path);
  if (openFiles === w.openFiles) return w;
  const activeFilePath = openFiles.some((f) => f.path === w.activeFilePath) ? w.activeFilePath : openFiles[0]?.path ?? null;
  return { openFiles, activeFilePath };
}
