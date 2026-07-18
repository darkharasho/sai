// tests/unit/NewProjectTakeover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});
