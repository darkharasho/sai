// Lightweight wrapper around highlight.js for React Native rendering.
// hljs.highlight() returns HTML with <span class="hljs-…">…</span> wrappers
// (plus literal text and entity-encoded characters). We don't want a real
// HTML parser on the device — instead we walk the output once and emit a
// flat list of {text, cls} tokens that the renderer can convert to native
// Text spans.

// Import from the main entry — it pre-registers every language hljs ships.
// The smaller core+per-language approach (`highlight.js/lib/core` + subpath
// language imports) is cleaner but Metro 0.83's package-exports resolution
// refuses to follow the subpath conditions on this expo-router setup. The
// full bundle adds ~1MB to the dev bundle, fine for now; revisit when we
// move from Expo Go → development build.
import hljs from 'highlight.js';

export interface Token {
  text: string;
  /** Single hljs class (e.g. 'keyword', 'string', 'number'). Empty = no style. */
  cls: string;
}

// Github Dark-ish palette — same colors highlight.js's github-dark.css uses,
// mapped from the hljs token class names. Anything not listed falls through
// to the default text color.
const PALETTE: Record<string, string> = {
  keyword: '#ff7b72',
  built_in: '#ffa657',
  type: '#ffa657',
  literal: '#79c0ff',
  number: '#79c0ff',
  string: '#a5d6ff',
  symbol: '#79c0ff',
  regexp: '#a5d6ff',
  meta: '#79c0ff',
  title: '#d2a8ff',
  'title.function': '#d2a8ff',
  'title.class': '#ffa657',
  attr: '#79c0ff',
  attribute: '#79c0ff',
  comment: '#8b949e',
  doctag: '#79c0ff',
  variable: '#ffa657',
  'variable.language': '#ff7b72',
  tag: '#7ee787',
  name: '#7ee787',
  selector_tag: '#7ee787',
  punctuation: '#c9d1d9',
  operator: '#ff7b72',
  params: '#c9d1d9',
  deletion: '#ffa198',
  addition: '#7ee787',
};

// Server-sent / file-extension language hints that aren't the canonical hljs
// id. Anything not listed passes through as-is — hljs.getLanguage handles
// the "unknown lang" case by returning falsy, which our tokenize() catches.
const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin',
  sh: 'bash', zsh: 'bash',
  cc: 'cpp', hpp: 'cpp', h: 'c',
  cs: 'csharp',
  yml: 'yaml',
  htm: 'xml', html: 'xml', svg: 'xml',
  toml: 'ini',
  md: 'markdown', mdx: 'markdown',
  patch: 'diff',
};

export function normalizeLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const k = lang.toLowerCase();
  return LANG_ALIAS[k] ?? k;
}

export function langFromPath(p: string): string | undefined {
  const base = p.split('/').pop() ?? '';
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return undefined;
  return normalizeLang(base.slice(dot + 1).toLowerCase());
}

export function colorForClass(cls: string): string | undefined {
  if (!cls) return undefined;
  if (cls in PALETTE) return PALETTE[cls];
  // hljs nests classes like 'title.function' → try the parent.
  const parent = cls.split('.')[0];
  return PALETTE[parent];
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
};
function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

// Walk the hljs HTML output once and emit flat tokens. Nested spans flatten
// into the outermost recognized class so the renderer doesn't need to model
// a tree — at chat-screen size the loss of nested styling is invisible.
export function tokenize(code: string, lang: string | undefined): Token[] {
  const normalized = normalizeLang(lang);
  if (!normalized || !hljs.getLanguage(normalized)) {
    return [{ text: code, cls: '' }];
  }
  let html: string;
  try {
    html = hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
  } catch {
    return [{ text: code, cls: '' }];
  }
  const tokens: Token[] = [];
  const re = /<span class="hljs-([^"]+)">|<\/span>|([^<]+)/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      stack.push(m[1]);
    } else if (m[0] === '</span>') {
      stack.pop();
    } else if (m[2] !== undefined) {
      const cls = stack[stack.length - 1] ?? '';
      tokens.push({ text: decodeEntities(m[2]), cls });
    }
  }
  return tokens;
}
