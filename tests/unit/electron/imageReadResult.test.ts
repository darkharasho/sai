import { describe, it, expect } from 'vitest';
import { imageReadResult } from '../../../electron/services/imageFiles';

describe('imageReadResult', () => {
  it('returns a placeholder + image ref for an image path', () => {
    expect(imageReadResult('/proj/assets/logo.png')).toEqual({
      text: '[image: logo.png]',
      image: { path: '/proj/assets/logo.png', media_type: 'image/png' },
    });
  });

  it('returns null for a non-image path', () => {
    expect(imageReadResult('/proj/src/main.ts')).toBeNull();
  });
});
