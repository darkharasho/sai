// Single-instance guard.
//
// Why: SAI never called app.requestSingleInstanceLock(), so nothing stopped a
// second copy from launching against the same userData dir. When that happened
// the two processes fought over IndexedDB's LevelDB lock — only one process may
// hold it, so the loser's `indexedDB.open` failed with "Internal error opening
// backing store" and the next DB write (e.g. a chat autosave on paste) wedged
// the renderer into a permanent "unresponsive" freeze.
//
// The duplicate arose from the AppImage self-update relaunch: WAIT_THEN_EXEC
// waits at most ~30s for the old pid to die and then execs the new binary
// regardless, so a slow-quitting old instance leaves two running. A manual
// double-launch does the same. This guard is the backstop for every such path.
//
// The lock key is Electron's userData path. On this machine $HOME is symlinked
// (/home/mstephens -> /var/home/mstephens), and the two instances were launched
// via different spellings — so the key MUST be realpath-canonicalized or the
// guard would treat the two spellings as different apps and never fire.

import fs from 'node:fs';

/**
 * Canonical userData path for the lock key. realpath collapses symlinked spellings
 * (/home vs /var/home) to one key; falls back to the raw path if it can't resolve
 * (e.g. the dir doesn't exist yet).
 */
export function canonicalUserData(dir: string, realpath: (p: string) => string = fs.realpathSync): string {
  try {
    return realpath(dir);
  } catch {
    return dir;
  }
}

export interface SingleInstanceDeps {
  /** app.requestSingleInstanceLock() — true if we're the first/only instance. */
  requestLock: () => boolean;
  /** Register a handler for Electron's 'second-instance' event. */
  onSecondInstance: (handler: () => void) => void;
  /** Focus/restore the existing window (called when a duplicate tries to launch). */
  focusExisting: () => void;
  /** Quit this (duplicate) process. */
  quit: () => void;
}

/**
 * Acquire the single-instance lock. Returns true when this is the primary
 * instance (caller should continue booting). Returns false when a primary is
 * already running — we surface it and quit, so the two never share a profile.
 */
export function enforceSingleInstance(deps: SingleInstanceDeps): boolean {
  if (!deps.requestLock()) {
    deps.quit();
    return false;
  }
  deps.onSecondInstance(deps.focusExisting);
  return true;
}
