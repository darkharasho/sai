import { describe, it, expect } from 'vitest';
import { clampRect } from '../../../electron/capturePage';

describe('clampRect', () => {
  it('rounds and clamps a rect to the page bounds', () => {
    expect(clampRect({ x: 10.4, y: 20.6, width: 100.2, height: 50.9 }, { width: 800, height: 600 }))
      .toEqual({ x: 10, y: 21, width: 100, height: 51 });
  });

  it('never returns negative origin or zero size', () => {
    expect(clampRect({ x: -5, y: -5, width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('clamps width/height to remain inside the page', () => {
    expect(clampRect({ x: 790, y: 0, width: 100, height: 10 }, { width: 800, height: 600 }))
      .toEqual({ x: 790, y: 0, width: 10, height: 10 });
  });
});
