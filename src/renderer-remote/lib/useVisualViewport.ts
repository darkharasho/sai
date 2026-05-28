import { useEffect, useState } from 'react';

export interface VisualViewportInfo {
  height: number;
  offsetTop: number;
}

/**
 * Tracks the visualViewport's height + offsetTop. Used to keep a
 * `position: fixed` chat container glued to the visible area while
 * iOS Safari scrolls the layout viewport to expose the focused input.
 *
 * Falls back to `window.innerHeight` / 0 on platforms without the API.
 */
export function useVisualViewport(): VisualViewportInfo {
  const get = (): VisualViewportInfo => {
    if (typeof window === 'undefined') return { height: 0, offsetTop: 0 };
    const vv = window.visualViewport;
    return {
      height: vv?.height ?? window.innerHeight,
      offsetTop: vv?.offsetTop ?? 0,
    };
  };
  const [info, setInfo] = useState<VisualViewportInfo>(get);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setInfo(get());
    update();
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, []);

  return info;
}

/** Back-compat alias used by callers that only need the height. */
export function useVisualViewportHeight(): number {
  return useVisualViewport().height;
}
