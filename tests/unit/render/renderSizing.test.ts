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
