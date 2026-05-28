const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  swift: 'swift', kt: 'kotlin',
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  html: 'html', css: 'css', scss: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  xml: 'xml', svg: 'xml',
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  if (i === -1) return '';
  return p.slice(i + 1).toLowerCase();
}

export function langFromPath(p: string): string | null {
  return LANG[extOf(p)] ?? null;
}

export function isImage(p: string): boolean {
  return extOf(p) in IMAGE_MIME;
}
