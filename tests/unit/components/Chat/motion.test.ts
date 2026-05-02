import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SPRING, EASING, STAGGER, DISTANCE, useReducedMotionTransition } from '@/components/Chat/motion';

describe('motion vocabulary', () => {
  it('exports spring tokens', () => {
    expect(SPRING.gentle).toEqual({ type: 'spring', stiffness: 220, damping: 28, mass: 0.9 });
    expect(SPRING.pop).toEqual({ type: 'spring', stiffness: 380, damping: 26, mass: 0.7 });
    expect(SPRING.flick).toEqual({ type: 'spring', stiffness: 520, damping: 32 });
    expect(SPRING.dock).toEqual({ type: 'spring', stiffness: 180, damping: 24, mass: 1.3 });
  });

  it('exports easing tokens', () => {
    expect(EASING.out).toEqual([0.22, 1, 0.36, 1]);
    expect(EASING.inOut).toEqual([0.65, 0, 0.35, 1]);
  });

  it('exports stagger and distance constants', () => {
    expect(STAGGER).toEqual({ tight: 30, default: 55, loose: 90 });
    expect(DISTANCE).toEqual({ nudge: 4, slide: 12, lift: 24 });
  });
});

describe('useReducedMotionTransition', () => {
  let mql: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mql = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => mql));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the configured transition when reduced motion is not preferred', () => {
    const { result } = renderHook(() => useReducedMotionTransition(SPRING.pop));
    expect(result.current).toEqual(SPRING.pop);
  });

  it('returns { duration: 0 } when reduced motion is preferred', () => {
    mql.matches = true;
    const { result } = renderHook(() => useReducedMotionTransition(SPRING.pop));
    expect(result.current).toEqual({ duration: 0 });
  });
});
