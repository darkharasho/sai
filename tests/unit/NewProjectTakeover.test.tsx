// tests/unit/NewProjectTakeover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewProjectTakeover from '../../src/components/NewProjectTakeover/NewProjectTakeover';
import BriefPane, { type SetupState } from '../../src/components/NewProjectTakeover/BriefPane';
import { EMPTY_BRIEF } from '../../src/components/NewProjectTakeover/useBrainstormBrief';

const setup: SetupState = {
  parentDir: '/tmp/projects',
  helpers: { claudeMd: true, gitInit: true, gitignore: true, readme: true, claudeSettings: false, githubRepo: false },
  repoName: '', visibility: 'private', githubUser: null,
};

const baseProps = () => ({
  brief: { ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.', goals: ['g1'], ready: false },
  onEditBrief: vi.fn().mockResolvedValue({ ok: true }),
  setup, onSetupChange: vi.fn(), onBrowseParent: vi.fn(), onConnectGitHub: vi.fn(),
  onCreate: vi.fn(), creating: false, createError: '', warnings: [], createdPath: '', onOpenProject: vi.fn(),
});

describe('BriefPane', () => {
  it('renders brief fields and hides the Ready pill until ready', () => {
    const { rerender } = render(<BriefPane {...baseProps()} />);
    expect(screen.getByTestId('brief-name')).toHaveTextContent('toy');
    expect(screen.getByTestId('brief-summary')).toHaveTextContent('A toy.');
    expect(screen.queryByTestId('brief-ready-pill')).toBeNull();
    rerender(<BriefPane {...baseProps()} brief={{ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.', ready: true }} />);
    expect(screen.getByTestId('brief-ready-pill')).toBeInTheDocument();
  });

  it('hides Open questions when empty and shows it dashed when present', () => {
    const props = baseProps();
    const { rerender } = render(<BriefPane {...props} />);
    expect(screen.queryByTestId('brief-open-questions')).toBeNull();
    rerender(<BriefPane {...props} brief={{ ...props.brief, openQuestions: ['Q?'] }} />);
    expect(screen.getByTestId('brief-open-questions')).toHaveTextContent('Q?');
  });

  it('click-to-edit name commits on Enter via onEditBrief', async () => {
    const props = baseProps();
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'toy-two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(props.onEditBrief).toHaveBeenCalledWith({ projectName: 'toy-two' }));
  });

  it('shows the validation error and stays in edit mode on rejection', async () => {
    const props = baseProps();
    props.onEditBrief = vi.fn().mockResolvedValue({ ok: false, error: 'projectName must be kebab-case' });
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'Bad Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/kebab-case/)).toBeInTheDocument());
    expect(screen.getByDisplayValue('Bad Name')).toBeInTheDocument();
  });

  it('gates Create on name+summary+parentDir and swaps to Open project after creation', () => {
    const props = baseProps();
    const { rerender } = render(<BriefPane {...props} brief={{ ...EMPTY_BRIEF }} />);
    expect(screen.getByTestId('create-project-btn')).toBeDisabled();
    rerender(<BriefPane {...props} />);
    expect(screen.getByTestId('create-project-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('create-project-btn'));
    expect(props.onCreate).toHaveBeenCalled();
    rerender(<BriefPane {...props} createdPath="/tmp/projects/toy" />);
    expect(screen.getByTestId('open-project-btn')).toBeInTheDocument();
  });

  it('expands the setup disclosure to reveal parent dir and helper toggles', () => {
    render(<BriefPane {...baseProps()} />);
    fireEvent.click(screen.getByTestId('setup-disclosure'));
    expect(screen.getByDisplayValue('/tmp/projects')).toBeInTheDocument();
    expect(screen.getByLabelText('CLAUDE.md')).toBeChecked();
  });

  it('does not double-commit when blur follows Enter', async () => {
    const props = baseProps();
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'toy-two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(props.onEditBrief).toHaveBeenCalledTimes(1));
  });

  it('does not commit on blur after Escape cancels', async () => {
    const props = baseProps();
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'toy-two' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await new Promise(r => setTimeout(r, 0));
    expect(props.onEditBrief).not.toHaveBeenCalled();
  });
});

function mockSai(overrides: Record<string, any> = {}) {
  const listeners: Record<string, (p: any) => void> = {};
  (window as any).sai = {
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sid-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEditBrief: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn((sid: string, cb: any) => { listeners[`chunk`] = cb; return () => {}; }),
    brainstormOnDone: vi.fn((sid: string, cb: any) => { listeners[`done`] = cb; return () => {}; }),
    brainstormOnError: vi.fn((sid: string, cb: any) => { listeners[`error`] = cb; return () => {}; }),
    brainstormOnBrief: vi.fn((sid: string, cb: any) => { listeners[`brief`] = cb; return () => {}; }),
    scaffoldProject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    selectFolder: vi.fn(), settingsGet: vi.fn().mockResolvedValue('/tmp/projects'),
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubStartAuth: vi.fn(), githubOnAuthComplete: vi.fn(() => () => {}),
    ...overrides,
  };
  return { listeners };
}

describe('NewProjectTakeover', () => {
  it('sends a message and fills the brief live from the brief event', async () => {
    const { listeners } = mockSai();
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'a folder sorter' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'folder-janitor', summary: 'Sorts.', ready: true }));
    act(() => listeners['done']('Draft is ready.'));
    expect(screen.getByTestId('brief-name')).toHaveTextContent('folder-janitor');
    expect(screen.getByTestId('brief-ready-pill')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-status-line')).toHaveTextContent(/brief ready/i);
  });

  it('Create passes the brief and transcript to scaffoldProject and calls onCreated', async () => {
    const { listeners } = mockSai();
    const onCreated = vi.fn();
    render(<NewProjectTakeover onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.' }));
    act(() => listeners['done']('ok'));
    await waitFor(() => expect(screen.getByTestId('create-project-btn')).toBeEnabled());
    fireEvent.click(screen.getByTestId('create-project-btn'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/tmp/projects/toy'));
    const call = (window as any).sai.scaffoldProject.mock.calls[0][0];
    expect(call.brief.projectName).toBe('toy');
    expect(call.brainstormTranscript).toContain('**User:** hi');
  });

  it('confirms before closing a dirty brainstorm', async () => {
    mockSai();
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewProjectTakeover onClose={onClose} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows scaffold errors inline and keeps the surface open', async () => {
    const { listeners } = mockSai({ scaffoldProject: vi.fn().mockResolvedValue({ ok: false, error: 'Could not create directory: EACCES' }) });
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.' }));
    act(() => listeners['done']('ok'));
    fireEvent.click(screen.getByTestId('create-project-btn'));
    await waitFor(() => expect(screen.getByText(/EACCES/)).toBeInTheDocument());
    expect(screen.getByTestId('brief-pane')).toBeInTheDocument();
  });

  it('hides the status line until the first assistant reply', async () => {
    const { listeners } = mockSai();
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    expect(screen.queryByTestId('brainstorm-status-line')).toBeNull();
    act(() => listeners['done']('first reply'));
    expect(screen.getByTestId('brainstorm-status-line')).toBeInTheDocument();
  });

  it('error event shows retry button; clicking retry calls brainstormSend twice with same text', async () => {
    const { listeners } = mockSai();
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'build me a thing' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    act(() => listeners['error']('network failure'));
    await waitFor(() => expect(screen.getByTestId('brainstorm-retry-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('brainstorm-retry-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalledTimes(2));
    expect((window as any).sai.brainstormSend).toHaveBeenLastCalledWith('sid-1', 'build me a thing');
  });

  it('Escape in name editor does not trigger confirm or close takeover', async () => {
    const { listeners } = mockSai();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    // Make it dirty (send a message so transcriptDirty = true)
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    // Trigger a brief update so the name field has content
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.' }));
    act(() => listeners['done']('ok'));
    // Open the name editor
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    confirmSpy.mockClear();
    // Fire Escape in the editor
    fireEvent.keyDown(input, { key: 'Escape' });
    // confirm should NOT have been called (event was stopped)
    expect(confirmSpy).not.toHaveBeenCalled();
    // Takeover still mounted
    expect(screen.getByTestId('brief-pane')).toBeInTheDocument();
    // Editor closed (display value gone / back to static)
    expect(screen.queryByDisplayValue('toy')).toBeNull();
    confirmSpy.mockRestore();
  });
});
