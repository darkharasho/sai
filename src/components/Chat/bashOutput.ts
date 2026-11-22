/**
 * Display formatting for Bash tool output: cleans the text, picks a highlight
 * language when the whole output is one kind of thing (a file read, JSON), and
 * otherwise tags each line (error, warning, success, diff, harness note) so the
 * card can tint it. Display-only heuristics; the text itself is never changed
 * beyond trimming blank runs and pretty-printing one-line JSON.
 */
import { langFromPath, shellWords } from './bashFormat';

export type LineKind = 'plain' | 'error' | 'warn' | 'ok' | 'meta' | 'add' | 'del' | 'hunk' | 'diffmeta';

export interface PreparedOutput {
  lines: string[];
  /** Shiki language for the whole output, or null to use line tinting. */
  lang: string | null;
  /** The output is a unified diff: tint +/- lines. */
  diff: boolean;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

const READERS = new Set(['cat', 'head', 'tail', 'sed', 'bat', 'less']);

/** Language of a single-file read (`cat x.ts`, `sed -n '1,40p' x.py`, `git show HEAD:x.json`). */
export function readLang(command: string): string | null {
  const cmd = command.trim();
  // One command, optionally piped into head/tail.
  if (/[;&\n]|\|\|/.test(cmd.replace(/'[^']*'|"[^"]*"/g, ''))) return null;
  const [first, ...rest] = cmd.split(/\|(?!\|)/);
  if (rest.some(seg => !/^\s*(head|tail)\b/.test(seg))) return null;
  const w = shellWords(first);
  const prog = w[0];
  if (prog === 'git' && w[1] === 'show') {
    const spec = w.slice(2).find(x => x.includes(':') && !x.startsWith('-'));
    return spec ? langFromPath(spec.slice(spec.indexOf(':') + 1)) : null;
  }
  if (!READERS.has(prog)) return null;
  if (prog === 'cat' && w.some(x => /^-\w*n/.test(x))) return null; // line-numbered
  const args = w.slice(1).filter(x => !x.startsWith('-'));
  // sed's first non-flag arg is the script.
  const files = prog === 'sed' ? args.slice(1) : args.filter(x => !/^\d+$/.test(x));
  if (files.length !== 1) return null;
  return langFromPath(files[0]);
}

export function prepareBashOutput(command: string | undefined, output: string): PreparedOutput {
  let text = output.replace(ANSI, '').replace(/\r\n?/g, '\n');
  const trimmed = text.trim();
  let lang: string | null = null;

  if (/^[[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      lang = 'json';
      if (!trimmed.includes('\n') && trimmed.length > 100) text = JSON.stringify(parsed, null, 2);
    } catch { /* not JSON */ }
  }
  if (!lang && command) lang = readLang(command);

  // Drop leading/trailing blank lines and collapse blank runs to one.
  const lines: string[] = [];
  for (const line of text.replace(/\s+$/, '').split('\n')) {
    const blank = !line.trim();
    if (blank && (!lines.length || !lines[lines.length - 1].trim())) continue;
    lines.push(blank ? '' : line.replace(/\s+$/, ''));
  }

  const diff = !lang && lines.some(l => /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(l));
  return { lines, lang, diff };
}

const META = /^(Shell cwd was reset to |\(Bash completed with no output\)$|Command running in background with ID:|Output is being written to )/;
/** `path:12:` (grep -n, ripgrep), `path.ts-12-` (grep context) or a bare `12:` (grep -n on one file). */
const LOCATION = /^(?:(?:\.{0,2}\/|~\/)?[\w@.~-][\w./@~+-]*:\d+(?::\d+)?[:-]|[\w./@~+-]+\.\w+-\d+-|\d+:)/;

const ERROR = [
  /^\s*(error|fatal|panic|exception)\b\s*[:[]/i,
  /(^\s*|[)\]]\s*:?\s*)error( TS\d+)?:\s/i, // tsc `file(1,2): error TS2322: …`, not `{ error: x }`
  /^\s*(FAIL|FAILED|ERR!|npm ERR!)\b/,
  /^Traceback \(most recent call last\)/,
  /^\s*\w*(Error|Exception)(: |$)/,
  /\b[1-9]\d* (failed|errors?|failing|failures?)\b/i,
  /(^|\s)[✗✘×❌]\s/,
  /\bcommand not found\b|\bNo such file or directory\b|\bPermission denied\b/,
];
const WARN = [/^\s*(warn(ing)?|⚠)\b/i, /\bwarning:/i, /\b[1-9]\d* warnings?\b/i];
const OK = [/^\s*(✓|✔|✅|PASS\b)/, /\b\d+ passed\b/, /\b(0 errors?|0 failed)\b/];
/** `exit 1`, `exit code: 2`, `exit 0: 1` (an echoed `exit $i: $?`): the last number is the status. */
const EXIT = /(?<![.\w])exit(?:ed)?(?: with)?(?: code| status)?\b[^\n]*?(\d+)\s*\)?\s*$/i;

/**
 * The kind of one output line, and how many leading characters are a
 * location prefix (`src/a.ts:12:`) to dim.
 */
export function classifyLine(line: string, diff: boolean): { kind: LineKind; prefix: number } {
  if (diff) {
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return { kind: 'diffmeta', prefix: 0 };
    if (line.startsWith('@@')) return { kind: 'hunk', prefix: 0 };
    if (line.startsWith('+')) return { kind: 'add', prefix: 0 };
    if (line.startsWith('-')) return { kind: 'del', prefix: 0 };
    return { kind: 'plain', prefix: 0 };
  }
  if (META.test(line)) return { kind: 'meta', prefix: 0 };
  const loc = line.match(LOCATION);
  // A grep match is file content: tinting it by the words it contains is noise.
  if (loc) return { kind: 'plain', prefix: loc[0].length };
  const exit = line.match(EXIT);
  if (exit && line.length < 80) return { kind: exit[1] === '0' ? 'ok' : 'error', prefix: 0 };
  if (ERROR.some(r => r.test(line))) return { kind: 'error', prefix: 0 };
  if (WARN.some(r => r.test(line))) return { kind: 'warn', prefix: 0 };
  if (OK.some(r => r.test(line))) return { kind: 'ok', prefix: 0 };
  return { kind: 'plain', prefix: 0 };
}
