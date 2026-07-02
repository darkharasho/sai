import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Mock shiki (used by ToolCallCard)
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockReturnValue('<pre><code>code</code></pre>'),
  }),
}));

import ToolCallCard, { isMarkdownBody } from '../../../../src/components/Chat/ToolCallCard';
import { SPRING } from '../../../../src/components/Chat/motion';
import { TaskRegistryContext } from '../../../../src/components/Chat/taskRegistry';

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

  it('marks the card running while output is absent', () => {
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't', type: 'file_search', name: 'ToolSearch', input: '{}' }} />
    );
    expect(container.querySelector('.tool-call-card--running')).toBeTruthy();
  });

  it('settles to done on an EMPTY-string output (ToolSearch-style results)', () => {
    // Some tools return an empty result body; presence of the result — not
    // its truthiness — is what ends the running shimmer.
    const { container } = render(
      <ToolCallCard toolCall={{ id: 't', type: 'file_search', name: 'ToolSearch', input: '{}', output: '' }} />
    );
    expect(container.querySelector('.tool-call-card--running')).toBeNull();
    expect(container.querySelector('.tool-status-done')).toBeTruthy();
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

  it('is false for code with a pipe line and a separate dashed divider (non-adjacent)', () => {
    expect(isMarkdownBody('', 'cat foo | grep bar\nsome code\n--------')).toBe(false);
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

  it('is false for a non-md file even when the body trips the heuristics', () => {
    // JSDoc continuation lines (" * text") match the list-item pattern, and
    // TS union arms ("| { ... }") look table-ish — a known non-markdown
    // extension must short-circuit before any body sniffing.
    const ts = [
      '/**',
      ' * Wire GitHub-Releases auto-updates.',
      ' * Active only in the packaged app.',
      ' */',
      'export type UpdateStatus =',
      "  | { state: 'checking' }",
      "  | { state: 'ready'; version: string }",
    ].join('\n');
    expect(isMarkdownBody('/abs/path/updater.ts', ts)).toBe(false);
    expect(isMarkdownBody('src/notes.py', '# heading-looking comment\n# another one\nx = 1')).toBe(false);
  });

  it('still applies heuristics when the label has no file extension', () => {
    expect(isMarkdownBody('Command', '# Title\n\n- a\n- b')).toBe(true);
  });
});

describe('ToolCallCard markdown body', () => {
  const mdWrite = {
    id: 'w1',
    type: 'file_edit' as const,
    name: 'Write',
    input: JSON.stringify({ file_path: 'docs/plan.md', content: '# Plan\n\n- a\n- b\n' }),
  };

  it('renders a .md Write as markdown by default', () => {
    const { container } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(container.querySelector('.card-md')).toBeTruthy();
    expect(container.querySelector('.card-md h1')?.textContent).toBe('Plan');
  });

  it('shows a rendered/source toggle for markdown bodies', () => {
    const { getByTestId } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(getByTestId('md-view-toggle')).toBeTruthy();
  });

  it('renders a .ts Write with JSDoc as plain source, not markdown', () => {
    const tsWrite = {
      id: 'w2',
      type: 'file_edit' as const,
      name: 'Write',
      input: JSON.stringify({
        file_path: '/p/updater.ts',
        content: '/**\n * Update lifecycle.\n * Pushed to the renderer.\n */\nexport const x = 1;\n',
      }),
    };
    const { container, queryByTestId } = render(<ToolCallCard toolCall={tsWrite} />);
    expect(container.querySelector('.card-md')).toBeFalsy();
    expect(queryByTestId('md-view-toggle')).toBeFalsy();
  });

  it('flips to highlighted source when toggled', () => {
    const { container, getByTestId } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(container.querySelector('.card-md')).toBeTruthy();
    fireEvent.click(getByTestId('md-view-source'));
    expect(container.querySelector('.card-md')).toBeNull();
    expect(container.querySelector('.highlighted-code, .plain-code')).toBeTruthy();
  });

  it('does not render markdown or toggle for a non-md Write', () => {
    const tsWrite = {
      id: 'w2',
      type: 'file_edit' as const,
      name: 'Write',
      input: JSON.stringify({ file_path: 'src/app.ts', content: 'const x = 1;\nexport default x;' }),
    };
    const { container, queryByTestId } = render(<ToolCallCard toolCall={tsWrite} />);
    expect(container.querySelector('.card-md')).toBeNull();
    expect(queryByTestId('md-view-toggle')).toBeNull();
  });

  it('keeps Edit of a .md file as a diff, not markdown', async () => {
    const mdEdit = {
      id: 'e1',
      type: 'file_edit' as const,
      name: 'Edit',
      input: JSON.stringify({ file_path: 'docs/plan.md', old_string: '# Old', new_string: '# New' }),
    };
    const { container } = render(<ToolCallCard toolCall={mdEdit} />);
    await waitFor(() => expect(container.querySelector('.diff-highlighted')).toBeTruthy());
    expect(container.querySelector('.card-md')).toBeNull();
  });
});

describe('ToolCallCard search rendering', () => {
  const grep = {
    id: 'g1',
    type: 'file_search' as const,
    name: 'Grep',
    input: JSON.stringify({ pattern: 'const', path: 'src', glob: '*.ts' }),
    output: 'src/a.ts:12:const x = 1\nsrc/b.ts:3:const y = 2',
  };

  it('renders grep output as search-result rows, not highlighted source', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    expect(container.querySelector('.search-result')).toBeTruthy();
    expect(container.querySelectorAll('.search-row-match').length).toBe(2);
  });

  it('highlights the matched term inside grep results', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    const marks = container.querySelectorAll('.search-hit');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent).toBe('const');
  });

  it('shows the query view for path/glob fields', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    const keys = Array.from(container.querySelectorAll('.search-query-key')).map(n => n.textContent);
    expect(keys).toContain('path');
    expect(keys).toContain('glob');
  });

  it('renders glob output as file rows even with no input body code', () => {
    const glob = {
      id: 'g2',
      type: 'file_search' as const,
      name: 'Glob',
      input: JSON.stringify({ pattern: '**/*.ts' }),
      output: 'src/a.ts\nsrc/b.ts',
    };
    const { container } = render(<ToolCallCard toolCall={glob} />);
    expect(container.querySelectorAll('.search-row-file').length).toBe(2);
  });

  it('does not crash and renders plain content for an invalid regex pattern', () => {
    const bad = {
      id: 'g3',
      type: 'file_search' as const,
      name: 'Grep',
      input: JSON.stringify({ pattern: '(' }),
      output: 'src/a.ts:1:a(b',
    };
    const { container } = render(<ToolCallCard toolCall={bad} />);
    expect(container.querySelector('.search-row-match')).toBeTruthy();
    expect(container.querySelector('.search-hit')).toBeNull();
  });

  it('leaves a non-search tool (Read output) unchanged', () => {
    const read = {
      id: 'r1',
      type: 'file_read' as const,
      name: 'Read',
      input: JSON.stringify({ file_path: 'src/a.ts' }),
      output: 'just some file contents here',
    };
    const { container } = render(<ToolCallCard toolCall={read} />);
    expect(container.querySelector('.search-result')).toBeNull();
  });

  it('does not render search results for a Bash card with file-list output', () => {
    const bash = {
      id: 'b1',
      type: 'terminal_command' as const,
      name: 'Bash',
      input: JSON.stringify({ command: 'ls src' }),
      output: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',
    };
    const { container } = render(<ToolCallCard toolCall={bash} />);
    expect(container.querySelector('.search-result')).toBeNull();
    // Bash keeps its dedicated IN/OUT rendering
    expect(container.querySelector('.bash-inout-body')).toBeTruthy();
  });
});

