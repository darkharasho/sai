export type KeybindingId =
  | 'palette.open'
  | 'chatHistory.toggle'
  | 'search.toggle'
  | 'markdownPreview.toggle';

export type KeyCombo = string;       // canonical, e.g. 'Ctrl+K' or '' (unbound)

export interface KeybindingDef {
  id: KeybindingId;
  label: string;
  defaultCombo: KeyCombo;
  description?: string;
}

export const KEYBINDINGS: KeybindingDef[] = [
  { id: 'palette.open',           label: 'Open command palette',        defaultCombo: 'Ctrl+K' },
  { id: 'chatHistory.toggle',     label: 'Toggle chat history sidebar', defaultCombo: 'Ctrl+H' },
  { id: 'search.toggle',          label: 'Toggle search sidebar',       defaultCombo: 'Ctrl+Shift+F' },
  { id: 'markdownPreview.toggle', label: 'Toggle markdown preview',     defaultCombo: 'Ctrl+Shift+M' },
];

const SPECIAL_KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};

function normalizeKey(key: string): string {
  if (key in SPECIAL_KEY_MAP) return SPECIAL_KEY_MAP[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Convert a KeyboardEvent into a canonical combo string.
 * Pure-modifier events return ''.
 * Cmd is collapsed to Ctrl so combos work cross-platform.
 */
export function eventToCombo(e: KeyboardEvent): KeyCombo {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: '⌘',
  Alt: '⌥',
  Shift: '⇧',
};

export type Platform = 'mac' | 'linux' | 'windows';

// macOS standard modifier display order: Alt(⌥), Shift(⇧), Ctrl/Cmd(⌘)
const MAC_MOD_ORDER = ['Alt', 'Shift', 'Ctrl'];

/**
 * Render a combo for display. On macOS, modifiers become symbols and the
 * key is appended directly (in standard macOS order: ⌥⇧⌘). On
 * Linux/Windows, return the verbatim string.
 */
export function formatCombo(combo: KeyCombo, platform: Platform): string {
  if (!combo) return '—';
  if (platform !== 'mac') return combo;
  const parts = combo.split('+');
  const key = parts.pop()!;
  const modSet = new Set(parts);
  const modSyms = MAC_MOD_ORDER
    .filter(m => modSet.has(m))
    .map(m => MAC_SYMBOLS[m] ?? m)
    .join('');
  return `${modSyms}${key}`;
}

/**
 * Return the id of the binding currently assigned to `combo` (other than
 * `selfId`), or null if unassigned.
 */
export function findConflict(
  selfId: KeybindingId,
  combo: KeyCombo,
  overrides: Partial<Record<KeybindingId, KeyCombo>>,
): KeybindingId | null {
  if (!combo) return null;
  for (const def of KEYBINDINGS) {
    if (def.id === selfId) continue;
    const effective = overrides[def.id] ?? def.defaultCombo;
    if (effective === combo) return def.id;
  }
  return null;
}

/**
 * Merge user overrides on top of registry defaults, dropping unknown ids.
 */
export function mergeWithDefaults(
  overrides: Partial<Record<KeybindingId, KeyCombo>>,
): Record<KeybindingId, KeyCombo> {
  const out: Record<string, KeyCombo> = {};
  for (const def of KEYBINDINGS) {
    out[def.id] = overrides[def.id] ?? def.defaultCombo;
  }
  return out as Record<KeybindingId, KeyCombo>;
}
