import path from 'node:path';
import type { FileMatches, SearchMatch, SearchResults, SearchQuery } from '../../src/types';

/**
 * Build ripgrep argv for a SearchQuery. Pure function so unit tests can
 * verify the flag matrix without spawning processes.
 *
 * @param query   the user's search options
 * @param openBufferRelPaths  paths (relative to project root, forward-slash)
 *                            of open files; rg is told to skip them so the
 *                            in-memory scan can supply matches instead
 */
export function buildRgArgs(query: SearchQuery, openBufferRelPaths: string[]): string[] {
  const args: string[] = ['--json', '--max-filesize', '5M'];

  if (!query.regex) args.push('--fixed-strings');
  if (query.caseSensitive) args.push('--case-sensitive');
  else args.push('-i');
  if (query.wholeWord) args.push('--word-regexp');
  if (!query.useGitignore) args.push('--no-ignore');

  for (const g of query.includeGlobs) {
    args.push('--glob', g);
  }
  for (const g of query.excludeGlobs) {
    args.push('--glob', `!${g}`);
  }
  for (const p of openBufferRelPaths) {
    args.push('--glob', `!${p}`);
  }

  args.push(query.pattern);
  return args;
}

interface ParseLimits {
  maxMatches: number;
  maxFiles: number;
}

export function parseRgOutput(stdout: string, rootPath: string, limits: ParseLimits): SearchResults {
  const byPath = new Map<string, SearchMatch[]>();
  let totalMatches = 0;
  let truncated = false;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== 'match') continue;

    const data = parsed.data;
    const absPath = data.path?.text;
    if (!absPath) continue;
    const rel = path.relative(rootPath, absPath).split(path.sep).join('/');

    if (!byPath.has(rel)) {
      if (byPath.size >= limits.maxFiles) {
        truncated = true;
        break;
      }
      byPath.set(rel, []);
    }
    const matches = byPath.get(rel)!;

    const submatch = data.submatches?.[0];
    if (!submatch) continue;
    const previewRaw = (data.lines?.text ?? '').replace(/\n$/, '');
    const preview = previewRaw.slice(0, 500);

    matches.push({
      line: data.line_number,
      column: submatch.start + 1,
      length: submatch.end - submatch.start,
      preview,
      matchStart: submatch.start,
      matchEnd: submatch.end,
    });

    totalMatches += 1;
    if (totalMatches >= limits.maxMatches) {
      truncated = true;
      break;
    }
  }

  const files: FileMatches[] = Array.from(byPath.entries()).map(([p, matches]) => ({
    path: p,
    matches,
  }));

  return { files, truncated, durationMs: 0 };
}

export interface Matcher {
  test(line: string): boolean;
  /** Returns array of [start, end] index pairs for matches in `line`. */
  exec(line: string): Array<[number, number]>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(query: SearchQuery): Matcher {
  let source = query.regex ? query.pattern : escapeRegex(query.pattern);
  if (query.wholeWord) source = `\\b${source}\\b`;
  const flags = query.caseSensitive ? 'g' : 'gi';
  // We construct a fresh regex per call to exec/test to keep lastIndex isolated.
  return {
    test(line: string): boolean {
      return new RegExp(source, flags).test(line);
    },
    exec(line: string): Array<[number, number]> {
      const re = new RegExp(source, flags);
      const out: Array<[number, number]> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
      }
      return out;
    },
  };
}

export function scanBuffer(content: string, query: SearchQuery): SearchMatch[] {
  const matcher = buildMatcher(query);
  const results: SearchMatch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ranges = matcher.exec(line);
    if (ranges.length === 0) continue;
    const preview = line.slice(0, 500);
    for (const [start, end] of ranges) {
      results.push({
        line: i + 1,
        column: start + 1,
        length: end - start,
        preview,
        matchStart: start,
        matchEnd: end,
      });
    }
  }
  return results;
}

export function mergeBufferResults(rgResults: SearchResults, bufferResults: FileMatches[]): SearchResults {
  const byPath = new Map<string, FileMatches>();
  for (const f of rgResults.files) byPath.set(f.path, f);
  for (const f of bufferResults) {
    if (f.matches.length === 0) continue;
    byPath.set(f.path, f);  // buffer wins; rg was told to skip these paths anyway
  }
  return {
    files: Array.from(byPath.values()),
    truncated: rgResults.truncated,
    durationMs: rgResults.durationMs,
  };
}
