/**
 * Regression test: handleSelectSession must call flushAndPersist (which writes
 * the outgoing session to the DB) before swapping activeSession to the target.
 *
 * Behaviour under test (App.tsx handleSelectSession):
 *
 *   const handleSelectSession = (id: string) => {
 *     flushAndPersist(activeProjectPath);   // ← must happen FIRST (saves outgoing session)
 *     ...
 *     dbGetMessagesTail(selected.id, ...).then(({ messages, totalCount }) => {
 *       updateWorkspace(...activeSession = { ...selected, messages, lastViewedAt }...);
 *     });
 *     // lastViewedAt is NOT saved immediately — it persists on next natural save.
 *   };
 *
 * flushAndPersist calls dbSaveSession only when the outgoing session has
 * messages.  We seed session A with a message so the assertion is non-trivial.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App, { reconcileOwnedStreamingScope } from '../../src/App';
import { installMockSai, createMockSai } from '../helpers/ipc-mock';
import type { ChatSession, ChatMessage } from '../../src/types';

const { chatPanelPropsLog, titleBarPropsLog } = vi.hoisted(() => ({
  chatPanelPropsLog: [] as any[],
  titleBarPropsLog: [] as any[],
}));

// ---------------------------------------------------------------------------
// Stub Monaco editor — imported directly in App.tsx
// ---------------------------------------------------------------------------
vi.mock('monaco-editor', () => ({
  default: {},
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  editor: { create: vi.fn(), setModelLanguage: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Stub heavy child components that bring in Monaco, xterm, etc.
// ---------------------------------------------------------------------------
vi.mock('../../src/components/Chat/ChatPanel', () => ({
  default: (props: any) => {
    chatPanelPropsLog.push(props);
    return <div data-testid="chat-panel" />;
  },
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
    isOpen: false,
    version: 'test',
    releases: [],
    fetchStatus: 'idle',
    openWhatsNew: vi.fn(),
    closeWhatsNew: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const PROJECT_PATH = '/test/project';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-' + Math.random(),
    role: 'user',
    content: 'hello from session A',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'sess-' + Math.random(),
    title: 'Session',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    aiProvider: 'claude',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// chatDb mock — tracks which session ids were passed to dbSaveSession in order
// ---------------------------------------------------------------------------
const saveOrder: string[] = [];
const savedSessions: ChatSession[] = [];

// messagesBySessionId is populated in beforeEach so dbGetMessagesTail can
// return the correct messages for each session.
const messagesBySessionId: Map<string, ChatMessage[]> = new Map();

vi.mock('../../src/chatDb', () => ({
  dbGetSessions: vi.fn(),
  dbGetAllSessions: vi.fn().mockResolvedValue([]),
  dbGetMessages: vi.fn().mockResolvedValue([]),
  dbGetMessagesTail: vi.fn((sessionId: string) => {
    const msgs = messagesBySessionId.get(sessionId) ?? [];
    return Promise.resolve({ messages: msgs, totalCount: msgs.length });
  }),
  dbSaveSession: vi.fn((_path: string, session: ChatSession) => {
    saveOrder.push(session.id);
    savedSessions.push(session);
    return Promise.resolve();
  }),
  dbPatchSessionMeta: vi.fn().mockResolvedValue(undefined),
  dbPurgeExpired: vi.fn().mockResolvedValue(undefined),
  dbDeleteSession: vi.fn().mockResolvedValue(undefined),
  migrateFromLocalStorage: vi.fn().mockResolvedValue(undefined),
}));

// Also stub out swarmDb so it doesn't try to open its own IndexedDB
vi.mock('../../src/swarmDb', () => ({
  swarmInit: vi.fn().mockResolvedValue(undefined),
  swarmGetTasks: vi.fn().mockResolvedValue([]),
  swarmUpdateTask: vi.fn().mockResolvedValue(undefined),
  swarmGetApprovals: vi.fn().mockResolvedValue([]),
  swarmResolveApproval: vi.fn().mockResolvedValue(undefined),
  swarmCreateApproval: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('App: persistence on session swap', () => {
  let sessionA: ChatSession;
  let sessionB: ChatSession;
  let mockSai: ReturnType<typeof createMockSai> & Record<string, any>;

  beforeEach(async () => {
    saveOrder.length = 0;
    savedSessions.length = 0;
    messagesBySessionId.clear();
    chatPanelPropsLog.length = 0;
    titleBarPropsLog.length = 0;
    global.fetch = vi.fn();

    const msgA = makeMsg();
    sessionA = makeSession({
      id: 'session-A',
      title: 'Chat A',
      // Give A a message so flushAndPersist will write it to the DB
      messages: [msgA],
      messageCount: 1,
      updatedAt: 1000,
    });
    sessionB = makeSession({
      id: 'session-B',
      title: 'Chat B',
      messages: [],
      messageCount: 0,
      updatedAt: 2000,
    });

    // Seed dbGetMessagesTail so clicking A populates activeSession.messages
    messagesBySessionId.set('session-A', [msgA]);

    // Import chatDb mock to configure return value per test
    const { dbGetSessions } = await import('../../src/chatDb');
    vi.mocked(dbGetSessions).mockResolvedValue([sessionA, sessionB]);

    // Install window.sai with getCwd pointing at our project
    mockSai = createMockSai() as ReturnType<typeof createMockSai> & Record<string, any>;
    mockSai.getCwd = vi.fn().mockResolvedValue(PROJECT_PATH);
    // settingsGet must resolve to avoid unhandled-promise errors
    mockSai.settingsGet = vi.fn().mockImplementation((_key: string, def: unknown) =>
      Promise.resolve(def ?? null)
    );
    mockSai.claudeOnMessage = vi.fn(() => () => {});
    // Methods present in the app but not yet in the MockSai interface
    mockSai.setBadgeCount = vi.fn();
    mockSai.metaWorkspaceList = vi.fn().mockResolvedValue([]);
    mockSai.fsWalkFiles = vi.fn().mockResolvedValue([]);
    mockSai.swarmSetOrchestratorSession = vi.fn();
    mockSai.remoteEmitWorkspaceStatus = vi.fn();
    installMockSai(mockSai as ReturnType<typeof createMockSai>);
  });

  it('does not activate Codex model discovery on default-Claude startup and fetches after selecting Codex', async () => {
    render(<App />);
    await waitFor(() => expect(titleBarPropsLog.at(-1)?.onSettingChange).toBeTypeOf('function'));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSai.codexModels).not.toHaveBeenCalled();
    await act(async () => { titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'codex'); });
    await waitFor(() => expect(mockSai.codexModels).toHaveBeenCalledWith(false));
  });

  it('loads Codex effort independently and never substitutes Claude max', async () => {
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'claude' ? { effort: 'max' } : key === 'codex' ? { effort: 'minimal' } : def ?? null,
    ));
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('minimal'));
    expect(chatPanelPropsLog.at(-1)?.effortLevel).toBe('max');
    await act(async () => { chatPanelPropsLog.at(-1).onCodexEffortChange('xhigh'); });
    await waitFor(() => expect(mockSai.settingsSet).toHaveBeenCalledWith('codex', expect.objectContaining({ effort: 'xhigh' })));
  });

  it('merges rapid nested Codex changes without losing sibling fields', async () => {
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'codex' ? { model: 'gpt-5', permission: 'auto', effort: 'high' } : def ?? null,
    ));
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('gpt-5'));
    mockSai.settingsSet.mockClear();

    act(() => {
      chatPanelPropsLog.at(-1).onCodexModelChange('gpt-5.2');
      chatPanelPropsLog.at(-1).onCodexPermissionChange('full-access');
      chatPanelPropsLog.at(-1).onCodexEffortChange('ultra');
    });

    expect(mockSai.settingsSet).toHaveBeenLastCalledWith('codex', {
      model: 'gpt-5.2', permission: 'full-access', effort: 'ultra',
    });
  });

  it('persists an owner-requested Codex effort deletion through the shadow', async () => {
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'codex' ? { model: 'none', permission: 'auto', effort: 'high' } : def ?? null,
    ));
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('high'));
    act(() => { titleBarPropsLog.at(-1).onSettingChange('codexEffort', undefined); });
    expect(mockSai.settingsSet).toHaveBeenLastCalledWith('codex', { model: 'none', permission: 'auto' });
  });

  it('normalizes persisted Codex effort when selected model metadata arrives', async () => {
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'aiProvider' ? 'codex'
        : key === 'codex' ? { model: 'no-min', permission: 'auto', effort: 'minimal' }
          : def ?? null,
    ));
    mockSai.codexModels.mockResolvedValue({
      models: [{ id: 'no-min', name: 'No Minimal', supportedReasoningEfforts: ['low', 'high', 'xhigh'], defaultReasoningEffort: 'high' }],
      defaultModel: 'no-min',
    });
    render(<App />);

    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('high'));
    expect(mockSai.settingsSet).toHaveBeenCalledWith('codex', {
      model: 'no-min', permission: 'auto', effort: 'high',
    });
  });

  it('keeps catalog normalization when the initial Codex settings read resolves late', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => key === 'aiProvider'
      ? Promise.resolve('codex') : key === 'codex' ? delayedCodex : Promise.resolve(def ?? null));
    mockSai.codexModels.mockResolvedValue({
      models: [{ id: 'current', name: 'Current', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high' }],
      defaultModel: 'current',
    });
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('current'));
    await act(async () => { resolveCodex({ model: 'stale', permission: 'read-only', effort: 'minimal' }); await delayedCodex; });
    expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('current');
    expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('high');
    expect(chatPanelPropsLog.at(-1)?.codexPermission).toBe('read-only');
  });

  it('restores a catalog-valid persisted custom model and effort from a late initial read', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => key === 'aiProvider'
      ? Promise.resolve('codex') : key === 'codex' ? delayedCodex : Promise.resolve(def ?? null));
    mockSai.codexModels.mockResolvedValue({
      models: [
        { id: 'default', name: 'Default', supportedReasoningEfforts: ['high'] },
        { id: 'custom', name: 'Custom', supportedReasoningEfforts: ['low', 'xhigh'] },
      ],
      defaultModel: 'default',
    });
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('default'));
    await act(async () => { resolveCodex({ model: 'custom', permission: 'read-only', effort: 'xhigh' }); await delayedCodex; });
    expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('custom');
    expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('xhigh');
    expect(chatPanelPropsLog.at(-1)?.codexPermission).toBe('read-only');
  });

  it('merges nested Codex snapshot, legacy model, and rapid permission through one shadow writer', async () => {
    let resolveNested!: (value: unknown) => void;
    const delayedNested = new Promise(resolve => { resolveNested = resolve; });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => {
      if (key === 'codex') return delayedNested;
      if (key === 'codexModel') return Promise.resolve('legacy-model');
      return Promise.resolve(def ?? null);
    });
    render(<App />);
    await waitFor(() => expect(mockSai.settingsGet).toHaveBeenCalledWith('codexModel', null));
    act(() => { chatPanelPropsLog.at(-1).onCodexPermissionChange('full-access'); });
    await act(async () => { resolveNested({ permission: 'auto', effort: 'xhigh' }); await delayedNested; });
    await waitFor(() => expect(mockSai.settingsSet).toHaveBeenLastCalledWith('codex', {
      model: 'legacy-model', permission: 'full-access', effort: 'xhigh',
    }));
  });

  it('rejects an unavailable remote Codex model after catalog load and force-refreshes', async () => {
    let applyRemote!: (settings: Record<string, unknown>) => void;
    mockSai.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemote = callback;
      return vi.fn();
    });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'aiProvider' ? 'codex'
        : key === 'codex' ? { model: 'valid', permission: 'auto', effort: 'high' }
          : def ?? null,
    ));
    mockSai.codexModels.mockResolvedValue({ models: [{ id: 'valid', name: 'Valid' }], defaultModel: 'valid' });
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('valid'));
    act(() => applyRemote({ codex: { model: 'unavailable' } }));
    expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('valid');
    await waitFor(() => expect(mockSai.codexModels).toHaveBeenCalledWith(true));
    await act(async () => { titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'claude'); });
    mockSai.codexModels.mockClear();
    await act(async () => { titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'codex'); });
    await waitFor(() => expect(mockSai.codexModels).toHaveBeenCalledWith(false));
  });

  it('defers an unknown remote model while Claude is active and adopts it after Codex activation validates it', async () => {
    let applyRemote!: (settings: Record<string, unknown>) => void;
    mockSai.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemote = callback;
      return vi.fn();
    });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => Promise.resolve(
      key === 'codex' ? { model: 'current', permission: 'auto', effort: 'high' } : def ?? null,
    ));
    mockSai.codexModels.mockResolvedValue({
      models: [{ id: 'current', name: 'Current' }, { id: 'pending', name: 'Pending' }],
      defaultModel: 'current',
    });
    render(<App />);
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('current'));
    expect(mockSai.codexModels).not.toHaveBeenCalled();
    act(() => applyRemote({ codex: { model: 'pending' } }));
    expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('current');
    expect(mockSai.codexModels).not.toHaveBeenCalled();
    await act(async () => { titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'codex'); });
    await waitFor(() => expect(mockSai.codexModels).toHaveBeenCalledWith(true));
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('pending'));
    expect(mockSai.settingsSet).toHaveBeenCalledWith('codex', expect.objectContaining({ model: 'pending' }));
  });

  it('merges a delayed persisted effort after adopting a pending remote model', async () => {
    let resolveCodex!: (value: unknown) => void;
    const delayedCodex = new Promise(resolve => { resolveCodex = resolve; });
    let applyRemote!: (settings: Record<string, unknown>) => void;
    mockSai.githubOnSettingsApplied = vi.fn((callback: (settings: Record<string, unknown>) => void) => {
      applyRemote = callback;
      return vi.fn();
    });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) => key === 'codex'
      ? delayedCodex : Promise.resolve(key === 'aiProvider' ? 'claude' : def ?? null));
    mockSai.codexModels.mockResolvedValue({
      models: [
        { id: 'current', name: 'Current', supportedReasoningEfforts: ['high'] },
        { id: 'pending', name: 'Pending', supportedReasoningEfforts: ['high', 'xhigh'] },
      ],
      defaultModel: 'current',
    });
    render(<App />);
    await waitFor(() => expect(mockSai.githubOnSettingsApplied).toHaveBeenCalled());
    act(() => applyRemote({ codex: { model: 'pending' } }));
    await act(async () => { titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'codex'); });
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('pending'));

    await act(async () => { resolveCodex({ permission: 'auto', effort: 'xhigh' }); await delayedCodex; });

    expect(chatPanelPropsLog.at(-1)?.codexModel).toBe('pending');
    expect(chatPanelPropsLog.at(-1)?.codexEffort).toBe('xhigh');
  });

  it('persists the outgoing session before activating the new one', async () => {
    render(<App />);

    // Wait for the chat history sidebar toggle button to appear
    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));

    // Open the chat history sidebar
    await act(async () => {
      fireEvent.click(chatsBtn);
    });

    // Wait for both sessions to be listed
    await waitFor(() => {
      expect(screen.getByText('Chat A')).toBeInTheDocument();
      expect(screen.getByText('Chat B')).toBeInTheDocument();
    });

    // Click session A first to make it the activeSession (it carries messages)
    await act(async () => {
      fireEvent.click(screen.getByText('Chat A'));
    });

    // Clear the save log; we only care about what happens during the A→B swap
    saveOrder.length = 0;

    // Click session B — this should flush A (because A has messages) then swap
    await act(async () => {
      fireEvent.click(screen.getByText('Chat B'));
    });

    // Give the async dbSaveSession promises a tick to record
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    // Session A must appear in saveOrder: flushAndPersist saved the outgoing session.
    expect(saveOrder).toContain('session-A');

    // Session B is NOT saved via dbSaveSession on swap — its messages tail
    // lives only in the DB and dbSaveSession would clobber it. lastViewedAt
    // is patched via dbPatchSessionMeta instead (asserted below).
    expect(saveOrder).not.toContain('session-B');
  });

  it('patches lastViewedAt on the incoming session via dbPatchSessionMeta', async () => {
    const { dbPatchSessionMeta } = await import('../../src/chatDb');
    render(<App />);

    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });

    await waitFor(() => {
      expect(screen.getByText('Chat A')).toBeInTheDocument();
      expect(screen.getByText('Chat B')).toBeInTheDocument();
    });

    // Click into B
    await act(async () => { fireEvent.click(screen.getByText('Chat B')); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // dbPatchSessionMeta must have been called with B's id + a lastViewedAt
    // timestamp. Anything else (e.g. lastTurnErrored) is allowed; we only
    // require lastViewedAt because that's what gates the unread indicator.
    const calls = vi.mocked(dbPatchSessionMeta).mock.calls;
    const swapCall = calls.find(([, sessionId]) => sessionId === 'session-B');
    expect(swapCall).toBeDefined();
    const [, , patch] = swapCall!;
    expect(typeof patch.lastViewedAt).toBe('number');
    expect(patch.lastViewedAt).toBeGreaterThan(0);
  });

  it('binds a persisted Codex session id to the selected owning scope', async () => {
    sessionB.codexSessionId = 'codex-thread-B';
    render(<App />);

    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });
    await waitFor(() => expect(screen.getByText('Chat B')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('Chat B')); });

    expect(mockSai.codexSetSessionId).toHaveBeenCalledWith(
      PROJECT_PATH,
      'codex-thread-B',
      'session-B',
    );
  });

  it('clears a Codex binding on the outgoing session scope when starting a new chat', async () => {
    render(<App />);

    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });
    await waitFor(() => expect(screen.getByText('Chat A')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('Chat A')); });
    mockSai.codexSetSessionId.mockClear();

    await act(async () => { fireEvent.click(screen.getByText('New Chat')); });

    expect(mockSai.codexSetSessionId).toHaveBeenCalledWith(
      PROJECT_PATH,
      undefined,
      'session-A',
    );
  });

  it('reconciles each non-chat streaming scope only through its owning provider', async () => {
    sessionA.aiProvider = 'claude';
    sessionB.aiProvider = 'codex';
    const workspace = {
      sessions: [sessionA, sessionB],
      activeSession: sessionA,
    };
    vi.useFakeTimers();
    try {
      const id = setInterval(() => {
        reconcileOwnedStreamingScope(
          PROJECT_PATH,
          'session-A',
          new Map([[PROJECT_PATH, workspace]]),
          new Map(),
          mockSai,
        );
        reconcileOwnedStreamingScope(
          PROJECT_PATH,
          'session-B',
          new Map([[PROJECT_PATH, workspace]]),
          new Map(),
          mockSai,
        );
      }, 20_000);
      vi.advanceTimersByTime(20_000);
      clearInterval(id);

      expect(mockSai.claudeReconcileScope).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeReconcileScope).toHaveBeenCalledWith(PROJECT_PATH, 'session-A');
      expect(mockSai.codexReconcileScope).toHaveBeenCalledTimes(1);
      expect(mockSai.codexReconcileScope).toHaveBeenCalledWith(PROJECT_PATH, 'session-B');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles an untagged fresh active session through the selected Codex provider', () => {
    delete sessionA.aiProvider;
    reconcileOwnedStreamingScope(
      PROJECT_PATH,
      'session-A',
      new Map([[PROJECT_PATH, { sessions: [sessionA], activeSession: sessionA }]]),
      new Map(),
      mockSai,
      'codex',
    );

    expect(mockSai.codexReconcileScope).toHaveBeenCalledWith(PROJECT_PATH, 'session-A');
    expect(mockSai.claudeReconcileScope).not.toHaveBeenCalled();
  });

  it('keeps an untagged persisted session on the legacy Claude default', () => {
    delete sessionA.aiProvider;
    reconcileOwnedStreamingScope(
      PROJECT_PATH,
      'session-A',
      new Map([[PROJECT_PATH, { sessions: [sessionA], activeSession: sessionA }]]),
      new Map(),
      mockSai,
    );

    expect(mockSai.claudeReconcileScope).toHaveBeenCalledWith(PROJECT_PATH, 'session-A');
    expect(mockSai.codexReconcileScope).not.toHaveBeenCalled();
  });

  it('marks only the active scoped Codex session as streaming', async () => {
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) =>
      Promise.resolve(key === 'aiProvider' ? 'codex' : (def ?? null))
    );
    sessionA.aiProvider = 'codex';
    sessionB.aiProvider = 'codex';
    render(<App />);

    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });
    await waitFor(() => expect(screen.getByText('Chat A')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('Chat A')); });
    await waitFor(() => {
      const props = chatPanelPropsLog.at(-1);
      expect(props?.aiProvider).toBe('codex');
      expect(props?.claudeScope).toBe('session-A');
    });

    const onMessage = mockSai.claudeOnMessage.mock.calls.at(-1)?.[0] as (msg: any) => void;
    await act(async () => {
      onMessage({ type: 'streaming_start', projectPath: PROJECT_PATH, scope: 'session-B', turnSeq: 1 });
    });
    expect(chatPanelPropsLog.at(-1)?.isStreaming).toBe(false);

    await act(async () => {
      onMessage({ type: 'streaming_start', projectPath: PROJECT_PATH, scope: 'chat', turnSeq: 1 });
    });
    expect(chatPanelPropsLog.at(-1)?.isStreaming).toBe(false);

    await act(async () => {
      onMessage({ type: 'streaming_start', projectPath: PROJECT_PATH, scope: 'session-A', turnSeq: 1 });
    });
    expect(chatPanelPropsLog.at(-1)?.isStreaming).toBe(true);
  });

  it('persists a background scoped Codex session id and rebinds it on selection', async () => {
    const { dbPatchSessionMeta } = await import('../../src/chatDb');
    vi.mocked(dbPatchSessionMeta).mockImplementation(async (_path, sessionId, patch) => {
      const target = sessionId === sessionA.id ? sessionA : sessionId === sessionB.id ? sessionB : undefined;
      if (target) Object.assign(target, patch);
    });
    mockSai.settingsGet.mockImplementation((key: string, def: unknown) =>
      Promise.resolve(key === 'aiProvider' ? 'codex' : (def ?? null))
    );
    sessionA.aiProvider = 'codex';
    sessionB.aiProvider = 'codex';
    render(<App />);

    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });
    await waitFor(() => expect(screen.getByText('Chat B')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('Chat B')); });
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.claudeScope).toBe('session-B'));

    const onMessage = mockSai.claudeOnMessage.mock.calls.at(-1)?.[0] as (msg: any) => void;
    await act(async () => {
      onMessage({ type: 'session_id', projectPath: PROJECT_PATH, scope: 'session-A', sessionId: 'codex-thread-A' });
      onMessage({
        type: 'assistant', projectPath: PROJECT_PATH, scope: 'session-A',
        message: { content: [{ type: 'text', text: 'background reply' }] },
      });
      onMessage({ type: 'done', projectPath: PROJECT_PATH, scope: 'session-A' });
    });

    await waitFor(() => expect(dbPatchSessionMeta).toHaveBeenCalledWith(
      PROJECT_PATH,
      'session-A',
      expect.objectContaining({ codexSessionId: 'codex-thread-A' }),
    ));
    await waitFor(() => expect(savedSessions.some(
      session => session.id === 'session-A' && session.codexSessionId === 'codex-thread-A'
    )).toBe(true));

    mockSai.codexSetSessionId.mockClear();
    await act(async () => { fireEvent.click(screen.getByText('Chat A')); });
    expect(mockSai.codexSetSessionId).toHaveBeenCalledWith(
      PROJECT_PATH,
      'codex-thread-A',
      'session-A',
    );
  });

  it('does not treat a scoped Claude session id as a Codex thread id', async () => {
    sessionA.aiProvider = 'claude';
    render(<App />);
    const chatsBtn = await waitFor(() => screen.getByTitle('Chats'));
    await act(async () => { fireEvent.click(chatsBtn); });
    await waitFor(() => expect(screen.getByText('Chat A')).toBeInTheDocument());

    const { dbPatchSessionMeta } = await import('../../src/chatDb');
    vi.mocked(dbPatchSessionMeta).mockClear();
    const onMessage = mockSai.claudeOnMessage.mock.calls.at(-1)?.[0] as (msg: any) => void;
    await act(async () => {
      onMessage({ type: 'session_id', projectPath: PROJECT_PATH, scope: 'session-A', sessionId: 'claude-session-A' });
    });

    expect(vi.mocked(dbPatchSessionMeta).mock.calls.some(
      ([, , patch]) => patch.codexSessionId === 'claude-session-A'
    )).toBe(false);
  });

  it('tags a fresh session with the newly selected Codex provider before thread.started', async () => {
    render(<App />);
    await waitFor(() => expect(titleBarPropsLog.at(-1)?.onSettingChange).toBeTypeOf('function'));

    await act(async () => {
      titleBarPropsLog.at(-1).onSettingChange('aiProvider', 'codex');
    });
    await waitFor(() => expect(chatPanelPropsLog.at(-1)?.aiProvider).toBe('codex'));
    const freshScope = chatPanelPropsLog.at(-1).claudeScope as string;

    const { dbPatchSessionMeta } = await import('../../src/chatDb');
    vi.mocked(dbPatchSessionMeta).mockClear();
    const onMessage = mockSai.claudeOnMessage.mock.calls.at(-1)?.[0] as (msg: any) => void;
    await act(async () => {
      onMessage({
        type: 'session_id', projectPath: PROJECT_PATH, scope: freshScope,
        sessionId: 'fresh-codex-thread',
      });
    });
    await act(async () => {
      chatPanelPropsLog.at(-1).onMessagesChange([makeMsg({ content: 'first codex message' })]);
    });

    await waitFor(() => expect(dbPatchSessionMeta).toHaveBeenCalledWith(
      PROJECT_PATH,
      freshScope,
      expect.objectContaining({ aiProvider: 'codex', codexSessionId: 'fresh-codex-thread' }),
    ));
    await waitFor(() => expect(savedSessions.some(session =>
      session.id === freshScope
      && session.aiProvider === 'codex'
      && session.codexSessionId === 'fresh-codex-thread'
    )).toBe(true));
    expect(mockSai.claudeReconcileScope).not.toHaveBeenCalledWith(PROJECT_PATH, freshScope);
  });
});
