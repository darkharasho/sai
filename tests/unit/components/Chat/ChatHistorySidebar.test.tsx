import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
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
});
