import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';

// Mock SaiLogo to avoid CSS/animation complexity in jsdom
vi.mock('../../../src/components/SaiLogo', () => ({
  default: ({ className }: { className?: string }) => (
    <span data-testid="sai-logo" className={className} />
  ),
}));

// Mock SaiLogo.css (imported inside SaiLogo but mocked above; belt-and-suspenders)
vi.mock('../../../src/components/SaiLogo.css', () => ({}));

import ThinkingAnimation from '../../../src/components/ThinkingAnimation';

describe('ThinkingAnimation', () => {
  beforeEach(() => {
    installMockSai();
    // Ensure the module-scope pref starts at true (SAI enabled)
    // by dispatching the event before rendering
    window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SAI path renders the clock prefix and a .thinking-cursor-block', async () => {
    const { container } = render(<ThinkingAnimation />);

    // Ensure SAI animation is active
    await act(async () => {
      window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
    });

    expect(container.querySelector('.thinking-clock')).toBeTruthy();
    expect(container.querySelector('.thinking-cursor-block')).toBeTruthy();
    expect(container.querySelector('.thinking-cursor-breathing')).toBeNull();
  });

  it('fallback path renders no clock, uses .thinking-cursor-breathing, and trailing ...', async () => {
    const { container } = render(<ThinkingAnimation />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false }));
    });

    expect(container.querySelector('.thinking-clock')).toBeNull();
    expect(container.querySelector('.thinking-cursor-breathing')).toBeTruthy();
    expect(container.querySelector('.thinking-cursor-block')).toBeNull();
    // Trailing ellipsis is present in the text node
    expect(container.querySelector('.thinking-text')?.textContent).toContain('...');
  });

  it('clock text matches expected format', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { container } = render(<ThinkingAnimation />);

    // Ensure SAI path is active
    await act(async () => {
      window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
    });

    // Advance timers so the clock interval fires at least once
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const clockEl = container.querySelector('.thinking-clock');
    expect(clockEl).toBeTruthy();
    // Format: [MM:SS.d] e.g. [00:00.2]
    expect(clockEl?.textContent).toMatch(/^\[\d{2}:\d{2}\.\d\]$/);
  });

  it('clock is absent when SAI animation is toggled off', async () => {
    const { container } = render(<ThinkingAnimation />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: false }));
    });

    expect(container.querySelector('.thinking-clock')).toBeNull();
  });
});
