import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
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

  it('click outside closes the popover', async () => {
    const messages = [buildTodosMsg([{ content: 'a', status: 'in_progress' }])];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    expect(container.querySelector('[data-testid="todo-ring-popover"]')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="todo-ring-popover"]')).toBeNull();
    });
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

  it('reconstructs the task list from TaskCreate / TaskUpdate calls', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'go', timestamp: 0 },
      {
        id: 'a1',
        role: 'assistant' as const,
        content: '',
        timestamp: 1,
        toolCalls: [
          { id: 'c1', name: 'TaskCreate', input: JSON.stringify({ subject: 'first task', description: 'd' }), output: 'Task #1 created successfully: first task' },
          { id: 'c2', name: 'TaskCreate', input: JSON.stringify({ subject: 'second task', description: 'd' }), output: 'Task #2 created successfully: second task' },
          { id: 'u1', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'in_progress' }), output: 'ok' },
          { id: 'u2', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'completed' }), output: 'ok' },
        ],
      },
    ];
    const { container, getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(container.querySelector('[data-testid="todo-ring"]')).toBeTruthy();
    expect(getByText('1/2')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    const items = container.querySelectorAll('[data-testid="todo-ring-item"]');
    expect(items[0].className).toContain('todo-ring-item--done');
    expect(items[1].className).toContain('todo-ring-item--pending');
  });

  it('drops tasks whose TaskUpdate sets status to deleted', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'go', timestamp: 0 },
      {
        id: 'a1',
        role: 'assistant' as const,
        content: '',
        timestamp: 1,
        toolCalls: [
          { id: 'c1', name: 'TaskCreate', input: JSON.stringify({ subject: 'a' }), output: 'Task #1 created successfully: a' },
          { id: 'c2', name: 'TaskCreate', input: JSON.stringify({ subject: 'b' }), output: 'Task #2 created successfully: b' },
          { id: 'd1', name: 'TaskUpdate', input: JSON.stringify({ taskId: '2', status: 'deleted' }), output: 'ok' },
          { id: 'u1', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'in_progress' }), output: 'ok' },
        ],
      },
    ];
    const { getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(getByText('0/1')).toBeTruthy();
  });

  it('shows new TodoWrite items added in a follow-up turn', () => {
    // Turn 1: Claude completes a plan (ring would hide via completed===total).
    // Turn 2: user follows up; Claude calls TodoWrite again with just the
    // newly added items. The ring should reflect the latest TodoWrite, not
    // disappear because the call sits in a later turn.
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'do X', timestamp: 0 },
      { ...buildTodosMsg([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'completed' },
      ]), id: 'a1', timestamp: 1 },
      { id: 'u2', role: 'user' as const, content: 'also do Y and Z', timestamp: 2 },
      { ...buildTodosMsg([
        { content: 'Y', status: 'in_progress' },
        { content: 'Z', status: 'pending' },
      ]), id: 'a2', timestamp: 3 },
    ];
    const { container, getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(container.querySelector('[data-testid="todo-ring"]')).toBeTruthy();
    expect(getByText('0/2')).toBeTruthy();
  });

  it('keeps prior-turn TodoWrite visible when current turn has no TodoWrite yet', () => {
    // Mid-stream in turn 2 before Claude has called TodoWrite: the plan from
    // turn 1 should remain visible (provided it is not fully complete).
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'do X', timestamp: 0 },
      { ...buildTodosMsg([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]), id: 'a1', timestamp: 1 },
      { id: 'u2', role: 'user' as const, content: 'also note this', timestamp: 2 },
    ];
    const { getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(getByText('1/3')).toBeTruthy();
  });

  it('replays TaskCreate/TaskUpdate across turns so updates find prior tasks', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'go', timestamp: 0 },
      {
        id: 'a1', role: 'assistant' as const, content: '', timestamp: 1,
        toolCalls: [
          { id: 'c1', name: 'TaskCreate', input: JSON.stringify({ subject: 'first' }), output: 'Task #1 created successfully: first' },
          { id: 'c2', name: 'TaskCreate', input: JSON.stringify({ subject: 'second' }), output: 'Task #2 created successfully: second' },
        ],
      },
      { id: 'u2', role: 'user' as const, content: 'add a third', timestamp: 2 },
      {
        id: 'a2', role: 'assistant' as const, content: '', timestamp: 3,
        toolCalls: [
          { id: 'u1', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'completed' }), output: 'ok' },
          { id: 'c3', name: 'TaskCreate', input: JSON.stringify({ subject: 'third' }), output: 'Task #3 created successfully: third' },
        ],
      },
    ];
    const { getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(getByText('1/3')).toBeTruthy();
  });

  it('does not let an older completed TodoWrite shadow a live TaskCreate plan', () => {
    // Root cause of "task list stops showing under the input": a TodoWrite
    // call earlier in the conversation (e.g. a prior turn, a restored history,
    // or a subagent) used to win unconditionally over the newer Task* registry.
    // When that legacy plan was fully completed the ring hid via
    // completed===total, even though a fresh TaskCreate plan was active.
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'do X', timestamp: 0 },
      { ...buildTodosMsg([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'completed' },
      ]), id: 'a1', timestamp: 1 },
      { id: 'u2', role: 'user' as const, content: 'now do Y', timestamp: 2 },
      {
        id: 'a2', role: 'assistant' as const, content: '', timestamp: 3,
        toolCalls: [
          { id: 'c1', name: 'TaskCreate', input: JSON.stringify({ subject: 'Y-1' }), output: 'Task #1 created successfully: Y-1' },
          { id: 'c2', name: 'TaskCreate', input: JSON.stringify({ subject: 'Y-2' }), output: 'Task #2 created successfully: Y-2' },
          { id: 'u3', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'in_progress' }), output: 'ok' },
        ],
      },
    ];
    const { container, getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(container.querySelector('[data-testid="todo-ring"]')).toBeTruthy();
    expect(getByText('0/2')).toBeTruthy();
  });

  it('still prefers a newer TodoWrite over an older TaskCreate plan', () => {
    // Symmetric guard: recency wins both ways. An older Task* plan must not
    // shadow a newer TodoWrite plan either.
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'go', timestamp: 0 },
      {
        id: 'a1', role: 'assistant' as const, content: '', timestamp: 1,
        toolCalls: [
          { id: 'c1', name: 'TaskCreate', input: JSON.stringify({ subject: 'old' }), output: 'Task #1 created successfully: old' },
          { id: 'u2', name: 'TaskUpdate', input: JSON.stringify({ taskId: '1', status: 'completed' }), output: 'ok' },
        ],
      },
      { id: 'u2', role: 'user' as const, content: 'now plan via todowrite', timestamp: 2 },
      { ...buildTodosMsg([
        { content: 'P', status: 'in_progress' },
        { content: 'Q', status: 'pending' },
        { content: 'R', status: 'pending' },
      ]), id: 'a2', timestamp: 3 },
    ];
    const { getByText } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    expect(getByText('0/3')).toBeTruthy();
  });

  it('shows a priority badge on a popover item with priority', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant' as const,
      content: '',
      timestamp: 0,
      toolCalls: [{
        id: 'tc1',
        name: 'TodoWrite',
        input: JSON.stringify({
          todos: [
            { id: '1', content: 'A', status: 'in_progress', activeForm: 'Doing A', priority: 'high' },
            { id: '2', content: 'B', status: 'pending' },
          ],
        }),
      }],
    }];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    expect(container.querySelector('.todo-ring-priority')?.textContent).toBe('high');
  });

  it('shows title primary and activeForm secondary for the active item', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant' as const,
      content: '',
      timestamp: 0,
      toolCalls: [{
        id: 'tc1',
        name: 'TodoWrite',
        input: JSON.stringify({
          todos: [
            { id: '1', content: 'Run the suite', status: 'in_progress', activeForm: 'Running the suite' },
            { id: '2', content: 'B', status: 'pending' },
          ],
        }),
      }],
    }];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    fireEvent.click(container.querySelector('[data-testid="todo-ring"]') as HTMLElement);
    const active = container.querySelector('.todo-ring-item--active');
    expect(active?.querySelector('.todo-ring-text')?.textContent).toContain('Run the suite');
    expect(active?.querySelector('.todo-ring-subtext')?.textContent).toContain('Running the suite');
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
