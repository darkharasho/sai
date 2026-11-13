import type { ModelExt } from '../model3d/modelFiles';
import type { CapturedImage } from './handleRenderToolRequest';
import { renderStore } from './renderStore';

type Size = { x: number; y: number; z: number };

export type RenderModelResult =
  | {
      ok: true;
      renderId: string;
      model: { versionKey: string; path: string; triangles: number; size: Size };
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
  } catch {
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

  renderStore.upsert({
    renderId: req.renderId,
    kind: 'model',
    payload: { path: snap.absPath, versionKey: snap.versionKey, ext: snap.ext },
    title: (typeof input.title === 'string' && input.title) || basename(path),
    width: 480,
    height: typeof input.height === 'number' ? input.height : 360,
    status: 'ready',
  });

  if (input.openInPanel !== false) deps.openInPanel(snap.absPath);

  return {
    ok: true,
    renderId: req.renderId,
    model: { versionKey: snap.versionKey, path: snap.absPath, triangles, size },
    ...(image ? { __mcpImage: image } : {}),
  };
}
