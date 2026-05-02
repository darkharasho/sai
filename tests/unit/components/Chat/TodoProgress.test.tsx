import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TodoProgress from '../../../../src/components/Chat/TodoProgress';
import { SPRING } from '../../../../src/components/Chat/motion';

describe('TodoProgress', () => {
  it('uses gentle spring on the fill', () => {
    const messages = [{
      id: '1',
      role: 'assistant' as const,
      content: '',
      timestamp: 0,
      toolCalls: [{
        id: 'tc1',
        name: 'TodoWrite',
        input: JSON.stringify({
          todos: [
            { id: 'a', content: 'a', status: 'completed' },
            { id: 'b', content: 'b', status: 'in_progress' },
          ],
        }),
      }],
    }];
    const { container } = render(<TodoProgress messages={messages as any} isStreaming={true} />);
    const fill = container.querySelector('[data-testid="todo-progress-fill"]');
    expect(fill?.getAttribute('data-transition')).toBe(JSON.stringify(SPRING.gentle));
  });
});
