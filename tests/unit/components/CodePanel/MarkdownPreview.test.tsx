import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock highlight.js CSS import
vi.mock('highlight.js/styles/monokai.css', () => ({}));

import MarkdownPreview from '../../../../src/components/CodePanel/MarkdownPreview';

describe('MarkdownPreview', () => {
  const defaultProps = {
    content: '# Hello World\n\nSome **bold** text.',
    onTogglePreview: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders markdown content as HTML', () => {
    render(<MarkdownPreview {...defaultProps} />);
    expect(screen.getByText('Hello World')).toBeTruthy();
    expect(screen.getByText(/bold/)).toBeTruthy();
  });

  it('renders a status bar with preview label', () => {
    const { container } = render(<MarkdownPreview {...defaultProps} />);
    expect(container.textContent).toContain('markdown');
    expect(container.textContent).toContain('preview');
  });

  it('renders an Editor toggle button in the status bar', () => {
    render(<MarkdownPreview {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /editor/i });
    expect(btn).toBeTruthy();
  });

  it('calls onTogglePreview when Editor button is clicked', () => {
    const onToggle = vi.fn();
    render(<MarkdownPreview {...defaultProps} onTogglePreview={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /editor/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders code blocks with syntax highlighting', () => {
    const content = '```js\nconsole.log("hi")\n```';
    const { container } = render(
      <MarkdownPreview {...defaultProps} content={content} />
    );
    // rehype-highlight adds hljs classes to code blocks
    const codeEl = container.querySelector('pre code');
    expect(codeEl).toBeTruthy();
  });

  it('renders GFM tables', () => {
    const content = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <MarkdownPreview {...defaultProps} content={content} />
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');
  });
});
