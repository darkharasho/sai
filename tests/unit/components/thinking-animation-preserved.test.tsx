/**
 * Guard test: ThinkingAnimation must render the SAI path (SaiLogo + clock).
 *
 * The double-dispatch of `sai-pref-sai-animation` is intentional: the first
 * fires in beforeEach (before the component mounts) to seed the module-scope
 * preference, and the second fires inside the test's `act(...)` block after
 * render to guarantee any useEffect listeners also pick up the enabled state.
 * This deterministically forces the SAI-enabled code path in jsdom where event
 * timing differs from a real browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';

// Mock SaiLogo to avoid CSS/animation complexity in jsdom
vi.mock('../../../src/components/SaiLogo', () => ({
  default: ({ className }: { className?: string }) => (
    <svg data-testid="sai-logo" className={className} />
  ),
}));
vi.mock('../../../src/components/SaiLogo.css', () => ({}));

import ThinkingAnimation from '../../../src/components/ThinkingAnimation';

beforeEach(() => {
  installMockSai();
  // Force the SAI animation enabled path before each test
  window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ThinkingAnimation preserved', () => {
  it('renders the SaiLogo (not a generic lucide icon) and the clock', async () => {
    const { container } = render(<ThinkingAnimation />);

    // Ensure SAI animation is active (event fires after render too)
    await act(async () => {
      window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
    });

    // SaiLogo renders as an <svg> in our mock
    expect(container.querySelector('[data-testid="sai-logo"]')).not.toBeNull();
    expect(container.querySelector('.thinking-clock')).not.toBeNull();
    expect(container.querySelector('.thinking-text')).not.toBeNull();
  });
});
