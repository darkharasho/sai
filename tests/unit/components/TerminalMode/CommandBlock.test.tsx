import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CommandBlock from '../../../../src/components/TerminalMode/CommandBlock';
import type { CommandBlock as CommandBlockType } from '../../../../src/components/TerminalMode/types';

const baseBlock: CommandBlockType = {
  type: 'command',
  id: '1',
  command: 'npm run build',
  output: 'Compiled successfully in 812ms\nBuild output: dist/',
  exitCode: 0,
  startTime: Date.now() - 800,
  duration: 800,
};

describe('CommandBlock', () => {
  it('renders the command text', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('$ npm run build');
  });

  it('renders the output', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('Compiled successfully in 812ms');
  });

  it('shows success status for exit code 0', () => {
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('0.8s');
  });

  it('shows failure status for non-zero exit code', () => {
    const failBlock = { ...baseBlock, exitCode: 1 };
    const { container } = render(
      <CommandBlock block={failBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('exit 1');
  });

  it('shows running state when exitCode is null', () => {
    const runningBlock = { ...baseBlock, exitCode: null, duration: null };
    const { container } = render(
      <CommandBlock block={runningBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('running');
  });

  it('calls onCopy when copy icon is clicked', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={onCopy} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const copyBtn = container.querySelector('[title="Copy output"]') as HTMLElement;
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith(baseBlock.output);
  });

  it('calls onAskAI when sparkles icon is clicked', () => {
    const onAskAI = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={onAskAI} onRerun={vi.fn()} />
    );
    const aiBtn = container.querySelector('[title="Ask AI"]') as HTMLElement;
    fireEvent.click(aiBtn);
    expect(onAskAI).toHaveBeenCalledWith(baseBlock);
  });

  it('calls onRerun when rerun icon is clicked', () => {
    const onRerun = vi.fn();
    const { container } = render(
      <CommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={onRerun} />
    );
    const rerunBtn = container.querySelector('[title="Rerun"]') as HTMLElement;
    fireEvent.click(rerunBtn);
    expect(onRerun).toHaveBeenCalledWith(baseBlock.command);
  });
});
