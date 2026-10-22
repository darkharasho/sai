// ChatInput.buildMessage sends attached files as a `@/abs/path @/abs/path`
// paragraph between the optional terminal block and the user's text. The model
// needs that text verbatim, so the bubble recovers the paths at display time
// instead of storing them separately — which also chip-ifies old chats.

const TERM_PREFIX = '[Terminal output]\n```\n';
const TERM_END = '\n```\n\n';
const PATH_START = /^@(?:\/|~[\\/]|[A-Za-z]:[\\/])/;
// Split before each ` @<path-start>` so paths containing spaces survive.
const PATH_SPLIT = / (?=@(?:\/|~[\\/]|[A-Za-z]:[\\/]))/;

export function parseUserAttachments(content: string): { files: string[]; text: string } {
  const none = { files: [], text: content };
  let head = '';
  let body = content;
  if (body.startsWith(TERM_PREFIX)) {
    const end = body.indexOf(TERM_END, TERM_PREFIX.length);
    if (end < 0) return none;
    head = body.slice(0, end + 4);
    body = body.slice(end + TERM_END.length);
  }
  const lineEnd = body.indexOf('\n\n');
  if (lineEnd < 0) return none;
  const line = body.slice(0, lineEnd);
  if (line.includes('\n')) return none;
  const tokens = line.split(PATH_SPLIT);
  if (!tokens.every(t => PATH_START.test(t))) return none;
  const rest = body.slice(lineEnd + 2);
  return {
    files: tokens.map(t => t.slice(1)),
    text: head ? `${head}\n\n${rest}` : rest,
  };
}

/** Parent folder hint (`Chat/`), or null when the file sits at the project root. */
export function shortDir(path: string, projectPath?: string): string | null {
  const parts = path.split(/[\\/]/);
  if (parts.length < 2) return null;
  const dir = parts.slice(0, -1).join('/');
  // /home ↔ /var/home symlink: compare with the /var prefix stripped.
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/var\/home\//, '/home/').replace(/\/+$/, '');
  if (projectPath && norm(dir) === norm(projectPath)) return null;
  return parts[parts.length - 2] ? `${parts[parts.length - 2]}/` : null;
}

/** Short badge label + color variable for a file's type. */
export function fileBadge(path: string): { label: string; color: string } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'ts': case 'tsx': return { label: 'TS', color: 'var(--blue)' };
    case 'js': case 'jsx': case 'mjs': case 'cjs': return { label: 'JS', color: 'var(--yellow)' };
    case 'md': case 'mdx': return { label: 'MD', color: 'var(--purple)' };
    case 'json': case 'jsonc': return { label: '{ }', color: 'var(--accent)' };
    case 'css': case 'scss': return { label: 'CSS', color: 'var(--pink)' };
    case 'html': case 'htm': case 'xml': case 'svg': return { label: '</>', color: 'var(--orange)' };
    case 'py': return { label: 'PY', color: 'var(--blue)' };
    case 'rs': return { label: 'RS', color: 'var(--orange)' };
    case 'go': return { label: 'GO', color: 'var(--turquoise)' };
    case 'sh': case 'bash': case 'zsh': return { label: '$', color: 'var(--green)' };
    case 'yml': case 'yaml': case 'toml': return { label: ext.slice(0, 3).toUpperCase(), color: 'var(--red)' };
    case '': return { label: '·', color: 'var(--text-secondary)' };
    default: return { label: ext.slice(0, 3).toUpperCase(), color: 'var(--text-secondary)' };
  }
}
