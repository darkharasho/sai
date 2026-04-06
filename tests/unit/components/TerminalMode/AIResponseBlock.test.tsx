import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AIResponseBlock from '../../../../src/components/TerminalMode/AIResponseBlock';
import type { AIResponseBlock as AIResponseBlockType } from '../../../../src/components/TerminalMode/types';

const baseBlock: AIResponseBlockType = {
  type: 'ai-response',
  id: '2',
  content: 'Your `add()` function returns `a + b + 1` instead of `a + b`.',
  parentBlockId: '1',
};

describe('AIResponseBlock', () => {
  it('renders the AI label', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    expect(container.textContent).toContain('Claude');
  });

  it('renders the response content as markdown', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    expect(container.textContent).toContain('add()');
  });

  it('calls onCopy when copy icon is clicked', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={onCopy} />
    );
    const copyBtn = container.querySelector('[title="Copy"]') as HTMLElement;
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith(baseBlock.content);
  });

  it('collapses and expands when chevron is clicked', () => {
    const { container } = render(
      <AIResponseBlock block={baseBlock} onCopy={vi.fn()} />
    );
    const chevron = container.querySelector('[title="Collapse"]') as HTMLElement;
    fireEvent.click(chevron);
    const body = container.querySelector('.tm-ai-body') as HTMLElement;
    expect(body.style.display).toBe('none');
  });
});
