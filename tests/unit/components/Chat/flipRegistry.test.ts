import { describe, it, expect, beforeEach } from 'vitest';
import { setFlipRect, readFlipRect, hasFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

const fakeRect = (x = 0, y = 0, w = 100, h = 40): DOMRect => ({
  x, y, width: w, height: h,
  left: x, top: y, right: x + w, bottom: y + h,
  toJSON: () => ({}),
}) as DOMRect;

describe('flipRegistry', () => {
  beforeEach(() => { _resetFlipRegistry(); });

  it('returns undefined when no rect is registered for an id', () => {
    expect(readFlipRect('missing')).toBeUndefined();
    expect(hasFlipRect('missing')).toBe(false);
  });

  it('reads are non-destructive — same rect returned across calls', () => {
    const rect = fakeRect(10, 20, 300, 80);
    setFlipRect('msg-1', rect);
    expect(readFlipRect('msg-1')).toBe(rect);
    expect(readFlipRect('msg-1')).toBe(rect);
    expect(hasFlipRect('msg-1')).toBe(true);
  });

  it('setFlipRect clears any prior entry — only the latest rect is retained', () => {
    setFlipRect('old', fakeRect(1, 1));
    setFlipRect('new', fakeRect(2, 2));
    expect(readFlipRect('old')).toBeUndefined();
    expect(readFlipRect('new')).toBeDefined();
  });

  it('overwrites an existing rect when set twice for the same id', () => {
    const a = fakeRect(1, 1);
    const b = fakeRect(2, 2);
    setFlipRect('x', a);
    setFlipRect('x', b);
    expect(readFlipRect('x')).toBe(b);
  });
});
