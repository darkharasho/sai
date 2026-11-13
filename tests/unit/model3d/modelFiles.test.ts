import { describe, it, expect } from 'vitest';
import { isModelFile, modelExt } from '../../../src/model3d/modelFiles';

describe('modelFiles', () => {
  it('detects supported extensions case-insensitively', () => {
    expect(isModelFile('a.STL')).toBe(true);
    expect(isModelFile('a.3mf')).toBe(true);
    expect(isModelFile('/x/y/a.obj')).toBe(true);
    expect(isModelFile('a.step')).toBe(false);
    expect(isModelFile('stl')).toBe(false);
  });
  it('returns the lowercase ext or null', () => {
    expect(modelExt('A.STL')).toBe('stl');
    expect(modelExt('a.3MF')).toBe('3mf');
    expect(modelExt('a.txt')).toBeNull();
  });
});
