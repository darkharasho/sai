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
  /** Total refs across all spellings; the watcher closes at 0. */
  count: number;
  /** Spellings passed to watch() (e.g. symlinked home aliases), with ref counts. */
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
  /** Key resolved at watch time per spelling, so unwatch works after the parent dir is gone. */
  const keyBySpelling = new Map<string, string>();

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
    for (const [sp, k] of keyBySpelling) if (k === key) keyBySpelling.delete(sp);
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
        existing.count++;
        existing.paths.set(p, (existing.paths.get(p) ?? 0) + 1);
        keyBySpelling.set(p, k.key);
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
      entries.set(k.key, { watcher, timer: null, count: 1, paths: new Map([[p, 1]]) });
      keyBySpelling.set(p, k.key);
    },
    unwatch(p) {
      const key = keyBySpelling.get(p) ?? keyFor(p)?.key;
      if (!key) return;
      const e = entries.get(key);
      if (!e) return;
      const n = e.paths.get(p);
      if (n !== undefined) {
        if (n > 1) e.paths.set(p, n - 1);
        else e.paths.delete(p);
      }
      if (--e.count <= 0) close(key);
    },
    disposeAll() {
      for (const key of [...entries.keys()]) close(key);
    },
  };
}

interface SenderLike {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: 'destroyed' | 'render-process-gone', l: () => void): unknown;
  on(event: 'did-start-navigation', l: (e: { isMainFrame?: boolean; isSameDocument?: boolean }) => void): unknown;
  on(event: 'render-process-gone', l: () => void): unknown;
}

/**
 * Per-webContents watch registries. A registry is dropped (watchers closed) when
 * the sender is destroyed, its renderer dies, or its main frame navigates/reloads
 * (the fresh page's viewer state knows nothing about old refs). Recreated lazily.
 */
export function createSenderWatches(opts: { debounceMs?: number } = {}) {
  const registries = new Map<number, FileWatchRegistry>();
  const hooked = new Set<number>();

  const dispose = (id: number) => {
    registries.get(id)?.disposeAll();
    registries.delete(id);
  };

  function registryFor(sender: SenderLike): FileWatchRegistry {
    const id = sender.id;
    let reg = registries.get(id);
    if (!reg) {
      reg = createFileWatchRegistry(p => {
        if (!sender.isDestroyed()) sender.send('fs:fileChanged', p);
      }, opts);
      registries.set(id, reg);
    }
    if (!hooked.has(id)) {
      hooked.add(id);
      sender.once('destroyed', () => { dispose(id); hooked.delete(id); });
      sender.on('render-process-gone', () => dispose(id));
      sender.on('did-start-navigation', e => {
        if (e.isMainFrame && !e.isSameDocument) dispose(id);
      });
    }
    return reg;
  }

  return {
    watch(sender: SenderLike, p: string) {
      if (sender.isDestroyed()) return;
      registryFor(sender).watch(p);
    },
    unwatch(sender: SenderLike, p: string) {
      registries.get(sender.id)?.unwatch(p);
    },
  };
}
