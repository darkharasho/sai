import type { ITheme } from '@xterm/xterm';

export type ThemeId = 'default' | 'midnight' | 'steel';

export const THEMES: { id: ThemeId; label: string; vars: Record<string, string>; terminal: ITheme; titleBar: { color: string; symbolColor: string } }[] = [
  {
    id: 'default',
    label: 'Default',
    vars: {
      '--bg-primary': '#111418',
      '--bg-secondary': '#0c0f11',
      '--bg-mid': '#0e1114',
      '--bg-input': '#161a1f',
      '--bg-hover': '#21292f',
      '--bg-elevated': '#1c2027',
      '--border': '#1e2228',
      '--accent': '#c7910c',
      '--accent-hover': '#f5b832',
      '--text': '#bec6d0',
      '--text-secondary': '#a0acbb',
      '--text-muted': '#5a6a7a',
    },
    terminal: {
      background: '#0e1114',
      foreground: '#bec6d0',
      cursor: '#c7910c',
      selectionBackground: '#c7910c44',
      black: '#000000',
      brightBlack: '#475262',
      red: '#E35535',
      green: '#00a884',
      yellow: '#c7910c',
      blue: '#11B7D4',
      magenta: '#d46ec0',
      cyan: '#38c7bd',
      white: '#FFFFFF',
      brightWhite: '#dce0e5',
    },
    titleBar: { color: '#0c0f11', symbolColor: '#bec6d0' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    vars: {
      '--bg-primary': '#14121a',
      '--bg-secondary': '#0e0c14',
      '--bg-mid': '#110f17',
      '--bg-input': '#1e1b26',
      '--bg-hover': '#2a2735',
      '--bg-elevated': '#211e2a',
      '--border': '#282432',
      '--accent': '#a07ee8',
      '--accent-hover': '#b99af0',
      '--text': '#ccc8d8',
      '--text-secondary': '#a8a0b8',
      '--text-muted': '#605878',
    },
    terminal: {
      background: '#110f17',
      foreground: '#ccc8d8',
      cursor: '#a07ee8',
      selectionBackground: '#a07ee844',
      black: '#0a0a0c',
      brightBlack: '#605878',
      red: '#E35535',
      green: '#00a884',
      yellow: '#c7910c',
      blue: '#11B7D4',
      magenta: '#d46ec0',
      cyan: '#38c7bd',
      white: '#FFFFFF',
      brightWhite: '#dce0e5',
    },
    titleBar: { color: '#0e0c14', symbolColor: '#ccc8d8' },
  },
  {
    id: 'steel',
    label: 'Steel',
    vars: {
      '--bg-primary': '#474a54',
      '--bg-secondary': '#3a3d46',
      '--bg-mid': '#40434c',
      '--bg-input': '#52555e',
      '--bg-hover': '#5c5f68',
      '--bg-elevated': '#4c4f58',
      '--border': '#5a5d66',
      '--accent': '#4da6d4',
      '--accent-hover': '#6bbce0',
      '--text': '#e0e0e6',
      '--text-secondary': '#b8b8c4',
      '--text-muted': '#85859a',
    },
    terminal: {
      background: '#40434c',
      foreground: '#e0e0e6',
      cursor: '#4da6d4',
      selectionBackground: '#4da6d444',
      black: '#3a3d46',
      brightBlack: '#85859a',
      red: '#E35535',
      green: '#00a884',
      yellow: '#c7910c',
      blue: '#4da6d4',
      magenta: '#d46ec0',
      cyan: '#38c7bd',
      white: '#FFFFFF',
      brightWhite: '#e8e8ee',
    },
    titleBar: { color: '#3a3d46', symbolColor: '#e0e0e6' },
  },
];

export function applyTheme(id: ThemeId) {
  const t = THEMES.find(th => th.id === id);
  if (!t) return;
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(t.vars)) {
    root.style.setProperty(prop, val);
  }
  window.dispatchEvent(new CustomEvent('sai-theme-change', { detail: { id, terminal: t.terminal } }));
  window.sai?.setTitleBarOverlay?.(t.titleBar.color, t.titleBar.symbolColor);
  // Re-apply Monaco theme with new app colors
  buildMonacoThemeData(_activeHighlightTheme).then(data => {
    window.dispatchEvent(new CustomEvent('sai-monaco-theme', { detail: data }));
  });
}

