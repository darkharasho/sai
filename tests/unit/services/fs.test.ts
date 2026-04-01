// @vitest-environment node
/**
 * Unit tests for electron/services/fs.ts
 *
 * Coverage:
 *   - readDir — sorted (directories first, then alphabetical)
 *   - readFile — returns content
 *   - writeFile — writes content
 *   - createFile / createDir
 *   - rename / delete (with dialog confirmation)
 *   - checkIgnored — uses git check-ignore, returns ignored paths
 *   - checkIgnored — returns empty array when git not available
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared objects for mock factories
// ---------------------------------------------------------------------------

const { mockIpcMain, mockFsModule, mockDialog, mockSpawnSync } = vi.hoisted(() => {
  type IpcHandler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, IpcHandler>();

  const mockIpcMain = {
    _handlers: handlers,
    handle: vi.fn((channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
    async _invoke(channel: string, ...args: unknown[]) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for "${channel}"`);
      return fn({ sender: {} } as unknown, ...args);
    },
  };

  const mockDialog = {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false }),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  };

  const mockSpawnSync = vi.fn();

  // fs synchronous mock
  const mockFsModule = {
    default: {
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      rmSync: vi.fn(),
      mkdirSync: vi.fn(),
      promises: {
        stat: vi.fn(),
      },
    },
  };

  return { mockIpcMain, mockFsModule, mockDialog, mockSpawnSync };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}));

vi.mock('node:fs', () => mockFsModule);

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  mockIpcMain._handlers.clear();
  mockIpcMain.handle.mockClear();

  const fs = mockFsModule.default;
  fs.readdirSync.mockReset();
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.renameSync.mockReset();
  fs.rmSync.mockReset();
  fs.mkdirSync.mockReset();
  fs.promises.stat.mockReset();

  mockDialog.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
  mockSpawnSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockBrowserWindow() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(false),
    on: vi.fn(),
  };
}

async function loadService() {
  return import('../../../electron/services/fs');
}

async function setup() {
  const win = createMockBrowserWindow();
  const { registerFsHandlers } = await loadService();
  registerFsHandlers(win as never);
  return { win, ipc: mockIpcMain };
}

// ---------------------------------------------------------------------------
// Helper to build fake dirent objects
// ---------------------------------------------------------------------------

function dirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
  };
}

// ===========================================================================
// fs:readDir
// ===========================================================================

describe('fs:readDir', () => {
  it('returns entries sorted — directories first, then alphabetical within each group', async () => {
    await setup();

    mockFsModule.default.readdirSync.mockReturnValue([
      dirent('zebra.ts', false),
      dirent('alpha.ts', false),
      dirent('src', true),
      dirent('node_modules', true),
      dirent('dist', true),
    ]);

    const result = await mockIpcMain._invoke('fs:readDir', '/project') as Array<{ name: string; type: string }>;

    const dirs = result.filter(e => e.type === 'directory').map(e => e.name);
    const files = result.filter(e => e.type === 'file').map(e => e.name);

    // Directories come first
    expect(result.indexOf(result.find(e => e.type === 'directory')!))
      .toBeLessThan(result.indexOf(result.find(e => e.type === 'file')!));

    // Directories sorted alphabetically
    expect(dirs).toEqual([...dirs].sort((a, b) => a.localeCompare(b)));

    // Files sorted alphabetically
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  });

  it('includes path and type for each entry', async () => {
    await setup();
    mockFsModule.default.readdirSync.mockReturnValue([
      dirent('index.ts', false),
    ]);

    const result = await mockIpcMain._invoke('fs:readDir', '/proj') as Array<Record<string, string>>;

    expect(result[0]).toMatchObject({
      name: 'index.ts',
      type: 'file',
      path: expect.stringContaining('index.ts'),
    });
  });

  it('returns empty array for empty directory', async () => {
    await setup();
    mockFsModule.default.readdirSync.mockReturnValue([]);

    const result = await mockIpcMain._invoke('fs:readDir', '/empty') as unknown[];
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// fs:readFile
// ===========================================================================

describe('fs:readFile', () => {
  it('returns file content as string', async () => {
    await setup();
    mockFsModule.default.readFileSync.mockReturnValue('hello world');

    const result = await mockIpcMain._invoke('fs:readFile', '/path/file.txt');

    expect(result).toBe('hello world');
    expect(mockFsModule.default.readFileSync).toHaveBeenCalledWith('/path/file.txt', 'utf-8');
  });
});

// ===========================================================================
// fs:writeFile
// ===========================================================================

describe('fs:writeFile', () => {
  it('writes content to the specified path', async () => {
    await setup();
    mockFsModule.default.writeFileSync.mockReturnValue(undefined);

    await mockIpcMain._invoke('fs:writeFile', '/path/output.txt', 'new content');

    expect(mockFsModule.default.writeFileSync).toHaveBeenCalledWith(
      '/path/output.txt', 'new content', 'utf-8',
    );
  });
});

// ===========================================================================
// fs:rename
// ===========================================================================

describe('fs:rename', () => {
  it('renames file from old path to new path', async () => {
    await setup();
    mockFsModule.default.renameSync.mockReturnValue(undefined);

    await mockIpcMain._invoke('fs:rename', '/old/path.ts', '/new/path.ts');

    expect(mockFsModule.default.renameSync).toHaveBeenCalledWith('/old/path.ts', '/new/path.ts');
  });
});

// ===========================================================================
// fs:delete
// ===========================================================================

describe('fs:delete', () => {
  it('deletes when user confirms (response 0)', async () => {
    await setup();
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });
    mockFsModule.default.rmSync.mockReturnValue(undefined);

    const result = await mockIpcMain._invoke('fs:delete', '/file/to/delete.ts');

    expect(mockFsModule.default.rmSync).toHaveBeenCalledWith(
      '/file/to/delete.ts',
      { recursive: true, force: true },
    );
    expect(result).toBe(true);
  });

  it('does not delete when user cancels (response 1)', async () => {
    await setup();
    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });

    const result = await mockIpcMain._invoke('fs:delete', '/file/to/keep.ts');

    expect(mockFsModule.default.rmSync).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('shows a warning dialog before deleting', async () => {
    await setup();
    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });

    await mockIpcMain._invoke('fs:delete', '/some/path/file.txt');

    expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'warning' }),
    );
  });
});

// ===========================================================================
// fs:createFile
// ===========================================================================

describe('fs:createFile', () => {
  it('creates parent directories and empty file', async () => {
    await setup();
    mockFsModule.default.mkdirSync.mockReturnValue(undefined);
    mockFsModule.default.writeFileSync.mockReturnValue(undefined);

    await mockIpcMain._invoke('fs:createFile', '/new/dir/file.ts');

    expect(mockFsModule.default.mkdirSync).toHaveBeenCalledWith(
      '/new/dir', { recursive: true },
    );
    expect(mockFsModule.default.writeFileSync).toHaveBeenCalledWith(
      '/new/dir/file.ts', '', 'utf-8',
    );
  });
});

// ===========================================================================
// fs:createDir
// ===========================================================================

describe('fs:createDir', () => {
  it('creates directory recursively', async () => {
    await setup();
    mockFsModule.default.mkdirSync.mockReturnValue(undefined);

    await mockIpcMain._invoke('fs:createDir', '/new/nested/dir');

    expect(mockFsModule.default.mkdirSync).toHaveBeenCalledWith(
      '/new/nested/dir', { recursive: true },
    );
  });
});

// ===========================================================================
// fs:checkIgnored
// ===========================================================================

describe('fs:checkIgnored', () => {
  it('returns ignored paths from git check-ignore output', async () => {
    await setup();
    mockSpawnSync.mockReturnValue({
      stdout: 'node_modules\0dist\0',
      stderr: '',
      status: 0,
    });

    const result = await mockIpcMain._invoke(
      'fs:checkIgnored', '/project', ['node_modules', 'dist', 'src'],
    );

    expect(result).toEqual(['node_modules', 'dist']);
  });

  it('calls git check-ignore with --stdin and -z flags', async () => {
    await setup();
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '' });

    await mockIpcMain._invoke('fs:checkIgnored', '/project', ['some/file.ts']);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'git',
      ['check-ignore', '--stdin', '-z'],
      expect.objectContaining({
        cwd: '/project',
        encoding: 'utf-8',
      }),
    );
  });

  it('passes paths as null-separated input to git', async () => {
    await setup();
    mockSpawnSync.mockReturnValue({ stdout: '', stderr: '' });

    await mockIpcMain._invoke('fs:checkIgnored', '/project', ['a', 'b', 'c']);

    const callArgs = mockSpawnSync.mock.calls[0][2] as { input: string };
    expect(callArgs.input).toBe('a\0b\0c\0');
  });

  it('returns empty array when paths list is empty', async () => {
    await setup();

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', []);

    expect(result).toEqual([]);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('returns empty array when git is not available (spawnSync throws)', async () => {
    await setup();
    mockSpawnSync.mockImplementation(() => { throw new Error('git not found'); });

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', ['file.ts']);

    expect(result).toEqual([]);
  });

  it('filters out empty strings from git output', async () => {
    await setup();
    mockSpawnSync.mockReturnValue({ stdout: 'ignored.ts\0\0', stderr: '' });

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', ['ignored.ts', 'other.ts']) as string[];

    expect(result).not.toContain('');
    expect(result).toContain('ignored.ts');
  });
});
