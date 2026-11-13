import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ throwOnCreate: false, renders: 0, disposed: 0 }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement = document.createElement('canvas');
    constructor() {
      if (state.throwOnCreate) throw new Error('no webgl');
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() { state.renders++; }
    dispose() { state.disposed++; }
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import ModelViewer from '../../../src/model3d/ModelViewer';

function cubeStl(): ArrayBuffer {
  const tris: number[][][] = [];
  const v = (x: number, y: number, z: number) => [x, y, z];
  const quads = [
    [v(0,0,0), v(1,0,0), v(1,1,0), v(0,1,0)], [v(0,0,1), v(1,0,1), v(1,1,1), v(0,1,1)],
    [v(0,0,0), v(1,0,0), v(1,0,1), v(0,0,1)], [v(0,1,0), v(1,1,0), v(1,1,1), v(0,1,1)],
    [v(0,0,0), v(0,1,0), v(0,1,1), v(0,0,1)], [v(1,0,0), v(1,1,0), v(1,1,1), v(1,0,1)],
  ];
  for (const q of quads) { tris.push([q[0], q[1], q[2]]); tris.push([q[0], q[2], q[3]]); }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    let o = 84 + i * 50 + 12;
    for (const p of t) for (const c of p) { dv.setFloat32(o, c * 10, true); o += 4; }
  });
  return buf;
}

beforeEach(() => {
  state.throwOnCreate = false;
  state.renders = 0;
  state.disposed = 0;
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

describe('ModelViewer', () => {
  it('shows unavailable text when WebGL cannot start', async () => {
    state.throwOnCreate = true;
    render(<ModelViewer load={async () => ({ buf: cubeStl(), ext: 'stl' })} />);
    await waitFor(() => expect(screen.getByText(/3D view unavailable/)).toBeTruthy());
  });

  it('renders a model, sets ready, and shows the status line', async () => {
    const onReady = vi.fn();
    const { container } = render(
      <ModelViewer load={async () => ({ buf: cubeStl(), ext: 'stl' })} onReady={onReady} />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-render-ready="true"]')).toBeTruthy();
    expect(screen.getByText(/12 triangles · 10\.0×10\.0×10\.0 mm/)).toBeTruthy();
  });

  it('keeps last good mesh when reload fails', async () => {
    const onReady = vi.fn();
    const onError = vi.fn();
    const { container, rerender } = render(
      <ModelViewer load={async () => ({ buf: cubeStl(), ext: 'stl' })} reloadToken={0} onReady={onReady} onError={onError} />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    rerender(
      <ModelViewer load={async () => { throw new Error('boom'); }} reloadToken={1} onReady={onReady} onError={onError} />,
    );
    await waitFor(() => expect(container.querySelector('.model-viewer-error')).toBeTruthy());
    expect(container.querySelector('.model-viewer-error')!.textContent).toContain('boom');
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('boom');
    expect(screen.getByText(/12 triangles/)).toBeTruthy();
  });

  it('shows an error when the first load fails and clears it on success', async () => {
    const { container, rerender } = render(
      <ModelViewer load={async () => { throw new Error('bad'); }} reloadToken={0} />,
    );
    await waitFor(() => expect(container.querySelector('.model-viewer-error')).toBeTruthy());
    rerender(<ModelViewer load={async () => ({ buf: cubeStl(), ext: 'stl' })} reloadToken={1} />);
    await waitFor(() => expect(container.querySelector('.model-viewer-error')).toBeNull());
    expect(screen.getByText(/12 triangles/)).toBeTruthy();
  });

  it('disposes the renderer on unmount', async () => {
    const onReady = vi.fn();
    const { unmount } = render(
      <ModelViewer load={async () => ({ buf: cubeStl(), ext: 'stl' })} onReady={onReady} />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    unmount();
    expect(state.disposed).toBeGreaterThanOrEqual(1);
  });
});