export function getTerminalTheme(id: ThemeId): ITheme {
  return THEMES.find(th => th.id === id)?.terminal ?? THEMES[0].terminal;
}

// ─── Code highlight themes ────────────────────────────────────��─────────────

export type HighlightThemeId =
  | 'andromeeda' | 'aurora-x' | 'ayu-dark' | 'catppuccin-frappe' | 'catppuccin-macchiato'
  | 'catppuccin-mocha' | 'dark-plus' | 'dracula' | 'dracula-soft' | 'everforest-dark'
  | 'github-dark' | 'github-dark-dimmed' | 'gruvbox-dark-medium' | 'houston' | 'kanagawa-dragon'
  | 'kanagawa-wave' | 'laserwave' | 'material-theme' | 'material-theme-darker'
  | 'material-theme-ocean' | 'material-theme-palenight' | 'min-dark' | 'monokai'
  | 'night-owl' | 'nord' | 'one-dark-pro' | 'plastic' | 'poimandres' | 'red'
  | 'rose-pine' | 'rose-pine-moon' | 'slack-dark' | 'solarized-dark' | 'synthwave-84'
  | 'tokyo-night' | 'vesper' | 'vitesse-black' | 'vitesse-dark';

export const HIGHLIGHT_THEMES: { id: HighlightThemeId; label: string; hljsCss: string }[] = [
  { id: 'andromeeda',             label: 'Andromeeda',             hljsCss: 'github-dark' },
  { id: 'aurora-x',              label: 'Aurora X',               hljsCss: 'github-dark' },
  { id: 'ayu-dark',              label: 'Ayu Dark',               hljsCss: 'github-dark' },
  { id: 'catppuccin-frappe',     label: 'Catppuccin Frappé',      hljsCss: 'github-dark' },
  { id: 'catppuccin-macchiato',  label: 'Catppuccin Macchiato',   hljsCss: 'github-dark' },
  { id: 'catppuccin-mocha',      label: 'Catppuccin Mocha',       hljsCss: 'github-dark' },
  { id: 'dark-plus',             label: 'Dark+',                  hljsCss: 'vs2015' },
  { id: 'dracula',               label: 'Dracula',                hljsCss: 'github-dark' },
  { id: 'dracula-soft',          label: 'Dracula Soft',           hljsCss: 'github-dark' },
  { id: 'everforest-dark',       label: 'Everforest Dark',        hljsCss: 'github-dark' },
  { id: 'github-dark',           label: 'GitHub Dark',            hljsCss: 'github-dark' },
  { id: 'github-dark-dimmed',    label: 'GitHub Dark Dimmed',     hljsCss: 'github-dark-dimmed' },
  { id: 'gruvbox-dark-medium',   label: 'Gruvbox Dark',           hljsCss: 'github-dark' },
  { id: 'houston',               label: 'Houston',                hljsCss: 'github-dark' },
  { id: 'kanagawa-dragon',       label: 'Kanagawa Dragon',        hljsCss: 'github-dark' },
  { id: 'kanagawa-wave',         label: 'Kanagawa Wave',          hljsCss: 'github-dark' },
  { id: 'laserwave',             label: 'Laserwave',              hljsCss: 'github-dark' },
  { id: 'material-theme',        label: 'Material',               hljsCss: 'github-dark' },
  { id: 'material-theme-darker', label: 'Material Darker',        hljsCss: 'github-dark' },
  { id: 'material-theme-ocean',  label: 'Material Ocean',         hljsCss: 'github-dark' },
  { id: 'material-theme-palenight', label: 'Material Palenight',  hljsCss: 'github-dark' },
  { id: 'min-dark',              label: 'Min Dark',               hljsCss: 'github-dark' },
  { id: 'monokai',               label: 'Monokai',                hljsCss: 'monokai' },
  { id: 'night-owl',             label: 'Night Owl',              hljsCss: 'night-owl' },
  { id: 'nord',                  label: 'Nord',                   hljsCss: 'nord' },
  { id: 'one-dark-pro',          label: 'One Dark Pro',           hljsCss: 'atom-one-dark' },
  { id: 'plastic',               label: 'Plastic',                hljsCss: 'github-dark' },
  { id: 'poimandres',            label: 'Poimandres',             hljsCss: 'github-dark' },
  { id: 'red',                   label: 'Red',                    hljsCss: 'github-dark' },
  { id: 'rose-pine',             label: 'Rosé Pine',              hljsCss: 'rose-pine' },
  { id: 'rose-pine-moon',        label: 'Rosé Pine Moon',         hljsCss: 'rose-pine-moon' },
  { id: 'slack-dark',            label: 'Slack Dark',             hljsCss: 'github-dark' },
  { id: 'solarized-dark',        label: 'Solarized Dark',         hljsCss: 'github-dark' },
  { id: 'synthwave-84',          label: 'Synthwave \'84',         hljsCss: 'github-dark' },
  { id: 'tokyo-night',           label: 'Tokyo Night',            hljsCss: 'tokyo-night-dark' },
  { id: 'vesper',                label: 'Vesper',                 hljsCss: 'github-dark' },
  { id: 'vitesse-black',         label: 'Vitesse Black',          hljsCss: 'github-dark' },
  { id: 'vitesse-dark',          label: 'Vitesse Dark',           hljsCss: 'github-dark' },
];

