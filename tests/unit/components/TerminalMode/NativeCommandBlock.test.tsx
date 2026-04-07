import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import NativeCommandBlock from '../../../../src/components/TerminalMode/NativeCommandBlock';

const baseBlock = {
  id: 'seg-1',
  command: 'npm run build',
  output: 'vite v6.2.0 building...\n✓ built in 2.1s',
  promptText: 'user@host:~$ ',
  startTime: Date.now() - 2100,
  duration: 2100,
  isRemote: false,
};

describe('NativeCommandBlock', () => {
  it('renders the prompt and command', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('npm run build');
  });

  it('renders the output', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('built in 2.1s');
  });

  it('shows duration', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('2.1s');
  });

  it('collapses when header is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <NativeCommandBlock block={baseBlock} collapsed={false} onToggleCollapse={onToggle} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const header = container.querySelector('.tn-block-header') as HTMLElement;
    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows collapsed state without output', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} collapsed={true} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).not.toContain('built in 2.1s');
    // Collapsed blocks show ▶ chevron
    expect(container.textContent).toContain('▶');
  });

  it('uses amber prompt color for remote blocks', () => {
    const remoteBlock = { ...baseBlock, isRemote: true, promptText: 'deploy@prod:~$ ' };
    const { container } = render(
      <NativeCommandBlock block={remoteBlock} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    const user = container.querySelector('.tn-user') as HTMLElement;
    expect(user.dataset.color).toContain('#f59e0b');
  });

  it('shows "via AI" label when aiSuggested is true', () => {
    const { container } = render(
      <NativeCommandBlock block={baseBlock} aiSuggested={true} onCopy={vi.fn()} onAskAI={vi.fn()} onRerun={vi.fn()} />
    );
    expect(container.textContent).toContain('via AI');
  });
});
