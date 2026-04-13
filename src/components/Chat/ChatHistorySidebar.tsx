import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Plus, Pin, Loader2 } from 'lucide-react';
import { formatSessionDate, formatSessionTime, exportSessionAsMarkdown } from '../../sessions';
import { dbGetMessages, dbDeleteSession, dbSaveSession } from '../../chatDb';
import ChatHistoryContextMenu from './ChatHistoryContextMenu';
import type { ChatSession } from '../../types';

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  aiProvider: 'claude' | 'codex' | 'gemini';
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onUpdateSessions: (sessions: ChatSession[]) => void;
  projectPath: string;
  titleGeneratingIds?: Set<string>;
}

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#d4a574',
  codex: '#74aa9c',
  gemini: '#8b9cf7',
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatSessionTime(timestamp);
}

function getSessionPreview(session: ChatSession): string {
  const messages = session.messages;
  if (messages && messages.length > 0) {
    const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
    if (firstUser) return firstUser.content;
    const secondUser = messages.find((m, i) => i > 0 && m.role === 'user' && m.content.trim());
    if (secondUser) return secondUser.content;
  }
  return '';
}

/** Extract a snippet around the first match, returning { before, match, after } */
function getMatchSnippet(text: string, query: string, contextChars = 30): { before: string; match: string; after: string } | null {
  if (!query) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return null;

  const matchText = text.slice(idx, idx + query.length);
  let start = Math.max(0, idx - contextChars);
  let end = Math.min(text.length, idx + query.length + contextChars);

  // Snap to word boundaries
  if (start > 0) {
    const spaceIdx = text.indexOf(' ', start);
    if (spaceIdx !== -1 && spaceIdx < idx) start = spaceIdx + 1;
  }
  if (end < text.length) {
    const spaceIdx = text.lastIndexOf(' ', end);
    if (spaceIdx > idx + query.length) end = spaceIdx;
  }

  const before = (start > 0 ? '...' : '') + text.slice(start, idx);
  const after = text.slice(idx + query.length, end) + (end < text.length ? '...' : '');
  return { before, match: matchText, after };
}

