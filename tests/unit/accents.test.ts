import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACCENTS,
  DEFAULT_ACCENT,
  accentVars,
  applyAccent,
  getAccent,
  hexToRgb,
  isAccentId,
  resolveAccentId,
} from '../../src/accents';

describe('accent presets', () => {
  it('includes gold as the default preset', () => {
    expect(DEFAULT_ACCENT).toBe('gold');
    const gold = getAccent('gold');
    expect(gold.base).toBe('#d4a017');
    expect(gold.hover).toBe('#f0b820');
  });

  it('has unique ids and valid hex pairs for every preset', () => {
    const ids = ACCENTS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACCENTS) {
      for (const hex of [a.base, a.hover, a.mid, a.far]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(a.label.length).toBeGreaterThan(0);
    }
  });

  it('falls back to gold for unknown ids', () => {
    expect(getAccent('nope' as never).id).toBe('gold');
  });
});

describe('hexToRgb', () => {
  it('parses 6-char hex', () => {
    expect(hexToRgb('#d4a017')).toEqual({ r: 212, g: 160, b: 23 });
  });

  it('parses 3-char shorthand', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('tolerates a missing leading hash', () => {
    expect(hexToRgb('4a9fd4')).toEqual({ r: 74, g: 159, b: 212 });
  });
});

describe('accentVars', () => {
  it('derives the full accent variable set from the base color', () => {
    expect(accentVars(getAccent('gold'))).toEqual({
      '--accent': '#d4a017',
      '--accent-hover': '#f0b820',
      '--accent-2': '#d4770c',
      '--accent-3': '#e35535',
      '--accent-dim': 'rgba(212, 160, 23, 0.12)',
      '--accent-rgb': '212, 160, 23',
      '--border-accent': 'rgba(212, 160, 23, 0.35)',
    });
  });

  it("keeps gold's companion stops equal to the app's original --orange/--red", () => {
    // The classic composer sweep must not shift when it moved off those vars.
    expect(getAccent('gold').mid).toBe('#d4770c');
    expect(getAccent('gold').far).toBe('#e35535');
  });

  it('gives every preset its own companion stops', () => {
    const vars = accentVars(getAccent('sage'));
    expect(vars['--accent-2']).toBe(getAccent('sage').mid);
    expect(vars['--accent-3']).toBe(getAccent('sage').far);
    expect(vars['--accent-2']).not.toBe(getAccent('gold').mid);
  });

  it('derives tints from each preset base, not from gold', () => {
    const vars = accentVars(getAccent('azure'));
    const { r, g, b } = hexToRgb(getAccent('azure').base);
    expect(vars['--accent-rgb']).toBe(`${r}, ${g}, ${b}`);
    expect(vars['--accent-dim']).toBe(`rgba(${r}, ${g}, ${b}, 0.12)`);
    expect(vars['--border-accent']).toBe(`rgba(${r}, ${g}, ${b}, 0.35)`);
  });
});

describe('isAccentId', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isAccentId('violet')).toBe(true);
    expect(isAccentId('gold')).toBe(true);
    expect(isAccentId('chartreuse')).toBe(false);
    expect(isAccentId(undefined)).toBe(false);
    expect(isAccentId(null)).toBe(false);
    expect(isAccentId(7)).toBe(false);
  });
});

describe('resolveAccentId', () => {
  it('prefers an explicit user choice over the theme default', () => {
    expect(resolveAccentId('sage', 'violet')).toBe('sage');
  });

  it('falls back to the theme default when there is no explicit choice', () => {
    expect(resolveAccentId(undefined, 'violet')).toBe('violet');
    expect(resolveAccentId(null, 'violet')).toBe('violet');
  });

  it('ignores an unknown explicit choice', () => {
    expect(resolveAccentId('chartreuse', 'violet')).toBe('violet');
  });

  it('falls back to gold when neither is usable', () => {
    expect(resolveAccentId(undefined, undefined)).toBe('gold');
  });
});

describe('applyAccent', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('writes every accent variable onto the document root', () => {
    applyAccent('violet');
    const style = document.documentElement.style;
    const expected = accentVars(getAccent('violet'));
    for (const [prop, val] of Object.entries(expected)) {
      expect(style.getPropertyValue(prop)).toBe(val);
    }
  });

  it('replaces the previous accent rather than merging with it', () => {
    applyAccent('gold');
    applyAccent('sage');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--accent')).toBe(getAccent('sage').base);
    expect(style.getPropertyValue('--accent-rgb')).not.toContain('212');
  });

  it('returns the resolved accent so callers can reuse it', () => {
    expect(applyAccent('ember')).toEqual(getAccent('ember'));
    expect(applyAccent('bogus' as never)).toEqual(getAccent('gold'));
  });
});
