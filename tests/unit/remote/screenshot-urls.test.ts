import { describe, it, expect } from 'vitest';
import { ScreenshotUrlSigner } from '@electron/services/remote/screenshot-urls';

describe('ScreenshotUrlSigner', () => {
  it('signs and verifies round trip', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1');
    const r = s.verify(url);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('img-1');
  });

  it('rejects tampered signature', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1').replace(/sig=[^&]+/, 'sig=tampered');
    expect(s.verify(url).ok).toBe(false);
  });

  it('rejects replay (single-use)', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1');
    expect(s.verify(url).ok).toBe(true);
    expect(s.verify(url).ok).toBe(false);
  });

  it('produces different URLs for the same id (nonce)', () => {
    const s = new ScreenshotUrlSigner('secret');
    expect(s.sign('img-1')).not.toBe(s.sign('img-1'));
  });
});
