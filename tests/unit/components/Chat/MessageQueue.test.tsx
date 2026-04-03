import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

describe('MessageQueue', () => {
  const mockQueue: QueuedMessage[] = [
    { id: '1', text: 'Refactor the auth module to use the new pattern' },
    { id: '2', text: 'Add unit tests for auth changes' },
    { id: '3', text: 'Run the full test suite' },
  ];

  it('renders nothing when queue is empty', () => {
    const { container } = render(<MessageQueue queue={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a card for each queued message', () => {
    render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} />);
    expect(screen.getByText(/Refactor the auth module/)).toBeTruthy();
    expect(screen.getByText(/Add unit tests/)).toBeTruthy();
    expect(screen.getByText(/Run the full test suite/)).toBeTruthy();
  });

  it('shows numbered indices starting at 1', () => {
    render(<MessageQueue queue={mockQueue} onRemove={vi.fn()} />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('3.')).toBeTruthy();
  });

  it('calls onRemove with correct id when × is clicked', () => {
    const onRemove = vi.fn();
    render(<MessageQueue queue={mockQueue} onRemove={onRemove} />);
    const removeButtons = screen.getAllByTitle('Remove from queue');
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith('2');
  });
});
