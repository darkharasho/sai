// Accent colors — orthogonal to the background theme in themes.ts.
//
// Every accent-tinted surface in the app reads one of the five CSS variables
// derived here, so setting them on :root recolors the whole UI at once.

export type AccentId = 'gold' | 'ember' | 'violet' | 'azure' | 'sage' | 'rose';

export interface Accent {
  id: AccentId;
  label: string;
  /** Primary accent color. */
  base: string;
  /** Lighter variant for hover/active states. */
  hover: string;
  /** Companion colors for accent gradients (the composer border sweep). */
  mid: string;
  far: string;
}

// Gold's companions are the app's original --orange / --red, so the classic
// composer sweep is unchanged.
export const ACCENTS: Accent[] = [
  { id: 'gold',   label: 'Gold',   base: '#d4a017', hover: '#f0b820', mid: '#d4770c', far: '#e35535' },
  { id: 'ember',  label: 'Ember',  base: '#e0673a', hover: '#f28455', mid: '#e89a3f', far: '#d63a52' },
  { id: 'violet', label: 'Violet', base: '#a07ee8', hover: '#b99af0', mid: '#c47ce4', far: '#6d8ff0' },
  { id: 'azure',  label: 'Azure',  base: '#4a9fd4', hover: '#6bb8e6', mid: '#3fc0d4', far: '#6f7ae8' },
  { id: 'sage',   label: 'Sage',   base: '#2ea87e', hover: '#45c396', mid: '#6cc45f', far: '#2e9fa8' },
  { id: 'rose',   label: 'Rose',   base: '#e0709a', hover: '#f08cb1', mid: '#e87ec4', far: '#d9556b' },
];

export const DEFAULT_ACCENT: AccentId = 'gold';

export function isAccentId(v: unknown): v is AccentId {
  return typeof v === 'string' && ACCENTS.some(a => a.id === v);
}

export function getAccent(id: AccentId): Accent {
  return ACCENTS.find(a => a.id === id) ?? ACCENTS[0];
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/** The CSS custom properties an accent contributes to :root. */
export function accentVars(a: Accent): Record<string, string> {
  const { r, g, b } = hexToRgb(a.base);
  const rgb = `${r}, ${g}, ${b}`;
  return {
    '--accent': a.base,
    '--accent-hover': a.hover,
    '--accent-2': a.mid,                    // gradient companion stops
    '--accent-3': a.far,
    '--accent-dim': `rgba(${rgb}, 0.12)`,   // icon bg, selection tints
    '--accent-rgb': rgb,                    // for rgba() usage
    '--border-accent': `rgba(${rgb}, 0.35)`, // selected/highlighted borders
  };
}

/**
 * An explicit user choice wins; otherwise follow the active theme's default;
 * otherwise gold.
 */
export function resolveAccentId(explicit: unknown, themeDefault: unknown): AccentId {
  if (isAccentId(explicit)) return explicit;
  if (isAccentId(themeDefault)) return themeDefault;
  return DEFAULT_ACCENT;
}

/** Paint an accent onto the document root. Returns the accent actually applied. */
export function applyAccent(id: AccentId): Accent {
  const accent = getAccent(id);
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(accentVars(accent))) {
    root.style.setProperty(prop, val);
  }
  return accent;
}
