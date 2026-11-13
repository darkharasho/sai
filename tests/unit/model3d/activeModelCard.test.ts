import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { claim, release, useIsActiveModelCard } from '../../../src/model3d/activeModelCard';

describe('activeModelCard', () => {
  it('a new claim demotes the previous; release clears', () => {
    const a = renderHook(() => useIsActiveModelCard('A'));
    const b = renderHook(() => useIsActiveModelCard('B'));
    act(() => claim('A'));
    expect(a.result.current).toBe(true);
    act(() => claim('B'));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(true);
    act(() => release('A')); // not holder: no-op
    expect(b.result.current).toBe(true);
    act(() => release('B'));
    expect(b.result.current).toBe(false);
  });
});
