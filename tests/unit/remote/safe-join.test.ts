import { describe, it, expect } from 'vitest';
import { safeJoin } from '@electron/services/remote/safe-join';

describe('safeJoin', () => {
  it('joins normal relative paths', () => {
    expect(safeJoin('/repo', 'src/App.tsx')).toBe('/repo/src/App.tsx');
  });

  it('returns cwd itself when path is empty or "."', () => {
    expect(safeJoin('/repo', '')).toBe('/repo');
    expect(safeJoin('/repo', '.')).toBe('/repo');
  });

  it('throws on ..-escape', () => {
    expect(() => safeJoin('/repo', '../etc/passwd')).toThrow(/escape/);
    expect(() => safeJoin('/repo', 'a/../../b')).toThrow(/escape/);
  });

  it('throws on absolute paths', () => {
    expect(() => safeJoin('/repo', '/etc/passwd')).toThrow(/absolute/);
  });

  it('handles trailing slashes consistently', () => {
    expect(safeJoin('/repo/', 'src/')).toBe('/repo/src');
  });
});
