import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRenderModelRequest, resolveRenderModelCwd, resolveOpenPath } from '../../../src/render/renderModelTool';
import { renderStore } from '../../../src/render/renderStore';

const snap = { ok: true as const, versionKey: 'k'.repeat(32), ext: 'stl' as const, absPath: '/p/part.stl', bytes: 10 };
const img = { base64: 'AAAA', triangles: 12, size: { x: 1, y: 2, z: 3 } };

function mkDeps(over: Record<string, unknown> = {}) {
  return {
    snapshot: vi.fn(async () => snap),
    readCached: vi.fn(async () => new ArrayBuffer(4)),
    thumbnail: vi.fn(async () => img),
    openInPanel: vi.fn(),
    ...over,
  } as any;
}
const req = (input: any = { path: 'part.stl' }) => ({ input, renderId: 'r1', cwd: '/p' });

describe('handleRenderModelRequest', () => {
  beforeEach(() => renderStore._resetForTests());

  it('happy path: snapshot, thumbnail, store upsert, opens panel once', async () => {
    const deps = mkDeps();
    const res: any = await handleRenderModelRequest(req(), deps);
    expect(res.ok).toBe(true);
    expect(res.model.versionKey).toBe(snap.versionKey);
    expect(res.model.triangles).toBe(12);
    expect(res.__mcpImage).toEqual({ base64: 'AAAA', mimeType: 'image/png' });
    const e = renderStore.get('r1')!;
    expect(e.kind).toBe('model');
    expect(e.payload).toEqual({ path: '/p/part.stl', versionKey: snap.versionKey, ext: 'stl' });
    expect(e.title).toBe('part.stl');
    expect(e.status).toBe('ready');
    expect(deps.openInPanel).toHaveBeenCalledTimes(1);
    expect(deps.openInPanel).toHaveBeenCalledWith('/p/part.stl');
  });

  it('openInPanel:false never opens', async () => {
    const deps = mkDeps();
    await handleRenderModelRequest(req({ path: 'part.stl', openInPanel: false }), deps);
    expect(deps.openInPanel).not.toHaveBeenCalled();
  });

  it('passes snapshot errors through without upserting', async () => {
    const deps = mkDeps({ snapshot: vi.fn(async () => ({ ok: false, error: 'nope' })) });
    const res = await handleRenderModelRequest(req(), deps);
    expect(res).toEqual({ ok: false, error: 'nope' });
    expect(renderStore.get('r1')).toBeUndefined();
  });

  it('thumbnail failure is best-effort', async () => {
    const deps = mkDeps({ thumbnail: vi.fn(async () => { throw new Error('webgl'); }) });
    const res: any = await handleRenderModelRequest(req(), deps);
    expect(res.ok).toBe(true);
    expect(res.__mcpImage).toBeUndefined();
    expect(renderStore.get('r1')).toBeTruthy();
  });

  it('opens the agent-supplied path resolved against cwd, not the realpath', async () => {
    const deps = mkDeps({ snapshot: vi.fn(async () => ({ ...snap, absPath: '/var/home/u/proj/part.stl' })) });
    const res: any = await handleRenderModelRequest({ input: { path: 'sub/../part.stl' }, renderId: 'r1', cwd: '/home/u/proj/' }, deps);
    expect(deps.openInPanel).toHaveBeenCalledWith('/home/u/proj/part.stl');
    expect(res.model.openPath).toBe('/home/u/proj/part.stl');
    expect(res.model.path).toBe('/var/home/u/proj/part.stl');
    expect(renderStore.get('r1')!.payload).toMatchObject({ path: '/home/u/proj/part.stl' });
  });

  it('absolute input path is used as-is for opening', async () => {
    const deps = mkDeps();
    await handleRenderModelRequest({ input: { path: '/home/u/a.stl' }, renderId: 'r1', cwd: '/p' }, deps);
    expect(deps.openInPanel).toHaveBeenCalledWith('/home/u/a.stl');
  });

  it('clamps height to 160..1200', async () => {
    await handleRenderModelRequest(req({ path: 'part.stl', height: 5 }), mkDeps());
    expect(renderStore.get('r1')!.height).toBe(160);
    await handleRenderModelRequest(req({ path: 'part.stl', height: 99999 }), mkDeps());
    expect(renderStore.get('r1')!.height).toBe(1200);
    await handleRenderModelRequest(req({ path: 'part.stl' }), mkDeps());
    expect(renderStore.get('r1')!.height).toBe(360);
  });

  it('logs thumbnail failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handleRenderModelRequest(req(), mkDeps({ thumbnail: vi.fn(async () => { throw new Error('webgl'); }) }));
    expect(warn).toHaveBeenCalledWith('[render_model] thumbnail failed', expect.any(Error));
    warn.mockRestore();
  });
});

describe('resolveRenderModelCwd', () => {
  it('uses the viewed spelling when the agent workspace is the viewed one via the /var/home symlink', () => {
    const r = resolveRenderModelCwd('/var/home/u/proj', '/home/u/proj');
    expect(r).toEqual({ cwd: '/home/u/proj', sameWs: true });
    // relative path now resolves to the same string as the editor's tab
    expect(resolveOpenPath(r.cwd, 'out/part.stl')).toBe('/home/u/proj/out/part.stl');
  });
  it('falls back to the active workspace when the agent gives none', () => {
    expect(resolveRenderModelCwd(undefined, '/home/u/proj')).toEqual({ cwd: '/home/u/proj', sameWs: true });
  });
  it('keeps the agent workspace and never opens the panel for a background workspace', () => {
    expect(resolveRenderModelCwd('/home/u/other', '/home/u/proj')).toEqual({ cwd: '/home/u/other', sameWs: false });
  });
  it('treats an agent workspace with no active project as background', () => {
    expect(resolveRenderModelCwd('/home/u/proj', '')).toEqual({ cwd: '/home/u/proj', sameWs: false });
  });
});