describe('ToolCallCard task rendering', () => {
  it('renders a TaskCreate card with subject title and a created badge', () => {
    const create = {
      id: 'tc1', type: 'task' as const, name: 'TaskCreate',
      input: JSON.stringify({ subject: 'Build the parser', description: 'parse search output' }),
      output: 'Task #1 created successfully',
    };
    const { container, getByText } = render(<ToolCallCard toolCall={create} />);
    expect(container.querySelector('.task-card')).toBeTruthy();
    expect(getByText('Build the parser')).toBeTruthy();
    expect(container.querySelector('.task-badge-created')).toBeTruthy();
  });

  it('resolves a TaskUpdate subject from the registry context', () => {
    const update = {
      id: 'tu1', type: 'task' as const, name: 'TaskUpdate',
      input: JSON.stringify({ taskId: '1', status: 'completed' }),
    };
    const registry = new Map([['1', { id: '1', subject: 'Build the parser', status: 'completed' as const }]]);
    const { getByText, container } = render(
      <TaskRegistryContext.Provider value={registry}>
        <ToolCallCard toolCall={update} />
      </TaskRegistryContext.Provider>
    );
    expect(getByText('Build the parser')).toBeTruthy();
    expect(container.querySelector('.task-badge-completed')).toBeTruthy();
  });

  it('falls back to Task #id when the update is unresolved', () => {
    const update = {
      id: 'tu2', type: 'task' as const, name: 'TaskUpdate',
      input: JSON.stringify({ taskId: '7', status: 'in_progress' }),
    };
    const { getByText } = render(<ToolCallCard toolCall={update} />);
    expect(getByText('Task #7')).toBeTruthy();
  });
});

describe('TodoWrite card enhancements', () => {
  const todoCall = {
    id: 'td1', type: 'todo' as const, name: 'TodoWrite',
    input: JSON.stringify({ todos: [
      { id: '1', content: 'First', status: 'completed' },
      { id: '2', content: 'Second', activeForm: 'Doing second', status: 'in_progress', priority: 'high' },
      { id: '3', content: 'Third', status: 'pending' },
    ] }),
  };

  it('shows a done/total count header', () => {
    const { getByTestId } = render(<ToolCallCard toolCall={todoCall} />);
    expect(getByTestId('todo-count').textContent).toBe('1/3');
  });

  it('shows the activeForm for the in-progress item', () => {
    const { getByText } = render(<ToolCallCard toolCall={todoCall} />);
    expect(getByText('Doing second')).toBeTruthy();
  });

  it('renders a priority badge when a todo has priority', () => {
    const { container } = render(<ToolCallCard toolCall={todoCall} />);
    expect(container.querySelector('.todo-priority')?.textContent).toBe('high');
  });
});
