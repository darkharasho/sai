import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { ipcMain } from 'electron';
import { registerMcpHandlers } from '../../../electron/services/mcp';

describe('mcp service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all expected IPC handlers', () => {
    registerMcpHandlers();
    const handle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const channels = handle.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('mcp:list');
    expect(channels).toContain('mcp:add');
    expect(channels).toContain('mcp:remove');
    expect(channels).toContain('mcp:update');
    expect(channels).toContain('mcp:registryList');
  });
});
