import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

vi.mock('../../../../src/components/SaiLogo', () => ({
  default: ({ mode, className }: { mode?: string; className?: string }) => (
    <span data-testid="sai-logo" data-mode={mode} className={className} />
  ),
}));
vi.mock('../../../../src/components/SaiLogo.css', () => ({}));

const revealSpy = vi.fn(() => ({ cancel: () => {} }));
vi.mock('../../../../src/components/Chat/wordReveal', () => ({
  revealWords: (...args: any[]) => revealSpy(...args),
}));

beforeEach(() => {
  installMockSai();
  revealSpy.mockClear();
  window.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  } as any);
  window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
});
afterEach(() => { vi.useRealTimers(); });

import StreamingAssistantHead from '../../../../src/components/Chat/StreamingAssistantHead';

describe('StreamingAssistantHead', () => {
  it('while streaming: shows live clock + status, animated logo, no reveal', () => {
    const { container, getByTestId } = render(
      <StreamingAssistantHead streaming content="">
        <p>unused</p>
      </StreamingAssistantHead>
    );
    expect(container.querySelector('.sah-clock')).toBeTruthy();
    expect(container.querySelector('.sah-status')).toBeTruthy();
    expect(getByTestId('sai-logo').getAttribute('data-mode')).not.toBe('static');
    expect(revealSpy).not.toHaveBeenCalled();
  });

  it('on completion: freezes clock to duration, settles logo, reveals md', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender, getByTestId } = render(
      <StreamingAssistantHead streaming content="">
        <p>hello world</p>
      </StreamingAssistantHead>
    );
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="hello world" durationMs={12400}>
          <p>hello world</p>
        </StreamingAssistantHead>
      );
    });
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(container.querySelector('.sah-clock')?.textContent).toBe('[00:12.4]');
    expect(getByTestId('sai-logo').getAttribute('data-mode')).toBe('static');
    expect(revealSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.sah-status')).toBeNull();
  });

  it('reduced motion: no morph, content shown instantly, no reveal animation', async () => {
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as any));
    const { container, rerender } = render(
      <StreamingAssistantHead streaming content=""><p>hi</p></StreamingAssistantHead>
    );
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="hi" durationMs={500}>
          <p>hi</p>
        </StreamingAssistantHead>
      );
    });
    expect(revealSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.chat-msg-md')?.textContent).toContain('hi');
  });

  it('shows the status blur class during the morphing phase', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender } = render(
      <StreamingAssistantHead streaming content=""><p>hi there</p></StreamingAssistantHead>
    );
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="hi there" durationMs={3000}>
          <p>hi there</p>
        </StreamingAssistantHead>
      );
    });
    // immediately after completion, before the 250ms handoff elapses: morphing phase
    expect(container.querySelector('.sah-status--gone')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(container.querySelector('.sah-status')).toBeNull();
  });

  it('reflects a durationMs that arrives in a later render than completion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender } = render(
      <StreamingAssistantHead streaming content=""><p>done</p></StreamingAssistantHead>
    );
    // completion render: streaming false, content present, but durationMs not stamped yet
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="done"><p>done</p></StreamingAssistantHead>
      );
    });
    // later render: durationMs now stamped by the parent
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="done" durationMs={7800}><p>done</p></StreamingAssistantHead>
      );
    });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(container.querySelector('.sah-clock')?.textContent).toBe('[00:07.8]');
  });

  it('reveals exactly once under StrictMode (no cancel-on-cleanup force-complete)', () => {
    // Regression for commit 34660bf: StrictMode double-invokes effects; a
    // cancel-on-cleanup would force-complete the reveal before the real run.
    render(
      <StrictMode>
        <StreamingAssistantHead streaming={false} content="already done">
          <p>already done</p>
        </StreamingAssistantHead>
      </StrictMode>
    );
    expect(revealSpy).toHaveBeenCalledTimes(1);
  });
});
