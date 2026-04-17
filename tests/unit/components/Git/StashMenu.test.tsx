import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import StashMenu from '../../../../src/components/Git/StashMenu';
import type { StashEntry } from '../../../../src/types';

const stashes: StashEntry[] = [
  { index: 0, message: 'WIP on main', date: '5 minutes ago', fileCount: 2 },
  { index: 1, message: 'feature prep', date: '2 days ago', fileCount: 5 },
];

describe('StashMenu', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a Stash button', () => {
    installMockSai();
    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    expect(screen.getByTitle(/stash/i)).toBeTruthy();
  });

  it('shows dropdown with stash list when clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);

    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => {
      expect(screen.getByText('WIP on main')).toBeTruthy();
      expect(screen.getByText('feature prep')).toBeTruthy();
    });
  });

  it('calls gitStash and onRefresh when Stash WIP clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue([]);
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<StashMenu projectPath="/proj" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getByText(/stash wip/i));
    fireEvent.click(screen.getByText(/stash wip/i));
    await waitFor(() => {
      expect(mock.gitStash).toHaveBeenCalledWith('/proj', undefined);
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('calls gitStashPop when Pop clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<StashMenu projectPath="/proj" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getAllByText('Pop'));
    fireEvent.click(screen.getAllByText('Pop')[0]);
    await waitFor(() => {
      expect(mock.gitStashPop).toHaveBeenCalledWith('/proj', 0);
    });
  });

  it('calls gitStashDrop when Drop clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);

    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getAllByText('Drop'));
    fireEvent.click(screen.getAllByText('Drop')[0]);
    await waitFor(() => {
      expect(mock.gitStashDrop).toHaveBeenCalledWith('/proj', 0);
    });
  });
});
