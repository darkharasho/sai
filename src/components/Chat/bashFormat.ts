/**
 * Display formatting for Bash tool commands.
 *
 * Splits a command into shell text and heredoc bodies so each body can be
 * highlighted in its own language, and puts each top-level command on its own
 * line (after `;`, `&&`, `||`). Line breaks are only inserted where bash reads
 * a newline the same way, so the formatted text still means the same thing.
 * This is a display heuristic, not a bash parser: anything it can't follow is
 * left as written.
 */

export type BashBlock =
  | { kind: 'shell'; text: string }
  /** `terminator` is the closing marker line, or null while it hasn't arrived (streaming). */
  | { kind: 'heredoc'; lang: string; body: string; terminator: string | null };

const OPENERS = new Set(['do', 'then', '{']);
const CLOSERS = new Set(['done', 'fi', '}']);
const MIDDLES = new Set(['else', 'elif']);
/** Keywords whose body starts on its own line. */
const BODY_START = new Set(['do', 'then', 'else']);
/** Words after which the next word is still in command position. */
const CMD_PREFIX = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', 'time']);
/** Characters that end a plain word. */
const SPECIAL = /[\s;&|<>()'"`\\$#]/;

interface PendingHeredoc { term: string; strip: boolean; stmtStart: number }

export function formatBashCommand(command: string): BashBlock[] {
  const blocks: BashBlock[] = [];
  const n = command.length;
  let out = '';
  let i = 0;
  let depth = 0;      // do/then/{ nesting, for indenting split lines
  let paren = 0;      // ( / $( nesting: never split inside
  let dbl = 0;        // [[ ]] nesting: never split inside
  let atCmd = true;   // next word is a command name (keywords only count there)
  let stmtStart = 0;  // index in `out` where the current statement began
  const pending: PendingHeredoc[] = [];

  const flushShell = () => {
    if (out) blocks.push({ kind: 'shell', text: out });
    out = '';
    stmtStart = 0;
  };

  const copyQuoted = (quote: string, escapes: boolean) => {
    let j = i + 1;
    while (j < n && command[j] !== quote) j += escapes && command[j] === '\\' ? 2 : 1;
    j = Math.min(j + 1, n);
    out += command.slice(i, j);
    i = j;
    atCmd = false;
  };

  while (i < n) {
    const c = command[i];

    if (c === '\n') {
      atCmd = true;
      i++;
      if (!pending.length) { out += '\n'; stmtStart = out.length; continue; }
      // Heredoc bodies start on the line after their operator.
      const stmts = pending.map(p => out.slice(p.stmtStart).split('\n')[0]);
      flushShell();
      for (let p = 0; p < pending.length; p++) {
        const { term, strip } = pending[p];
        const lines: string[] = [];
        let terminator: string | null = null;
        while (i < n) {
          const end = command.indexOf('\n', i);
          const line = command.slice(i, end < 0 ? n : end);
          i = end < 0 ? n : end + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === term) { terminator = line; break; }
          lines.push(line);
        }
        const body = lines.join('\n');
        blocks.push({ kind: 'heredoc', lang: detectHeredocLang(stmts[p], body), body, terminator });
      }
      pending.length = 0;
      continue;
    }

    if (c === ' ' || c === '\t') { out += c; i++; continue; }

    if (c === '#' && (out === '' || /[\s;&|(]$/.test(out))) {
      const end = command.indexOf('\n', i);
      out += command.slice(i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }

    if (c === '\\') { out += command.slice(i, i + 2); i += 2; atCmd = false; continue; }
    if (c === "'") { copyQuoted("'", false); continue; }
    if (c === '"' || c === '`') { copyQuoted(c, true); continue; }
    if (c === '$') {
      if (command[i + 1] === "'") { out += '$'; i++; copyQuoted("'", true); continue; }
      if (command[i + 1] === '(') { out += '$('; i += 2; paren++; atCmd = true; continue; }
      out += '$'; i++; atCmd = false; continue;
    }
    if (c === '(') { out += c; i++; paren++; atCmd = true; continue; }
    if (c === ')') { out += c; i++; paren = Math.max(0, paren - 1); atCmd = false; continue; }

    if (command.startsWith('<<<', i)) { out += '<<<'; i += 3; continue; }
    if (command.startsWith('<<', i)) {
      let j = i + 2;
      const strip = command[j] === '-';
      if (strip) j++;
      while (command[j] === ' ' || command[j] === '\t') j++;
      const m = command.slice(j).match(/^(?:'[^'\n]*'|"[^"\n]*"|[^\s;&|<>()]+)+/);
      if (m) {
        const term = m[0].replace(/['"\\]/g, '');
        pending.push({ term, strip, stmtStart });
        out += command.slice(i, j + m[0].length);
        i = j + m[0].length;
        atCmd = false;
        continue;
      }
    }

    const op = command.startsWith(';;', i) ? ';;'
      : command.startsWith('&&', i) ? '&&'
      : command.startsWith('||', i) ? '||'
      : c === ';' ? ';' : null;
    if (op) {
      out += op;
      i += op.length;
      atCmd = true;
      if (paren > 0 || dbl > 0) continue;
      stmtStart = out.length;
      // A pending heredoc's body follows this physical line; splitting here
      // would print later commands above the body that belongs to this one.
      if (pending.length) continue;
      let k = i;
      while (command[k] === ' ' || command[k] === '\t') k++;
      if (k >= n || command[k] === '\n' || command[k] === '#') continue;
      const next = command.slice(k).match(/^[^\s;&|<>()]+/)?.[0] ?? '';
      if (op === ';' && (next === 'do' || next === 'then')) { out += ' '; i = k; continue; }
      const indent = Math.max(0, depth - (CLOSERS.has(next) || MIDDLES.has(next) ? 1 : 0));
      out += '\n' + '  '.repeat(indent);
      stmtStart = out.length;
      i = k;
      continue;
    }

    if (c === '|' || c === '&') { out += c; i++; atCmd = true; continue; }
    if (c === '<' || c === '>') { out += c; i++; continue; }

    let j = i;
    while (j < n && !SPECIAL.test(command[j])) j++;
    if (j === i) { out += c; i++; continue; }
    const word = command.slice(i, j);
    if (word === '[[') dbl++;
    else if (word === ']]') dbl = Math.max(0, dbl - 1);
    if (atCmd) {
      if (OPENERS.has(word)) depth++;
      else if (CLOSERS.has(word)) depth = Math.max(0, depth - 1);
    }
    const keyword: boolean = atCmd && CMD_PREFIX.has(word);
    atCmd = keyword || (atCmd && /^\w+=/.test(word));
    out += word;
    i = j;
    // `do echo hi` → the body starts its own indented line.
    if (keyword && BODY_START.has(word) && paren === 0 && dbl === 0 && !pending.length) {
      let k = i;
      while (command[k] === ' ' || command[k] === '\t') k++;
      if (k > i && k < n && command[k] !== '\n' && command[k] !== '#') {
        out += '\n' + '  '.repeat(depth);
        stmtStart = out.length;
        i = k;
      }
    }
  }

  // Unterminated heredoc operator on the last line: the body hasn't streamed yet.
  flushShell();
  return blocks;
}

const EXT_LANG: Record<string, string> = {
  py: 'python', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonl: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', css: 'css', rs: 'rust', go: 'go', diff: 'diff', patch: 'diff', sql: 'sql',
};

const PROG_LANG: Record<string, string> = {
  python: 'python', python3: 'python', pypy: 'python', pypy3: 'python', uv: 'python',
  node: 'javascript', bun: 'javascript', deno: 'typescript',
  tsx: 'typescript', 'ts-node': 'typescript',
  bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash', ssh: 'bash',
  psql: 'sql', sqlite3: 'sql', mysql: 'sql', duckdb: 'sql',
  patch: 'diff',
};

const SKIP_PREFIX = new Set(['sudo', 'env', 'exec', 'time', 'command', 'nohup', 'npx', 'bunx', 'pnpx', 'uvx']);

export function shellWords(segment: string): string[] {
  return (segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(w => w.replace(/^['"]|['"]$/g, ''));
}

/** Picks a highlight language for a heredoc body from the command that receives it. */
export function detectHeredocLang(statement: string, body: string): string {
  const cmd = statement.replace(/<<-?\s*(?:'[^']*'|"[^"]*"|\S+)/g, ' ');

  for (const segment of cmd.split(/\|(?!\|)/)) {
    const w = shellWords(segment);
    let k = 0;
    while (k < w.length && (SKIP_PREFIX.has(w[k]) || /^\w+=/.test(w[k]) || (k > 0 && w[k].startsWith('-')))) k++;
    if (w[k] === 'pnpm' || w[k] === 'yarn') { k++; if (w[k] === 'dlx' || w[k] === 'exec') k++; }
    const prog = (w[k] ?? '').split('/').pop() ?? '';
    const base = prog.replace(/\d+(\.\d+)*$/, '');
    if (PROG_LANG[prog]) return PROG_LANG[prog];
    if (PROG_LANG[base]) return PROG_LANG[base];
    if (prog === 'git' && (w[k + 1] === 'apply' || w[k + 1] === 'am')) return 'diff';
    if ((prog === 'git' || prog === 'gh') && w.some((x, idx) => (x === '-F' || x === '--file' || x === '--body-file' || x === '--notes-file') && w[idx + 1] === '-')) return 'markdown';
    if (prog === 'kubectl') return 'yaml';
    if (prog === 'tee') {
      const target = w.slice(k + 1).find(x => !x.startsWith('-'));
      const lang = target && langFromPath(target);
      if (lang) return lang;
    }
  }

  const redirects = [...cmd.matchAll(/>>?\s*([^\s;&|<>]+)/g)];
  const target = redirects.length ? redirects[redirects.length - 1][1].replace(/^['"]|['"]$/g, '') : '';
  const fromPath = target && langFromPath(target);
  if (fromPath) return fromPath;

  return sniffLang(body);
}

export function langFromPath(path: string): string | null {
  const name = path.split('/').pop() ?? '';
  if (name === 'Dockerfile' || name === 'Makefile') return 'bash';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_LANG[ext] ?? null;
}

function sniffLang(body: string): string {
  const head = body.trimStart();
  if (head.startsWith('#!')) {
    const argv = head.slice(2).split('\n')[0].trim().split(/\s+/);
    let prog = argv[0].split('/').pop() ?? '';
    if (prog === 'env') prog = argv.slice(1).find(a => !a.startsWith('-')) ?? '';
    return PROG_LANG[prog.replace(/\d+(\.\d+)*$/, '')] ?? 'bash';
  }
  if (/^[[{]/.test(head)) {
    try { JSON.parse(head); return 'json'; } catch { /* not JSON */ }
  }
  if (/^(diff --git|--- \S|@@ )/m.test(head)) return 'diff';
  if (/^\s*(import\s.+\sfrom\s|export\s|const\s|let\s|interface\s|type\s+\w+\s*=)/m.test(head)) return 'typescript';
  if (/^\s*(def\s|class\s\w+[(:]|from\s+[\w.]+\s+import\s|import\s+[\w.]+\s*$|print\()/m.test(head)) return 'python';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH)\s/im.test(head)) return 'sql';
  return 'text';
}
