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
