import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, setAccent, getActiveAccentId, getTerminalTheme } from '../../src/themes';
import { getAccent } from '../../src/accents';

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('theme + accent integration', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    setAccent(null);
    applyTheme('default');
  });

  it('paints the theme default accent when the user has not picked one', () => {
    applyTheme('midnight');
    expect(getActiveAccentId()).toBe('violet');
    expect(cssVar('--accent')).toBe(getAccent('violet').base);
  });

  it('derives the dim/rgb tints from the theme accent, not from gold', () => {
    applyTheme('midnight');
    // Regression: these vars used to be hardcoded gold in globals.css, so
    // non-default themes leaked gold selection tints.
    expect(cssVar('--accent-rgb')).toBe('160, 126, 232');
    expect(cssVar('--accent-dim')).toBe('rgba(160, 126, 232, 0.12)');
    expect(cssVar('--border-accent')).toBe('rgba(160, 126, 232, 0.35)');
  });

  it('keeps an explicit accent across theme switches', () => {
    setAccent('sage');
    applyTheme('midnight');
    expect(getActiveAccentId()).toBe('sage');
    expect(cssVar('--accent')).toBe(getAccent('sage').base);
    applyTheme('steel');
    expect(cssVar('--accent')).toBe(getAccent('sage').base);
  });

  it('returns to the theme default when the explicit accent is cleared', () => {
    setAccent('sage');
    applyTheme('steel');
    setAccent(null);
    expect(getActiveAccentId()).toBe('azure');
  });

  it('moves the composer gradient companions with the accent', () => {
    applyTheme('midnight');
    expect(cssVar('--accent-2')).toBe(getAccent('violet').mid);
    expect(cssVar('--accent-3')).toBe(getAccent('violet').far);
    setAccent('gold');
    // Gold restores the original warm sweep exactly.
    expect(cssVar('--accent-2')).toBe('#d4770c');
    expect(cssVar('--accent-3')).toBe('#e35535');
  });

  it('leaves non-accent theme vars alone when only the accent changes', () => {
    applyTheme('midnight');
    const bg = cssVar('--bg-primary');
    setAccent('rose');
    expect(cssVar('--bg-primary')).toBe(bg);
    expect(cssVar('--accent')).toBe(getAccent('rose').base);
  });

  it('drives the terminal cursor and selection from the accent', () => {
    setAccent('rose');
    const term = getTerminalTheme('default');
    expect(term.cursor).toBe(getAccent('rose').base);
    expect(term.selectionBackground).toBe(`${getAccent('rose').base}44`);
    // ANSI yellow is semantic and must not follow the accent
    expect(term.yellow).toBe('#c7910c');
    expect(term.background).toBe('#0e1114');
  });

  it('tells the terminal about a live accent change', () => {
    const onThemeChange = vi.fn();
    window.addEventListener('sai-theme-change', onThemeChange);
    setAccent('ember');
    window.removeEventListener('sai-theme-change', onThemeChange);

    expect(onThemeChange).toHaveBeenCalled();
    const detail = onThemeChange.mock.calls.at(-1)![0].detail;
    expect(detail.terminal.cursor).toBe(getAccent('ember').base);
  });
});
