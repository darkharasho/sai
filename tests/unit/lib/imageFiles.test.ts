import { describe, it, expect } from 'vitest';
import { isImagePath, mimeForImagePath } from '../../../src/lib/imageFiles';

describe('imageFiles', () => {
  it('recognizes image extensions case-insensitively', () => {
    expect(isImagePath('/a/b/foo.png')).toBe(true);
    expect(isImagePath('/a/b/FOO.JPG')).toBe(true);
    expect(isImagePath('/a/b/icon.svg')).toBe(true);
    expect(isImagePath('/a/b/pic.webp')).toBe(true);
  });

  it('rejects non-image extensions', () => {
    expect(isImagePath('/a/b/notes.txt')).toBe(false);
    expect(isImagePath('/a/b/code.ts')).toBe(false);
    expect(isImagePath('/a/b/noext')).toBe(false);
  });

  it('maps extensions to mime types', () => {
    expect(mimeForImagePath('/x/a.png')).toBe('image/png');
    expect(mimeForImagePath('/x/a.jpeg')).toBe('image/jpeg');
    expect(mimeForImagePath('/x/a.svg')).toBe('image/svg+xml');
    expect(mimeForImagePath('/x/a.unknown')).toBe('application/octet-stream');
  });
});
