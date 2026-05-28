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
import App from '../../src/App';
import { installMockSai, createMockSai } from '../helpers/ipc-mock';
import type { ChatSession, ChatMessage } from '../../src/types';

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
  default: () => <div data-testid="chat-panel" />,
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

// messagesBySessionId is populated in beforeEach so dbGetMessagesTail can
// return the correct messages for each session.
const messagesBySessionId: Map<string, ChatMessage[]> = new Map();

vi.mock('../../src/chatDb', () => ({
  dbGetSessions: vi.fn(),
  dbGetMessages: vi.fn().mockResolvedValue([]),
  dbGetMessagesTail: vi.fn((sessionId: string) => {
    const msgs = messagesBySessionId.get(sessionId) ?? [];
    return Promise.resolve({ messages: msgs, totalCount: msgs.length });
  }),
  dbSaveSession: vi.fn((_path: string, session: ChatSession) => {
    saveOrder.push(session.id);
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

  beforeEach(async () => {
    saveOrder.length = 0;
    messagesBySessionId.clear();

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
    const mock = createMockSai() as ReturnType<typeof createMockSai> & Record<string, unknown>;
    mock.getCwd = vi.fn().mockResolvedValue(PROJECT_PATH);
    // settingsGet must resolve to avoid unhandled-promise errors
    mock.settingsGet = vi.fn().mockImplementation((_key: string, def: unknown) =>
      Promise.resolve(def ?? null)
    );
    // Methods present in the app but not yet in the MockSai interface
    mock.setBadgeCount = vi.fn();
    mock.metaWorkspaceList = vi.fn().mockResolvedValue([]);
    mock.fsWalkFiles = vi.fn().mockResolvedValue([]);
    mock.swarmSetOrchestratorSession = vi.fn();
    installMockSai(mock as ReturnType<typeof createMockSai>);
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
});
