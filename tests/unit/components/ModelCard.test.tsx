import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../../../src/model3d/ModelViewer', () => ({
  default: ({ load, onError, wheelZoom }: any) => {
    (globalThis as any).__viewerWheelZoom = wheelZoom;
    load().catch((e: Error) => onError?.(e.message));
    return <div data-testid="viewer" />;
  },
}));

import { ModelCard } from '../../../src/components/Chat/ModelCard';
import { claim, release } from '../../../src/model3d/activeModelCard';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const base = { path: '/p/a.stl', ext: 'stl' as const, height: 300 };

beforeEach(() => {
  act(() => { release('c1'); release('c2'); });
  (window as any).sai = {
    modelReadCached: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    fsReadFileBase64: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  };
});

describe('ModelCard', () => {
  it('shows unavailable state on cache miss', async () => {
    (window as any).sai.modelReadCached = vi.fn().mockResolvedValue(null);
    const onOpenFile = vi.fn();
    render(<ModelCard renderId="c1" versionKey={KEY} isNewest {...base} onOpenFile={onOpenFile} />);
    await screen.findByText('Older version unavailable');
    fireEvent.click(screen.getByText('Open current file'));
    expect(onOpenFile).toHaveBeenCalledWith('/p/a.stl');
  });

  it('inactive card shows thumbnail without viewer; click mounts viewer', async () => {
    render(<ModelCard renderId="c1" versionKey={KEY} isNewest={false} thumbnailPath="/x/y.png" {...base} />);
    const img = await screen.findByRole('img');
    expect(img).toBeTruthy();
    expect(screen.queryByTestId('viewer')).toBeNull();
    fireEvent.click(screen.getByTestId('model-card-inactive'));
    expect(await screen.findByTestId('viewer')).toBeTruthy();
  });

  it('newest claims on mount and a second claim demotes it; unmount releases', async () => {
    const { unmount } = render(<ModelCard renderId="c1" versionKey={KEY} isNewest {...base} />);
    expect(await screen.findByTestId('viewer')).toBeTruthy();
    act(() => claim('c2'));
    await waitFor(() => expect(screen.queryByTestId('viewer')).toBeNull());
    expect(screen.getByText(/Click to rotate/)).toBeTruthy();
    unmount();
  });

  it('versionKey null never reads the cache', () => {
    render(<ModelCard renderId="c1" versionKey={null} isNewest running {...base} />);
    expect(screen.getByText('Preparing model…')).toBeTruthy();
    expect((window as any).sai.modelReadCached).not.toHaveBeenCalled();
  });
});

describe('ModelCard budget + states', () => {
  it('two cards sharing a renderId never both go live', async () => {
    render(<><ModelCard renderId="same" versionKey={KEY} isNewest {...base} /><ModelCard renderId="same" versionKey={KEY} isNewest {...base} /></>);
    await screen.findAllByTestId(/model-card-/);
    expect(screen.getAllByTestId('viewer')).toHaveLength(1);
    expect(screen.getAllByTestId('model-card-inactive')).toHaveLength(1);
  });
  it('null versionKey never claims or demotes a live card', async () => {
    render(<ModelCard renderId="g" versionKey={KEY} isNewest {...base} />);
    expect(await screen.findByTestId('viewer')).toBeTruthy();
    render(<ModelCard renderId="f" versionKey={null} isNewest {...base} error="boom" />);
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByTestId('viewer')).toBeTruthy();
  });
  it('done without key says unavailable; running says preparing', () => {
    const { rerender } = render(<ModelCard renderId="x" versionKey={null} isNewest {...base} running />);
    expect(screen.getByText('Preparing model…')).toBeTruthy();
    rerender(<ModelCard renderId="x" versionKey={null} isNewest {...base} />);
    expect(screen.getByText('Model unavailable')).toBeTruthy();
  });

  it('live viewer is mounted with wheelZoom={false} and card adds no duplicate error text', async () => {
    act(() => { claim('x'); });
    (window as any).sai.modelReadCached = vi.fn().mockRejectedValue(new Error('WebGL boom'));
    const { container } = render(<ModelCard renderId="c1" versionKey={KEY} isNewest {...base} />);
    expect(await screen.findByTestId('viewer')).toBeTruthy();
    expect((globalThis as any).__viewerWheelZoom).toBe(false);
    expect(container.querySelector('.sai-render-card__err')).toBeNull();
  });
});
