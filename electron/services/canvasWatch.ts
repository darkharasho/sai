import fs from 'node:fs';
import path from 'node:path';

export interface CanvasChange {
  /** The spelling the caller passed to watch(), so the renderer can match its workspace key. */
  projectPath: string;
  /** Absolute path built from the realpath'd project dir. */
  path: string;
  /** File content, or null when the file is gone. */
  content: string | null;
}

export interface CanvasWatcher {
  watch(projectPath: string): void;
  unwatch(projectPath: string): void;
  disposeAll(): void;
}

type Mode = 'canvas' | 'sai' | 'root';

interface Project {
  real: string;
  canvasDir: string;
  /** Caller spellings with ref counts. */
  spellings: Map<string, number>;
  mode: Mode | null;
  watcher: fs.FSWatcher | null;
  /** Names of *.md files we know exist (initial scan + emitted). */
  known: Set<string>;
  timers: Map<string, NodeJS.Timeout>;
  warned: Set<string>;
  closed: boolean;
  retryTimer: NodeJS.Timeout | null;
  retryDelay: number;
}

const isValidProjectPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length > 0 && path.isAbsolute(p);

const RETRY_BASE_MS = 200;
const RETRY_MAX_MS = 5000;

const isDir = (p: string): boolean => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

function listMd(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.name.endsWith('.md') && !d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/** Absolute canvas files for a project (empty if `.sai/canvas` is missing; never creates it). */
export function listCanvases(projectPath: string): { path: string; content: string }[] {
  if (!isValidProjectPath(projectPath)) return [];
  let real: string;
  try { real = fs.realpathSync(projectPath); } catch { return []; }
  const dir = path.join(real, '.sai', 'canvas');
  const out: { path: string; content: string }[] = [];
  for (const name of listMd(dir)) {
    try {
      out.push({ path: path.join(dir, name), content: fs.readFileSync(path.join(dir, name), 'utf8') });
    } catch { /* vanished or unreadable: skip */ }
  }
  return out;
}

/**
 * Watches `<project>/.sai/canvas/*.md`. While the directory does not exist it
 * watches the nearest existing ancestor (project root, then `.sai`) so a later
 * mkdir is picked up. Ref-counted per realpath'd project; per-file debounce.
 * Saves that replace a file via rename are reported as content, never as a
 * delete, because the file is re-read after the debounce.
 */
export function createCanvasWatcher(
  emit: (e: CanvasChange) => void,
  opts: { debounceMs?: number } = {},
): CanvasWatcher {
  const debounceMs = opts.debounceMs ?? 150;
  const projects = new Map<string, Project>();
  const realBySpelling = new Map<string, string>();

  function fire(p: Project, name: string, content: string | null) {
    const abs = path.join(p.canvasDir, name);
    for (const spelling of [...p.spellings.keys()]) emit({ projectPath: spelling, path: abs, content });
  }

  function schedule(p: Project, name: string) {
    const old = p.timers.get(name);
    if (old) clearTimeout(old);
    p.timers.set(name, setTimeout(() => {
      p.timers.delete(name);
      if (p.closed) return;
      let content: string;
      try {
        content = fs.readFileSync(path.join(p.canvasDir, name), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          if (p.known.delete(name)) fire(p, name, null);
        } else if (!p.warned.has(name)) {
          p.warned.add(name);
          console.warn(`[canvasWatch] cannot read ${name}:`, err);
        }
        return;
      }
      p.known.add(name);
      fire(p, name, content);
    }, debounceMs));
  }

  function closeWatcher(p: Project) {
    if (p.watcher) {
      try { p.watcher.close(); } catch { /* already closed */ }
      p.watcher = null;
    }
  }

  /** The watched files are gone (dir removed or watcher lost): report them as deleted. */
  function nullKnown(p: Project) {
    for (const t of p.timers.values()) clearTimeout(t);
    p.timers.clear();
    for (const name of [...p.known]) fire(p, name, null);
    p.known.clear();
  }

  /** Re-arm after a failed/lost watcher, with capped exponential backoff. */
  function scheduleRetry(p: Project) {
    if (p.closed || p.retryTimer) return;
    const delay = p.retryDelay;
    p.retryDelay = Math.min(p.retryDelay * 2, RETRY_MAX_MS);
    p.retryTimer = setTimeout(() => {
      p.retryTimer = null;
      if (!p.closed) sync(p);
    }, delay);
  }

  function desiredMode(p: Project): Mode {
    if (isDir(p.canvasDir)) return 'canvas';
    if (isDir(path.dirname(p.canvasDir))) return 'sai';
    return 'root';
  }

  function dirFor(p: Project, mode: Mode): string {
    return mode === 'canvas' ? p.canvasDir : mode === 'sai' ? path.dirname(p.canvasDir) : p.real;
  }

  /** Bring the active watcher in line with what exists on disk. */
  function sync(p: Project, initial = false) {
    for (let i = 0; i < 3 && !p.closed; i++) {
      const want = desiredMode(p);
      if (want === p.mode && p.watcher) return;
      const was = p.mode;
      closeWatcher(p);
      if (was === 'canvas') {
        // Canvas dir vanished: the files are gone with it.
        nullKnown(p);
      }
      p.mode = want;
      try {
        p.watcher = fs.watch(dirFor(p, want), (_ev, filename) => onEvent(p, filename == null ? null : String(filename)));
        p.watcher.on('error', err => {
          console.warn(`[canvasWatch] watcher error for ${p.real}:`, err);
          const was = p.mode;
          closeWatcher(p);
          p.mode = null;
          if (was === 'canvas') {
            // Transient errors must not wipe files that are still on disk.
            const present = new Set(listMd(p.canvasDir));
            for (const name of [...p.known]) {
              if (present.has(name)) continue;
              const t = p.timers.get(name);
              if (t) { clearTimeout(t); p.timers.delete(name); }
              p.known.delete(name);
              fire(p, name, null);
            }
          }
          scheduleRetry(p);
        });
      } catch (err) {
        console.warn(`[canvasWatch] fs.watch failed for ${p.real}:`, err);
        p.mode = null;
        scheduleRetry(p);
        return;
      }
      p.retryDelay = RETRY_BASE_MS;
      if (want === 'canvas') {
        const present = listMd(p.canvasDir);
        if (initial) {
          for (const n of present) p.known.add(n);
        } else {
          // Dir appeared after the watch started: report what is already in it.
          // Union with known so files that vanished during an outage get their null.
          for (const n of new Set([...p.known, ...present])) schedule(p, n);
        }
      }
      initial = false;
      // Loop once more to catch anything created while we were attaching.
    }
  }

  function onEvent(p: Project, filename: string | null) {
    if (p.closed) return;
    sync(p);
    if (p.mode !== 'canvas') return;
    if (filename == null) {
      // No filename (Linux can do this): rescan and compare against what we know.
      const now = new Set(listMd(p.canvasDir));
      for (const n of new Set([...p.known, ...now])) schedule(p, n);
      return;
    }
    if (!filename.endsWith('.md') || filename.includes('/') || filename.includes(path.sep)) return;
    schedule(p, filename);
  }

  function close(key: string) {
    const p = projects.get(key);
    if (!p) return;
    p.closed = true;
    for (const t of p.timers.values()) clearTimeout(t);
    p.timers.clear();
    if (p.retryTimer) { clearTimeout(p.retryTimer); p.retryTimer = null; }
    closeWatcher(p);
    projects.delete(key);
    for (const [s, k] of realBySpelling) if (k === key) realBySpelling.delete(s);
  }

  return {
    watch(projectPath) {
      if (!isValidProjectPath(projectPath)) return;
      let real: string;
      try { real = fs.realpathSync(projectPath); } catch {
        console.warn(`[canvasWatch] project dir missing, not watching: ${projectPath}`);
        return;
      }
      let p = projects.get(real);
      if (!p) {
        p = {
          real,
          canvasDir: path.join(real, '.sai', 'canvas'),
          spellings: new Map(),
          mode: null,
          watcher: null,
          known: new Set(),
          timers: new Map(),
          warned: new Set(),
          closed: false,
          retryTimer: null,
          retryDelay: RETRY_BASE_MS,
        };
        projects.set(real, p);
        p.spellings.set(projectPath, 1);
        realBySpelling.set(projectPath, real);
        sync(p, true);
        return;
      }
      p.spellings.set(projectPath, (p.spellings.get(projectPath) ?? 0) + 1);
      realBySpelling.set(projectPath, real);
    },
    unwatch(projectPath) {
      if (!isValidProjectPath(projectPath)) return;
      let key = realBySpelling.get(projectPath);
      if (!key) { try { key = fs.realpathSync(projectPath); } catch { return; } }
      const p = projects.get(key);
      if (!p) return;
      const n = p.spellings.get(projectPath);
      if (n === undefined) return;
      if (n > 1) { p.spellings.set(projectPath, n - 1); return; }
      p.spellings.delete(projectPath);
      realBySpelling.delete(projectPath);
      if (p.spellings.size === 0) close(key);
    },
    disposeAll() {
      for (const key of [...projects.keys()]) close(key);
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

/** Per-webContents canvas watchers, disposed on destroy / renderer death / main-frame navigation. */
export function createSenderCanvasWatches(opts: { debounceMs?: number } = {}) {
  const watchers = new Map<number, CanvasWatcher>();
  const hooked = new Set<number>();

  const dispose = (id: number) => {
    watchers.get(id)?.disposeAll();
    watchers.delete(id);
  };

  function watcherFor(sender: SenderLike): CanvasWatcher {
    const id = sender.id;
    let w = watchers.get(id);
    if (!w) {
      w = createCanvasWatcher(e => {
        if (!sender.isDestroyed()) sender.send('canvas:changed', e);
      }, opts);
      watchers.set(id, w);
    }
    if (!hooked.has(id)) {
      hooked.add(id);
      sender.once('destroyed', () => { dispose(id); hooked.delete(id); });
      sender.on('render-process-gone', () => dispose(id));
      sender.on('did-start-navigation', e => {
        if (e.isMainFrame && !e.isSameDocument) dispose(id);
      });
    }
    return w;
  }

  return {
    watch(sender: SenderLike, projectPath: string) {
      if (sender.isDestroyed()) return;
      watcherFor(sender).watch(projectPath);
    },
    unwatch(sender: SenderLike, projectPath: string) {
      watchers.get(sender.id)?.unwatch(projectPath);
    },
  };
}
