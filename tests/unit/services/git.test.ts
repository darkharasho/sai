// @vitest-environment node
/**
 * Unit tests for electron/services/git.ts
 *
 * Coverage:
 *   - git:status — branch, staged, modified, created, deleted, ahead, behind
 *   - git:stage / git:unstage / git:commit / git:push / git:pull / git:fetch
 *   - git:log — includes AI-provider detection
 *   - git:diff — staged vs unstaged
 *   - git:branches — list, current
 *   - git:checkout / git:createBranch
 *   - git:discard — tracked (checkout) vs untracked (unlink)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared objects for mock factories
// ---------------------------------------------------------------------------

const { mockIpcMain, mockSimpleGit, mockGitInstance, mockFsPromises } = vi.hoisted(() => {
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

  // A single git instance mock — all simpleGit(cwd) calls return this
  const mockGitInstance = {
    status: vi.fn(),
    add: vi.fn(),
    reset: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    fetch: vi.fn(),
    log: vi.fn(),
    branch: vi.fn(),
    checkout: vi.fn(),
    checkoutLocalBranch: vi.fn(),
    diff: vi.fn(),
    env: vi.fn(function (this: unknown) { return this; }),
  };

  const mockSimpleGit = vi.fn(() => mockGitInstance);

  // fs/promises mock for git:discard (unlink)
  const mockFsPromises = {
    unlink: vi.fn().mockResolvedValue(undefined),
  };

  return { mockIpcMain, mockSimpleGit, mockGitInstance, mockFsPromises };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}));

vi.mock('simple-git', () => ({
  default: mockSimpleGit,
}));

vi.mock('fs/promises', () => ({
  unlink: mockFsPromises.unlink,
}));

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  mockIpcMain._handlers.clear();
  mockIpcMain.handle.mockClear();
  // Reset all git instance methods
  for (const fn of Object.values(mockGitInstance)) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockFsPromises.unlink.mockReset().mockResolvedValue(undefined);
  mockSimpleGit.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadService() {
  const mod = await import('../../../electron/services/git');
  return mod;
}

async function setup() {
  const { registerGitHandlers } = await loadService();
  registerGitHandlers();
  return mockIpcMain;
}

// ---------------------------------------------------------------------------
// Default status fixture
// ---------------------------------------------------------------------------

function makeStatus(overrides: Partial<{
  current: string;
  staged: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  not_added: string[];
  ahead: number;
  behind: number;
}> = {}) {
  return {
    current: 'main',
    staged: [],
    modified: [],
    created: [],
    deleted: [],
    not_added: [],
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

// ===========================================================================
// git:status
// ===========================================================================

describe('git:status', () => {
  it('returns correct structure with branch, staged, modified, created, deleted, ahead, behind', async () => {
    await setup();
    mockGitInstance.status.mockResolvedValue(
      makeStatus({
        current: 'feature/abc',
        staged: ['file-a.ts'],
        modified: ['file-b.ts'],
        created: ['file-c.ts'],
        deleted: ['file-d.ts'],
        not_added: ['file-e.ts'],
        ahead: 2,
        behind: 1,
      }),
    );

    const result = await mockIpcMain._invoke('git:status', '/repo') as Record<string, unknown>;

    expect(result.branch).toBe('feature/abc');
    expect(result.staged).toEqual([{ path: 'file-a.ts', status: 'staged' }]);
    expect(result.modified).toEqual([{ path: 'file-b.ts', status: 'modified' }]);
    expect(result.created).toEqual([{ path: 'file-c.ts', status: 'added' }]);
    expect(result.deleted).toEqual([{ path: 'file-d.ts', status: 'deleted' }]);
    expect(result.not_added).toEqual([{ path: 'file-e.ts', status: 'added' }]);
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(1);
  });

  it('passes cwd to simpleGit', async () => {
    await setup();
    mockGitInstance.status.mockResolvedValue(makeStatus());

    await mockIpcMain._invoke('git:status', '/my/repo');

    expect(mockSimpleGit).toHaveBeenCalledWith({ baseDir: '/my/repo', binary: 'git' });
  });
});

// ===========================================================================
// git:stage
// ===========================================================================

describe('git:stage', () => {
  it('calls git.add with the filepath', async () => {
    await setup();
    mockGitInstance.add.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:stage', '/repo', 'src/index.ts');

    expect(mockGitInstance.add).toHaveBeenCalledWith('src/index.ts');
  });
});

// ===========================================================================
// git:unstage
// ===========================================================================

describe('git:unstage', () => {
  it('calls git.reset with HEAD and filepath', async () => {
    await setup();
    mockGitInstance.reset.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:unstage', '/repo', 'src/foo.ts');

    expect(mockGitInstance.reset).toHaveBeenCalledWith(['HEAD', '--', 'src/foo.ts']);
  });
});

// ===========================================================================
// git:commit
// ===========================================================================

describe('git:commit', () => {
  it('calls git.commit with the message', async () => {
    await setup();
    mockGitInstance.commit.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:commit', '/repo', 'fix: some bug');

    expect(mockGitInstance.commit).toHaveBeenCalledWith('fix: some bug');
  });
});

// ===========================================================================
// git:push
// ===========================================================================

describe('git:push', () => {
  it('calls git.push', async () => {
    await setup();
    mockGitInstance.push.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:push', '/repo');

    expect(mockGitInstance.push).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// git:pull
// ===========================================================================

describe('git:pull', () => {
  it('calls git.pull', async () => {
    await setup();
    mockGitInstance.pull.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:pull', '/repo');

    expect(mockGitInstance.pull).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// git:fetch
// ===========================================================================

describe('git:fetch', () => {
  it('calls git.fetch', async () => {
    await setup();
    mockGitInstance.fetch.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:fetch', '/repo');

    expect(mockGitInstance.fetch).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// git:log — AI-provider detection
// ===========================================================================

describe('git:log', () => {
  it('returns correct log entry structure', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [
        {
          hash: 'abc123',
          message: 'feat: add something',
          author_name: 'Alice',
          date: '2024-01-01',
        },
      ],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 10) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hash: 'abc123',
      message: 'feat: add something',
      author: 'Alice',
      date: '2024-01-01',
      files: [],
      aiProvider: undefined,
    });
  });

  it('marks entry as Claude when author_name contains "Claude"', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash: 'x', message: 'commit', author_name: 'Claude Opus', date: '2024-01-01' }],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 1) as Array<{ aiProvider?: string }>;
    expect(result[0].aiProvider).toBe('claude');
  });

  it('marks entry as Codex when author_name contains "Codex"', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash: 'x', message: 'commit', author_name: 'OpenAI Codex', date: '2024-01-01' }],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 1) as Array<{ aiProvider?: string }>;
    expect(result[0].aiProvider).toBe('codex');
  });

  it('marks entry as Claude when message contains "Co-Authored-By: Claude"', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [{
        hash: 'y',
        message: 'fix: something\n\nCo-Authored-By: Claude',
        author_name: 'Human Dev',
        date: '2024-01-01',
      }],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 1) as Array<{ aiProvider?: string }>;
    expect(result[0].aiProvider).toBe('claude');
  });

  it('marks entry as Gemini when message contains "Co-Authored-By: Gemini"', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [{
        hash: 'g',
        message: 'fix: something\n\nCo-Authored-By: Gemini',
        author_name: 'Human Dev',
        date: '2024-01-01',
      }],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 1) as Array<{ aiProvider?: string }>;
    expect(result[0].aiProvider).toBe('gemini');
  });

  it('does not mark regular commits as AI-authored', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({
      all: [{ hash: 'z', message: 'normal commit', author_name: 'Dev', date: '2024-01-01' }],
    });

    const result = await mockIpcMain._invoke('git:log', '/repo', 1) as Array<{ aiProvider?: string }>;
    expect(result[0].aiProvider).toBeUndefined();
  });

  it('passes maxCount to git.log', async () => {
    await setup();
    mockGitInstance.log.mockResolvedValue({ all: [] });

    await mockIpcMain._invoke('git:log', '/repo', 25);

    expect(mockGitInstance.log).toHaveBeenCalledWith({ maxCount: 25 });
  });
});

// ===========================================================================
// git:diff
// ===========================================================================

describe('git:diff', () => {
  it('uses --cached flag when staged=true', async () => {
    await setup();
    mockGitInstance.diff.mockResolvedValue('diff output staged');

    const result = await mockIpcMain._invoke('git:diff', '/repo', 'file.ts', true);

    expect(mockGitInstance.diff).toHaveBeenCalledWith(['--cached', '--', 'file.ts']);
    expect(result).toBe('diff output staged');
  });

  it('uses plain -- flag when staged=false', async () => {
    await setup();
    mockGitInstance.diff.mockResolvedValue('diff output unstaged');

    const result = await mockIpcMain._invoke('git:diff', '/repo', 'file.ts', false);

    expect(mockGitInstance.diff).toHaveBeenCalledWith(['--', 'file.ts']);
    expect(result).toBe('diff output unstaged');
  });
});

// ===========================================================================
// git:branches
// ===========================================================================

describe('git:branches', () => {
  it('returns current branch and list of all branches', async () => {
    await setup();
    mockGitInstance.branch.mockResolvedValue({
      current: 'main',
      branches: {
        main: {},
        'feature/x': {},
        'fix/y': {},
      },
    });

    const result = await mockIpcMain._invoke('git:branches', '/repo') as Record<string, unknown>;

    expect(result.current).toBe('main');
    expect(result.branches).toEqual(['main', 'feature/x', 'fix/y']);
  });

  it('calls git.branch with empty array', async () => {
    await setup();
    mockGitInstance.branch.mockResolvedValue({ current: 'main', branches: {} });

    await mockIpcMain._invoke('git:branches', '/repo');

    expect(mockGitInstance.branch).toHaveBeenCalledWith([]);
  });
});

// ===========================================================================
// git:checkout
// ===========================================================================

describe('git:checkout', () => {
  it('checks out the specified branch', async () => {
    await setup();
    mockGitInstance.checkout.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:checkout', '/repo', 'feature/new');

    expect(mockGitInstance.checkout).toHaveBeenCalledWith('feature/new');
  });
});

// ===========================================================================
// git:createBranch
// ===========================================================================

describe('git:createBranch', () => {
  it('creates and checks out a new local branch', async () => {
    await setup();
    mockGitInstance.checkoutLocalBranch.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:createBranch', '/repo', 'my-new-branch');

    expect(mockGitInstance.checkoutLocalBranch).toHaveBeenCalledWith('my-new-branch');
  });
});

// ===========================================================================
// git:discard
// ===========================================================================

describe('git:discard', () => {
  it('uses git checkout -- for tracked files', async () => {
    await setup();
    mockGitInstance.status.mockResolvedValue(makeStatus({ not_added: [] }));
    mockGitInstance.checkout.mockResolvedValue(undefined);

    await mockIpcMain._invoke('git:discard', '/repo', 'tracked.ts');

    expect(mockGitInstance.checkout).toHaveBeenCalledWith(['--', 'tracked.ts']);
    expect(mockFsPromises.unlink).not.toHaveBeenCalled();
  });

  it('unlinks untracked files', async () => {
    await setup();
    mockGitInstance.status.mockResolvedValue(makeStatus({ not_added: ['untracked.ts'] }));

    await mockIpcMain._invoke('git:discard', '/repo', 'untracked.ts');

    expect(mockFsPromises.unlink).toHaveBeenCalledWith(
      expect.stringContaining('untracked.ts'),
    );
    expect(mockGitInstance.checkout).not.toHaveBeenCalled();
  });
});
