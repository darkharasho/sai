// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn(), handle: vi.fn() }, app: { getPath: vi.fn(() => '/tmp') } }));

import { getOrCreate, onWorkspaceCreated } from '../../../electron/services/workspace';

describe('onWorkspaceCreated', () => {
  it('fires once when a workspace is created, not when an existing one is reused', () => {
    const seen: string[] = [];
    const off = onWorkspaceCreated((p) => seen.push(p));
    getOrCreate('/ws-created-a');
    getOrCreate('/ws-created-a');
    getOrCreate('/ws-created-b');
    off();
    getOrCreate('/ws-created-c');
    expect(seen).toEqual(['/ws-created-a', '/ws-created-b']);
  });

  it('a throwing listener does not break creation', () => {
    const off = onWorkspaceCreated(() => { throw new Error('boom'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getOrCreate('/ws-created-d').projectPath).toBe('/ws-created-d');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    off();
  });
});
