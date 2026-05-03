import { useEffect, useState } from 'react';
import type { Transition } from 'motion/react';

export const SPRING = {
  gentle: { type: 'spring', stiffness: 220, damping: 28, mass: 0.9 },
  pop:    { type: 'spring', stiffness: 380, damping: 26, mass: 0.7 },
  flick:  { type: 'spring', stiffness: 520, damping: 32 },
  dock:   { type: 'spring', stiffness: 180, damping: 24, mass: 1.3 },
} as const satisfies Record<string, Transition>;

export const EASING = {
  out:   [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};

export const STAGGER = { tight: 30, default: 55, loose: 90 } as const;
export const DISTANCE = { nudge: 4, slide: 12, lift: 24 } as const;

const REDUCED = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED).matches;
}

export function useReducedMotionTransition<T extends Transition>(
  transition: T
): T | { duration: 0 } {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced ? { duration: 0 } : transition;
}
