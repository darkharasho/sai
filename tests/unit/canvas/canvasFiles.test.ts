import { describe, it, expect } from 'vitest';
import {
  isCanvasFile,
  canvasRelPath,
  canvasKey,
  closeDeletedCanvas,
  findOpenCanvasPath,
} from '../../../src/canvas/canvasFiles';
import type { OpenFile } from '../../../src/types';

const tab = (path: string): OpenFile => ({ path, viewMode: 'editor', content: '' });

describe('isCanvasFile', () => {
  it('matches .sai/canvas/<name>.md', () => {
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.md')).toBe(true);
    expect(isCanvasFile('/var/home/u/p/.sai/canvas/my-plan.md')).toBe(true);
  });
  it('rejects nested, non-md and non-canvas paths', () => {
    expect(isCanvasFile('/home/u/p/.sai/canvas/sub/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.txt')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.md.bak')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/canvas/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/')).toBe(false);
  });
});

describe('canvasRelPath', () => {
  it('strips the project prefix across the /home vs /var/home symlink', () => {
    expect(canvasRelPath('/home/u/p', '/var/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
    expect(canvasRelPath('/var/home/u/p', '/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
    expect(canvasRelPath('/home/u/p/', '/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
  });
  it('returns the absolute path for files outside the project', () => {
    expect(canvasRelPath('/home/u/p', '/home/u/other/.sai/canvas/plan.md')).toBe('/home/u/other/.sai/canvas/plan.md');
    expect(canvasRelPath('/home/u/p', '/home/u/p2/.sai/canvas/plan.md')).toBe('/home/u/p2/.sai/canvas/plan.md');
  });
});

describe('canvasKey', () => {
  it('gives both spellings one key', () => {
    expect(canvasKey('/var/home/u/p/.sai/canvas/a.md')).toBe(canvasKey('/home/u/p/.sai/canvas/a.md'));
  });
});

describe('closeDeletedCanvas', () => {
  it('closes tab on delete', () => {
    const files = [tab('/home/u/p/a.ts'), tab('/home/u/p/.sai/canvas/plan.md')];
    expect(closeDeletedCanvas(files, '/var/home/u/p/.sai/canvas/plan.md')).toEqual([files[0]]);
  });
  it('keeps the same array when nothing matches', () => {
    const files = [tab('/home/u/p/a.ts')];
    expect(closeDeletedCanvas(files, '/home/u/p/.sai/canvas/plan.md')).toBe(files);
  });
});

describe('findOpenCanvasPath', () => {
  it('finds an open tab under either spelling', () => {
    const files = [tab('/home/u/p/.sai/canvas/plan.md')];
    expect(findOpenCanvasPath(files, '/var/home/u/p/.sai/canvas/plan.md')).toBe('/home/u/p/.sai/canvas/plan.md');
    expect(findOpenCanvasPath(files, '/home/u/p/.sai/canvas/other.md')).toBeNull();
  });
});
