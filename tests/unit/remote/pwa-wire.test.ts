import { describe, it, expect } from 'vitest';
import { extractPairCode, BEARER_KEY } from '@/renderer-remote/wire';

describe('PWA wire helpers', () => {
  it('extracts ?code= from URL', () => {
    expect(extractPairCode('https://x.y/?code=abc123')).toBe('abc123');
    expect(extractPairCode('https://x.y/?other=1&code=zz')).toBe('zz');
    expect(extractPairCode('https://x.y/')).toBeNull();
  });

  it('exposes a stable localStorage key', () => {
    expect(BEARER_KEY).toBe('sai-remote-bearer');
  });
});
