import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock shiki (used by ToolCallCard)
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>code</code></pre>'),
  }),
}));

import ToolCallCard from '../../../../src/components/Chat/ToolCallCard';
import { SPRING } from '../../../../src/components/Chat/motion';

describe('ToolCallCard', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't1', type: 'other', name: 'Foo', input: '' }} />
    );
    expect(container.querySelector('.tool-call-card')).toBeTruthy();
  });

  it('uses pop spring + slide distance for entry', () => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't1', type: 'other', name: 'Foo', input: '' }} />
    );
    const card = container.querySelector('[data-testid="tool-card"]');
    expect(card?.getAttribute('data-entry-transition')).toBe(JSON.stringify(SPRING.pop));
    expect(card?.getAttribute('data-entry-y')).toBe(String(10));
  });

  it('uses flick spring for status badge transitions', () => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't', type: 'other', name: 'X', input: '', output: 'done' }} />
    );
    const badge = container.querySelector('[data-testid="tool-status-badge"]');
    expect(badge?.getAttribute('data-status-transition')).toBe(JSON.stringify(SPRING.flick));
  });

  it.each([
    ['file_edit', 'tool-sig-wipe'],
    ['terminal_command', 'tool-sig-typed'],
    ['web_fetch', 'tool-sig-shimmer'],
    ['file_read', null],
    ['other', null],
  ] as const)('applies signature class for %s', (type, expectedClass) => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't', type, name: 'X', input: '' }} />
    );
    if (expectedClass) {
      expect(container.querySelector(`.${expectedClass}`)).toBeTruthy();
    } else {
      expect(container.querySelector('.tool-sig-wipe, .tool-sig-typed, .tool-sig-shimmer')).toBeFalsy();
    }
  });
});
