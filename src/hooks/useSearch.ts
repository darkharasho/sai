import { useCallback, useRef, useState } from 'react';
import type { SearchQuery, SearchResults, FileMatches } from '../types';

export type SearchState = 'idle' | 'searching' | 'results' | 'replacing' | 'error';

export interface UseSearchOptions {
  rootPath: string;
  getOpenBuffers: () => { path: string; content: string }[];
  /** Called for each open file affected by a replace. Implementer routes through Monaco. */
  applyMonacoEdits?: (path: string, edits: { line: number; column: number; length: number; replacement: string }[]) => void;
}

export interface UseSearchResult {
  state: SearchState;
  results: SearchResults | null;
  error: string | null;
  lastQuery: SearchQuery | null;
  runSearch(query: SearchQuery): Promise<void>;
  replaceAll(replacement: string): Promise<void>;
  replaceFile(path: string, replacement: string): Promise<void>;
  replaceMatch(path: string, matchIndex: number, replacement: string): Promise<void>;
  clear(): void;
}

export function useSearch(opts: UseSearchOptions): UseSearchResult {
  const [state, setState] = useState<SearchState>('idle');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<SearchQuery | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<number>(0);

  const runSearch = useCallback(async (query: SearchQuery): Promise<void> => {
    setLastQuery(query);
    if (!query.pattern) {
      setResults(null);
      setState('idle');
      setError(null);
      return;
    }
    setState('searching');
    setError(null);
    const myId = ++inflightRef.current;
    try {
      const out = await (window as any).sai.searchRun({
        rootPath: opts.rootPath,
        query,
        openBuffers: opts.getOpenBuffers(),
      }) as SearchResults;
      if (inflightRef.current !== myId) return;  // a newer search superseded us
      setResults(out);
      setState('results');
    } catch (e: any) {
      if (inflightRef.current !== myId) return;
      setError(e?.message ?? String(e));
      setState('error');
    }
  }, [opts.rootPath, opts.getOpenBuffers]);

  const replaceFiles = useCallback(async (files: FileMatches[], replacement: string) => {
    if (!lastQuery) return;
    setState('replacing');
    const buffers = opts.getOpenBuffers();
    const openPaths = new Set(buffers.map(b => b.path));
    try {
      for (const file of files) {
        const absPath = `${opts.rootPath}/${file.path}`;
        const edits = file.matches.map(m => ({
          line: m.line,
          column: m.column,
          length: m.length,
          replacement,
        }));
        if (openPaths.has(absPath) && opts.applyMonacoEdits) {
          opts.applyMonacoEdits(absPath, edits);
        } else {
          await (window as any).sai.searchReplaceFile({ filePath: absPath, edits });
        }
      }
      // refresh results after replace
      await runSearch(lastQuery);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setState('error');
    }
  }, [lastQuery, opts, runSearch]);

  const replaceAll = useCallback(async (replacement: string) => {
    if (!results) return;
    await replaceFiles(results.files, replacement);
  }, [results, replaceFiles]);

  const replaceFile = useCallback(async (path: string, replacement: string) => {
    if (!results) return;
    const file = results.files.find(f => f.path === path);
    if (!file) return;
    await replaceFiles([file], replacement);
  }, [results, replaceFiles]);

  const replaceMatch = useCallback(async (path: string, matchIndex: number, replacement: string) => {
    if (!results) return;
    const file = results.files.find(f => f.path === path);
    if (!file) return;
    const match = file.matches[matchIndex];
    if (!match) return;
    await replaceFiles([{ path, matches: [match] }], replacement);
  }, [results, replaceFiles]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResults(null);
    setError(null);
    setState('idle');
    setLastQuery(null);
  }, []);

  return { state, results, error, lastQuery, runSearch, replaceAll, replaceFile, replaceMatch, clear };
}
