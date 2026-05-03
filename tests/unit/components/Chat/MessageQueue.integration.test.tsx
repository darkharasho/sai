import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import MessageQueue from '../../../../src/components/Chat/MessageQueue';
import type { QueuedMessage } from '../../../../src/types';

const buildQueue = (count: number): QueuedMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `q-${i}`,
    text: `message ${i + 1}`,
    fullText: `message ${i + 1}`,
  }));

describe('MessageQueue (badge + popover)', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <MessageQueue queue={[]} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the badge with "<n> queued" when the queue has items', () => {
    const { container, getByText } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.querySelector('[data-testid="queue-badge"]')).toBeTruthy();
    expect(getByText('3 queued')).toBeTruthy();
  });

  it('click opens the popover with all queued items', () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    expect(container.querySelector('[data-testid="queue-popover"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const popover = container.querySelector('[data-testid="queue-popover"]');
    expect(popover).toBeTruthy();
    expect(popover?.textContent).toContain('message 1');
    expect(popover?.textContent).toContain('message 2');
    expect(popover?.textContent).toContain('message 3');
  });

  it('click outside closes the popover', async () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    expect(container.querySelector('[data-testid="queue-popover"]')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="queue-popover"]')).toBeNull();
    });
  });

  it('promote button is hidden on item at index 0', () => {
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="queue-item"]');
    expect(items[0].querySelector('[data-testid="queue-promote"]')).toBeNull();
    expect(items[1].querySelector('[data-testid="queue-promote"]')).toBeTruthy();
  });

  it('promote button calls onPromote with the item id', () => {
    const onPromote = vi.fn();
    const { container } = render(
      <MessageQueue queue={buildQueue(3)} onRemove={vi.fn()} onPromote={onPromote} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="queue-item"]');
    const promoteBtn = items[2].querySelector('[data-testid="queue-promote"]') as HTMLElement;
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledWith('q-2');
  });

  it('remove button calls onRemove with the item id', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <MessageQueue queue={buildQueue(2)} onRemove={onRemove} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    const removeBtn = container.querySelector('[data-testid="queue-remove"]') as HTMLElement;
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('q-0');
  });

  it('renders attachment glyphs when an item has attachments', () => {
    const queue: QueuedMessage[] = [{
      id: 'q-att',
      text: 'msg with attachments',
      fullText: 'msg with attachments',
      attachments: { images: 2, files: 1, terminal: true },
    }];
    const { container } = render(
      <MessageQueue queue={queue} onRemove={vi.fn()} onPromote={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-testid="queue-badge"]') as HTMLElement);
    expect(container.querySelector('[data-testid="queue-attachments"]')).toBeTruthy();
  });
});
