import type { WebContents } from 'electron';
import { devlogFor } from './devlog';

/**
 * Idle memory purge for the main window's renderer.
 *
 * Measured 2026-11-08: after a day of use the renderer sat at ~600MB PSS
 * while its live V8 heap was only ~40MB. Chromium only does a full,
 * memory-releasing collection under system memory pressure, which a
 * well-provisioned machine never reports, so freed memory was never returned.
 * A forced full GC (CDP HeapProfiler.collectGarbage) dropped it by
 * 100-170MB for a ~150ms main-thread pause. Simulated critical memory
 * pressure added little on top, so we only GC.
 *
 * The pause is the cost, so we purge only when nobody is looking: the window
 * has been unfocused, or the whole system has had no input, for IDLE_MS. We
 * also wait at least MIN_GAP_MS between purges.
 */

const log = devlogFor('memory');

export const PURGE_CHECK_MS = 60_000;
export const PURGE_IDLE_MS = 2 * 60_000;
export const PURGE_MIN_GAP_MS = 10 * 60_000;

export interface PurgeState {
  now: number;
  /** Window focus. When focused, only system-wide idle time counts. */
  focused: boolean;
  /** When the window last lost focus; null while focused. */
  blurredAt: number | null;
  /** powerMonitor.getSystemIdleTime() in ms. Can read 0 forever on some
   *  Wayland setups, which just means we fall back to the blur path. */
  systemIdleMs: number;
  lastPurgeAt: number | null;
}

export function shouldPurge(s: PurgeState): boolean {
  if (s.lastPurgeAt !== null && s.now - s.lastPurgeAt < PURGE_MIN_GAP_MS) return false;
  const blurredFor = !s.focused && s.blurredAt !== null ? s.now - s.blurredAt : 0;
  return Math.max(s.systemIdleMs, blurredFor) >= PURGE_IDLE_MS;
}

/** Full GC in the renderer via the CDP debugger. Reuses an existing
 *  attachment (and leaves it attached) so we never fight other users. */
export async function collectRendererGarbage(wc: WebContents): Promise<number> {
  const dbg = wc.debugger;
  const wasAttached = dbg.isAttached();
  if (!wasAttached) dbg.attach('1.3');
  const started = Date.now();
  try {
    await dbg.sendCommand('HeapProfiler.collectGarbage');
  } finally {
    if (!wasAttached) {
      try { dbg.detach(); } catch { /* already gone */ }
    }
  }
  return Date.now() - started;
}

export interface IdleMemoryPurgeDeps {
  now(): number;
  isFocused(): boolean;
  systemIdleMs(): number;
  purge(): Promise<void>;
}

/**
 * Start the timer. Returns hooks for the window's blur/focus events plus a
 * stop function for teardown.
 */
export function startIdleMemoryPurge(deps: IdleMemoryPurgeDeps) {
  let blurredAt: number | null = deps.isFocused() ? null : deps.now();
  let lastPurgeAt: number | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = deps.now();
    const focused = deps.isFocused();
    if (!shouldPurge({ now, focused, blurredAt, systemIdleMs: deps.systemIdleMs(), lastPurgeAt })) return;
    running = true;
    lastPurgeAt = now;
    try {
      await deps.purge();
    } catch (err) {
      log('purge.failed', { error: String(err) });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, PURGE_CHECK_MS);
  timer.unref?.();

  return {
    onBlur: () => { blurredAt = deps.now(); },
    onFocus: () => { blurredAt = null; },
    tick,
    stop: () => clearInterval(timer),
  };
}

export function logPurge(data: Record<string, unknown>): void {
  log('purge', data);
}
