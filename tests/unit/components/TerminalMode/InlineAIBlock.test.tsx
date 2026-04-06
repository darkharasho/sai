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

  it('renders the AI response content', () => {
    const { container } = render(
      <InlineAIBlock question="test" content="The server is fine." onRunCommand={vi.fn()} />
    );
    expect(container.textContent).toContain('The server is fine.');
  });

  it('renders suggested commands with Run/Skip buttons', () => {
    const { container } = render(
      <InlineAIBlock
        question="test"
        content="Try this:"
        suggestedCommands={['tail -20 /var/log/syslog', 'systemctl restart nginx']}
        onRunCommand={vi.fn()}
      />
    );
    expect(container.textContent).toContain('tail -20 /var/log/syslog');
    expect(container.textContent).toContain('Run');
    expect(container.textContent).toContain('Skip');
  });

  it('calls onRunCommand when Run is clicked', () => {
    const onRun = vi.fn();
    const { container } = render(
      <InlineAIBlock
        question="test"
        content="Try:"
        suggestedCommands={['echo hello']}
        onRunCommand={onRun}
      />
    );
    const runBtn = container.querySelector('[data-action="run"]') as HTMLElement;
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
