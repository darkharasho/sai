import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import { OverlayView } from '../../../../src/components/Overlay/OverlayView';
import type { OverlayPayload } from '../../../../src/lib/overlayFeed';

let stateCb: ((p: OverlayPayload) => void) | null = null;
const setInteractive = vi.fn();

beforeEach(() => {
  stateCb = null;
  setInteractive.mockClear();
  const sai = createMockSai();
  (sai as any).overlayOnState = (cb: (p: OverlayPayload) => void) => { stateCb = cb; return () => { stateCb = null; }; };
  (sai as any).overlaySetInteractive = setInteractive;
  installMockSai(sai as any);
});

const payload: OverlayPayload = {
  hasReportable: true,
  strip: [
    { path: '/a', name: 'sai', kind: 'project', state: 'busy' },
    { path: '/b', name: 'BotCord', kind: 'project', state: 'question' },
    { path: '/m', name: 'infra', kind: 'meta', state: 'done' },
  ],
  focus: {
    path: '/b', name: 'BotCord', kind: 'project', state: 'question',
    snippet: 'Which auth method should the bot use?',
    toolLine: '▸ AskUserQuestion',
  },
};

describe('OverlayView', () => {
  it('renders strip squircles and the focus section from overlay:state', () => {
    const { container, getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    expect(container.querySelectorAll('.ws-sq')).toHaveLength(3 + 1); // strip + focus header
    expect(getByText('Which auth method should the bot use?')).toBeTruthy();
    expect(getByText('▸ AskUserQuestion')).toBeTruthy();
    expect(getByText('BotCord', { selector: '.overlay-focus-name' })).toBeTruthy();
  });

  it('ctrl+shift mousemove requests interactive mode; plain mousemove reverts', () => {
    const { container } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    const root = container.querySelector('.overlay-root')!;
    fireEvent.mouseMove(root, { ctrlKey: true, shiftKey: true });
    expect(setInteractive).toHaveBeenLastCalledWith(true);
    fireEvent.mouseMove(root, { ctrlKey: false, shiftKey: false });
    expect(setInteractive).toHaveBeenLastCalledWith(false);
    fireEvent.mouseLeave(root);
    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });
});
