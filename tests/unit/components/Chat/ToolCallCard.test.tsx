import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock shiki (used by ToolCallCard)
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>code</code></pre>'),
  }),
}));

import ToolCallCard, { isMarkdownBody } from '../../../../src/components/Chat/ToolCallCard';
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

  it('shows duration when durationMs is set', () => {
    const { getByTestId } = render(
      <ToolCallCard toolCall={{ id: 't1', type: 'other', name: 'Foo', input: '', output: 'done', durationMs: 3750 }} />
    );
    const el = getByTestId('tool-call-duration');
    expect(el).toBeTruthy();
    expect(el.textContent).toMatch(/^\[\d{2}:\d{2}\.\d\]$/);
    // 3750ms = 3.7s → [00:03.7]
    expect(el.textContent).toBe('[00:03.7]');
  });

  it('does not render duration when durationMs is undefined', () => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't1', type: 'other', name: 'Foo', input: '', output: 'done' }} />
    );
    expect(container.querySelector('[data-testid="tool-call-duration"]')).toBeNull();
  });

  it.each([
    ['file_edit', 'tool-sig-wipe'],
    ['terminal_command', 'tool-sig-typed'],
    ['web_fetch', 'tool-sig-shimmer'],
    ['file_read', 'tool-sig-scan'],
    ['other', 'tool-sig-shimmer'],
  ] as const)('applies signature class for %s', (type, expectedClass) => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't', type, name: 'X', input: '' }} />
    );
    expect(container.querySelector(`.${expectedClass}`)).toBeTruthy();
  });
});

describe('isMarkdownBody', () => {
  it('is true for a .md / .markdown label even with plain code', () => {
    expect(isMarkdownBody('docs/plan.md', 'just plain text')).toBe(true);
    expect(isMarkdownBody('NOTES.MARKDOWN', '')).toBe(true);
    expect(isMarkdownBody('/abs/path/TODO.md', 'x')).toBe(true);
  });

  it('is true for content with an ATX heading', () => {
    expect(isMarkdownBody('', '# Title\n\nSome body text here.')).toBe(true);
  });

  it('is true for content with a fenced code block', () => {
    expect(isMarkdownBody('', 'intro line\n```\ncode\n```\n')).toBe(true);
  });

  it('is true for content with a GFM table', () => {
    expect(isMarkdownBody('', 'col a | col b\n--- | ---\n1 | 2')).toBe(true);
  });

  it('is true for a multi-item markdown list', () => {
    expect(isMarkdownBody('', '- one\n- two\n- three')).toBe(true);
  });

  it('is false for plain prose', () => {
    expect(isMarkdownBody('', 'This is just a sentence about things.')).toBe(false);
  });

  it('is false for a single dash value line', () => {
    expect(isMarkdownBody('', '- only one item')).toBe(false);
  });

  it('is false for plain code / JSON bodies', () => {
    expect(isMarkdownBody('config.ts', 'const x = 1;\nexport default x;')).toBe(false);
    expect(isMarkdownBody('', '{\n  "a": 1\n}')).toBe(false);
  });

  it('is false for empty body with no md label', () => {
    expect(isMarkdownBody('', '')).toBe(false);
    expect(isMarkdownBody('app.tsx', '')).toBe(false);
  });
});
