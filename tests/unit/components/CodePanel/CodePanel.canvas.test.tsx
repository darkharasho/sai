import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../../../src/components/FileExplorer/MonacoEditor', () => ({
  default: () => <div data-testid="monaco" />,
}));
vi.mock('../../../../src/components/CodePanel/DiffViewer', () => ({ default: () => null }));

import CodePanel from '../../../../src/components/CodePanel/CodePanel';
import { CanvasContext, type CanvasController } from '../../../../src/canvas/CanvasContext';
import { createCanvasStore } from '../../../../src/canvas/canvasStore';
import { canvasKey } from '../../../../src/canvas/canvasFiles';

const props = {
  projectPath: '/home/u/p',
  externallyModified: new Set<string>(),
  onActivate: vi.fn(), onClose: vi.fn(), onCloseAll: vi.fn(), onDiffModeChange: vi.fn(),
  onEditorSave: vi.fn(), onEditorContentChange: vi.fn(), onEditorDirtyChange: vi.fn(),
  onReloadFile: vi.fn(), onKeepMyEdits: vi.fn(),
};

// Tab opened under /home; the watcher reported the realpath /var/home.
const TAB = '/home/u/p/.sai/canvas/plan.md';

async function controller(): Promise<CanvasController> {
  const store = createCanvasStore({ writeFile: async () => {}, now: () => Date.now() });
  await store.onDiskChange(canvasKey('/var/home/u/p/.sai/canvas/plan.md'), '# Plan\n\nhello\n', false);
  return {
    store, chatKey: 'c', agentStatus: 'idle',
    sendInFor: () => null, sendNow: vi.fn(), holdToggle: vi.fn(),
    openCanvas: vi.fn(), openSource: vi.fn(), writeSource: vi.fn(),
  };
}

describe('CodePanel canvas tabs', () => {
  it('renders the canvas view for a canvas file and opens source on request', async () => {
    const ctl = await controller();
    render(
      <CanvasContext.Provider value={ctl}>
        <CodePanel {...props} openFiles={[{ path: TAB, viewMode: 'editor', content: '# Plan\n' }]} activeFilePath={TAB} />
      </CanvasContext.Provider>,
    );
    expect(screen.queryByTestId('monaco')).toBeNull();
    expect(screen.getByText('hello')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText('Source')); });
    expect(ctl.openSource).toHaveBeenCalledWith(TAB);
  });

  it('renders Monaco when the canvas tab is in source mode', async () => {
    const ctl = await controller();
    render(
      <CanvasContext.Provider value={ctl}>
        <CodePanel {...props} openFiles={[{ path: TAB, viewMode: 'editor', content: '# Plan\n', canvasSource: true }]} activeFilePath={TAB} />
      </CanvasContext.Provider>,
    );
    expect(screen.getByTestId('monaco')).toBeTruthy();
  });
});
