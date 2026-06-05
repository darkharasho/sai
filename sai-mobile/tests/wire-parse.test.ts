import { parsePairingUrl, isAllowedPairHost } from '../lib/wire';

describe('parsePairingUrl', () => {
  it('parses a valid pairing URL', () => {
    const r = parsePairingUrl('https://my-mac.tail-abc.ts.net/?code=XYZ123');
    expect(r).toEqual({ baseUrl: 'https://my-mac.tail-abc.ts.net', code: 'XYZ123' });
  });
  it('returns null for missing code', () => {
    expect(parsePairingUrl('https://my-mac.ts.net/')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parsePairingUrl('not a url')).toBeNull();
  });
});

describe('isAllowedPairHost', () => {
  it('accepts ts.net hosts', () => {
    expect(isAllowedPairHost('my-mac.tail-abc.ts.net')).toBe(true);
  });
  it('accepts CGNAT range', () => {
    expect(isAllowedPairHost('100.64.5.10')).toBe(true);
  });
  it('accepts localhost', () => {
    expect(isAllowedPairHost('localhost')).toBe(true);
    expect(isAllowedPairHost('127.0.0.1')).toBe(true);
  });
  it('rejects public hosts', () => {
    expect(isAllowedPairHost('evil.com')).toBe(false);
    expect(isAllowedPairHost('8.8.8.8')).toBe(false);
  });
});
