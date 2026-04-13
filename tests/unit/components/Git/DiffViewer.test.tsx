import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

// Mock monaco-editor — jsdom doesn't support canvas/webgl
const mockSetModel = vi.fn();
const mockUpdateOptions = vi.fn();
const mockDispose = vi.fn();
const mockDiffEditor = {
  setModel: mockSetModel,
  updateOptions: mockUpdateOptions,
  dispose: mockDispose,
};
vi.mock('monaco-editor', () => ({
  editor: {
    createDiffEditor: vi.fn(() => mockDiffEditor),
    createModel: vi.fn((content: string, lang: string) => ({ content, lang, dispose: vi.fn() })),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
}));

// Mock theme helpers
vi.mock('../../../../src/themes', () => ({
  getActiveHighlightTheme: vi.fn().mockReturnValue('monokai'),
  buildMonacoThemeData: vi.fn().mockResolvedValue({
    base: 'vs-dark',
    rules: [],
    colors: {},
  }),
}));

import DiffViewer from '../../../../src/components/CodePanel/DiffViewer';

const defaultProps = {
  projectPath: '/home/user/project',
  filePath: 'src/index.ts',
  staged: false,
  mode: 'unified' as const,
  minimap: true,
};

describe('DiffViewer (Monaco)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    const mock = createMockSai();
    mock.gitShow.mockImplementation(() => new Promise(() => {}));
    mock.fsReadFile.mockImplementation(() => new Promise(() => {}));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    expect(screen.getByText('Loading diff...')).toBeTruthy();
  });

  it('fetches HEAD content and working tree content for unstaged diff', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('original content');
    mock.fsReadFile.mockResolvedValue('modified content');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', 'HEAD');
      expect(mock.fsReadFile).toHaveBeenCalled();
    });
  });

  it('fetches staged content when staged=true', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('content');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} staged={true} />);
    await waitFor(() => {
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', 'HEAD');
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', ':');
    });
  });

  it('creates a diff editor after content loads', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('old');
    mock.fsReadFile.mockResolvedValue('new');
    installMockSai(mock);

    const { editor } = await import('monaco-editor');

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(editor.createDiffEditor).toHaveBeenCalled();
    });
  });

  it('shows error message when fetch fails', async () => {
    const mock = createMockSai();
    mock.gitShow.mockRejectedValue(new Error('fatal error'));
    mock.fsReadFile.mockRejectedValue(new Error('file not found'));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/fatal error|file not found/)).toBeTruthy();
    });
  });
});
