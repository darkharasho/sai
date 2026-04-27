import type { SearchQuery } from '../../src/types';

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
