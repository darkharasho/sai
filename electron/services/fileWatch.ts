import fs from 'node:fs';
import path from 'node:path';

export interface FileWatchRegistry {
  watch(p: string): void;
  unwatch(p: string): void;
  disposeAll(): void;
}

interface Entry {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
  /** Paths as originally passed to watch(), with their ref counts. */
  paths: Map<string, number>;
}

/**
 * Watches files by their parent directory (so atomic rename-over saves keep
 * working) and filters events by basename. Ref-counted per realpath'd
 * parent + basename; change events are debounced.
 */
export function createFileWatchRegistry(
  onChange: (absPath: string) => void,
  opts: { debounceMs?: number } = {},
): FileWatchRegistry {
  const debounceMs = opts.debounceMs ?? 300;
  const entries = new Map<string, Entry>();

  function keyFor(p: string): { key: string; dir: string; base: string } | null {
    const abs = path.resolve(p);
    const base = path.basename(abs);
    try {
      const dir = fs.realpathSync(path.dirname(abs));
      return { key: path.join(dir, base), dir, base };
    } catch {
      return null;
    }
  }

  function close(key: string) {
    const e = entries.get(key);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    try { e.watcher.close(); } catch { /* already closed */ }
    entries.delete(key);
  }

  return {
    watch(p) {
      const k = keyFor(p);
      if (!k) {
        console.warn(`[fileWatch] parent dir missing, not watching: ${p}`);
        return;
      }
      const existing = entries.get(k.key);
      if (existing) {
        existing.paths.set(p, (existing.paths.get(p) ?? 0) + 1);
        return;
      }
      let watcher: fs.FSWatcher;
      try {
        watcher = fs.watch(k.dir, (_event, filename) => {
          // Linux can report a null filename; treat that as a possible match.
          if (filename != null && String(filename) !== k.base) return;
          const e = entries.get(k.key);
          if (!e) return;
          if (e.timer) clearTimeout(e.timer);
          e.timer = setTimeout(() => {
            e.timer = null;
            for (const orig of [...e.paths.keys()]) onChange(orig);
          }, debounceMs);
        });
      } catch (err) {
        console.warn(`[fileWatch] fs.watch failed for ${p}:`, err);
        return;
      }
      watcher.on('error', err => {
        console.warn(`[fileWatch] watcher error for ${p}:`, err);
        close(k.key);
      });
      entries.set(k.key, { watcher, timer: null, paths: new Map([[p, 1]]) });
    },
    unwatch(p) {
      const k = keyFor(p);
      if (!k) return;
      const e = entries.get(k.key);
      if (!e) return;
      const n = (e.paths.get(p) ?? 0) - 1;
      if (n > 0) { e.paths.set(p, n); return; }
      e.paths.delete(p);
      if (e.paths.size === 0) close(k.key);
    },
    disposeAll() {
      for (const key of [...entries.keys()]) close(key);
    },
  };
}
