import { describe, it, expect } from 'vitest';
import { captureRenderRegion } from '../../../src/render/captureRenderRegion';

describe('captureRenderRegion', () => {
  it('rejects when the render region is not in the DOM', async () => {
    await expect(captureRenderRegion('does-not-exist')).rejects.toThrow(/not found/);
  });
});
