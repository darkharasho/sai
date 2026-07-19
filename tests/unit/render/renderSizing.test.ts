import { describe, it, expect } from 'vitest';
import { nextRenderWidth, sanitizeCssColor, resolveThemedSurface } from '../../../src/render/renderSizing';

describe('nextRenderWidth', () => {
  it('grows to a larger reported width', () => {
    expect(nextRenderWidth(360, 460, 360)).toBe(460);
  });
  it('never shrinks below the current width', () => {
    expect(nextRenderWidth(460, 380, 360)).toBe(460);
  });
  it('never goes below the requested minimum', () => {
    expect(nextRenderWidth(360, 100, 360)).toBe(360);
  });
  it('ignores non-finite and non-positive reports', () => {
    expect(nextRenderWidth(360, NaN, 360)).toBe(360);
    expect(nextRenderWidth(360, 0, 360)).toBe(360);
    expect(nextRenderWidth(360, -5, 360)).toBe(360);
  });
  it('rounds fractional reports up', () => {
    expect(nextRenderWidth(360, 400.2, 360)).toBe(401);
  });
});

describe('sanitizeCssColor', () => {
  it('accepts hex, rgb(), named colors, and color-mix()', () => {
    expect(sanitizeCssColor('#0a0c0e')).toBe('#0a0c0e');
    expect(sanitizeCssColor('rgb(10, 12, 14)')).toBe('rgb(10, 12, 14)');
    expect(sanitizeCssColor('rebeccapurple')).toBe('rebeccapurple');
    expect(sanitizeCssColor('color-mix(in srgb, red 50%, blue)')).toBe('color-mix(in srgb, red 50%, blue)');
  });
  it('trims whitespace', () => {
    expect(sanitizeCssColor('  #fff  ')).toBe('#fff');
  });
  it('rejects style-attribute breakouts', () => {
    expect(sanitizeCssColor('red;background-image:url(x)')).toBeNull();
    expect(sanitizeCssColor('red" onload="alert(1)')).toBeNull();
    expect(sanitizeCssColor('</style><script>1</script>')).toBeNull();
  });
  it('rejects url() even though its characters pass the charset', () => {
    expect(sanitizeCssColor('url(data:image/svg+xml,x)')).toBeNull();
  });
  it('rejects empty and oversized values', () => {
    expect(sanitizeCssColor('')).toBeNull();
    expect(sanitizeCssColor('a'.repeat(65))).toBeNull();
  });
});

describe('resolveThemedSurface', () => {
  it('falls back to #1a1a1a when --sai-surface is unset', () => {
    expect(resolveThemedSurface()).toBe('#1a1a1a');
  });
  it('returns the documentElement --sai-surface value when set', () => {
    document.documentElement.style.setProperty('--sai-surface', '#101418');
    try {
      expect(resolveThemedSurface()).toBe('#101418');
    } finally {
      document.documentElement.style.removeProperty('--sai-surface');
    }
  });
});

import { createHeightSizer, nextRenderHeight, MAX_RENDER_HEIGHT } from '../../../src/render/renderSizing';

describe('nextRenderHeight', () => {
  it('starts at the minimum viewport', () => {
    expect(createHeightSizer(480).height).toBe(480);
  });
  it('grows to a larger report', () => {
    const s = nextRenderHeight(createHeightSizer(480), 900);
    expect(s.height).toBe(900);
    expect(s.frozen).toBe(false);
  });
  it('never shrinks on a smaller report', () => {
    const grown = nextRenderHeight(createHeightSizer(480), 900);
    expect(nextRenderHeight(grown, 500).height).toBe(900);
  });
  it('never goes below the minimum', () => {
    expect(nextRenderHeight(createHeightSizer(480), 100).height).toBe(480);
  });
  it('caps at MAX_RENDER_HEIGHT', () => {
    expect(nextRenderHeight(createHeightSizer(480), 99999).height).toBe(MAX_RENDER_HEIGHT);
  });
  it('ignores non-finite and non-positive reports', () => {
    const s0 = createHeightSizer(480);
    expect(nextRenderHeight(s0, NaN)).toEqual(s0);
    expect(nextRenderHeight(s0, 0)).toEqual(s0);
    expect(nextRenderHeight(s0, -10)).toEqual(s0);
  });
  it('rounds fractional reports up', () => {
    expect(nextRenderHeight(createHeightSizer(480), 500.2).height).toBe(501);
  });
  it('freezes after three consecutive equal positive increments (vh feedback loop)', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50 applied
    expect(s.height).toBe(530);
    s = nextRenderHeight(s, 580);   // +50 applied (2nd equal)
    expect(s.height).toBe(580);
    s = nextRenderHeight(s, 630);   // +50 would be 3rd equal → frozen, NOT applied
    expect(s.height).toBe(580);
    expect(s.frozen).toBe(true);
    s = nextRenderHeight(s, 4000);  // frozen: ignored
    expect(s.height).toBe(580);
  });
  it('does not freeze on unequal increments', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50
    s = nextRenderHeight(s, 630);   // +100
    s = nextRenderHeight(s, 3000);  // +2370
    expect(s.height).toBe(3000);
    expect(s.frozen).toBe(false);
  });
  it('no-growth reports do not advance the repeat counter', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50
    s = nextRenderHeight(s, 530);   // no growth
    s = nextRenderHeight(s, 530);   // no growth
    s = nextRenderHeight(s, 580);   // +50 (2nd equal)
    s = nextRenderHeight(s, 630);   // 3rd equal → frozen at 580
    expect(s.height).toBe(580);
    expect(s.frozen).toBe(true);
  });
});
