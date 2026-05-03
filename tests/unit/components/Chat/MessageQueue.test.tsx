import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

describe('MessageQueue', () => {
  const mockQueue: QueuedMessage[] = [
    { id: '1', text: 'Refactor the auth module to use the new pattern', fullText: 'Refactor the auth module to use the new pattern' },
    { id: '2', text: 'Add unit tests for auth changes', fullText: 'Add unit tests for auth changes' },
    { id: '3', text: 'Run the full test suite', fullText: 'Run the full test suite' },
  ];

  it('renders nothing when queue is empty', () => {
    const { container } = render(<MessageQueue queue={[]} onRemove={vi.fn()} onPromote={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the badge when queue has items', () => {
    const { container } = render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} onPromote={vi.fn()} />);
    expect(container.querySelector('[data-testid="queue-badge"]')).toBeTruthy();
  });

  it('opens popover showing all queued messages on badge click', () => {
    const { container } = render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} onPromote={vi.fn()} />);
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const popover = container.querySelector('[data-testid="queue-popover"]');
    expect(popover?.textContent).toContain('Refactor the auth module');
    expect(popover?.textContent).toContain('Add unit tests');
    expect(popover?.textContent).toContain('Run the full test suite');
  });

  it('calls onRemove with correct id when remove button is clicked', () => {
    const onRemove = vi.fn();
    const { container } = render(<MessageQueue queue={mockQueue} onRemove={onRemove} onPromote={vi.fn()} />);
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const removeButtons = container.querySelectorAll('[data-testid="queue-remove"]');
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith('2');
  });
});
