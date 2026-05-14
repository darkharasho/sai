import { describe, it, expect } from 'vitest';
import { owningLink, isCrossProjectMove } from '@/lib/syntheticRoot';

describe('owningLink', () => {
  const root = '/meta/root';

  it('returns the first segment under the synthetic root', () => {
    expect(owningLink('/meta/root/projA/src/index.ts', root)).toBe('projA');
  });

  it('returns the segment when the path is the link directory itself', () => {
    expect(owningLink('/meta/root/projA', root)).toBe('projA');
  });

  it('returns null when the path is not under the synthetic root', () => {
    expect(owningLink('/other/place/file.ts', root)).toBeNull();
  });

  it('returns null when the path equals the synthetic root', () => {
    expect(owningLink('/meta/root', root)).toBeNull();
    expect(owningLink('/meta/root/', root)).toBeNull();
  });

  it('handles backslash separators', () => {
    expect(owningLink('/meta/root\\projB\\file.ts', root)).toBe('projB');
  });
});

describe('isCrossProjectMove', () => {
  const root = '/meta/root';

  it('is true when src and dst belong to different links', () => {
    expect(
      isCrossProjectMove('/meta/root/projA/x.ts', '/meta/root/projB/x.ts', root)
    ).toBe(true);
  });

  it('is false when src and dst belong to the same link', () => {
    expect(
      isCrossProjectMove('/meta/root/projA/x.ts', '/meta/root/projA/sub/y.ts', root)
    ).toBe(false);
  });

  it('is false when either path is outside the synthetic root', () => {
    expect(
      isCrossProjectMove('/elsewhere/x.ts', '/meta/root/projA/x.ts', root)
    ).toBe(false);
    expect(
      isCrossProjectMove('/meta/root/projA/x.ts', '/elsewhere/x.ts', root)
    ).toBe(false);
  });
});
