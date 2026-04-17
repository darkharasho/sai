import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import { RebaseButton, RebaseInProgressBanner } from '../../../../src/components/Git/RebaseControls';

describe('RebaseButton', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a Rebase button', () => {
    installMockSai();
    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={vi.fn()} onListBranches={async () => ({ current: 'feature', branches: ['main', 'develop', 'feature'] })} />);
    expect(screen.getByText(/rebase/i)).toBeTruthy();
  });

  it('shows branch picker when clicked', async () => {
    installMockSai();
    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={vi.fn()} onListBranches={async () => ({ current: 'feature', branches: ['main', 'develop'] })} />);
    fireEvent.click(screen.getByText(/rebase/i));
    await waitFor(() => {
      expect(screen.getByText('main')).toBeTruthy();
      expect(screen.getByText('develop')).toBeTruthy();
    });
  });

  it('calls gitRebase and onRefresh when branch selected and Rebase clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={onRefresh} onListBranches={async () => ({ current: 'feature', branches: ['main'] })} />);
    fireEvent.click(screen.getByText(/rebase/i));
    await waitFor(() => screen.getByText('main'));
    fireEvent.click(screen.getByText('main'));
    fireEvent.click(screen.getByRole('button', { name: /^rebase$/i }));
    await waitFor(() => {
      expect(mock.gitRebase).toHaveBeenCalledWith('/proj', 'main');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});

describe('RebaseInProgressBanner', () => {
  it('renders in-progress banner with Continue/Skip/Abort', () => {
    installMockSai();
    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={vi.fn()} />);
    expect(screen.getByText(/rebase in progress/i)).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByText('Skip')).toBeTruthy();
    expect(screen.getByText('Abort')).toBeTruthy();
  });

  it('calls gitRebaseAbort and onRefresh when Abort clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Abort'));
    await waitFor(() => {
      expect(mock.gitRebaseAbort).toHaveBeenCalledWith('/proj');
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('calls gitRebaseContinue and onRefresh when Continue clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => {
      expect(mock.gitRebaseContinue).toHaveBeenCalledWith('/proj');
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('calls gitRebaseSkip and onRefresh when Skip clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Skip'));
    await waitFor(() => {
      expect(mock.gitRebaseSkip).toHaveBeenCalledWith('/proj');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
