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

const { mockIpcMain, mockFsModule, mockDialog, mockExecFile } = vi.hoisted(() => {
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

  const mockExecFile = vi.fn();

  const mockFsModule = {
    default: {
      promises: {
        readdir: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        rename: vi.fn(),
        rm: vi.fn(),
        mkdir: vi.fn(),
        stat: vi.fn(),
      },
    },
  };

  return { mockIpcMain, mockFsModule, mockDialog, mockExecFile };
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
  execFile: mockExecFile,
}));

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  mockIpcMain._handlers.clear();
  mockIpcMain.handle.mockClear();

  const p = mockFsModule.default.promises;
  p.readdir.mockReset();
  p.readFile.mockReset();
  p.writeFile.mockReset();
  p.rename.mockReset();
  p.rm.mockReset();
  p.mkdir.mockReset();
  p.stat.mockReset();

  mockDialog.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
  mockExecFile.mockReset();
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

// Helper to mock execFile with a given stdout/stderr result
function mockExecFileResult(stdout: string, stderr = '', error: Error | null = null) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    const proc = { stdin: { write: vi.fn(), end: vi.fn() } };
    cb(error, stdout, stderr);
    return proc;
  });
}

// ===========================================================================
// fs:readDir
// ===========================================================================

describe('fs:readDir', () => {
  it('returns entries sorted — directories first, then alphabetical within each group', async () => {
    await setup();

    mockFsModule.default.promises.readdir.mockResolvedValue([
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
    mockFsModule.default.promises.readdir.mockResolvedValue([
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
    mockFsModule.default.promises.readdir.mockResolvedValue([]);

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
    mockFsModule.default.promises.readFile.mockResolvedValue('hello world');

    const result = await mockIpcMain._invoke('fs:readFile', '/path/file.txt');

    expect(result).toBe('hello world');
    expect(mockFsModule.default.promises.readFile).toHaveBeenCalledWith('/path/file.txt', 'utf-8');
  });
});

// ===========================================================================
// fs:writeFile
// ===========================================================================

describe('fs:writeFile', () => {
  it('writes content to the specified path', async () => {
    await setup();
    mockFsModule.default.promises.writeFile.mockResolvedValue(undefined);

    await mockIpcMain._invoke('fs:writeFile', '/path/output.txt', 'new content');

    expect(mockFsModule.default.promises.writeFile).toHaveBeenCalledWith(
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
    mockFsModule.default.promises.rename.mockResolvedValue(undefined);

    await mockIpcMain._invoke('fs:rename', '/old/path.ts', '/new/path.ts');

    expect(mockFsModule.default.promises.rename).toHaveBeenCalledWith('/old/path.ts', '/new/path.ts');
  });
});

// ===========================================================================
// fs:delete
// ===========================================================================

describe('fs:delete', () => {
  it('deletes when user confirms (response 0)', async () => {
    await setup();
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });
    mockFsModule.default.promises.rm.mockResolvedValue(undefined);

    const result = await mockIpcMain._invoke('fs:delete', '/file/to/delete.ts');

    expect(mockFsModule.default.promises.rm).toHaveBeenCalledWith(
      '/file/to/delete.ts',
      { recursive: true, force: true },
    );
    expect(result).toBe(true);
  });

  it('does not delete when user cancels (response 1)', async () => {
    await setup();
    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });

    const result = await mockIpcMain._invoke('fs:delete', '/file/to/keep.ts');

    expect(mockFsModule.default.promises.rm).not.toHaveBeenCalled();
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
    mockFsModule.default.promises.mkdir.mockResolvedValue(undefined);
    mockFsModule.default.promises.writeFile.mockResolvedValue(undefined);

    await mockIpcMain._invoke('fs:createFile', '/new/dir/file.ts');

    expect(mockFsModule.default.promises.mkdir).toHaveBeenCalledWith(
      '/new/dir', { recursive: true },
    );
    expect(mockFsModule.default.promises.writeFile).toHaveBeenCalledWith(
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
    mockFsModule.default.promises.mkdir.mockResolvedValue(undefined);

    await mockIpcMain._invoke('fs:createDir', '/new/nested/dir');

    expect(mockFsModule.default.promises.mkdir).toHaveBeenCalledWith(
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
    mockExecFileResult('node_modules\0dist\0');

    const result = await mockIpcMain._invoke(
      'fs:checkIgnored', '/project', ['node_modules', 'dist', 'src'],
    );

    expect(result).toEqual(['node_modules', 'dist']);
  });

  it('calls git check-ignore with --stdin and -z flags', async () => {
    await setup();
    mockExecFileResult('');

    await mockIpcMain._invoke('fs:checkIgnored', '/project', ['some/file.ts']);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['check-ignore', '--stdin', '-z'],
      expect.objectContaining({
        cwd: '/project',
        encoding: 'utf-8',
      }),
      expect.any(Function),
    );
  });

  it('passes paths as null-separated input via stdin', async () => {
    await setup();
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, '', '');
      return { stdin: { write: stdinWrite, end: stdinEnd } };
    });

    await mockIpcMain._invoke('fs:checkIgnored', '/project', ['a', 'b', 'c']);

    expect(stdinWrite).toHaveBeenCalledWith('a\0b\0c\0');
    expect(stdinEnd).toHaveBeenCalled();
  });

  it('returns empty array when paths list is empty', async () => {
    await setup();

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', []);

    expect(result).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns empty array when git is not available', async () => {
    await setup();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('git not found'), '', '');
      return { stdin: { write: vi.fn(), end: vi.fn() } };
    });

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', ['file.ts']);

    expect(result).toEqual([]);
  });

  it('filters out empty strings from git output', async () => {
    await setup();
    mockExecFileResult('ignored.ts\0\0');

    const result = await mockIpcMain._invoke('fs:checkIgnored', '/project', ['ignored.ts', 'other.ts']) as string[];

    expect(result).not.toContain('');
    expect(result).toContain('ignored.ts');
  });
});
