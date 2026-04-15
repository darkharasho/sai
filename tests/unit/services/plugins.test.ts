import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { ipcMain } from 'electron';
import { registerPluginHandlers } from '../../../electron/services/plugins';

describe('plugins service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all expected IPC handlers', () => {
    registerPluginHandlers();
    const handle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const channels = handle.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('plugins:list');
    expect(channels).toContain('plugins:install');
    expect(channels).toContain('plugins:uninstall');
    expect(channels).toContain('plugins:registryList');
  });
});
