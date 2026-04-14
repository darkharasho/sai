import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

// Mock monaco-editor (same pattern as CodePanel.test.tsx)
vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn().mockReturnValue({
      dispose: vi.fn(),
      getValue: vi.fn().mockReturnValue(''),
      setValue: vi.fn(),
      onDidChangeModelContent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidChangeCursorPosition: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      addCommand: vi.fn(),
      getModel: vi.fn().mockReturnValue({ uri: { toString: () => 'file:///test' } }),
      updateOptions: vi.fn(),
      layout: vi.fn(),
      focus: vi.fn(),
    }),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    createModel: vi.fn().mockReturnValue({
      dispose: vi.fn(),
      uri: { toString: () => 'file:///test' },
    }),
    getModel: vi.fn().mockReturnValue(null),
    Uri: { parse: vi.fn().mockReturnValue({ toString: () => 'file:///test' }) },
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
  Uri: { parse: vi.fn().mockReturnValue({ toString: () => 'file:///test' }) },
}));
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// Mock highlight themes
vi.mock('../../../../src/themes', () => ({
  getActiveHighlightTheme: vi.fn().mockReturnValue('monokai'),
  buildMonacoThemeData: vi.fn().mockReturnValue({ base: 'vs-dark', inherit: true, rules: [], colors: {} }),
}));

import ImageViewer from '../../../../src/components/CodePanel/ImageViewer';

describe('ImageViewer', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  beforeEach(() => {
    mockSai = installMockSai();
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
  });

  it('renders an image element', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(mockSai.fsReadFileBase64).toHaveBeenCalledWith('/project/logo.png');
    });
  });

  it('shows file type label', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(screen.getByText('PNG')).toBeTruthy();
    });
  });

  it('shows View Source button for SVG files', async () => {
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/svg+xml;base64,PHN2Zz4=');
    render(<ImageViewer filePath="/project/icon.svg" projectPath="/project" />);
    await waitFor(() => {
      expect(screen.getByText('View Source')).toBeTruthy();
    });
  });

  it('does not show View Source button for non-SVG files', async () => {
    render(<ImageViewer filePath="/project/logo.png" projectPath="/project" />);
    await waitFor(() => {
      expect(mockSai.fsReadFileBase64).toHaveBeenCalled();
    });
    expect(screen.queryByText('View Source')).toBeNull();
  });

  it('toggles to source view when View Source is clicked', async () => {
    mockSai.fsReadFileBase64.mockResolvedValue('data:image/svg+xml;base64,PHN2Zz4=');
    mockSai.fsReadFile.mockResolvedValue('<svg></svg>');
    render(
      <ImageViewer
        filePath="/project/icon.svg"
        projectPath="/project"
        onEditorSave={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('View Source')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('View Source'));
    await waitFor(() => {
      expect(mockSai.fsReadFile).toHaveBeenCalledWith('/project/icon.svg');
    });
  });
});
