/**
 * The Home workspace: an ordinary workspace rooted at the user's home
 * directory, presented as a permanent pinned row rather than a project.
 *
 * Everything here is presentation + identity. The activation path, sessions,
 * terminals and status indicators are the same ones every other workspace
 * uses — Home is just `projectPath === $HOME`.
 */

export const HOME_WORKSPACE_NAME = 'Home';

export interface HomeInfo {
  /** Canonical (realpath-resolved) home directory. */
  path: string;
  /** Every spelling of home that may reach the renderer, including symlinks. */
  aliases: string[];
}

let cached: HomeInfo | null = null;
let inflight: Promise<HomeInfo | null> | null = null;

const normalize = (p: string): string => p.replace(/\/+$/, '');

export function setHomeInfo(info: HomeInfo | null): void {
  cached = info;
}

export function resetHomeInfo(): void {
  cached = null;
  inflight = null;
}

export function getHomePath(): string | null {
  return cached ? cached.path : null;
}

/**
 * Fetches home from the main process once and caches it. Concurrent callers
 * share the same in-flight request.
 */
export function loadHomeInfo(): Promise<HomeInfo | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  const bridge = (globalThis as any).window?.sai;
  if (!bridge?.homeDir) return Promise.resolve(null);
  inflight = Promise.resolve(bridge.homeDir())
    .then((info: HomeInfo | null) => {
      if (info?.path) {
        cached = { path: info.path, aliases: info.aliases?.length ? info.aliases : [info.path] };
      }
      return cached;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

export function isHomeWorkspace(projectPath: string | null | undefined): boolean {
  if (!projectPath || !cached) return false;
  const target = normalize(projectPath);
  if (!target) return false;
  return cached.aliases.some(a => normalize(a) === target);
}
