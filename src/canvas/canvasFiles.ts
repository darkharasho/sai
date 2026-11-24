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

/** Focus is in a text editor/field that is not part of a canvas view. */
export function isEditingOutsideCanvas(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  const editable =
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'INPUT' ||
    (el as HTMLElement).isContentEditable ||
    !!el.closest('.monaco-editor');
  return editable && !el.closest('.canvas-view');
}
