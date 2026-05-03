import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import TodoProgress from '../../../../src/components/Chat/TodoProgress';

const buildTodosMsg = (todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>) => ({
  id: 'a1',
  role: 'assistant' as const,
  content: '',
  timestamp: 0,
  toolCalls: [{
    id: 'tc1',
    name: 'TodoWrite',
    input: JSON.stringify({
      todos: todos.map((t, i) => ({ id: String(i), content: t.content, status: t.status })),
    }),
  }],
});

describe('TodoProgress (ring + popover)', () => {
  it('renders nothing when there are no todos', () => {
    const { container } = render(<TodoProgress messages={[] as any} isStreaming={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when isStreaming is false', () => {
    const messages = [buildTodosMsg([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the ring with count when todos exist and isStreaming is true', () => {
    const messages = [buildTodosMsg([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'in_progress' },
    ])];
    const { container, getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(container.querySelector('[data-testid="todo-ring"]')).toBeTruthy();
    expect(getByText('2/3')).toBeTruthy();
  });

  it('click opens the popover with all todo items', () => {
    const messages = [buildTodosMsg([
      { content: 'first task', status: 'completed' },
      { content: 'middle task', status: 'in_progress' },
      { content: 'final task', status: 'pending' },
    ])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(container.querySelector('[data-testid="todo-ring-popover"]')).toBeNull();

    const ring = container.querySelector('[data-testid="todo-ring"]') as HTMLElement;
    fireEvent.click(ring);

    const popover = container.querySelector('[data-testid="todo-ring-popover"]');
    expect(popover).toBeTruthy();
    expect(popover?.textContent).toContain('first task');
    expect(popover?.textContent).toContain('middle task');
    expect(popover?.textContent).toContain('final task');
  });

  it('click outside closes the popover', () => {
    const messages = [buildTodosMsg([{ content: 'a', status: 'in_progress' }])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    expect(container.querySelector('[data-testid="todo-ring-popover"]')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('[data-testid="todo-ring-popover"]')).toBeNull();
  });

  it('dismiss button hides the indicator entirely', () => {
    const messages = [buildTodosMsg([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    const dismiss = container.querySelector('[data-testid="todo-ring-dismiss"]') as HTMLElement;
    fireEvent.click(dismiss);
    expect(container.querySelector('[data-testid="todo-ring"]')).toBeNull();
  });

  it('renders status indicators with correct classes', () => {
    const messages = [buildTodosMsg([
      { content: 'done one', status: 'completed' },
      { content: 'doing one', status: 'in_progress' },
      { content: 'todo one', status: 'pending' },
    ])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="todo-ring-item"]');
    expect(items[0].className).toContain('todo-ring-item--done');
    expect(items[1].className).toContain('todo-ring-item--active');
    expect(items[2].className).toContain('todo-ring-item--pending');
  });
});
