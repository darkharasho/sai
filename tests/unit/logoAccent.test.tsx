import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, cleanup } from '@testing-library/react';
import SaiLogo from '../../src/components/SaiLogo';
import { bootstrapAppearance, applyTheme, setAccent, getActiveAccentId, getActiveTheme } from '../../src/themes';
import { getAccent } from '../../src/accents';

const SRC = path.resolve(__dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('SaiLogo accent', () => {
  afterEach(cleanup);

  it('defaults to the live accent instead of a fixed gold', () => {
    const { container } = render(<SaiLogo />);
    const svg = container.querySelector('svg')!;
    expect(svg.style.color).toBe('var(--accent)');
  });

  it('still honors an explicit color override', () => {
    const { container } = render(<SaiLogo color="#123456" />);
    expect(container.querySelector('svg')!.style.color).toBe('rgb(18, 52, 86)');
  });

  it('leaves no hardcoded logo gold anywhere in the renderer', () => {
    // The mark's old fixed color. Any survivor is a spot that would stay gold
    // when the user picks another accent.
    const offenders = walk(SRC)
      .filter(f => /c7913b|199,\s*145,\s*59/i.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('bootstrapAppearance', () => {
  const settingsGet = vi.fn();

  beforeEach(() => {
    settingsGet.mockReset();
    document.documentElement.removeAttribute('style');
    setAccent(null);
    applyTheme('default');
    (window as any).sai = { settingsGet };
  });

  afterEach(() => {
    delete (window as any).sai;
  });

  it('paints the saved accent and theme', async () => {
    settingsGet.mockImplementation((key: string) =>
      Promise.resolve(key === 'accent' ? 'sage' : 'midnight'));

    await bootstrapAppearance();

    expect(getActiveAccentId()).toBe('sage');
    // Accent must be applied before the theme, or applyTheme() would repaint
    // with midnight's default accent and stomp the user's choice.
    expect(document.documentElement.style.getPropertyValue('--accent'))
      .toBe(getAccent('sage').base);
  });

  it('falls back to the theme default when no accent was saved', async () => {
    settingsGet.mockImplementation((key: string) =>
      Promise.resolve(key === 'accent' ? null : 'midnight'));

    await bootstrapAppearance();

    expect(getActiveAccentId()).toBe('violet');
  });

  it('ignores an unknown saved theme', async () => {
    settingsGet.mockImplementation((key: string) =>
      Promise.resolve(key === 'accent' ? 'rose' : 'chartreuse'));

    await bootstrapAppearance();

    expect(getActiveAccentId()).toBe('rose');
    expect(getActiveTheme()).toBe('default');
  });

  it('no-ops when the settings bridge is missing', async () => {
    delete (window as any).sai;
    await expect(bootstrapAppearance()).resolves.toBeUndefined();
  });
});
