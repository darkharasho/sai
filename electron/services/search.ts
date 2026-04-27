import path from 'node:path';
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import type { FileMatches, SearchMatch, SearchResults, SearchQuery } from '../../src/types';

const execFileAsync = promisify(execFile);

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

export interface ReplaceEdit {
  line: number;
  column: number;
  length: number;
  replacement: string;
}

/**
 * Apply edits to file content. Edits MUST be sorted descending by (line, column)
 * so applying them in array order does not invalidate later positions.
 */
export function applyEditsToContent(content: string, edits: ReplaceEdit[]): string {
  // Defensive: sort descending so callers don't have to.
  const sorted = [...edits].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.column - a.column;
  });
  const lines = content.split('\n');
  for (const edit of sorted) {
    const idx = edit.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx];
    const before = line.slice(0, edit.column - 1);
    const after = line.slice(edit.column - 1 + edit.length);
    lines[idx] = before + edit.replacement + after;
  }
  return lines.join('\n');
}

export interface SearchRunArgs {
  rootPath: string;
  query: SearchQuery;
  openBuffers: { path: string; content: string }[];  // path is absolute
}

export interface SearchReplaceFileArgs {
  filePath: string;
  edits: ReplaceEdit[];
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:run', async (_event, args: SearchRunArgs): Promise<SearchResults> => {
    const start = Date.now();
    const openBufferRelPaths = args.openBuffers.map(b =>
      path.relative(args.rootPath, b.path).split(path.sep).join('/')
    );
    const argv = buildRgArgs(args.query, openBufferRelPaths);

    let rgResults: SearchResults = { files: [], truncated: false, durationMs: 0 };
    try {
      const { stdout } = await execFileAsync('rg', argv, {
        cwd: args.rootPath,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30_000,
      });
      rgResults = parseRgOutput(stdout, args.rootPath, { maxMatches: 5000, maxFiles: 200 });
    } catch (err: any) {
      // rg exits 1 when no matches; still parse stdout if present
      if (err && typeof err.stdout === 'string') {
        rgResults = parseRgOutput(err.stdout, args.rootPath, { maxMatches: 5000, maxFiles: 200 });
      } else if (err && err.code === 'ENOENT') {
        // rg not installed — return empty so the renderer can show the fallback message
        return { files: [], truncated: false, durationMs: Date.now() - start };
      }
      // Other errors (timeout, etc.) — fall through with whatever we got
      if (err && err.killed) rgResults.truncated = true;
    }

    const bufferFileMatches: FileMatches[] = [];
    for (const buf of args.openBuffers) {
      const matches = scanBuffer(buf.content, args.query);
      if (matches.length > 0) {
        const rel = path.relative(args.rootPath, buf.path).split(path.sep).join('/');
        bufferFileMatches.push({ path: rel, matches });
      }
    }

    const merged = mergeBufferResults(rgResults, bufferFileMatches);
    return { ...merged, durationMs: Date.now() - start };
  });

  ipcMain.handle('search:replaceFile', async (_event, args: SearchReplaceFileArgs): Promise<void> => {
    const content = await fs.promises.readFile(args.filePath, 'utf8');
    const next = applyEditsToContent(content, args.edits);
    await fs.promises.writeFile(args.filePath, next, 'utf8');
  });
}
