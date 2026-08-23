/**
 * Regression test: a workspace must never flash "has finished" while it is
 * thinking on a freshly sent message.
 *
 * Sending again mid-stream (or Stop-then-send) makes the backend emit a
 * synthetic `done` for the superseded turn, immediately followed by the new
 * turn's `streaming_start`. The done releases the workspace's last busy slot,
 * which schedules the completion badge/toast 300ms later — by which time the
 * new turn is already streaming. A streaming_start must cancel that pending
 * completion.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import App from '../../src/App';
import { installMockSai, createMockSai } from '../helpers/ipc-mock';

const { titleBarPropsLog } = vi.hoisted(() => ({ titleBarPropsLog: [] as any[] }));

vi.mock('monaco-editor', () => ({
  default: {},
  Range: class Range {},
  editor: { create: vi.fn(), setModelLanguage: vi.fn() },
}));
vi.mock('../../src/components/Chat/ChatPanel', () => ({
  default: () => <div data-testid="chat-panel" />,
}));
vi.mock('../../src/components/TitleBar', () => ({
  default: (props: any) => {
    titleBarPropsLog.push(props);
    return <div data-testid="title-bar" />;
  },
}));
vi.mock('../../src/components/Terminal/TerminalPanel', () => ({
  default: () => <div data-testid="terminal-panel" />,
}));
vi.mock('../../src/components/CodePanel/CodePanel', () => ({
  default: () => <div data-testid="code-panel" />,
}));
vi.mock('../../src/components/Git/GitSidebar', () => ({
  default: () => <div data-testid="git-sidebar" />,
}));
vi.mock('../../src/components/Git/MetaGitSidebar', () => ({
  MetaGitSidebar: () => <div data-testid="meta-git-sidebar" />,
}));
vi.mock('../../src/components/FileExplorer/FileExplorerSidebar', () => ({
  default: () => <div data-testid="file-explorer" />,
}));
vi.mock('../../src/components/SearchPanel/SearchPanel', () => ({
  default: () => <div data-testid="search-panel" />,
}));
vi.mock('../../src/components/Plugins/PluginsSidebar', () => ({
  default: () => <div data-testid="plugins-sidebar" />,
}));
vi.mock('../../src/components/MCP/McpSidebar', () => ({
  default: () => <div data-testid="mcp-sidebar" />,
}));
vi.mock('../../src/components/Swarm/SwarmSidebar', () => ({
  default: () => <div data-testid="swarm-sidebar" />,
}));
vi.mock('../../src/components/Swarm/OrchestratorView', () => ({
  default: () => <div data-testid="orchestrator-view" />,
}));
vi.mock('../../src/components/Swarm/SwarmLogoCluster', () => ({
  default: () => <div data-testid="swarm-logo" />,
}));
vi.mock('../../src/hooks/useWhatsNew', () => ({
  useWhatsNew: () => ({
    isOpen: false, version: 'test', releases: [], fetchStatus: 'idle',
    openWhatsNew: vi.fn(), closeWhatsNew: vi.fn(),
  }),
}));

vi.mock('../../src/chatDb', () => ({
  dbGetSessions: vi.fn().mockResolvedValue([]),
  dbGetAllSessions: vi.fn().mockResolvedValue([]),
  dbGetMessages: vi.fn().mockResolvedValue([]),
  dbGetMessagesTail: vi.fn().mockResolvedValue({ messages: [], totalCount: 0 }),
  dbSaveSession: vi.fn().mockResolvedValue(undefined),
  dbPatchSessionMeta: vi.fn().mockResolvedValue(undefined),
  dbPurgeExpired: vi.fn().mockResolvedValue(undefined),
  dbDeleteSession: vi.fn().mockResolvedValue(undefined),
  migrateFromLocalStorage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/swarmDb', () => ({
  swarmInit: vi.fn().mockResolvedValue(undefined),
  swarmGetTasks: vi.fn().mockResolvedValue([]),
  swarmUpdateTask: vi.fn().mockResolvedValue(undefined),
  swarmGetApprovals: vi.fn().mockResolvedValue([]),
  swarmResolveApproval: vi.fn().mockResolvedValue(undefined),
  swarmCreateApproval: vi.fn().mockResolvedValue(undefined),
}));

const ACTIVE_PATH = '/test/project';
const BG_PATH = '/test/background';

describe('App: superseded turn never flashes a completion', () => {
  let emit: (msg: any) => void;

  beforeEach(async () => {
    titleBarPropsLog.length = 0;
    global.fetch = vi.fn();
    const mockSai = createMockSai() as ReturnType<typeof createMockSai> & Record<string, any>;
    mockSai.getCwd = vi.fn().mockResolvedValue(ACTIVE_PATH);
    mockSai.settingsGet = vi.fn().mockImplementation((_k: string, def: unknown) => Promise.resolve(def ?? null));
    mockSai.claudeOnMessage = vi.fn((cb: (msg: any) => void) => { emit = cb; return () => {}; });
    mockSai.setBadgeCount = vi.fn();
    mockSai.metaWorkspaceList = vi.fn().mockResolvedValue([]);
    mockSai.fsWalkFiles = vi.fn().mockResolvedValue([]);
    mockSai.swarmSetOrchestratorSession = vi.fn();
    mockSai.remoteEmitWorkspaceStatus = vi.fn();
    installMockSai(mockSai as ReturnType<typeof createMockSai>);

    render(<App />);
    await waitFor(() => expect(titleBarPropsLog.at(-1)?.onSettingChange).toBeTypeOf('function'));
    await waitFor(() => expect(emit).toBeTypeOf('function'));
  });

  const settle = async (ms: number) => {
    await act(async () => { await new Promise(r => setTimeout(r, ms)); });
  };

  it('cancels the deferred completion when the next turn starts', async () => {
    await act(async () => {
      emit({ type: 'streaming_start', projectPath: BG_PATH, scope: 'chat', turnSeq: 1 });
    });
    await waitFor(() => expect(titleBarPropsLog.at(-1).busyWorkspaces?.has(BG_PATH)).toBe(true));
    // Superseded turn end followed immediately by the new turn (send mid-stream).
    await act(async () => {
      emit({ type: 'done', projectPath: BG_PATH, scope: 'chat', turnSeq: 1 });
      emit({ type: 'streaming_start', projectPath: BG_PATH, scope: 'chat', turnSeq: 2 });
    });
    await settle(500);
    expect(titleBarPropsLog.at(-1).completedWorkspaces?.has(BG_PATH)).toBe(false);
    expect(titleBarPropsLog.at(-1).busyWorkspaces?.has(BG_PATH)).toBe(true);
  });

  it('still marks a genuinely finished background workspace as completed', async () => {
    await act(async () => {
      emit({ type: 'streaming_start', projectPath: BG_PATH, scope: 'chat', turnSeq: 1 });
    });
    await waitFor(() => expect(titleBarPropsLog.at(-1).busyWorkspaces?.has(BG_PATH)).toBe(true));
    await act(async () => {
      emit({ type: 'done', projectPath: BG_PATH, scope: 'chat', turnSeq: 1 });
    });
    await settle(500);
    expect(titleBarPropsLog.at(-1).completedWorkspaces?.has(BG_PATH)).toBe(true);
  });
});
