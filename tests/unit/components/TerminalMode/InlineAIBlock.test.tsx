import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import InlineAIBlock from '../../../../src/components/TerminalMode/InlineAIBlock';

describe('InlineAIBlock', () => {
  it('renders the user question', () => {
    const { container } = render(
      <InlineAIBlock question="is this healthy?" content="Yes, nginx is running." onRunCommand={vi.fn()} />
    );
    expect(container.textContent).toContain('is this healthy?');
  });

  it('renders the AI response content as markdown', () => {
    const { container } = render(
      <InlineAIBlock question="test" content="The **server** is fine." onRunCommand={vi.fn()} />
    );
    expect(container.textContent).toContain('The server is fine.');
    // Bold should be rendered
    expect(container.querySelector('strong')?.textContent).toBe('server');
  });

  it('renders code blocks with copy button', () => {
    const { container } = render(
      <InlineAIBlock
        question="test"
        content={'Try this:\n```bash\necho hello\n```'}
        onRunCommand={vi.fn()}
      />
    );
    expect(container.querySelector('.tn-ai-code-wrapper')).toBeTruthy();
    expect(container.querySelector('.tn-ai-code-copy')).toBeTruthy();
  });

  it('shows run button on runnable code blocks', () => {
    const onRun = vi.fn();
    const { container } = render(
      <InlineAIBlock
        question="test"
        content={'Try:\n```bash\necho hello\n```'}
        suggestedCommands={['echo hello']}
        onRunCommand={onRun}
      />
    );
    const runBtn = container.querySelector('.tn-ai-code-run') as HTMLElement;
    expect(runBtn).toBeTruthy();
    fireEvent.click(runBtn);
    expect(onRun).toHaveBeenCalledWith('echo hello');
  });

  it('shows streaming indicator when streaming', () => {
    const { container } = render(
      <InlineAIBlock question="test" content="" streaming={true} onRunCommand={vi.fn()} />
    );
    expect(container.querySelector('.tn-ai-streaming')).toBeTruthy();
  });
});
