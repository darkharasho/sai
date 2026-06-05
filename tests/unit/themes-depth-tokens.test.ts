import { describe, it, expect } from 'vitest';
import { THEMES, DEPTH_TOKEN_KEYS } from '../../src/themes';

describe('depth tokens', () => {
  it('defines all depth tokens in every theme', () => {
    for (const theme of THEMES) {
      for (const key of DEPTH_TOKEN_KEYS) {
        expect(theme.vars[key], `${theme.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it('exposes at least the three known themes', () => {
    expect(THEMES.map(t => t.id)).toEqual(
      expect.arrayContaining(['default', 'midnight', 'steel']),
    );
  });
});
