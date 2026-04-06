import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import TerminalModeInput from '../../../../src/components/TerminalMode/TerminalModeInput';

describe('TerminalModeInput', () => {
  it('renders with $ prompt in shell mode', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} />
    );
    expect(container.textContent).toContain('$');
  });

  it('renders with sparkle prompt in AI mode', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="ai" onToggleMode={vi.fn()} />
    );
    const prompt = container.querySelector('.tm-input-prompt');
    expect(prompt?.textContent).toContain('\u2726');
  });

  it('calls onSubmit with input value on Enter', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={onSubmit} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('ls -la');
  });

  it('clears input after submit', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('calls onToggleMode when Tab is pressed', () => {
    const onToggleMode = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={onToggleMode} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onToggleMode).toHaveBeenCalled();
  });

  it('does not submit empty input', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <TerminalModeInput onSubmit={onSubmit} mode="shell" onToggleMode={vi.fn()} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('populates input when initialValue is provided', () => {
    const { container } = render(
      <TerminalModeInput onSubmit={vi.fn()} mode="shell" onToggleMode={vi.fn()} initialValue="echo hello" />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('echo hello');
  });
});
