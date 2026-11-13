import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileWatch } from '../../../src/model3d/useFileWatch';

describe('useFileWatch', () => {
  let cb: ((p: string) => void) | null;
  const unsub = vi.fn();
  const fsWatchFile = vi.fn().mockResolvedValue(undefined);
  const fsUnwatchFile = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    cb = null;
    unsub.mockClear(); fsWatchFile.mockClear(); fsUnwatchFile.mockClear();
    (window as any).sai = {
      fsWatchFile, fsUnwatchFile,
      onFsFileChanged: (f: (p: string) => void) => { cb = f; return unsub; },
    };
  });
  afterEach(() => { delete (window as any).sai; });

  it('increments on a change event for the same path and ignores others', () => {
    const { result } = renderHook(() => useFileWatch('/a/part.stl'));
    expect(result.current).toBe(0);
    expect(fsWatchFile).toHaveBeenCalledWith('/a/part.stl');
    act(() => cb!('/a/other.stl'));
    expect(result.current).toBe(0);
    act(() => cb!('/a/part.stl'));
    expect(result.current).toBe(1);
  });

  it('unwatches and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useFileWatch('/a/part.stl'));
    unmount();
    expect(fsUnwatchFile).toHaveBeenCalledWith('/a/part.stl');
    expect(unsub).toHaveBeenCalled();
  });

  it('does nothing for a null path', () => {
    renderHook(() => useFileWatch(null));
    expect(fsWatchFile).not.toHaveBeenCalled();
  });

  it('survives a rejecting fsWatchFile', async () => {
    fsWatchFile.mockRejectedValueOnce(new Error('ENOENT'));
    const { result } = renderHook(() => useFileWatch('/missing.stl'));
    await act(async () => {});
    expect(result.current).toBe(0);
  });
});
