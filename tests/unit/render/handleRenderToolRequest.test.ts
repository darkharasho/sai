import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderStore } from '../../../src/render/renderStore';
import { handleRenderToolRequest } from '../../../src/render/handleRenderToolRequest';

beforeEach(() => renderStore._resetForTests());

describe('handleRenderToolRequest', () => {
  const okCapture = () =>
    vi.fn(async (_id: string) => ({ base64: 'PNGDATA', mimeType: 'image/png' as const }));

  it('returns ok + __mcpImage and marks the entry ready', async () => {
    const capture = okCapture();
    const res: any = await handleRenderToolRequest(
      { tool: 'render_html', input: { html: '<b>x</b>' }, renderId: 'r1' },
      { captureRenderRegion: capture },
    );
    expect(res.ok).toBe(true);
    expect(res.renderId).toBe('r1');
    expect(res.__mcpImage).toEqual({ base64: 'PNGDATA', mimeType: 'image/png' });
    expect(renderStore.get('r1')?.status).toBe('ready');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('r1');
  });

  it('returns the validation error and does not capture for bad input', async () => {
    const capture = okCapture();
    const res: any = await handleRenderToolRequest(
      { tool: 'render_html', input: {}, renderId: 'r2' },
      { captureRenderRegion: capture },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('requires a non-empty');
    expect(res.__mcpImage).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('returns ok (best-effort) and marks the entry ready if capture throws', async () => {
    const res: any = await handleRenderToolRequest(
      { tool: 'render_html', input: { html: '<b>x</b>' }, renderId: 'r3' },
      { captureRenderRegion: async () => { throw new Error('capture failed'); } },
    );
    expect(res.ok).toBe(true);
    expect(res.__mcpImage).toBeUndefined();
    expect(renderStore.get('r3')?.status).toBe('ready');
  });

  it('returns ok without __mcpImage when no deps provided', async () => {
    const res: any = await handleRenderToolRequest(
      { tool: 'render_html', input: { html: '<b>x</b>' }, renderId: 'r4' },
      {},
    );
    expect(res.ok).toBe(true);
    expect(res.renderId).toBe('r4');
    expect(res.__mcpImage).toBeUndefined();
    expect(renderStore.get('r4')?.status).toBe('ready');
  });
});
