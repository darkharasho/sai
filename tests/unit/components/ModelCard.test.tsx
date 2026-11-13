import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../../../src/model3d/ModelViewer', () => ({
  default: ({ load, onError }: any) => {
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
    render(<ModelCard renderId="c1" versionKey={null} isNewest {...base} />);
    expect(screen.getByText('Preparing model…')).toBeTruthy();
    expect((window as any).sai.modelReadCached).not.toHaveBeenCalled();
  });
});
