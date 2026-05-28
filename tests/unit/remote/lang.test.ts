import { describe, it, expect } from 'vitest';
import { langFromPath, isTextLike, mimeFromPath } from '@electron/services/remote/lang';

describe('lang helpers', () => {
  it('langFromPath returns common language ids', () => {
    expect(langFromPath('App.tsx')).toBe('tsx');
    expect(langFromPath('src/index.ts')).toBe('typescript');
    expect(langFromPath('script.js')).toBe('javascript');
    expect(langFromPath('main.py')).toBe('python');
    expect(langFromPath('Cargo.toml')).toBe('toml');
    expect(langFromPath('README.md')).toBe('markdown');
    expect(langFromPath('unknown.xyz')).toBeNull();
  });

  it('isTextLike based on extension', () => {
    expect(isTextLike('App.tsx')).toBe(true);
    expect(isTextLike('image.png')).toBe(false);
    expect(isTextLike('binary.bin')).toBe(false);
    expect(isTextLike('plain.txt')).toBe(true);
  });

  it('mimeFromPath returns image mimes', () => {
    expect(mimeFromPath('image.png')).toBe('image/png');
    expect(mimeFromPath('photo.jpg')).toBe('image/jpeg');
    expect(mimeFromPath('unknown.xyz')).toBe('application/octet-stream');
  });
});
