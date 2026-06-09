import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureRenderRegion } from '../../../src/render/captureRenderRegion';

function mountRegion(renderId: string): void {
  const el = document.createElement('div');
  el.setAttribute('data-render-region', renderId);
  // jsdom returns a zero rect from getBoundingClientRect by default; stub a real one.
  el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 50, top: 20, left: 10, right: 110, bottom: 70, toJSON() {} }) as DOMRect;
  document.body.appendChild(el);
}

describe('captureRenderRegion', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    delete (window as any).sai;
  });

  it('rejects an invalid renderId before touching the DOM', async () => {
    await expect(captureRenderRegion('bad id!')).rejects.toThrow(/invalid renderId/);
  });

  it('rejects when the render region is not in the DOM', async () => {
    await expect(captureRenderRegion('does-not-exist')).rejects.toThrow(/not found/);
  });

  it('measures the region and returns the captured png', async () => {
    mountRegion('mcp-abc');
    const captureRegion = vi.fn(async () => 'BASE64PNG');
    (window as any).sai = { captureRegion };
    const result = await captureRenderRegion('mcp-abc');
    expect(captureRegion).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 50 });
    expect(result).toEqual({ base64: 'BASE64PNG', mimeType: 'image/png' });
  });

  it('rejects when capture returns no image', async () => {
    mountRegion('mcp-empty');
    (window as any).sai = { captureRegion: vi.fn(async () => null) };
    await expect(captureRenderRegion('mcp-empty')).rejects.toThrow(/no image/);
  });
});
