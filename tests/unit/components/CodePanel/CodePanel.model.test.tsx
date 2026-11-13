import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../src/model3d/ModelViewer', () => ({
  default: (p: any) => { p.load?.().catch(() => {}); return <div data-testid="model-viewer" data-token={p.reloadToken} />; },
}));
vi.mock('../../../../src/components/FileExplorer/MonacoEditor', () => ({
  default: () => <div data-testid="monaco" />,
}));
vi.mock('../../../../src/components/CodePanel/DiffViewer', () => ({ default: () => null }));

import CodePanel from '../../../../src/components/CodePanel/CodePanel';

const props = {
  projectPath: '/p',
  externallyModified: new Set<string>(),
  onActivate: vi.fn(), onClose: vi.fn(), onCloseAll: vi.fn(), onDiffModeChange: vi.fn(),
  onEditorSave: vi.fn(), onEditorContentChange: vi.fn(), onEditorDirtyChange: vi.fn(),
  onReloadFile: vi.fn(), onKeepMyEdits: vi.fn(),
};

describe('CodePanel model files', () => {
  let cb: ((p: string) => void) | null = null;
  beforeEach(() => {
    (window as any).sai = {
      fsReadFileBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      fsWatchFile: vi.fn().mockResolvedValue(undefined),
      fsUnwatchFile: vi.fn().mockResolvedValue(undefined),
      onFsFileChanged: (f: any) => { cb = f; return () => {}; },
    };
  });

  it('renders ModelViewer for .stl and not Monaco', () => {
    render(<CodePanel {...props} openFiles={[{ path: '/p/part.stl', viewMode: 'editor' } as any]} activeFilePath="/p/part.stl" />);
    expect(screen.getByTestId('model-viewer')).toBeTruthy();
    expect(screen.queryByTestId('monaco')).toBeNull();
    expect((window as any).sai.fsWatchFile).toHaveBeenCalledWith('/p/part.stl');
    expect((window as any).sai.fsReadFileBuffer).toHaveBeenCalledWith('/p/part.stl');
  });
});
