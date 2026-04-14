import { describe, it, expect } from 'vitest';
import { isImageFile, isSvgFile, getImageType } from '../../../src/utils/imageFiles';

describe('isImageFile', () => {
  it('returns true for .png files', () => {
    expect(isImageFile('/path/to/image.png')).toBe(true);
  });

  it('returns true for .jpg files', () => {
    expect(isImageFile('/path/to/photo.jpg')).toBe(true);
  });

  it('returns true for .jpeg files', () => {
    expect(isImageFile('/path/to/photo.jpeg')).toBe(true);
  });

  it('returns true for .gif files', () => {
    expect(isImageFile('/path/to/anim.gif')).toBe(true);
  });

  it('returns true for .webp files', () => {
    expect(isImageFile('/path/to/photo.webp')).toBe(true);
  });

  it('returns true for .svg files', () => {
    expect(isImageFile('/path/to/icon.svg')).toBe(true);
  });

  it('returns false for .ts files', () => {
    expect(isImageFile('/path/to/code.ts')).toBe(false);
  });

  it('returns false for .json files', () => {
    expect(isImageFile('/path/to/data.json')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isImageFile('/path/to/IMAGE.PNG')).toBe(true);
    expect(isImageFile('/path/to/photo.JPG')).toBe(true);
  });

  it('returns false for files with no extension', () => {
    expect(isImageFile('/path/to/Makefile')).toBe(false);
  });
});

describe('isSvgFile', () => {
  it('returns true for .svg files', () => {
    expect(isSvgFile('/path/to/icon.svg')).toBe(true);
  });

  it('returns false for non-svg files', () => {
    expect(isSvgFile('/path/to/image.png')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSvgFile('/path/to/icon.SVG')).toBe(true);
  });
});

describe('getImageType', () => {
  it('returns uppercase extension', () => {
    expect(getImageType('/path/to/image.png')).toBe('PNG');
  });

  it('returns JPEG for .jpg', () => {
    expect(getImageType('/path/to/photo.jpg')).toBe('JPEG');
  });

  it('returns JPEG for .jpeg', () => {
    expect(getImageType('/path/to/photo.jpeg')).toBe('JPEG');
  });

  it('returns SVG for .svg', () => {
    expect(getImageType('/path/to/icon.svg')).toBe('SVG');
  });
});
