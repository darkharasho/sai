import { useEffect, useState } from 'react';

/**
 * Watches a file on disk. Returns a counter that increments on every change
 * event for `path`. Main emits events with the same spelling passed to
 * fsWatchFile, so a direct comparison is safe.
 */
export function useFileWatch(path: string | null): number {
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!path) return;
    const sai = window.sai;
    const off = sai?.onFsFileChanged?.((changed) => {
      if (changed === path) setToken((n) => n + 1);
    });
    Promise.resolve(sai?.fsWatchFile?.(path)).catch(() => {});
    return () => {
      off?.();
      Promise.resolve(sai?.fsUnwatchFile?.(path)).catch(() => {});
    };
  }, [path]);

  return token;
}
