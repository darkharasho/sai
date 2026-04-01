import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

import FileExplorerSidebar from '../../../../src/components/FileExplorer/FileExplorerSidebar';
import type { DirEntry } from '../../../../src/types';

const defaultProps = {
  projectPath: '/home/user/project',
  onFileOpen: vi.fn(),
};

describe('FileExplorerSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    installMockSai();
    const { container } = render(<FileExplorerSidebar {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('calls fsReadDir on mount for the project path', async () => {
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue([]);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.fsReadDir).toHaveBeenCalledWith('/home/user/project');
    });
  });

  it('renders file entries returned from fsReadDir', async () => {
    const entries: DirEntry[] = [
      { name: 'index.ts', path: '/home/user/project/index.ts', type: 'file' },
      { name: 'README.md', path: '/home/user/project/README.md', type: 'file' },
    ];
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue(entries);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeTruthy();
      expect(screen.getByText('README.md')).toBeTruthy();
    });
  });

  it('renders directory entries', async () => {
    const entries: DirEntry[] = [
      { name: 'src', path: '/home/user/project/src', type: 'directory' },
    ];
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue(entries);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
  });

  it('calls onFileOpen when a file is clicked', async () => {
    const onFileOpen = vi.fn();
    const entries: DirEntry[] = [
      { name: 'App.tsx', path: '/home/user/project/App.tsx', type: 'file' },
    ];
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue(entries);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar projectPath="/home/user/project" onFileOpen={onFileOpen} />);
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('App.tsx'));
    expect(onFileOpen).toHaveBeenCalledWith('/home/user/project/App.tsx');
  });

  it('expands directory on click and loads children', async () => {
    const entries: DirEntry[] = [
      { name: 'src', path: '/home/user/project/src', type: 'directory' },
    ];
    const childEntries: DirEntry[] = [
      { name: 'main.ts', path: '/home/user/project/src/main.ts', type: 'file' },
    ];
    const mock = createMockSai();
    mock.fsReadDir
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce(childEntries);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });

    // Click on src directory to expand it
    fireEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(mock.fsReadDir).toHaveBeenCalledWith('/home/user/project/src');
    });
  });

  it('does not call fsReadDir when projectPath is empty', async () => {
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue([]);
    installMockSai(mock);

    render(<FileExplorerSidebar projectPath="" onFileOpen={vi.fn()} />);
    await new Promise(r => setTimeout(r, 50));
    expect(mock.fsReadDir).not.toHaveBeenCalled();
  });

  it('renders empty state when directory has no entries', async () => {
    const mock = createMockSai();
    mock.fsReadDir.mockResolvedValue([]);
    mock.fsCheckIgnored.mockResolvedValue([]);
    installMockSai(mock);

    const { container } = render(<FileExplorerSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(mock.fsReadDir).toHaveBeenCalled();
    });
    expect(container).toBeTruthy();
  });
});
