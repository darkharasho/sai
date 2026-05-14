import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewProjectModal from '../../src/components/NewProjectModal';

function mockSai(overrides: Partial<any> = {}) {
  const sai: any = {
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubOnAuthComplete: vi.fn().mockReturnValue(() => {}),
    settingsGet: vi.fn().mockResolvedValue(''),
    selectFolder: vi.fn().mockResolvedValue(''),
    githubStartAuth: vi.fn().mockResolvedValue(undefined),
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true, text: 'AI reply' }),
    brainstormSynthesize: vi.fn().mockResolvedValue({
      ok: true, projectName: 'my-app', context: 'A summary.', transcript: 'transcript',
    }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn().mockReturnValue(() => {}),
    brainstormOnDone: vi.fn().mockImplementation((_sid: string, cb: any) => {
      setTimeout(() => cb('AI reply'), 0);
      return () => {};
    }),
    brainstormOnError: vi.fn().mockReturnValue(() => {}),
    scaffoldProject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    ...overrides,
  };
  (window as any).sai = sai;
  return sai;
}

describe('NewProjectModal brainstorm tab', () => {
  beforeEach(() => mockSai());

  it('renders both tabs and defaults to Setup', () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Brainstorm')).toBeInTheDocument();
    expect(screen.getByText(/Parent directory/i)).toBeVisible();
  });

  it('"Use this →" is disabled until an AI reply lands', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    const btn = screen.getByRole('button', { name: /use this/i });
    expect(btn).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/What are you thinking about building/i);
    fireEvent.change(textarea, { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
  });

  it('on synthesize, prefills name + context and switches to Setup', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect((screen.getByPlaceholderText('my-app') as HTMLInputElement).value).toBe('my-app'));
    expect((screen.getByPlaceholderText(/What is this project for/i) as HTMLTextAreaElement).value).toBe('A summary.');
    expect(screen.getAllByText(/from brainstorm/i).length).toBeGreaterThan(0);
  });

  it('shows Replace? prompt when fields are already filled', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    // Pre-fill name
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'manual-name' } });
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect(screen.getByText(/Replace your typed values/i)).toBeVisible());
    expect((screen.getByPlaceholderText('my-app') as HTMLInputElement).value).toBe('manual-name');
  });

  it('"from brainstorm" badge clears when user edits the field', async () => {
    render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Brainstorm'));
    fireEvent.change(screen.getByPlaceholderText(/What are you thinking about building/i), { target: { value: 'a CLI' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByRole('button', { name: /use this/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));
    await waitFor(() => expect(screen.getAllByText(/from brainstorm/i).length).toBeGreaterThan(0));
    const initialBadgeCount = screen.getAllByText(/from brainstorm/i).length;
    fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'edited' } });
    await waitFor(() => expect(screen.queryAllByText(/from brainstorm/i).length).toBe(initialBadgeCount - 1));
  });
});
