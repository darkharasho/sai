import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRenderModelRequest } from '../../../src/render/renderModelTool';
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
});
