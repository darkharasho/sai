import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

// Mock diff2html — it manipulates the DOM in ways jsdom doesn't support
vi.mock('diff2html', () => ({
  html: vi.fn().mockReturnValue('<div class="d2h-file-wrapper">mocked diff</div>'),
}));

vi.mock('diff2html/bundles/css/diff2html.min.css', () => ({}));

import DiffViewer from '../../../../src/components/CodePanel/DiffViewer';

const defaultProps = {
  projectPath: '/home/user/project',
  filePath: 'src/index.ts',
  staged: false,
  mode: 'unified' as const,
};

describe('DiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    const mock = createMockSai();
    // Never resolves during this test
    mock.gitDiff.mockImplementation(() => new Promise(() => {}));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    expect(screen.getByText('Loading diff...')).toBeTruthy();
  });

  it('calls gitDiff with correct arguments', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue('');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', false);
    });
  });

  it('calls gitDiff with staged=true when staged prop is true', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue('');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} staged={true} />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', true);
    });
  });

  it('shows "No changes" when diff is empty', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue('');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('No changes')).toBeTruthy();
    });
  });

  it('renders diff HTML when diff data is present', async () => {
    const { html: diff2htmlFn } = await import('diff2html');
    (diff2htmlFn as ReturnType<typeof vi.fn>).mockReturnValue('<div class="d2h-file-wrapper">diff content here</div>');

    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue('--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new');
    installMockSai(mock);

    const { container } = render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(container.querySelector('.diff-container')).toBeTruthy();
    });
  });

  it('shows error message when gitDiff fails', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockRejectedValue(new Error('permission denied'));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('permission denied')).toBeTruthy();
    });
  });

  it('re-fetches when filePath changes', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue('');
    installMockSai(mock);

    const { rerender } = render(<DiffViewer {...defaultProps} filePath="src/a.ts" />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/home/user/project', 'src/a.ts', false);
    });

    rerender(<DiffViewer {...defaultProps} filePath="src/b.ts" />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/home/user/project', 'src/b.ts', false);
    });
  });
});
