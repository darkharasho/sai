import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

import GitSidebar from '../../../../src/components/Git/GitSidebar';
import type { GitFile } from '../../../../src/types';

const defaultProps = {
  projectPath: '/home/user/project',
  onFileClick: vi.fn(),
};

describe('GitSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', async () => {
    installMockSai();
    const { container } = render(<GitSidebar {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('calls gitStatus on mount', async () => {
    const mockSai = installMockSai();
    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(mockSai.gitStatus).toHaveBeenCalledWith('/home/user/project');
    });
  });

  it('calls gitLog on mount', async () => {
    const mockSai = installMockSai();
    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(mockSai.gitLog).toHaveBeenCalledWith('/home/user/project', 20);
    });
  });

  it('renders staged files from git status', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main',
      staged: [{ path: 'src/index.ts', status: 'M' }],
      modified: [],
      created: [],
      deleted: [],
      not_added: [],
      ahead: 0,
      behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    // The component shows just the filename (index.ts) with the dir (src) below it
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeTruthy();
    });
  });

  it('renders unstaged modified files', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'feature',
      staged: [],
      modified: [{ path: 'README.md', status: 'M' }],
      created: [],
      deleted: [],
      not_added: [],
      ahead: 0,
      behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    // The file path 'README.md' has no directory component, so the filename is 'README.md'
    await waitFor(() => {
      expect(screen.getAllByText('README.md').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no changes', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main',
      staged: [],
      modified: [],
      created: [],
      deleted: [],
      not_added: [],
      ahead: 0,
      behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    const { container } = render(<GitSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.gitStatus).toHaveBeenCalled();
    });
    expect(container).toBeTruthy();
  });

  it('shows error when gitStatus fails', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockRejectedValue(new Error('not a git repo'));
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/not a git repo/i)).toBeTruthy();
    });
  });

  it('does not call gitStatus when projectPath is empty', async () => {
    const mockSai = installMockSai();
    render(<GitSidebar projectPath="" onFileClick={vi.fn()} />);
    // Give time for effects to potentially run
    await new Promise(r => setTimeout(r, 50));
    expect(mockSai.gitStatus).not.toHaveBeenCalled();
  });

  it('shows expand arrow on file rows', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main',
      staged: [],
      modified: [{ path: 'src/App.tsx', status: 'M' }],
      created: [], deleted: [], not_added: [], ahead: 0, behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => screen.getByText('App.tsx'));
    // The expand arrow (▶) should be present in the file row
    expect(screen.getAllByText('▶').length).toBeGreaterThan(0);
  });

  it('renders AI activity for Codex commits', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main',
      staged: [],
      modified: [],
      created: [],
      deleted: [],
      not_added: [],
      ahead: 0,
      behind: 0,
    });
    mock.gitLog.mockResolvedValue([
      {
        hash: 'abc1234',
        message: 'feat: update app shell',
        author: 'OpenAI Codex',
        date: '2024-01-01',
        files: [],
        aiProvider: 'codex',
      },
    ]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('AI Activity')).toBeTruthy();
      expect(screen.getByText('feat: update app shell')).toBeTruthy();
      expect(screen.getByText('Codex')).toBeTruthy();
    });
  });
});
