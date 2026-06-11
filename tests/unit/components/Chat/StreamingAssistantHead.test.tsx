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
import { _resetRevealRegistry } from '../../../../src/components/Chat/revealRegistry';

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

  it('does not strand the reply hidden when streaming resumes after an idle settle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender } = render(
      <StreamingAssistantHead streaming content=""><p>{''}</p></StreamingAssistantHead>
    );
    // idle settle mid-reply: streaming flips false with partial content (premature)
    await act(async () => {
      rerender(<StreamingAssistantHead streaming={false} content="partial"><p>partial</p></StreamingAssistantHead>);
    });
    await act(async () => { vi.advanceTimersByTime(300); });
    // tokens resume: streaming true again with more content
    await act(async () => {
      rerender(<StreamingAssistantHead streaming content="partial more"><p>partial more</p></StreamingAssistantHead>);
    });
    // true completion with the real duration
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="partial more final" durationMs={5000}>
          <p>partial more final</p>
        </StreamingAssistantHead>
      );
    });
    await act(async () => { vi.advanceTimersByTime(300); });

    const md = container.querySelector('.sah-md') as HTMLElement;
    expect(md).toBeTruthy();
    expect(md.style.display).not.toBe('none');            // NOT stranded hidden
    expect(md.textContent).toContain('partial more final');
    expect(container.querySelector('.sah-root')?.getAttribute('data-phase')).toBe('revealed');
    expect(container.querySelector('.sah-clock')?.textContent).toBe('[00:05.0]');
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

describe('reveal replay on remount (workspace/chat swap)', () => {
  it('plays the reveal the first time a message id mounts already-complete', async () => {
    _resetRevealRegistry();
    const { container } = render(
      <StreamingAssistantHead streaming={false} content="fresh arrival" messageId="m-first">
        <p>fresh arrival</p>
      </StreamingAssistantHead>
    );
    expect(revealSpy).toHaveBeenCalledTimes(1);
    // Content container must be visible (reveal owns word-level visibility)
    expect((container.querySelector('.sah-md') as HTMLElement).style.display).not.toBe('none');
  });

  it('does NOT replay the reveal when the same message id remounts', async () => {
    _resetRevealRegistry();
    // First mount: completes a live stream, reveal plays once.
    const first = render(
      <StreamingAssistantHead streaming content="" messageId="m-replay">
        <p>the reply</p>
      </StreamingAssistantHead>
    );
    first.rerender(
      <StreamingAssistantHead streaming={false} content="the reply" durationMs={1000} messageId="m-replay">
        <p>the reply</p>
      </StreamingAssistantHead>
    );
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    expect(revealSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    // Remount (workspace swap): same id, already revealed → no animation,
    // content visible immediately.
    const second = render(
      <StreamingAssistantHead streaming={false} content="the reply" durationMs={1000} messageId="m-replay">
        <p>the reply</p>
      </StreamingAssistantHead>
    );
    expect(revealSpy).toHaveBeenCalledTimes(1);
    expect((second.container.querySelector('.sah-md') as HTMLElement).style.display).not.toBe('none');
    expect(second.container.textContent).toContain('the reply');
  });
});
