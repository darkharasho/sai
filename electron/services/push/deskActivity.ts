// Whether the user is at the desk right now, for push suppression: a focused
// SAI window alone doesn't mean anyone is looking at it (they may have walked
// away with SAI in front). Active means all of:
//
//   - the screen is not locked (powerMonitor lock-screen / unlock-screen);
//   - system idle time is under DESK_ACTIVE_WINDOW_S;
//   - the window saw input (key, mouse, wheel) within DESK_ACTIVE_WINDOW_S.
//
// System idle time can read 0 forever on some platforms (Wayland included,
// see idleMemoryPurge.ts), so it is never trusted alone: the last-input clock
// must agree. Either signal saying "away" means away, so a doubt sends.

export const DESK_ACTIVE_WINDOW_S = 60;

export interface DeskActivityOpts {
  /** powerMonitor.getSystemIdleTime() (seconds). */
  systemIdleSeconds: () => number;
  now?: () => number;
}

export class DeskActivity {
  private locked = false;
  private lastInputAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: DeskActivityOpts) {
    this.now = opts.now ?? Date.now;
  }

  /** The window received input (or gained focus). */
  markInput(): void { this.lastInputAt = this.now(); }

  setLocked(locked: boolean): void { this.locked = locked; }

  isActive(): boolean {
    if (this.locked || this.lastInputAt === null) return false;
    if (this.now() - this.lastInputAt >= DESK_ACTIVE_WINDOW_S * 1000) return false;
    let idle: number;
    try { idle = this.opts.systemIdleSeconds(); } catch { return false; }
    return Number.isFinite(idle) && idle < DESK_ACTIVE_WINDOW_S;
  }
}
