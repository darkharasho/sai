import { describe, it, expect, vi } from 'vitest';
import { handleCanvasOpen } from '../../../src/canvas/canvasOpenTool';

const list = vi.fn(async () => [
  { path: '/var/home/u/proj/.sai/canvas/plan.md', content: '# Plan' },
]);

describe('handleCanvasOpen', () => {
  it('opens an existing canvas of the viewed workspace (symlinked home spellings match)', async () => {
    const openCanvas = vi.fn();
    const r = await handleCanvasOpen({ action: 'open', name: 'plan.md' }, '/home/u/proj', {
      activeWorkspace: '/var/home/u/proj', canvasList: list, openCanvas,
    });
    expect(openCanvas).toHaveBeenCalledWith('/var/home/u/proj/.sai/canvas/plan.md');
    expect(r).toEqual({ ok: true, opened: true, path: '/var/home/u/proj/.sai/canvas/plan.md' });
  });

  it('errors on a missing canvas, naming the existing ones', async () => {
    const openCanvas = vi.fn();
    await expect(handleCanvasOpen({ action: 'open', name: 'nope' }, '/home/u/proj', {
      activeWorkspace: '/home/u/proj', canvasList: list, openCanvas,
    })).rejects.toThrow('no canvas named "nope" (existing: plan)');
    expect(openCanvas).not.toHaveBeenCalled();
  });

  it('does not open a canvas of a workspace the user is not viewing', async () => {
    const openCanvas = vi.fn();
    const r = await handleCanvasOpen({ action: 'open', name: 'plan' }, '/home/u/proj', {
      activeWorkspace: '/home/u/other', canvasList: list, openCanvas,
    });
    expect(openCanvas).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, opened: false });
  });

  it('rejects a bad name', async () => {
    await expect(handleCanvasOpen({ action: 'open', name: '../x' }, '/home/u/proj', {
      activeWorkspace: '/home/u/proj', canvasList: list, openCanvas: vi.fn(),
    })).rejects.toThrow(/invalid canvas name/);
  });
});
