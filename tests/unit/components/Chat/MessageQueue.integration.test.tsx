// tests/unit/components/Chat/MessageQueue.integration.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';
import { SPRING, STAGGER } from '../../../../src/components/Chat/motion';

describe('MessageQueue integration', () => {
  it('renumbers cards after removal', async () => {
    const queue: QueuedMessage[] = [
      { id: '1', text: 'First' },
      { id: '2', text: 'Second' },
      { id: '3', text: 'Third' },
    ];
    const onRemove = vi.fn();
    const { rerender } = render(<MessageQueue queue={queue} onRemove={onRemove} />);

    // Remove middle item
    fireEvent.click(screen.getAllByTitle('Remove from queue')[1]);
    expect(onRemove).toHaveBeenCalledWith('2');

    // Simulate parent removing the item and re-rendering
    const updated = queue.filter(m => m.id !== '2');
    rerender(<MessageQueue queue={updated} onRemove={onRemove} />);

    // AnimatePresence may keep the exiting card in the DOM briefly — wait for it
    // to leave, then assert the renumbered indices.
    await waitFor(() => {
      expect(screen.queryAllByText('Second')).toHaveLength(0);
    });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Third')).toBeTruthy();
    expect(screen.queryByText('3')).toBeNull();
  });

  it('renders nothing after all items removed', () => {
    const { container, rerender } = render(
      <MessageQueue queue={[{ id: '1', text: 'Only one' }]} onRemove={vi.fn()} />
    );
    expect(container.firstChild).not.toBeNull();

    rerender(<MessageQueue queue={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('truncates long message text via CSS (card structure is correct)', () => {
    const longText = 'A'.repeat(200);
    render(<MessageQueue queue={[{ id: '1', text: longText, fullText: longText }]} onRemove={vi.fn()} />);
    const textEl = screen.getByText(longText);
    expect(textEl.className).toContain('message-queue-text');
  });

  it('queue chips use gentle spring with tight stagger', () => {
    const { container } = render(
      <MessageQueue queue={[
        { id: '1', text: 'a', fullText: 'a' },
        { id: '2', text: 'b', fullText: 'b' },
      ]} onRemove={() => {}} />
    );
    const chip = container.querySelector('[data-testid="queue-chip"]');
    expect(chip?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.gentle));
    const stagger = container.querySelector('[data-testid="queue-stagger"]');
    expect(stagger?.getAttribute('data-cadence-ms')).toBe(String(STAGGER.tight));
  });

  it('passes duration:0 transitions to all motion children when reduced motion is preferred', () => {
    const original = window.matchMedia;
    // @ts-expect-error - test stub
    window.matchMedia = (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });

    const queue: QueuedMessage[] = [
      { id: '1', text: 'First', fullText: 'First' },
      { id: '2', text: 'Second', fullText: 'Second' },
    ];
    const { container } = render(<MessageQueue queue={queue} onRemove={() => {}} />);

    const all = container.querySelectorAll('[data-transition]');
    expect(all.length).toBeGreaterThan(0);
    for (const el of all) {
      const t = el.getAttribute('data-transition');
      expect(t).toBe(JSON.stringify({ duration: 0 }));
    }

    window.matchMedia = original;
  });
});
