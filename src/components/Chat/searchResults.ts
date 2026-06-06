/** Pure parsing/classification for search-tool output (Grep/Glob and lookalikes). */

export type SearchRow =
  | { type: 'match'; path: string; line: number; text: string }
  | { type: 'file'; path: string }
  | { type: 'separator' }
  | { type: 'raw'; text: string };

export type SearchKind = 'files' | 'matches' | 'mixed' | 'empty';

const MATCH_RE = /^(.+?):(\d+):(.*)$/;
// A bare path: no whitespace, and contains a slash or a dotted extension.
const FILE_RE = /^[^\s:][^\s]*$/;

function looksLikePath(s: string): boolean {
  if (!FILE_RE.test(s)) return false;
  return s.includes('/') || s.includes('\\') || /\.[a-zA-Z0-9]{1,8}$/.test(s);
}

function classify(line: string): SearchRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === '--') return { type: 'separator' };
  const m = trimmed.match(MATCH_RE);
  if (m && looksLikePath(m[1])) {
    return { type: 'match', path: m[1], line: parseInt(m[2], 10), text: m[3] };
  }
  if (looksLikePath(trimmed)) return { type: 'file', path: trimmed };
  return { type: 'raw', text: trimmed };
}

export function parseSearchResults(output: string): { rows: SearchRow[]; kind: SearchKind } {
  const rows: SearchRow[] = [];
  for (const line of (output || '').split('\n')) {
    const row = classify(line);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return { rows, kind: 'empty' };
  const content = rows.filter(r => r.type === 'file' || r.type === 'match');
  const files = rows.filter(r => r.type === 'file').length;
  const matches = rows.filter(r => r.type === 'match').length;
  let kind: SearchKind;
  if (content.length === 0) kind = 'mixed';
  else if (matches === 0) kind = 'files';
  else if (files === 0) kind = 'matches';
  else kind = 'mixed';
  return { rows, kind };
}

export function isSearchTool(name: string, output: string): boolean {
  if (name === 'Grep' || name === 'Glob') return true;
  const { rows } = parseSearchResults(output);
  const contentRows = rows.filter(r => r.type === 'file' || r.type === 'match').length;
  const nonBlank = (output || '').split('\n').filter(l => l.trim()).length;
  if (nonBlank < 2 || contentRows < 2) return false;
  return contentRows / rows.filter(r => r.type !== 'separator').length >= 0.75;
}

export type HighlightSegment = { hit: boolean; text: string };

/** Split `text` into hit/plain segments by `pattern` (treated as a regex).
 *  Invalid/empty patterns, or pathological match counts, yield one plain segment. */
export function highlightMatches(text: string, pattern: string): HighlightSegment[] {
  if (!pattern) return [{ hit: false, text }];
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch {
    return [{ hit: false, text }];
  }
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (++count > 50) return [{ hit: false, text }];
    // Guard against zero-width matches looping forever.
    if (m.index === re.lastIndex) { re.lastIndex++; continue; }
    if (m.index > lastIndex) segments.push({ hit: false, text: text.slice(lastIndex, m.index) });
    segments.push({ hit: true, text: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (segments.length === 0) return [{ hit: false, text }];
  if (lastIndex < text.length) segments.push({ hit: false, text: text.slice(lastIndex) });
  return segments;
}
