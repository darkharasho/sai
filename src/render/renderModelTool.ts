import type { ModelExt } from '../model3d/modelFiles';
import type { CapturedImage } from './handleRenderToolRequest';
import { renderStore } from './renderStore';

type Size = { x: number; y: number; z: number };

export type RenderModelResult =
  | {
      ok: true;
      renderId: string;
      model: { versionKey: string; path: string; openPath: string; triangles: number; size: Size };
      __mcpImage?: CapturedImage;
    }
  | { ok: false; error: string };

export interface RenderModelDeps {
  snapshot: (args: { cwd: string; path: string }) => Promise<
    { ok: true; versionKey: string; ext: ModelExt; absPath: string; bytes: number } | { ok: false; error: string }
  >;
  readCached: (versionKey: string) => Promise<ArrayBuffer | null>;
  thumbnail: (buf: ArrayBuffer, ext: ModelExt) => Promise<{ base64: string; triangles: number; size: Size }>;
  openInPanel: (absPath: string) => void;
}

/** Resolve against cwd WITHOUT realpath so it matches the tab paths the editor uses. */
export function resolveOpenPath(cwd: string, p: string): string {
  const isAbs = p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
  const joined = isAbs || !cwd ? p : `${cwd.replace(/[\\/]+$/, '')}/${p}`;
  const lead = joined.startsWith('/') ? '/' : '';
  const out: string[] = [];
  for (const seg of joined.split(/[\\/]/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!lead) out.push('..'); continue; }
    out.push(seg);
  }
  return lead + out.join('/');
}

const normWs = (p: string) => p.replace(/^\/var\/home\//, '/home/').replace(/[\\/]+$/, '');

/**
 * Pick the cwd for a render_model call and whether it may touch the code panel.
 * When the agent's workspace IS the viewed one, resolve against the viewed
 * spelling (e.g. /home/… not /var/home/…) so the opened path matches existing
 * editor tabs instead of opening a duplicate.
 */
export function resolveRenderModelCwd(workspace: string | undefined, active: string): { cwd: string; sameWs: boolean } {
  const sameWs = !workspace || (!!active && normWs(workspace) === normWs(active));
  const cwd = sameWs ? (active || workspace || '') : workspace!;
  return { cwd, sameWs };
}

export const clampModelHeight =(h: unknown, dflt = 360) =>
  typeof h === 'number' && Number.isFinite(h) ? Math.min(1200, Math.max(160, h)) : dflt;

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export async function handleRenderModelRequest(
  req: { input: any; renderId: string; cwd: string },
  deps: RenderModelDeps,
): Promise<RenderModelResult> {
  const input = req.input ?? {};
  const path = typeof input.path === 'string' ? input.path : '';
  if (!path) return { ok: false, error: 'path is required' };

  const snap = await deps.snapshot({ cwd: req.cwd, path });
  if (!snap.ok) return { ok: false, error: snap.error };

  let triangles = 0;
  let size: Size = { x: 0, y: 0, z: 0 };
  let image: CapturedImage | undefined;
  try {
    const buf = await deps.readCached(snap.versionKey);
    if (!buf) throw new Error('cached model missing');
    const t = await deps.thumbnail(buf, snap.ext);
    triangles = t.triangles;
    size = t.size;
    image = { base64: t.base64, mimeType: 'image/png' };
  } catch (err) {
    console.warn('[render_model] thumbnail failed', err);
    // Best-effort: still report triangles/size if the mesh parses.
    try {
      const buf = await deps.readCached(snap.versionKey);
      if (buf) {
        const { parseModel } = await import('../model3d/parseModel');
        const p = await parseModel(buf, snap.ext);
        triangles = p.triangles;
        size = { x: p.size.x, y: p.size.y, z: p.size.z };
      }
    } catch { /* leave zeros */ }
  }

  const openPath = resolveOpenPath(req.cwd, path);
  renderStore.upsert({
    renderId: req.renderId,
    kind: 'model',
    payload: { path: openPath, versionKey: snap.versionKey, ext: snap.ext },
    title: (typeof input.title === 'string' && input.title) || basename(path),
    width: 480,
    height: clampModelHeight(input.height),
    status: 'ready',
  });

  if (input.openInPanel !== false) deps.openInPanel(openPath);

  return {
    ok: true,
    renderId: req.renderId,
    model: { versionKey: snap.versionKey, path: snap.absPath, openPath, triangles, size },
    ...(image ? { __mcpImage: image } : {}),
  };
}
