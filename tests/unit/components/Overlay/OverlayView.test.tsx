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
let interactiveCb: ((v: boolean) => void) | null = null;
const setInteractive = vi.fn();

beforeEach(() => {
  stateCb = null;
  interactiveCb = null;
  setInteractive.mockClear();
  const sai = createMockSai();
  (sai as any).overlayOnState = (cb: (p: OverlayPayload) => void) => { stateCb = cb; return () => { stateCb = null; }; };
  (sai as any).overlayOnInteractive = (cb: (v: boolean) => void) => { interactiveCb = cb; return () => { interactiveCb = null; }; };
  (sai as any).overlaySetInteractive = setInteractive;
  installMockSai(sai as any);
});

const payload: OverlayPayload = {
  hasReportable: true,
  rows: [
    { path: '/a', name: 'sai', kind: 'project', state: 'busy', snippet: 'refactoring the spawn path', tools: [{ name: 'Read', done: true }, { name: 'Bash', done: false }] },
    { path: '/b', name: 'BotCord', kind: 'project', state: 'question', snippet: 'Which auth method should the bot use?', tools: [{ name: 'AskUserQuestion', done: false }] },
    { path: '/m', name: 'infra', kind: 'meta', state: 'done', snippet: 'migration complete' },
  ],
  focusPath: '/b',
};

describe('OverlayView', () => {
  it('keeps the last reportable content when an empty payload arrives (hide-linger)', () => {
    const { getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    act(() => { stateCb!({ hasReportable: false, rows: [], focusPath: null }); });
    expect(getByText('Which auth method should the bot use?')).toBeTruthy();
  });

  it('mirrors interactive mode driven by the main process shortcut', () => {
    const { container } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    act(() => { interactiveCb!(true); });
    expect(container.querySelector('.overlay-root')!.className).toContain('overlay-interactive');
    act(() => { interactiveCb!(false); });
    expect(container.querySelector('.overlay-root')!.className).not.toContain('overlay-interactive');
  });

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

  it('renders multiple tool cards with running/done status', () => {
    const { container, getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    const cards = container.querySelectorAll('.overlay-tool-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Read');
    expect(cards[0].className).toContain('overlay-tool-done');
    expect(cards[1].textContent).toContain('Bash');
    expect(cards[1].className).not.toContain('overlay-tool-done');
  });

  it('shows the thinking animation for a busy focused row', () => {
    const { getByTestId, getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    expect(getByTestId('sai-logo').getAttribute('data-mode')).toBe('pulse');
  });

  it('interactive mode is driven ONLY by the main-process toggle (Ctrl+Shift+F9), not hover', () => {
    // Regression: in interactive mode mouse events reach the window, and the
    // old hover-modifier handler instantly cleared interactive on any plain
    // mousemove — making the F9 toggle appear to "reset on new messages".
    const { container } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    const root = container.querySelector('.overlay-root')!;
    expect(root.className).not.toContain('overlay-interactive');
    act(() => { interactiveCb!(true); });
    fireEvent.mouseMove(root, { ctrlKey: false, shiftKey: false });
    fireEvent.mouseLeave(root);
    expect(container.querySelector('.overlay-root')!.className).toContain('overlay-interactive');
    expect(setInteractive).not.toHaveBeenCalled();
  });
});
