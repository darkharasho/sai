import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

vi.mock('../../../../src/components/SaiLogo', () => ({
  default: ({ mode }: { mode?: string }) => <span data-testid="sai-logo" data-mode={mode} />,
}));
vi.mock('../../../../src/components/SaiLogo.css', () => ({}));
vi.mock('../../../../src/components/Chat/useThinkingDriver', () => ({
  useThinkingDriver: (active: boolean) => ({ chainMode: active ? 'pulse' : 'static', clockText: '00:00.0', elapsedMs: 0, displayText: 'thinking' }),
}));

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
  rows: [
    { path: '/a', name: 'sai', kind: 'project', state: 'busy', snippet: 'refactoring the spawn path', toolLine: '▸ Bash' },
    { path: '/b', name: 'BotCord', kind: 'project', state: 'question', snippet: 'Which auth method should the bot use?', toolLine: '▸ AskUserQuestion' },
    { path: '/m', name: 'infra', kind: 'meta', state: 'done', snippet: 'migration complete' },
  ],
  focusPath: '/b',
};

describe('OverlayView', () => {
  it('renders the strip and the default focus row', () => {
    const { getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    expect(getByText('Which auth method should the bot use?')).toBeTruthy();
    expect(getByText('BotCord', { selector: '.overlay-focus-name' })).toBeTruthy();
  });

  it('clicking a strip item changes the focused conversation', () => {
    const { getByText, queryByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    expect(getByText('refactoring the spawn path')).toBeTruthy();
    expect(queryByText('Which auth method should the bot use?')).toBeNull();
  });

  it('falls back to the default focus when the selected row disappears', () => {
    const { getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    act(() => { stateCb!({ ...payload, rows: payload.rows.filter(r => r.path !== '/a'), focusPath: '/b' }); });
    expect(getByText('Which auth method should the bot use?')).toBeTruthy();
  });

  it('shows the thinking animation for a busy focused row', () => {
    const { getByTestId, getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    expect(getByTestId('sai-logo').getAttribute('data-mode')).toBe('pulse');
  });

  it('is ghosted by default and solid in interactive mode', () => {
    const { container } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    const root = container.querySelector('.overlay-root')!;
    expect(root.className).not.toContain('overlay-interactive');
    fireEvent.mouseMove(root, { ctrlKey: true, shiftKey: true });
    expect(setInteractive).toHaveBeenLastCalledWith(true);
    expect(container.querySelector('.overlay-root')!.className).toContain('overlay-interactive');
    fireEvent.mouseMove(root, { ctrlKey: false, shiftKey: false });
    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });
});
