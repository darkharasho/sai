// Edge swipe: drag from the left edge to pull a panel in from the left (the
// phone's back-to-home gesture), drag it back left to close. The panel follows
// the finger; on release it settles open or closed by distance or flick speed.
import { useEffect, useRef, useState } from 'react';

/** Touches starting this close to the left edge can pull the drawer open. */
export const EDGE_PX = 28;
/** Movement before a touch commits to a direction. */
const SLOP_PX = 10;
/** Past this fraction of the drawer's width, release keeps the new state. */
const COMMIT_FRACTION = 0.35;
/** A flick at least this fast (px/ms) commits regardless of distance. */
const FLICK_PX_PER_MS = 0.4;
/** Fallback if transitionend never fires (reduced motion, interrupted). */
const SETTLE_MS = 220;

/** Matches .sai-phone-drawer's width: min(84vw, 340px). */
export function drawerWidth(): number {
  return Math.min(window.innerWidth * 0.84, 340);
}

/** Where the drawer sits during a gesture: x is its translateX in px (-width = closed, 0 = open). */
export interface DrawerSwipe { x: number; width: number; settling: boolean }

interface Track { startX: number; startY: number; fromOpen: boolean; locked: boolean; lastX: number; lastT: number; v: number; width: number }

/**
 * Attaches the gesture to `root` (native listeners: a horizontal drag must
 * preventDefault, which React's passive touch handlers can't). Returns the
 * drawer's live position while a gesture or its settle runs, else null.
 */
export function useDrawerSwipe(
  root: HTMLElement | null,
  open: boolean,
  setOpen: (open: boolean) => void,
  opts: { enabled?: boolean; width?: () => number; layer?: string } = {},
): { swipe: DrawerSwipe | null; settled(): void } {
  const { enabled = true, layer = '.sai-phone-drawer-layer' } = opts;
  const widthRef = useRef(opts.width ?? drawerWidth);
  widthRef.current = opts.width ?? drawerWidth;
  const [swipe, setSwipe] = useState<DrawerSwipe | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const settleTo = useRef<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settled = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const to = settleTo.current;
    settleTo.current = null;
    if (to !== null) setOpenRef.current(to);
    setSwipe(null);
  };
  const settledRef = useRef(settled);
  settledRef.current = settled;

  useEffect(() => {
    if (!root || !enabled) return;
    let t: Track | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { t = null; return; }
      // A new touch while the last swipe settles: finish that settle now.
      const pending = settleTo.current;
      if (pending !== null) settledRef.current();
      const p = e.touches[0];
      const fromOpen = pending ?? openRef.current;
      if (!fromOpen && p.clientX > EDGE_PX) { t = null; return; }
      if (fromOpen && !(e.target instanceof Element && e.target.closest(layer))) { t = null; return; }
      t = { startX: p.clientX, startY: p.clientY, fromOpen, locked: false, lastX: p.clientX, lastT: e.timeStamp, v: 0, width: widthRef.current() };
    };

    const onMove = (e: TouchEvent) => {
      if (!t) return;
      const p = e.touches[0];
      const dx = p.clientX - t.startX;
      const dy = p.clientY - t.startY;
      if (!t.locked) {
        if (Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) { t = null; return; } // a scroll
        const toward = t.fromOpen ? -dx : dx;
        if (toward < SLOP_PX || toward < Math.abs(dy)) return;
        t.locked = true;
      }
      e.preventDefault();
      const dt = e.timeStamp - t.lastT;
      if (dt > 0) t.v = (p.clientX - t.lastX) / dt;
      t.lastX = p.clientX;
      t.lastT = e.timeStamp;
      const base = t.fromOpen ? 0 : -t.width;
      const x = Math.max(-t.width, Math.min(0, base + dx));
      setSwipe({ x, width: t.width, settling: false });
    };

    const onEnd = () => {
      const g = t;
      t = null;
      if (!g || !g.locked) return;
      const shown = (g.lastX - g.startX) * (g.fromOpen ? -1 : 1); // px moved toward the new state
      const flick = (g.fromOpen ? -g.v : g.v) >= FLICK_PX_PER_MS;
      const commit = flick || shown >= g.width * COMMIT_FRACTION;
      const toOpen = g.fromOpen ? !commit : commit;
      settleTo.current = toOpen;
      setSwipe({ x: toOpen ? 0 : -g.width, width: g.width, settling: true });
      timer.current = setTimeout(() => settledRef.current(), SETTLE_MS);
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [root, enabled, layer]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { swipe, settled };
}
