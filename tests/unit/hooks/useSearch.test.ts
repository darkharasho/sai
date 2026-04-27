import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearch } from '../../../src/hooks/useSearch';

const mockSearchRun = vi.fn();
const mockReplaceFile = vi.fn();

beforeEach(() => {
  mockSearchRun.mockReset();
  mockReplaceFile.mockReset();
  (window as any).sai = {
    searchRun: mockSearchRun,
    searchReplaceFile: mockReplaceFile,
  };
});

describe('useSearch', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));
    expect(result.current.state).toBe('idle');
    expect(result.current.results).toBeNull();
  });

  it('runs a search when runSearch is called', async () => {
    mockSearchRun.mockResolvedValue({ files: [{ path: 'a.ts', matches: [] }], truncated: false, durationMs: 5 });
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'foo',
        caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    expect(mockSearchRun).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('results');
    expect(result.current.results?.files).toHaveLength(1);
  });

  it('passes open buffers from getOpenBuffers', async () => {
    mockSearchRun.mockResolvedValue({ files: [], truncated: false, durationMs: 0 });
    const buffers = [{ path: '/proj/a.ts', content: 'hello' }];
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => buffers }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'x', caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    expect(mockSearchRun).toHaveBeenCalledWith(expect.objectContaining({
      openBuffers: buffers,
    }));
  });

  it('transitions to error state when searchRun rejects with invalid regex', async () => {
    mockSearchRun.mockRejectedValue(new Error('regex parse error: foo'));
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));

    await act(async () => {
      await result.current.runSearch({
        pattern: '(', caseSensitive: false, wholeWord: false, regex: true,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('regex');
  });

  it('replace calls applyMonacoEdits for open files and searchReplaceFile for unopened', async () => {
    mockSearchRun.mockResolvedValue({ files: [
      { path: 'open.ts', matches: [{ line: 1, column: 1, length: 3, preview: 'foo', matchStart: 0, matchEnd: 3 }] },
      { path: 'closed.ts', matches: [{ line: 1, column: 1, length: 3, preview: 'foo', matchStart: 0, matchEnd: 3 }] },
    ], truncated: false, durationMs: 0 });
    mockReplaceFile.mockResolvedValue(undefined);
    const monacoApply = vi.fn();
    const { result } = renderHook(() => useSearch({
      rootPath: '/proj',
      getOpenBuffers: () => [{ path: '/proj/open.ts', content: 'foo' }],
      applyMonacoEdits: monacoApply,
    }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'foo', caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    await act(async () => {
      await result.current.replaceAll('bar');
    });

    expect(monacoApply).toHaveBeenCalledWith('/proj/open.ts', expect.any(Array));
    expect(mockReplaceFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/proj/closed.ts',
    }));
  });
});
