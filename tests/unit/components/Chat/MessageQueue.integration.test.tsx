// tests/unit/components/Chat/MessageQueue.integration.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

describe('MessageQueue integration', () => {
  it('renumbers cards after removal', () => {
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

    // Should renumber to 1, 2
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.queryByText('3.')).toBeNull();
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
    render(<MessageQueue queue={[{ id: '1', text: longText }]} onRemove={vi.fn()} />);
    const textEl = screen.getByText(longText);
    expect(textEl.className).toContain('message-queue-text');
  });
});