export default function ChatHistorySidebar({
  sessions,
  activeSessionId,
  aiProvider,
  onSelectSession,
  onNewChat,
  onUpdateSessions,
  projectPath,
  titleGeneratingIds,
}: ChatHistorySidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [searchCache, setSearchCache] = useState<Map<string, { raw: string; lower: string }>>(new Map());

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Focus rename input when editing
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  // Filter sessions by provider
  const providerSessions = useMemo(
    () => sessions.filter(s => !s.aiProvider || s.aiProvider === aiProvider),
    [sessions, aiProvider]
  );

  // Build search cache asynchronously
  useEffect(() => {
    if (!debouncedQuery) return;
    let cancelled = false;
    (async () => {
      const toLoad = providerSessions.filter(s => !searchCache.has(s.id));
      if (toLoad.length === 0) return;
      const newEntries = new Map(searchCache);
      for (const session of toLoad) {
        const messages = await dbGetMessages(session.id);
        const raw = messages.map(m => m.content).join(' ');
        newEntries.set(session.id, { raw, lower: raw.toLowerCase() });
      }
      if (!cancelled) setSearchCache(newEntries);
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery, providerSessions]);

  const getSearchContent = useCallback((sessionId: string): string => {
    return searchCache.get(sessionId)?.lower || '';
  }, [searchCache]);

  const getRawSearchContent = useCallback((sessionId: string): string => {
    return searchCache.get(sessionId)?.raw || '';
  }, [searchCache]);

  // Filter by search query
  const filteredSessions = useMemo(() => {
    if (!debouncedQuery.trim()) return providerSessions;
    const q = debouncedQuery.toLowerCase();
    return providerSessions.filter(s => {
      if (s.title.toLowerCase().includes(q)) return true;
      return getSearchContent(s.id).includes(q);
    });
  }, [providerSessions, debouncedQuery, getSearchContent]);

  // Group sessions: pinned first, then by date
  const groupedSessions = useMemo(() => {
    if (debouncedQuery.trim()) {
      return [{ label: 'Results', sessions: filteredSessions }];
    }

    const pinned = filteredSessions.filter(s => s.pinned);
    const unpinned = filteredSessions.filter(s => !s.pinned);

    const groups: { label: string; sessions: ChatSession[] }[] = [];

    if (pinned.length > 0) {
      groups.push({ label: 'Pinned', sessions: pinned });
    }

    for (const session of unpinned) {
      const label = formatSessionDate(session.updatedAt);
      const existing = groups.find(g => g.label === label);
      if (existing) existing.sessions.push(session);
      else groups.push({ label, sessions: [session] });
    }

    return groups;
  }, [filteredSessions, debouncedQuery]);

  // Get a search snippet for the session when searching
  const getSearchSnippet = useCallback((sessionId: string): { before: string; match: string; after: string } | null => {
    if (!debouncedQuery.trim()) return null;
    // Try title first
    const session = providerSessions.find(s => s.id === sessionId);
    if (session) {
      const titleSnippet = getMatchSnippet(session.title, debouncedQuery);
      if (titleSnippet) return titleSnippet;
    }
    // Try message content
    const raw = getRawSearchContent(sessionId);
    return getMatchSnippet(raw, debouncedQuery);
  }, [debouncedQuery, providerSessions, getRawSearchContent]);

  const getMessageCount = useCallback((session: ChatSession): number => {
    if (session.messages && session.messages.length > 0) return session.messages.length;
    return session.messageCount || 0;
  }, []);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  const handleContextAction = (action: string) => {
    if (!contextMenu) return;
    const { sessionId } = contextMenu;

    switch (action) {
      case 'rename': {
        const session = sessions.find(s => s.id === sessionId);
        setRenamingId(sessionId);
        setRenameValue(session?.title || '');
        break;
      }
      case 'pin': {
        const toggled = sessions.map(s =>
          s.id === sessionId ? { ...s, pinned: !s.pinned } : s
        );
        onUpdateSessions(toggled);
        const session = toggled.find(s => s.id === sessionId);
        if (session) {
          dbSaveSession(projectPath, session).catch(() => {});
        }
        break;
      }
      case 'export': {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          dbGetMessages(sessionId).then(messages => {
            const md = exportSessionAsMarkdown(session.title || 'Untitled', messages);
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${session.title || 'chat'}.md`;
            a.click();
            URL.revokeObjectURL(url);
          });
        }
        break;
      }
      case 'delete': {
        const updated = sessions.filter(s => s.id !== sessionId);
        onUpdateSessions(updated);
        dbDeleteSession(sessionId).catch(() => {});
        break;
      }
    }
    setContextMenu(null);
  };

  const handleRenameSubmit = (sessionId: string) => {
    if (renameValue.trim()) {
      const updated = sessions.map(s =>
        s.id === sessionId ? { ...s, title: renameValue.trim(), titleEdited: true } : s
      );
      onUpdateSessions(updated);
      const session = updated.find(s => s.id === sessionId);
      if (session) {
        dbSaveSession(projectPath, session).catch(() => {});
      }
    }
    setRenamingId(null);
  };

  const providerColor = PROVIDER_COLORS[aiProvider] || '#888';

  return (
    <div className="chat-history-sidebar">
      {/* Search bar */}
      <div className="chat-history-search">
        <Search size={12} className="chat-history-search-icon" />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="chat-history-search-input"
        />
        {searchQuery && (
          <button className="chat-history-search-clear" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* New Chat button */}
      <button className="chat-history-new-btn" onClick={onNewChat}>
        <Plus size={14} />
        New Chat
      </button>

      {/* Session list */}
      <div className="chat-history-list">
        {filteredSessions.length === 0 ? (
          <div className="chat-history-empty">
            {debouncedQuery ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label}>
              <div className="chat-history-group-label">
                {group.label === 'Pinned' && <Pin size={10} />}
                {group.label}
              </div>
              {group.sessions.map(session => (
                <div
                  key={session.id}
                  className={`chat-history-card ${session.id === activeSessionId ? 'history-card-active' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                  onContextMenu={e => handleContextMenu(e, session.id)}
                >
                  {renamingId === session.id ? (
                    <input
                      ref={renameRef}
                      className="chat-history-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(session.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit(session.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="chat-history-card-header">
                        <span
                          className="chat-history-provider-dot"
                          style={{ background: PROVIDER_COLORS[session.aiProvider || aiProvider] || providerColor }}
                        />
                        <span className="chat-history-card-title">{session.title || 'Untitled'}</span>
                        {titleGeneratingIds?.has(session.id) && (
                          <Loader2 size={11} className="chat-history-title-spinner" />
                        )}
                        {session.id === activeSessionId && (
                          <span className="chat-history-active-badge">ACTIVE</span>
                        )}
                      </div>
                      {debouncedQuery.trim() ? (
                        (() => {
                          const snippet = getSearchSnippet(session.id);
                          if (!snippet) return null;
                          return (
                            <div className="chat-history-card-preview">
                              {snippet.before}<mark className="chat-history-match">{snippet.match}</mark>{snippet.after}
                            </div>
                          );
                        })()
                      ) : (
                        getSessionPreview(session) && (
                          <div className="chat-history-card-preview">
                            {getSessionPreview(session)}
                          </div>
                        )
                      )}
                      <div className="chat-history-card-meta">
                        <span>{getMessageCount(session)} msgs</span>
                        <span className="chat-history-meta-dot">&middot;</span>
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ChatHistoryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          pinned={sessions.find(s => s.id === contextMenu.sessionId)?.pinned || false}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <style>{`
        .chat-history-sidebar {
          width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
        }
        .chat-history-search {
          padding: 8px 10px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 6px;
          position: relative;
        }
        .chat-history-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .chat-history-search-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text);
          font-size: 12px;
          font-family: inherit;
          outline: none;
        }
        .chat-history-search-input::placeholder {
          color: var(--text-muted);
        }
        .chat-history-search-clear {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
        }
        .chat-history-search-clear:hover {
          color: var(--text);
        }
        .chat-history-new-btn {
          margin: 6px 10px;
          padding: 5px 10px;
          background: var(--bg-hover);
          border: 1px solid var(--border);
          border-radius: 5px;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;
          transition: background 0.15s;
        }
        .chat-history-new-btn:hover {
          background: var(--bg-elevated);
        }
        .chat-history-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        .chat-history-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }
        .chat-history-group-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .chat-history-card {
          padding: 8px 10px;
          margin: 1px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .chat-history-card:hover {
          background: rgba(255,255,255,0.04);
        }
        .history-card-active {
          border-left: 2px solid var(--accent);
          background: rgba(199,145,12,0.12);
        }
        .history-card-active:hover {
          background: rgba(199,145,12,0.15);
        }
        .chat-history-card-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 3px;
        }
        .chat-history-provider-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          opacity: 0.7;
        }
        .chat-history-card-title {
          font-weight: 500;
          font-size: 13px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .chat-history-active-badge {
          font-size: 9px;
          background: var(--accent);
          color: #000;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .chat-history-card-preview {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          margin-bottom: 4px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .chat-history-card-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0.7;
        }
        .chat-history-meta-dot {
          color: var(--text-muted);
          opacity: 0.4;
        }
        .chat-history-rename-input {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--accent);
          border-radius: 4px;
          padding: 4px 8px;
          color: var(--text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .chat-history-title-spinner {
          flex-shrink: 0;
          color: var(--text-muted);
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .chat-history-match {
          background: rgba(199, 145, 12, 0.3);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
    </div>
  );
}
