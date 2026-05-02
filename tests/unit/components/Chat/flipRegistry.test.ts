import { describe, it, expect, beforeEach } from 'vitest';
import { setFlipRect, consumeFlipRect, hasFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

const fakeRect = (x = 0, y = 0, w = 100, h = 40): DOMRect => ({
  x, y, width: w, height: h,
  left: x, top: y, right: x + w, bottom: y + h,
  toJSON: () => ({}),
}) as DOMRect;

describe('flipRegistry', () => {
  beforeEach(() => { _resetFlipRegistry(); });

  it('returns undefined when no rect is registered for an id', () => {
    expect(consumeFlipRect('missing')).toBeUndefined();
    expect(hasFlipRect('missing')).toBe(false);
  });

  it('hasFlipRect is true after set and false after consume', () => {
    setFlipRect('msg-h', fakeRect());
    expect(hasFlipRect('msg-h')).toBe(true);
    consumeFlipRect('msg-h');
    expect(hasFlipRect('msg-h')).toBe(false);
  });

  it('returns a registered rect once and then deletes it', () => {
    const rect = fakeRect(10, 20, 300, 80);
    setFlipRect('msg-1', rect);
    expect(consumeFlipRect('msg-1')).toBe(rect);
    expect(consumeFlipRect('msg-1')).toBeUndefined();
  });

  it('keeps rects for different ids independent', () => {
    const a = fakeRect(1, 1);
    const b = fakeRect(2, 2);
    setFlipRect('a', a);
    setFlipRect('b', b);
    expect(consumeFlipRect('b')).toBe(b);
    expect(consumeFlipRect('a')).toBe(a);
  });

  it('overwrites an existing rect when set twice for the same id', () => {
    const a = fakeRect(1, 1);
    const b = fakeRect(2, 2);
    setFlipRect('x', a);
    setFlipRect('x', b);
    expect(consumeFlipRect('x')).toBe(b);
  });
});
