import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore } from '../../../src/render/renderStore';
import { handleRenderToolRequest } from '../../../src/render/handleRenderToolRequest';

beforeEach(() => renderStore._resetForTests());

describe('handleRenderToolRequest', () => {
  const deps = {
    captureRenderRegion: async (_id: string) => ({ base64: 'PNGDATA', mimeType: 'image/png' as const }),
  };

  it('returns ok + __mcpImage and marks the entry ready', async () => {
    const res: any = await handleRenderToolRequest({ tool: 'render_html', input: { html: '<b>x</b>' }, renderId: 'r1' }, deps);
    expect(res.ok).toBe(true);
    expect(res.renderId).toBe('r1');
    expect(res.__mcpImage).toEqual({ base64: 'PNGDATA', mimeType: 'image/png' });
    expect(renderStore.get('r1')?.status).toBe('ready');
  });

  it('returns the validation error and does not capture for bad input', async () => {
    const res: any = await handleRenderToolRequest({ tool: 'render_html', input: {}, renderId: 'r2' }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('requires a non-empty');
    expect(res.__mcpImage).toBeUndefined();
  });

  it('marks the entry error and returns the message if capture throws', async () => {
    const res: any = await handleRenderToolRequest(
      { tool: 'render_component', input: { component: 'WorkspaceSquircle' }, renderId: 'r3' },
      { captureRenderRegion: async () => { throw new Error('capture failed'); } },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('capture failed');
    expect(renderStore.get('r3')?.status).toBe('error');
  });
});
