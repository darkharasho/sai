// Plain RTL render (NOT renderWithProviders — that installs its own window.sai
// mock and would clobber the claudeSudoReply stub below).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { SudoPromptCard } from '../../src/components/Chat/SudoPromptCard';
import type { PendingSudoPrompt } from '../../src/types';

const prompt: PendingSudoPrompt = {
  promptId: 'p1',
  toolUseId: 'toolu_1',
  command: 'sudo systemctl restart nginx',
};

describe('SudoPromptCard', () => {
  let sudoReply: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sudoReply = vi.fn(async () => {});
    (window as any).sai = { claudeSudoReply: sudoReply };
  });

  it('shows the command and disables Unlock until a password is typed', () => {
    render(<SudoPromptCard prompt={prompt} />);
    expect(screen.getByText('sudo systemctl restart nginx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock/i })).toBeDisabled();
  });

  it('submits the password over IPC', () => {
    render(<SudoPromptCard prompt={prompt} />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    expect(sudoReply).toHaveBeenCalledWith('p1', 'hunter2');
  });

  it('sends null on cancel', () => {
    render(<SudoPromptCard prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(sudoReply).toHaveBeenCalledWith('p1', null);
  });

  it('shows the retry error and re-enables input on a new promptId', () => {
    const { rerender } = render(<SudoPromptCard prompt={prompt} />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    rerender(<SudoPromptCard prompt={{ ...prompt, promptId: 'p2', error: 'Incorrect password' }} />);
    expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).not.toBeDisabled();
  });
});
