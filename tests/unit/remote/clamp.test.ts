import { describe, it, expect } from 'vitest';
import { clamp, type PermMode } from '@electron/services/remote/clamp';

describe('clamp', () => {
  const cases: Array<[PermMode | undefined, PermMode | null, PermMode | undefined]> = [
    // [desktop, ceiling, expected]
    ['auto', 'always-ask', 'always-ask'],
    ['auto', 'auto-read', 'auto-read'],
    ['auto', 'auto', 'auto'],
    ['auto-read', 'always-ask', 'always-ask'],
    ['auto-read', 'auto-read', 'auto-read'],
    ['auto-read', 'auto', 'auto-read'],
    ['always-ask', 'always-ask', 'always-ask'],
    ['always-ask', 'auto-read', 'always-ask'],
    ['always-ask', 'auto', 'always-ask'],
    [undefined, 'always-ask', 'always-ask'],
    [undefined, null, undefined],
    ['auto', null, 'auto'],
  ];
  for (const [desktop, ceiling, expected] of cases) {
    it(`clamp(${desktop}, ${ceiling}) → ${expected}`, () => {
      expect(clamp(desktop, ceiling)).toBe(expected);
    });
  }
});