const SHIKI_LANGS = ['json', 'typescript', 'javascript', 'bash', 'python', 'html', 'css', 'markdown', 'yaml', 'toml', 'rust', 'go', 'diff'] as const;

let _shikiPromise: Promise<any> | null = null;
export function getShikiHighlighter(): Promise<any> {
  if (!_shikiPromise) {
    _shikiPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: HIGHLIGHT_THEMES.map(t => t.id),
        langs: [...SHIKI_LANGS],
      })
    );
  }
  return _shikiPromise;
}

let _activeHighlightTheme: HighlightThemeId = 'monokai';

export function getActiveHighlightTheme(): HighlightThemeId {
  return _activeHighlightTheme;
}

const HLJS_CSS: Record<string, () => Promise<string>> = {
  'monokai': () => import('highlight.js/styles/monokai.css?raw').then(m => m.default),
  'github-dark': () => import('highlight.js/styles/github-dark.css?raw').then(m => m.default),
  'github-dark-dimmed': () => import('highlight.js/styles/github-dark-dimmed.css?raw').then(m => m.default),
  'nord': () => import('highlight.js/styles/nord.css?raw').then(m => m.default),
  'night-owl': () => import('highlight.js/styles/night-owl.css?raw').then(m => m.default),
  'tokyo-night-dark': () => import('highlight.js/styles/tokyo-night-dark.css?raw').then(m => m.default),
  'atom-one-dark': () => import('highlight.js/styles/atom-one-dark.css?raw').then(m => m.default),
  'vs2015': () => import('highlight.js/styles/vs2015.css?raw').then(m => m.default),
  'rose-pine': () => import('highlight.js/styles/rose-pine.css?raw').then(m => m.default),
  'rose-pine-moon': () => import('highlight.js/styles/rose-pine-moon.css?raw').then(m => m.default),
};

function applyHljsCss(cssName: string) {
  const loader = HLJS_CSS[cssName];
  if (!loader) return;
  loader().then(css => {
    let el = document.getElementById('hljs-theme-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'hljs-theme-style';
      document.head.appendChild(el);
    }
    el.textContent = css;
  });
}

// Load default hljs theme
applyHljsCss('monokai');

// Map TextMate scopes to Monaco token names
const TM_TO_MONACO: [string, string[]][] = [
  ['comment',              ['comment']],
  ['string',               ['string']],
  ['constant.numeric',     ['number']],
  ['constant.language',    ['keyword']],
  ['keyword',              ['keyword']],
  ['keyword.control',      ['keyword']],
  ['storage.type',         ['keyword', 'type']],
  ['storage.modifier',     ['keyword']],
  ['entity.name.type',     ['type.identifier']],
  ['entity.name.class',    ['type.identifier']],
  ['entity.name.function', ['identifier']],
  ['variable',             ['variable']],
  ['variable.language',    ['keyword']],
  ['support.function',     ['identifier']],
  ['support.type',         ['type.identifier']],
  ['support.class',        ['type.identifier']],
  ['entity.other.attribute-name', ['attribute.name']],
  ['constant.character.escape',   ['string.escape']],
  ['punctuation',          ['delimiter']],
  ['meta.tag',             ['tag']],
  ['entity.name.tag',      ['tag']],
];

