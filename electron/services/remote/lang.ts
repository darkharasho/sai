const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', kt: 'kotlin',
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  html: 'html', css: 'css', scss: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  xml: 'xml', svg: 'xml',
  dockerfile: 'dockerfile',
};

const TEXT_LIKE_EXTRA = new Set(['txt', 'log', 'env', 'gitignore', 'gitattributes', 'editorconfig', 'lock']);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  if (i === -1) {
    const base = p.split('/').pop()!.toLowerCase();
    return LANG[base] ? base : '';
  }
  return p.slice(i + 1).toLowerCase();
}

export function langFromPath(p: string): string | null {
  const ext = extOf(p);
  return LANG[ext] ?? null;
}

export function isTextLike(p: string): boolean {
  const ext = extOf(p);
  if (ext in LANG) return true;
  if (TEXT_LIKE_EXTRA.has(ext)) return true;
  if (ext === '') return true;
  return false;
}

export function mimeFromPath(p: string): string {
  const ext = extOf(p);
  return IMAGE_MIME[ext] ?? 'application/octet-stream';
}
