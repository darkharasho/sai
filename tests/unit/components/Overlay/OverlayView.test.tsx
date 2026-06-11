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
    { path: '/a', name: 'sai', kind: 'project', state: 'busy', tail: [
      { kind: 'text', text: 'refactoring the spawn path' },
      { kind: 'tool', name: 'Read', done: true },
      { kind: 'text', text: 'now running the suite' },
      { kind: 'tool', name: 'Bash', done: false },
    ] },
    { path: '/b', name: 'BotCord', kind: 'project', state: 'question', tail: [
      { kind: 'text', text: 'Which auth method should the bot use?' },
      { kind: 'tool', name: 'AskUserQuestion', done: false },
    ] },
    { path: '/m', name: 'infra', kind: 'meta', state: 'done', tail: [{ kind: 'text', text: 'migration complete' }] },
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

  it('renders text and tool cards interleaved in chronological order', () => {
    const { container, getByText } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    fireEvent.click(getByText('sai', { selector: '.overlay-strip-name' }));
    const items = Array.from(container.querySelectorAll('.overlay-scroll > *'));
    expect(items.map(el => el.className.includes('overlay-tool-card') ? 'tool' : 'text'))
      .toEqual(['text', 'tool', 'text', 'tool']);
    const cards = container.querySelectorAll('.overlay-tool-card');
    expect(cards[0].className).toContain('overlay-tool-done');
    expect(cards[1].className).not.toContain('overlay-tool-done');
  });

  it('shows the identity status row at the bottom, not a header', () => {
    const { container } = render(<OverlayView />);
    act(() => { stateCb!(payload); });
    expect(container.querySelector('.overlay-focus-head')).toBeNull();
    const row = container.querySelector('.overlay-status-row')!;
    expect(row.textContent).toContain('BotCord');
    expect(row.textContent).toContain('waiting for your answer');
    // The status row is the card's last section (after the scroll area).
    const card = container.querySelector('.overlay-focus')!;
    expect(card.lastElementChild).toBe(row);
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

describe('done state and markdown (2026-06-11 round 4)', () => {
  it('renders text segments as markdown', () => {
    const { container } = render(<OverlayView />);
    act(() => {
      stateCb!({
        hasReportable: true,
        rows: [{ path: '/a', name: 'sai', kind: 'project', state: 'busy', tail: [{ kind: 'text', text: 'fixed **all** the `bugs`' }] }],
        focusPath: '/a',
      });
    });
    expect(container.querySelector('.overlay-snippet strong')?.textContent).toBe('all');
    expect(container.querySelector('.overlay-snippet code')?.textContent).toBe('bugs');
  });

  it('done shows the static SAI mark and name without a working label', () => {
    const { container } = render(<OverlayView />);
    act(() => {
      stateCb!({
        hasReportable: true,
        rows: [{ path: '/a', name: 'sai', kind: 'project', state: 'done', tail: [{ kind: 'text', text: 'all set' }] }],
        focusPath: '/a',
      });
    });
    const row = container.querySelector('.overlay-status-row')!;
    expect(row.querySelector('[data-testid="sai-logo"]')?.getAttribute('data-mode')).toBe('static');
    expect(row.textContent).toContain('sai');
    expect(row.textContent).not.toContain('working');
    expect(row.textContent).not.toContain('done');
  });
});

describe('history depth + task ring (2026-06-11 round 6)', () => {
  it('renders user messages distinctly within the timeline', () => {
    const { container } = render(<OverlayView />);
    act(() => {
      stateCb!({
        hasReportable: true,
        rows: [{ path: '/a', name: 'sai', kind: 'project', state: 'busy', tail: [
          { kind: 'user', text: 'fix the spawn path' },
          { kind: 'text', text: 'on it' },
        ] }],
        focusPath: '/a',
      });
    });
    expect(container.querySelector('.overlay-user-msg')?.textContent).toBe('fix the spawn path');
  });

  it('shows the task ring in the footer when todos exist', () => {
    const { container } = render(<OverlayView />);
    act(() => {
      stateCb!({
        hasReportable: true,
        rows: [{ path: '/a', name: 'sai', kind: 'project', state: 'busy', tail: [{ kind: 'text', text: 'working' }], todos: { done: 3, total: 7 } }],
        focusPath: '/a',
      });
    });
    const ring = container.querySelector('.overlay-status-row .overlay-task-ring');
    expect(ring).toBeTruthy();
    expect(ring!.textContent).toContain('3/7');
  });

  it('omits the task ring when no todos exist', () => {
    const { container } = render(<OverlayView />);
    act(() => {
      stateCb!({
        hasReportable: true,
        rows: [{ path: '/a', name: 'sai', kind: 'project', state: 'busy', tail: [{ kind: 'text', text: 'working' }] }],
        focusPath: '/a',
      });
    });
    expect(container.querySelector('.overlay-task-ring')).toBeNull();
  });
});
