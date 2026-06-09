import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureRenderRegion } from '../../../src/render/captureRenderRegion';

const REAL_RECT = { x: 10, y: 20, width: 100, height: 50, top: 20, left: 10, right: 110, bottom: 70, toJSON() {} } as DOMRect;

function mountRegion(renderId: string, rect: DOMRect = REAL_RECT): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-render-region', renderId);
  // jsdom returns a zero rect by default; stub a real layout box.
  el.getBoundingClientRect = () => rect;
  document.body.appendChild(el);
  return el;
}

const FAST = { timeoutMs: 80, intervalMs: 5 };

describe('captureRenderRegion', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    delete (window as any).sai;
  });

  it('rejects an invalid renderId before touching the DOM', async () => {
    await expect(captureRenderRegion('bad id!', FAST)).rejects.toThrow(/invalid renderId/);
  });

  it('times out when the region never appears', async () => {
    await expect(captureRenderRegion('missing', FAST)).rejects.toThrow(/not found or not visible/);
  });

  it('times out when the region is present but has a zero-size box', async () => {
    const zero = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
    mountRegion('mcp-zero', zero);
    await expect(captureRenderRegion('mcp-zero', FAST)).rejects.toThrow(/not found or not visible/);
  });

  it('measures the region and returns the captured png', async () => {
    mountRegion('mcp-abc');
    const captureRegion = vi.fn(async () => 'BASE64PNG');
    (window as any).sai = { captureRegion };
    const result = await captureRenderRegion('mcp-abc', FAST);
    expect(captureRegion).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 50 });
    expect(result).toEqual({ base64: 'BASE64PNG', mimeType: 'image/png' });
  });

  it('waits for a region that appears slightly later', async () => {
    (window as any).sai = { captureRegion: vi.fn(async () => 'LATE') };
    setTimeout(() => mountRegion('mcp-late'), 20);
    const result = await captureRenderRegion('mcp-late', { timeoutMs: 500, intervalMs: 5 });
    expect(result.base64).toBe('LATE');
  });

  it('rejects when capture returns no image', async () => {
    mountRegion('mcp-empty');
    (window as any).sai = { captureRegion: vi.fn(async () => null) };
    await expect(captureRenderRegion('mcp-empty', FAST)).rejects.toThrow(/no image/);
  });
});
