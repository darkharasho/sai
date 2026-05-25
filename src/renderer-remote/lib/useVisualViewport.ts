import { useEffect, useState } from 'react';

/**
 * Returns the current visualViewport height — i.e. the height of the area
 * NOT covered by the iOS keyboard or browser chrome. Falls back to
 * window.innerHeight on platforms without the API.
 */
export function useVisualViewportHeight(): number {
  const get = () => (typeof window === 'undefined' ? 0 : (window.visualViewport?.height ?? window.innerHeight));
  const [h, setH] = useState<number>(get);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setH(get());
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

  return h;
}
