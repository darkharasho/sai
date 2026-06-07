import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import ChatHistorySidebar from '../../../../src/components/Chat/ChatHistorySidebar';
import type { ChatSession } from '../../../../src/types';

vi.mock('../../../../src/chatDb', () => ({
  dbGetMessages: vi.fn().mockResolvedValue([]),
  dbDeleteSession: vi.fn().mockResolvedValue(undefined),
  dbSaveSession: vi.fn().mockResolvedValue(undefined),
  dbGetSessions: vi.fn().mockResolvedValue([]),
}));

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ChatHistorySidebar', () => {
  const defaultProps = {
    sessions: [] as ChatSession[],
    activeSessionId: '',
    aiProvider: 'claude' as const,
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    onUpdateSessions: vi.fn(),
    projectPath: '/test/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    const { container } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders search input', () => {
    const { container } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(container.querySelector('input[placeholder*="Search"]')).toBeTruthy();
  });

  it('renders New Chat button', () => {
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(getByText('New Chat')).toBeTruthy();
  });

  it('calls onNewChat when New Chat button is clicked', () => {
    const onNewChat = vi.fn();
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} onNewChat={onNewChat} />);
    fireEvent.click(getByText('New Chat'));
    expect(onNewChat).toHaveBeenCalled();
  });

  it('shows "No conversations yet" when sessions list is empty', () => {
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} />);
    expect(getByText('No conversations yet')).toBeTruthy();
  });

  it('renders session cards for provided sessions', () => {
    const sessions = [
      makeSession({ title: 'First chat' }),
      makeSession({ title: 'Second chat' }),
    ];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    expect(getByText('First chat')).toBeTruthy();
    expect(getByText('Second chat')).toBeTruthy();
  });

  it('highlights the active session', () => {
    const sessions = [makeSession({ title: 'Active one' })];
    const { container } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} activeSessionId={sessions[0].id} />
    );
    const activeCard = container.querySelector('.history-card-active');
    expect(activeCard).toBeTruthy();
  });

  it('calls onSelectSession when a session card is clicked', () => {
    const onSelectSession = vi.fn();
    const sessions = [makeSession({ title: 'Click me' })];
    const { getByText } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} onSelectSession={onSelectSession} />
    );
    fireEvent.click(getByText('Click me'));
    expect(onSelectSession).toHaveBeenCalledWith(sessions[0].id);
  });

  it('shows pinned section when pinned sessions exist', () => {
    const sessions = [makeSession({ title: 'Pinned one', pinned: true })];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    expect(getByText('Pinned')).toBeTruthy();
  });

  it('filters sessions by search query', async () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Auth middleware' }),
      makeSession({ id: 's2', title: 'Border fix' }),
    ];

    const { container, getByText, queryByText } = render(
      <ChatHistorySidebar {...defaultProps} sessions={sessions} />
    );
    const input = container.querySelector('input')!;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'auth' } });
      await new Promise(r => setTimeout(r, 350));
    });

    expect(getByText('Auth middleware')).toBeTruthy();
    expect(queryByText('Border fix')).toBeNull();
  });

  it('shows context menu on right-click', () => {
    const sessions = [makeSession({ title: 'Right-click me' })];
    const { getByText } = render(<ChatHistorySidebar {...defaultProps} sessions={sessions} />);
    fireEvent.contextMenu(getByText('Right-click me'));
    expect(getByText('Rename')).toBeTruthy();
  });

  it('renders running state on a streaming session', () => {
    const s = makeSession({ id: 'a' });
    render(<ChatHistorySidebar
      {...defaultProps}
      sessions={[s]}
      streamingSessionIds={new Set(['a'])}
    />);
    expect(screen.getByTestId('sidebar-status-a-busy')).toBeInTheDocument();
  });

  it('renders awaiting state on an approval-pending session', () => {
    const s = makeSession({ id: 'b' });
    render(<ChatHistorySidebar
      {...defaultProps}
      sessions={[s]}
      awaitingSessionIds={new Set(['b'])}
    />);
    expect(screen.getByTestId('sidebar-status-b-awaiting')).toBeInTheDocument();
  });

  it('renders error state on an errored session', () => {
    const s = makeSession({ id: 'c' });
    render(<ChatHistorySidebar
      {...defaultProps}
      sessions={[s]}
      errorSessionIds={new Set(['c'])}
    />);
    expect(screen.getByTestId('sidebar-status-c-error')).toBeInTheDocument();
  });

  it('renders suspended state on a session whose scope was reaped by the idle sweep', () => {
    const s = makeSession({ id: 'd' });
    render(<ChatHistorySidebar
      {...defaultProps}
      sessions={[s]}
      suspendedSessionIds={new Set(['d'])}
    />);
    expect(screen.getByTestId('sidebar-status-d-suspended')).toBeInTheDocument();
  });

  it('prefers higher-priority indicators over suspended', () => {
    // Busy spinner should win over suspended when both apply mid-resume
    const s = makeSession({ id: 'e' });
    render(<ChatHistorySidebar
      {...defaultProps}
      sessions={[s]}
      streamingSessionIds={new Set(['e'])}
      suspendedSessionIds={new Set(['e'])}
    />);
    expect(screen.getByTestId('sidebar-status-e-busy')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-status-e-suspended')).not.toBeInTheDocument();
  });

  const baseProps = defaultProps;

  it('marks a non-active session as unread when updatedAt > lastViewedAt', () => {
    const unread = makeSession({ id: 'u', updatedAt: 2000, lastViewedAt: 1000 });
    render(<ChatHistorySidebar
      {...baseProps}
      activeSessionId="other"
      sessions={[unread]}
    />);
    expect(screen.getByTestId('sidebar-status-u-done')).toBeInTheDocument();
  });

  it('does not mark the active session as unread', () => {
    const unread = makeSession({ id: 'u', updatedAt: 2000, lastViewedAt: 1000 });
    render(<ChatHistorySidebar
      {...baseProps}
      activeSessionId="u"
      sessions={[unread]}
    />);
    expect(screen.queryByTestId('sidebar-status-u-done')).not.toBeInTheDocument();
  });

  it('does not mark a viewed session as unread', () => {
    const viewed = makeSession({ id: 'v', updatedAt: 1000, lastViewedAt: 2000 });
    render(<ChatHistorySidebar
      {...baseProps}
      activeSessionId="other"
      sessions={[viewed]}
    />);
    expect(screen.queryByTestId('sidebar-status-v-done')).not.toBeInTheDocument();
  });

  it('shows only sessions matching the active provider, inferring from session IDs for untagged sessions', () => {
    const claudeTagged = makeSession({ title: 'Claude tagged', aiProvider: 'claude' });
    const claudeInferred = makeSession({ title: 'Claude inferred', claudeSessionId: 'c-123' });
    const claudeDefault = makeSession({ title: 'Claude default' }); // no aiProvider, no sessionIds → infers claude
    const geminiTagged = makeSession({ title: 'Gemini tagged', aiProvider: 'gemini' });
    const geminiInferred = makeSession({ title: 'Gemini inferred', geminiSessionId: 'g-123' });

    const { getByText, queryByText } = render(
      <ChatHistorySidebar
        {...baseProps}
        aiProvider="claude"
        sessions={[claudeTagged, claudeInferred, claudeDefault, geminiTagged, geminiInferred]}
      />
    );

    // Claude sessions should be visible
    expect(getByText('Claude tagged')).toBeTruthy();
    expect(getByText('Claude inferred')).toBeTruthy();
    expect(getByText('Claude default')).toBeTruthy();

    // Gemini sessions must NOT appear when filtering for claude
    expect(queryByText('Gemini tagged')).toBeNull();
    expect(queryByText('Gemini inferred')).toBeNull();
  });
});