/** Normalize any CSS hex color to 6-char hex (no #, no alpha). Monaco requires this format. */
function normalizeHex(color: string): string {
  let c = color.replace('#', '');
  // 3-char shorthand -> 6-char (#FFF -> FFFFFF)
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  // 4-char shorthand with alpha -> 6-char (#FFFF -> FFFFFF)
  if (c.length === 4) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  // 8-char with alpha -> strip alpha (#8b8b8b94 -> 8b8b8b)
  if (c.length === 8) c = c.substring(0, 6);
  return c;
}

function buildMonacoRules(settings: any[]): { token: string; foreground?: string; fontStyle?: string }[] {
  const scopeColorMap = new Map<string, { fg?: string; style?: string }>();

  for (const s of settings) {
    if (!s.scope || !s.settings) continue;
    const scopes: string[] = Array.isArray(s.scope) ? s.scope : [s.scope];
    for (const scope of scopes) {
      scopeColorMap.set(scope, { fg: s.settings.foreground, style: s.settings.fontStyle });
    }
  }

  // Find the best matching TextMate scope for each Monaco token
  const rules: { token: string; foreground?: string; fontStyle?: string }[] = [];
  const seen = new Set<string>();

  for (const [tmScope, monacoTokens] of TM_TO_MONACO) {
    // Try exact match first, then prefix match
    let match = scopeColorMap.get(tmScope);
    if (!match) {
      for (const [scope, val] of scopeColorMap) {
        if (scope.startsWith(tmScope) || tmScope.startsWith(scope)) {
          match = val;
          break;
        }
      }
    }
    if (!match?.fg) continue;
    for (const token of monacoTokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      rules.push({
        token,
        foreground: normalizeHex(match.fg),
        fontStyle: match.style,
      });
    }
  }

  // Also pass through all original TextMate scopes (Monaco ignores unknown ones harmlessly)
  for (const s of settings) {
    if (!s.scope || !s.settings?.foreground) continue;
    const scopes: string[] = Array.isArray(s.scope) ? s.scope : [s.scope];
    for (const scope of scopes) {
      rules.push({
        token: scope,
        foreground: normalizeHex(s.settings.foreground),
        fontStyle: s.settings.fontStyle,
      });
    }
  }

  return rules;
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export async function buildMonacoThemeData(id: HighlightThemeId): Promise<MonacoThemeData> {
  const hl = await getShikiHighlighter();
  const theme = hl.getTheme(id);

  const rules = buildMonacoRules(theme.settings || []);

  // Use the app theme's CSS vars for editor chrome so the editor always matches the UI
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();

  const colors: Record<string, string> = {
    'editor.background': v('--bg-primary'),
    'editor.foreground': v('--text'),
    'editorLineNumber.foreground': v('--text-muted'),
    'editorLineNumber.activeForeground': v('--text-secondary'),
    'editor.selectionBackground': v('--bg-hover'),
    'editor.lineHighlightBackground': v('--bg-input'),
    'editorWidget.background': v('--bg-secondary'),
    'editorWidget.border': v('--border'),
    'input.background': v('--bg-input'),
    'input.border': v('--border'),
    'dropdown.background': v('--bg-elevated'),
    'list.hoverBackground': v('--bg-hover'),
    'minimap.background': v('--bg-secondary'),
    'scrollbar.shadow': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  };

  return {
    base: theme.type === 'light' ? 'vs' : 'vs-dark',
    rules,
    colors,
  };
}

export function setActiveHighlightTheme(id: HighlightThemeId) {
  _activeHighlightTheme = id;
  const entry = HIGHLIGHT_THEMES.find(t => t.id === id);
  if (entry) applyHljsCss(entry.hljsCss);
  // Build Monaco theme data and dispatch — MonacoEditor listens and applies via its own monaco import
  buildMonacoThemeData(id).then(data => {
    window.dispatchEvent(new CustomEvent('sai-monaco-theme', { detail: data }));
  });
  window.dispatchEvent(new CustomEvent('sai-highlight-theme-change', { detail: id }));
}
